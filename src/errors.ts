import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({
        error: 'ValidationError',
        details: err.issues.map((i: { path: PropertyKey[]; message: string }) => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    const e = err as Error & { statusCode?: number };
    const status = e.statusCode;
    // Only 4xx messages are returned; 5xx text can leak internals.
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(status).send({ error: e.name, message: e.message });
    }

    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'InternalServerError' });
  });
}
