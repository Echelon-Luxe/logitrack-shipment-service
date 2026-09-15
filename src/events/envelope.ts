import { randomUUID } from 'node:crypto';

export interface EventEnvelope<T = unknown> {
  eventId: string;
  eventType: string;
  eventVersion: number;
  occurredAt: string;
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
