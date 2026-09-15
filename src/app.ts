import Fastify, { type FastifyInstance } from 'fastify';
import { Registry, collectDefaultMetrics, Counter } from 'prom-client';
import { shipmentRoutes } from './routes/shipments.js';
import { registerErrorHandler } from './errors.js';
import { pingDb } from './db/client.js';

export const SERVICE_NAME = 'logitrack-shipment-service';

// Liveness must not check dependencies: failing it kills the container.
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
    logger: { level: process.env['LOG_LEVEL'] ?? 'info' },
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

    // Kafka is not checked: the outbox lets writes continue without a broker.
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