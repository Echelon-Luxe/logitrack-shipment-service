import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import {
  createShipment, getShipment, listShipments, assignDriver, changeStatus, shipmentStats, NotFoundError,
} from '../domain/shipments.js';
import { SHIPMENT_STATUSES, nextStatuses, type ShipmentStatus } from '../domain/status.js';
import { canRead, scopeFor, canCreate, canAssign, assertCanChangeStatus } from '../domain/access.js';
import { resolveAssignableDriver } from '../domain/driver-client.js';
import { quote } from '../domain/pricing.js';
import { identity, ForbiddenError, OPERATORS, hasRole } from '../authz.js';

const Lat = z.number().min(-90).max(90);
const Lng = z.number().min(-180).max(180);

const CreateBody = z.object({
  // Only ADMIN/DISPATCHER may name a customer; for a customer it is always self.
  customerId: z.string().min(1).optional(),
  customerName: z.string().max(120).optional(),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().max(32).optional(),
  origin: z.string().min(1).max(200),
  destination: z.string().min(1).max(200),
  originLat: Lat.optional(),
  originLng: Lng.optional(),
  destLat: Lat.optional(),
  destLng: Lng.optional(),
  notes: z.string().max(500).optional(),
});

const QuoteBody = z.object({ originLat: Lat, originLng: Lng, destLat: Lat, destLng: Lng });
const StatusBody = z.object({ status: z.enum(SHIPMENT_STATUSES) });
const AssignBody = z.object({ driverId: z.string().min(1) });
const IdParam = z.object({ id: z.string().uuid() });

const ListQuery = z.object({
  customerId: z.string().optional(),
  driverId: z.string().optional(),
  status: z.enum(SHIPMENT_STATUSES).optional(),
  // Comma-separated, e.g. ?statuses=PICKED_UP,IN_TRANSIT for "active".
  statuses: z.string().optional().transform((v) =>
    v ? v.split(',').filter((s): s is ShipmentStatus => (SHIPMENT_STATUSES as readonly string[]).includes(s)) : undefined),
  q: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const traceOf = (h: Record<string, unknown>): string | undefined =>
  typeof h['x-trace-id'] === 'string' ? h['x-trace-id'] : undefined;

// Drop undefined values: exactOptionalPropertyTypes treats an explicit
// undefined as different from an omitted key.
const defined = <T extends object>(o: T): { [K in keyof T]: Exclude<T[K], undefined> } =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as never;

export async function shipmentRoutes(app: FastifyInstance): Promise<void> {
  app.post('/shipments', async (req, reply) => {
    const id = identity(req);
    if (!canCreate(id)) throw new ForbiddenError('Your role cannot create shipments');
    const body = CreateBody.parse(req.body);

    const onBehalf = hasRole(id, OPERATORS) && body.customerId;
    const customer = onBehalf
      ? { customerId: body.customerId!, customerName: body.customerName ?? '', customerEmail: body.customerEmail ?? '', customerPhone: body.customerPhone }
      : { customerId: id.userId, customerName: id.name, customerEmail: id.email, customerPhone: body.customerPhone };

    const shipment = await createShipment(prisma, defined({
      ...customer,
      origin: body.origin,
      destination: body.destination,
      originLat: body.originLat,
      originLng: body.originLng,
      destLat: body.destLat,
      destLng: body.destLng,
      notes: body.notes,
      traceId: traceOf(req.headers),
    }));
    return reply.code(201).send(shipment);
  });

  // Price preview for the create form. Same function as creation, so the
  // number shown is the number charged.
  app.post('/shipments/quote', async (req) => {
    identity(req);
    const b = QuoteBody.parse(req.body);
    return quote({ lat: b.originLat, lng: b.originLng }, { lat: b.destLat, lng: b.destLng });
  });

  app.get('/shipments', async (req) => {
    const id = identity(req);
    const q = ListQuery.parse(req.query);
    // Scope last: it overrides any customerId/driver filter the caller sent.
    return listShipments(prisma, defined({
      customerId: q.customerId,
      driverId: q.driverId,
      status: q.status,
      statuses: q.statuses,
      q: q.q,
      limit: q.limit,
      ...scopeFor(id),
    }));
  });

  app.get('/shipments/stats', async (req) => {
    const id = identity(req);
    const { days } = z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }).parse(req.query);
    return shipmentStats(prisma, scopeFor(id), days);
  });

  app.get('/shipments/:id', async (req) => {
    const id = identity(req);
    const { id: shipmentId } = IdParam.parse(req.params);
    const s = await getShipment(prisma, shipmentId);
    // 404, not 403: a 403 would confirm the id exists to someone who may not
    // know it.
    if (!canRead(id, s)) throw new NotFoundError(shipmentId);
    return { ...s, allowedNext: nextStatuses(s.status as ShipmentStatus) };
  });

  app.post('/shipments/:id/assign', async (req) => {
    const id = identity(req);
    if (!canAssign(id)) throw new ForbiddenError('Only dispatch can assign drivers');
    const { id: shipmentId } = IdParam.parse(req.params);
    const { driverId } = AssignBody.parse(req.body);
    // Existence first, so an unknown shipment is a 404 rather than a driver error.
    await getShipment(prisma, shipmentId);
    const driver = await resolveAssignableDriver(driverId);
    return assignDriver(prisma, shipmentId, driver, traceOf(req.headers));
  });

  app.post('/shipments/:id/status', async (req) => {
    const id = identity(req);
    const { id: shipmentId } = IdParam.parse(req.params);
    const { status } = StatusBody.parse(req.body);
    return changeStatus(prisma, shipmentId, status, traceOf(req.headers), (current) => {
      if (!canRead(id, current)) throw new NotFoundError(shipmentId);
      assertCanChangeStatus(id, current, status);
    });
  });
}
