import Fastify, { type FastifyInstance } from 'fastify';
import { Registry, collectDefaultMetrics, Counter } from 'prom-client';
import { shipmentRoutes } from './routes/shipments.js';
import { registerErrorHandler } from './errors.js';
import { pingDb } from './db/client.js';

export const SERVICE_NAME = 'logitrack-shipment-service';

/**
 * Readiness is deliberately separate from liveness.
 *
 *   /healthz (liveness)  -> "the process is not wedged". Failing this gets the
 *                           container KILLED, so it must never depend on
 *                           Postgres or Kafka. A DB outage restarting every pod
 *                           in a crash loop is a classic self-inflicted outage.
 *
 *   /readyz  (readiness) -> "this pod can serve traffic right now". Failing this
 *                           only removes the pod from the Service endpoints.
 *                           THIS is where dependency checks belong.
 */
let ready = false;
export const setReady = (v: boolean): void => { ready = v; };

export function buildApp(): FastifyInstance {
  const registry = new Registry();
  registry.setDefaultLabels({ service: SERVICE_NAME });
  collectDefaultMetrics({ register: registry });

  const httpRequests = new Counter({
    name: 'http_requests_total',
    help: 'Total HTTP requests',
    labelNames: ['method', 'route', 'status'] as const,
    registers: [registry],
  });

  const app = Fastify({
    // Structured JSON logs to stdout. Never log to files in a container -
    // the collector (Promtail/Fluent Bit) reads stdout, and a file inside an
    // ephemeral filesystem is lost the moment the pod is rescheduled.
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
    // Trust the ingress controller's X-Forwarded-* headers so client IPs
    // (used for rate limiting) are real rather than the ingress pod's IP.
    trustProxy: true,
  });

  app.addHook('onResponse', (req, reply, done) => {
    httpRequests.inc({
      method: req.method,
      route: req.routeOptions.url ?? 'unknown',
      status: String(reply.statusCode),
    });
    done();
  });

  app.get('/healthz', () => ({ status: 'ok', service: SERVICE_NAME }));

  app.get('/readyz', async (_req, reply) => {
    if (!ready) return reply.code(503).send({ status: 'not-ready', service: SERVICE_NAME });

    // Readiness DOES check dependencies - failing only removes this pod from
    // the Service endpoints. Kafka is deliberately not checked: the outbox
    // means the service can still accept writes with the broker down, so
    // refusing traffic would be worse than queueing.
    const db = await pingDb();
    if (!db) {
      return reply.code(503).send({ status: 'not-ready', service: SERVICE_NAME, db: false });
    }
    return { status: 'ready', service: SERVICE_NAME, db: true };
  });

  app.get('/metrics', async (_req, reply) => {
    reply.header('Content-Type', registry.contentType);
    return registry.metrics();
  });

  registerErrorHandler(app);
  void app.register(shipmentRoutes);

  return app;
}