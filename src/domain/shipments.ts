import type { Prisma, PrismaClient, Shipment } from '@prisma/client';
import { quote } from './pricing.js';
import { assertTransition, eventTypeForStatus, type ShipmentStatus } from './status.js';
import { buildEnvelope, type ShipmentEventPayload } from '../events/envelope.js';

const PRODUCER = 'logitrack-shipment-service';

export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(id: string) {
    super(`Shipment ${id} not found`);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'ConflictError';
  }
}

const toPayload = (s: Shipment): ShipmentEventPayload => ({
  shipmentId: s.id,
  reference: s.reference,
  status: s.status,
  customerId: s.customerId,
  driverId: s.driverId,
  driverUserId: s.driverUserId ?? null,
  origin: s.origin,
  destination: s.destination,
  originLat: s.originLat ?? null,
  originLng: s.originLng ?? null,
  destLat: s.destLat ?? null,
  destLng: s.destLng ?? null,
  priceKobo: s.priceKobo ?? 0,
  customerName: s.customerName ?? '',
  driverName: s.driverName ?? null,
});

// Display reference, not a security token.
const newReference = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `LT-${out}`;
};

// Each mutation writes the row and its outbox event in one transaction.

export interface CreateInput {
  customerId: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  origin: string;
  destination: string;
  originLat?: number;
  originLng?: number;
  destLat?: number;
  destLng?: number;
  notes?: string;
  traceId?: string;
}

const pointOf = (lat?: number, lng?: number) =>
  lat !== undefined && lng !== undefined ? { lat, lng } : null;

export async function createShipment(db: PrismaClient, input: CreateInput): Promise<Shipment> {
  const from = pointOf(input.originLat, input.originLng);
  const to = pointOf(input.destLat, input.destLng);
  const { priceKobo, distanceKm } = quote(from, to);
  return db.$transaction(async (tx) => {
    const shipment = await tx.shipment.create({
      data: {
        reference: newReference(),
        customerId: input.customerId,
        customerName: input.customerName ?? '',
        customerEmail: input.customerEmail ?? '',
        ...(input.customerPhone ? { customerPhone: input.customerPhone } : {}),
        origin: input.origin,
        destination: input.destination,
        ...(from ? { originLat: from.lat, originLng: from.lng } : {}),
        ...(to ? { destLat: to.lat, destLng: to.lng } : {}),
        ...(input.notes ? { notes: input.notes } : {}),
        priceKobo,
        distanceKm,
      },
    });
    await tx.outboxEvent.create({
      data: {
        partitionKey: shipment.id,
        eventType: 'shipment.created',
        envelope: buildEnvelope({
          eventType: 'shipment.created',
          payload: toPayload(shipment),
          producer: PRODUCER,
          ...(input.traceId ? { traceId: input.traceId } : {}),
        }) as object,
      },
    });
    return shipment;
  });
}

export interface AssignedDriver {
  id: string;
  userId: string;
  name: string;
  phone?: string | null;
}

export async function assignDriver(
  db: PrismaClient,
  id: string,
  driver: AssignedDriver,
  traceId?: string,
): Promise<Shipment> {
  return db.$transaction(async (tx) => {
    const current = await tx.shipment.findUnique({ where: { id } });
    if (!current) throw new NotFoundError(id);
    // Not a status change, but meaningless once terminal.
    assertTransition(current.status as ShipmentStatus, 'PICKED_UP');

    const shipment = await tx.shipment.update({
      where: { id },
      data: {
        driverId: driver.id,
        driverUserId: driver.userId,
        driverName: driver.name,
        driverPhone: driver.phone ?? null,
      },
    });
    await tx.outboxEvent.create({
      data: {
        partitionKey: shipment.id,
        eventType: 'shipment.assigned',
        envelope: buildEnvelope({
          eventType: 'shipment.assigned',
          payload: toPayload(shipment),
          producer: PRODUCER,
          ...(traceId ? { traceId } : {}),
        }) as object,
      },
    });
    return shipment;
  });
}

export async function changeStatus(
  db: PrismaClient,
  id: string,
  to: ShipmentStatus,
  traceId?: string,
  // Runs against the row read inside the transaction, so the permission check
  // and the write see the same state.
  authorize?: (current: Shipment) => void,
): Promise<Shipment> {
  return db.$transaction(async (tx) => {
    const current = await tx.shipment.findUnique({ where: { id } });
    if (!current) throw new NotFoundError(id);
    assertTransition(current.status as ShipmentStatus, to);
    // Nobody can pick up a parcel that has no driver; the timeline and the
    // driver's earnings would both be attributed to no one.
    if (to === 'PICKED_UP' && !current.driverId) {
      throw new ConflictError('Assign a driver before marking the shipment picked up');
    }
    if (authorize) authorize(current);

    const shipment = await tx.shipment.update({ where: { id }, data: { status: to } });
    const eventType = eventTypeForStatus(to);
    await tx.outboxEvent.create({
      data: {
        partitionKey: shipment.id,
        eventType,
        envelope: buildEnvelope({
          eventType,
          payload: toPayload(shipment),
          producer: PRODUCER,
          ...(traceId ? { traceId } : {}),
        }) as object,
      },
    });
    return shipment;
  });
}

export async function getShipment(db: PrismaClient, id: string): Promise<Shipment> {
  const s = await db.shipment.findUnique({ where: { id } });
  if (!s) throw new NotFoundError(id);
  return s;
}

export interface ListFilter {
  customerId?: string;
  driverId?: string;
  driverUserId?: string;
  status?: ShipmentStatus;
  statuses?: ShipmentStatus[];
  q?: string;
  limit?: number;
}

const whereOf = (filter: ListFilter): Prisma.ShipmentWhereInput => ({
  ...(filter.customerId ? { customerId: filter.customerId } : {}),
  ...(filter.driverId ? { driverId: filter.driverId } : {}),
  ...(filter.driverUserId ? { driverUserId: filter.driverUserId } : {}),
  ...(filter.status ? { status: filter.status } : filter.statuses?.length ? { status: { in: filter.statuses } } : {}),
  ...(filter.q
    ? {
        OR: [
          { reference: { contains: filter.q, mode: 'insensitive' as const } },
          { origin: { contains: filter.q, mode: 'insensitive' as const } },
          { destination: { contains: filter.q, mode: 'insensitive' as const } },
          { customerName: { contains: filter.q, mode: 'insensitive' as const } },
          { driverName: { contains: filter.q, mode: 'insensitive' as const } },
        ],
      }
    : {}),
});

export async function listShipments(db: PrismaClient, filter: ListFilter): Promise<Shipment[]> {
  return db.shipment.findMany({
    where: whereOf(filter),
    orderBy: { createdAt: 'desc' },
    take: Math.min(filter.limit ?? 50, 200),
  });
}

/**
 * Dashboard numbers within the caller's scope: totals by status, revenue, and
 * one bucket per day for the last `days` days (oldest first, gaps as zero).
 */
export async function shipmentStats(
  db: PrismaClient,
  scope: Pick<ListFilter, 'customerId' | 'driverUserId'>,
  days = 14,
) {
  const where = whereOf(scope);
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - (days - 1));

  const [byStatus, recent, revenue] = await Promise.all([
    db.shipment.groupBy({ by: ['status'], where, _count: { _all: true } }),
    db.shipment.findMany({ where: { ...where, createdAt: { gte: since } }, select: { createdAt: true, status: true } }),
    db.shipment.aggregate({ where: { ...where, status: { not: 'CANCELLED' } }, _sum: { priceKobo: true } }),
  ]);

  const counts: Record<string, number> = {};
  for (const g of byStatus) counts[g.status] = g._count._all;

  const daily: { date: string; created: number; delivered: number }[] = [];
  for (let i = 0; i < days; i++) {
    const d = new Date(since);
    d.setUTCDate(since.getUTCDate() + i);
    daily.push({ date: d.toISOString().slice(0, 10), created: 0, delivered: 0 });
  }
  const index = new Map(daily.map((d, i) => [d.date, i]));
  for (const r of recent) {
    const i = index.get(r.createdAt.toISOString().slice(0, 10));
    if (i === undefined) continue;
    daily[i]!.created += 1;
    if (r.status === 'DELIVERED') daily[i]!.delivered += 1;
  }

  return {
    total: Object.values(counts).reduce((a, b) => a + b, 0),
    byStatus: counts,
    revenueKobo: revenue._sum.priceKobo ?? 0,
    daily,
  };
}
