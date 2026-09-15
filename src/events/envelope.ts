import { randomUUID } from 'node:crypto';

/**
 * The wire contract every LogiTrack service agrees on.
 *
 * Duplicated verbatim in each consumer repo rather than shared via a package.
 * That is a deliberate microservice trade-off: a shared library would couple
 * the deploy cycles of all six services (bump the lib, redeploy everything),
 * whereas duplication lets a consumer keep running old code against a new
 * producer. The cost is that changes must be made compatibly - which is
 * exactly what eventVersion is for.
 */
export interface EventEnvelope<T = unknown> {
  /** Consumer idempotency key. Kafka is at-least-once; duplicates WILL arrive. */
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
  /** Stitches async hops together in distributed traces. */
  traceId: string;
  producer: string;
  payload: T;
}

export interface ShipmentEventPayload {
  shipmentId: string;
  reference: string;
  status: string;
  customerId: string;
  driverId: string | null;
  origin: string;
  destination: string;
}

export function buildEnvelope<T>(args: {
  eventType: string;
  payload: T;
  producer: string;
  traceId?: string;
  eventVersion?: number;
}): EventEnvelope<T> {
  return {
    eventId: randomUUID(),
    eventType: args.eventType,
    eventVersion: args.eventVersion ?? 1,
    occurredAt: new Date().toISOString(),
    traceId: args.traceId ?? randomUUID(),
    producer: args.producer,
    payload: args.payload,
  };
}

export const SHIPMENT_EVENTS_TOPIC = 'logitrack.shipment.events';
export const SHIPMENT_EVENTS_DLQ = 'logitrack.shipment.events.dlq';
