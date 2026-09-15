import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';

/**
 * One error handler, so no route has to remember to map domain errors to
 * status codes. Domain errors carry their own statusCode; anything else is a
 * 500 and is logged with the stack but NOT returned to the caller - leaking
 * internals is how stack traces end up in bug reports from strangers.
 */
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

    // Fastify types the handler argument as unknown once ZodError is narrowed off.
    const e = err as Error & { statusCode?: number };
    const status = e.statusCode;
    // Only 4xx messages are safe to return: they describe what the CALLER did
    // wrong. 5xx messages describe what we did wrong and can leak internals.
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(status).send({ error: e.name, message: e.message });
    }

    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'InternalServerError' });
  });
}
