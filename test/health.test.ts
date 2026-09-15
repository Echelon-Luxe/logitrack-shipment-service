import { describe, it, expect, afterEach, vi } from 'vitest';

// Mock the database module so health tests stay fast and deterministic and do
// not need a live Postgres. The point here is the probe CONTRACT, not Prisma.
const pingDb = vi.fn<() => Promise<boolean>>();
vi.mock('../src/db/client.js', () => ({
  pingDb: () => pingDb(),
  prisma: {},
}));

const { buildApp, setReady } = await import('../src/app.js');

describe('health endpoints', () => {
  afterEach(() => {
    setReady(false);
    pingDb.mockReset();
  });

  it('liveness is up even when the database is unreachable', async () => {
    pingDb.mockResolvedValue(false);
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    // This is the important one: a DB outage must NOT kill the container.
    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('readiness is 503 before the service marks itself ready', async () => {
    pingDb.mockResolvedValue(true);
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    await app.close();
  });

  it('readiness is 503 when the database is unreachable', async () => {
    pingDb.mockResolvedValue(false);
    const app = buildApp();
    setReady(true);
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ db: false });
    await app.close();
  });

  it('readiness is 200 when ready and the database answers', async () => {
    pingDb.mockResolvedValue(true);
    const app = buildApp();
    setReady(true);
    const res = await app.inject({ method: 'GET', url: '/readyz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ db: true });
    await app.close();
  });

  it('exposes prometheus metrics', async () => {
    const app = buildApp();
    const res = await app.inject({ method: 'GET', url: '/metrics' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('process_cpu_user_seconds_total');
    await app.close();
  });
});
