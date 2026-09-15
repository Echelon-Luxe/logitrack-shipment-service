import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db/client.js';
import {
  createShipment, getShipment, listShipments, assignDriver, changeStatus,
} from '../domain/shipments.js';
import { SHIPMENT_STATUSES } from '../domain/status.js';

const CreateBody = z.object({
  customerId: z.string().min(1),
  origin: z.string().min(1).max(200),
  destination: z.string().min(1).max(200),
});

const StatusBody = z.object({ status: z.enum(SHIPMENT_STATUSES) });
const AssignBody = z.object({ driverId: z.string().min(1) });

const ListQuery = z.object({
  customerId: z.string().optional(),
  driverId: z.string().optional(),
  status: z.enum(SHIPMENT_STATUSES).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

// Safe to trust only because backends are ClusterIP-only.
const traceOf = (h: Record<string, unknown>): string | undefined =>
  typeof h['x-trace-id'] === 'string' ? h['x-trace-id'] : undefined;

export async function shipmentRoutes(app: FastifyInstance): Promise<void> {
  app.post('/shipments', async (req, reply) => {
    const body = CreateBody.parse(req.body);
    const shipment = await createShipment(prisma, {
      ...body,
      ...(traceOf(req.headers) ? { traceId: traceOf(req.headers)! } : {}),
    });
    return reply.code(201).send(shipment);
  });

  app.get('/shipments', async (req) => {
    const q = ListQuery.parse(req.query);
    // exactOptionalPropertyTypes: an explicit undefined is not an omitted key.
    return listShipments(prisma, {
      ...(q.customerId !== undefined ? { customerId: q.customerId } : {}),
      ...(q.driverId !== undefined ? { driverId: q.driverId } : {}),
      ...(q.status !== undefined ? { status: q.status } : {}),
      ...(q.limit !== undefined ? { limit: q.limit } : {}),
    });
  });

  app.get('/shipments/:id', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    return getShipment(prisma, id);
  });

  app.post('/shipments/:id/assign', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { driverId } = AssignBody.parse(req.body);
    return assignDriver(prisma, id, driverId, traceOf(req.headers));
  });

  app.post('/shipments/:id/status', async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { status } = StatusBody.parse(req.body);
    return changeStatus(prisma, id, status, traceOf(req.headers));
  });
}
