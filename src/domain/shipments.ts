import type { PrismaClient, Shipment } from '@prisma/client';
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

const toPayload = (s: Shipment): ShipmentEventPayload => ({
  shipmentId: s.id,
  reference: s.reference,
  status: s.status,
  customerId: s.customerId,
  driverId: s.driverId,
  origin: s.origin,
  destination: s.destination,
});

// Display reference, not a security token.
const newReference = (): string => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no I/O/0/1
  let out = '';
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `LT-${out}`;
};

// Each mutation writes the row and its outbox event in one transaction.

export async function createShipment(
  db: PrismaClient,
  input: { customerId: string; origin: string; destination: string; traceId?: string },
): Promise<Shipment> {
  return db.$transaction(async (tx) => {
    const shipment = await tx.shipment.create({
      data: {
        reference: newReference(),
        customerId: input.customerId,
        origin: input.origin,
        destination: input.destination,
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

export async function assignDriver(
  db: PrismaClient,
  id: string,
  driverId: string,
  traceId?: string,
): Promise<Shipment> {
  return db.$transaction(async (tx) => {
    const current = await tx.shipment.findUnique({ where: { id } });
    if (!current) throw new NotFoundError(id);
    // Not a status change, but meaningless once terminal.
    assertTransition(current.status as ShipmentStatus, 'PICKED_UP');

    const shipment = await tx.shipment.update({ where: { id }, data: { driverId } });
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
): Promise<Shipment> {
  return db.$transaction(async (tx) => {
    const current = await tx.shipment.findUnique({ where: { id } });
    if (!current) throw new NotFoundError(id);
    assertTransition(current.status as ShipmentStatus, to);

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

export async function listShipments(
  db: PrismaClient,
  filter: { customerId?: string; driverId?: string; status?: ShipmentStatus; limit?: number },
): Promise<Shipment[]> {
  return db.shipment.findMany({
    where: {
      ...(filter.customerId ? { customerId: filter.customerId } : {}),
      ...(filter.driverId ? { driverId: filter.driverId } : {}),
      ...(filter.status ? { status: filter.status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: Math.min(filter.limit ?? 50, 200),
  });
}
