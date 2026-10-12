import { describe, it, expect, afterEach } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { canRead, scopeFor, canCreate, canAssign, assertCanChangeStatus } from '../src/domain/access.js';
import { identity, ForbiddenError, UnauthorizedError, type Identity, type Role } from '../src/authz.js';
import { quote, haversineKm } from '../src/domain/pricing.js';

const who = (role: Role, userId = `${role.toLowerCase()}-1`): Identity => ({ userId, role, email: '', name: '' });
const ship = (over: Record<string, unknown> = {}) => ({
  customerId: 'customer-1', driverUserId: 'driver-1', driverId: 'drv-1', status: 'IN_TRANSIT', ...over,
}) as never;

describe('who can read a shipment', () => {
  it('lets every staff role read any shipment', () => {
    for (const r of ['ADMIN', 'DISPATCHER', 'SUPPORT'] as const) expect(canRead(who(r), ship())).toBe(true);
  });
  it('lets a customer read only their own', () => {
    expect(canRead(who('CUSTOMER'), ship())).toBe(true);
    expect(canRead(who('CUSTOMER', 'customer-2'), ship())).toBe(false);
  });
  it('lets a driver read only what they are assigned', () => {
    expect(canRead(who('DRIVER'), ship())).toBe(true);
    expect(canRead(who('DRIVER', 'driver-2'), ship())).toBe(false);
  });
});

// The scope overrides the caller's filters: ?customerId=someone-else from a
// customer must still return only their rows.
describe('list scoping', () => {
  it('forces customers and drivers onto their own rows', () => {
    expect(scopeFor(who('CUSTOMER'))).toEqual({ customerId: 'customer-1' });
    expect(scopeFor(who('DRIVER'))).toEqual({ driverUserId: 'driver-1' });
  });
  it('leaves staff unscoped', () => {
    expect(scopeFor(who('SUPPORT'))).toEqual({});
  });
});

describe('create and assign', () => {
  it('blocks SUPPORT and DRIVER from creating', () => {
    expect(canCreate(who('SUPPORT'))).toBe(false);
    expect(canCreate(who('DRIVER'))).toBe(false);
    expect(canCreate(who('CUSTOMER'))).toBe(true);
  });
  it('lets only ADMIN and DISPATCHER assign', () => {
    expect(['ADMIN', 'DISPATCHER', 'SUPPORT', 'DRIVER', 'CUSTOMER'].filter((r) => canAssign(who(r as Role)))).toEqual(['ADMIN', 'DISPATCHER']);
  });
});

describe('status changes', () => {
  it('lets the assigned driver advance but not cancel', () => {
    expect(() => assertCanChangeStatus(who('DRIVER'), ship(), 'OUT_FOR_DELIVERY')).not.toThrow();
    expect(() => assertCanChangeStatus(who('DRIVER'), ship(), 'CANCELLED')).toThrow(ForbiddenError);
  });
  it('blocks a driver who is not assigned', () => {
    expect(() => assertCanChangeStatus(who('DRIVER', 'driver-2'), ship(), 'OUT_FOR_DELIVERY')).toThrow(ForbiddenError);
  });
  it('lets a customer cancel only before pickup', () => {
    expect(() => assertCanChangeStatus(who('CUSTOMER'), ship({ status: 'CREATED' }), 'CANCELLED')).not.toThrow();
    expect(() => assertCanChangeStatus(who('CUSTOMER'), ship({ status: 'IN_TRANSIT' }), 'CANCELLED')).toThrow(ForbiddenError);
    expect(() => assertCanChangeStatus(who('CUSTOMER'), ship({ status: 'CREATED' }), 'PICKED_UP')).toThrow(ForbiddenError);
  });
  it('keeps SUPPORT read-only', () => {
    expect(() => assertCanChangeStatus(who('SUPPORT'), ship(), 'DELIVERED')).toThrow(ForbiddenError);
  });
  it('lets dispatch make any legal move', () => {
    expect(() => assertCanChangeStatus(who('DISPATCHER'), ship(), 'CANCELLED')).not.toThrow();
  });
});

describe('identity from gateway headers', () => {
  const req = (headers: Record<string, string>) => ({ headers }) as unknown as FastifyRequest;
  afterEach(() => { delete process.env['INTERNAL_TOKEN']; });

  it('reads the identity the gateway forwarded', () => {
    const id = identity(req({ 'x-user-id': 'u1', 'x-user-role': 'CUSTOMER', 'x-user-name': encodeURIComponent('Adé Obi') }));
    expect(id).toMatchObject({ userId: 'u1', role: 'CUSTOMER', name: 'Adé Obi' });
  });
  it('rejects a missing or unknown role', () => {
    expect(() => identity(req({ 'x-user-id': 'u1' }))).toThrow(UnauthorizedError);
    expect(() => identity(req({ 'x-user-id': 'u1', 'x-user-role': 'ROOT' }))).toThrow(UnauthorizedError);
  });
  // A caller that bypasses the gateway cannot claim an identity.
  it('requires the internal token when one is configured', () => {
    process.env['INTERNAL_TOKEN'] = 'secret';
    const h = { 'x-user-id': 'u1', 'x-user-role': 'ADMIN' };
    expect(() => identity(req(h))).toThrow(UnauthorizedError);
    expect(() => identity(req({ ...h, 'x-internal-token': 'wrong' }))).toThrow(UnauthorizedError);
    expect(identity(req({ ...h, 'x-internal-token': 'secret' })).role).toBe('ADMIN');
  });
});

describe('pricing', () => {
  it('charges the flat fare without coordinates', () => {
    expect(quote(null, null)).toEqual({ priceKobo: 350_000, distanceKm: null });
  });
  it('rounds to ₦50 and never goes under the minimum', () => {
    const near = quote({ lat: 6.5, lng: 3.3 }, { lat: 6.5001, lng: 3.3001 });
    expect(near.priceKobo).toBe(200_000);
    const far = quote({ lat: 6.6142, lng: 3.3581 }, { lat: 6.4474, lng: 3.4723 });
    expect(far.priceKobo % 5_000).toBe(0);
    expect(far.priceKobo).toBeGreaterThan(200_000);
  });
  it('measures Ikeja to Lekki at about 22 km', () => {
    expect(haversineKm({ lat: 6.6142, lng: 3.3581 }, { lat: 6.4474, lng: 3.4723 })).toBeCloseTo(22.4, 0);
  });
});
