import { Kafka, type Producer, logLevel } from 'kafkajs';
import { prisma } from '../db/client.js';
import { SHIPMENT_EVENTS_TOPIC } from './envelope.js';

const brokers = (process.env['KAFKA_BROKERS'] ?? 'localhost:9092').split(',');

const kafka = new Kafka({
  clientId: 'logitrack-shipment-service',
  brokers,
  logLevel: logLevel.ERROR,
  retry: { initialRetryTime: 300, retries: 5 },
});

let producer: Producer | null = null;
let connected = false;

export const isProducerConnected = (): boolean => connected;

export async function connectProducer(): Promise<void> {
  producer = kafka.producer({ idempotent: true, maxInFlightRequests: 1 });
  await producer.connect();
  connected = true;
}

export async function disconnectProducer(): Promise<void> {
  connected = false;
  await producer?.disconnect();
  producer = null;
}

/**
 * Drains unpublished outbox rows to Kafka, oldest first.
 *
 * Ordering: rows are keyed by shipmentId, so Kafka routes all events for one
 * shipment to the same partition and consumers see them in order. Processing
 * oldest-first preserves that order within the batch too.
 *
 * Failure: a row that cannot be published keeps publishedAt NULL and has its
 * attempt count incremented. It is retried on the next tick rather than
 * dropped, so a broker outage delays events instead of losing them.
 *
 * Returns how many rows were published.
 */
export async function drainOutbox(batchSize = 50): Promise<number> {
  if (!producer || !connected) return 0;

  const pending = await prisma.outboxEvent.findMany({
    where: { publishedAt: null },
    orderBy: { createdAt: 'asc' },
    take: batchSize,
  });
  if (pending.length === 0) return 0;

  let published = 0;
  for (const row of pending) {
    try {
      await producer.send({
        topic: SHIPMENT_EVENTS_TOPIC,
        messages: [{ key: row.partitionKey, value: JSON.stringify(row.envelope) }],
      });
      await prisma.outboxEvent.update({
        where: { id: row.id },
        data: { publishedAt: new Date() },
      });
      published += 1;
    } catch (err) {
      await prisma.outboxEvent.update({
        where: { id: row.id },
        data: {
          attempts: { increment: 1 },
          lastError: err instanceof Error ? err.message : String(err),
        },
      });
      // Stop on first failure: continuing would publish later events for the
      // same shipment ahead of this one and corrupt the timeline.
      break;
    }
  }
  return published;
}

let timer: NodeJS.Timeout | null = null;

export function startOutboxPublisher(intervalMs = 1000): void {
  timer = setInterval(() => {
    void drainOutbox().catch(() => { /* next tick retries */ });
  }, intervalMs);
  timer.unref();
}

export function stopOutboxPublisher(): void {
  if (timer) clearInterval(timer);
  timer = null;
}
