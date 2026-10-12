import type { Shipment } from '@prisma/client';
import { ForbiddenError, OPERATORS, hasRole, isStaff, type Identity } from '../authz.js';
import type { ShipmentStatus } from './status.js';

type Owned = Pick<Shipment, 'customerId' | 'driverUserId' | 'status' | 'driverId'>;

// Who may see a shipment. Staff see everything; a customer sees what they
// ordered; a driver sees what they are assigned.
export function canRead(id: Identity, s: Owned): boolean {
  if (isStaff(id)) return true;
  if (id.role === 'CUSTOMER') return s.customerId === id.userId;
  if (id.role === 'DRIVER') return s.driverUserId === id.userId;
  return false;
}

// List filters forced by role. Applied over whatever the caller asked for, so
// ?customerId=someone-else from a customer still returns only their own rows.
export function scopeFor(id: Identity): { customerId?: string; driverUserId?: string } {
  if (isStaff(id)) return {};
  if (id.role === 'CUSTOMER') return { customerId: id.userId };
  if (id.role === 'DRIVER') return { driverUserId: id.userId };
  // Unknown roles see nothing rather than everything.
  return { customerId: '__none__' };
}

export const canCreate = (id: Identity): boolean => id.role === 'CUSTOMER' || hasRole(id, OPERATORS);
export const canAssign = (id: Identity): boolean => hasRole(id, OPERATORS);

/**
 * Status changes, on top of the transition table in status.ts:
 *  - ADMIN/DISPATCHER may make any legal move, including cancelling.
 *  - The assigned driver may move their job forward, never cancel it - a
 *    driver abandoning a delivery is a dispatch decision.
 *  - The customer may cancel only before pickup, while nothing is in motion.
 */
export function assertCanChangeStatus(id: Identity, s: Owned, to: ShipmentStatus): void {
  if (hasRole(id, OPERATORS)) return;
  if (id.role === 'DRIVER' && s.driverUserId === id.userId && to !== 'CANCELLED') return;
  if (id.role === 'CUSTOMER' && s.customerId === id.userId && to === 'CANCELLED' && s.status === 'CREATED') return;
  throw new ForbiddenError(
    id.role === 'CUSTOMER'
      ? 'Customers can only cancel a shipment before it is picked up'
      : 'You cannot change the status of this shipment',
  );
}
