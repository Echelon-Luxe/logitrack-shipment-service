import { describe, it, expect } from 'vitest';
import {
  SHIPMENT_STATUSES,
  type ShipmentStatus,
  canTransition,
  assertTransition,
  isTerminal,
  nextStatuses,
  isShipmentStatus,
  eventTypeForStatus,
  InvalidTransitionError,
} from '../src/domain/status.js';

const LEGAL: ReadonlyArray<[ShipmentStatus, ShipmentStatus]> = [
  ['CREATED', 'PICKED_UP'],
  ['PICKED_UP', 'IN_TRANSIT'],
  ['IN_TRANSIT', 'OUT_FOR_DELIVERY'],
  ['OUT_FOR_DELIVERY', 'DELIVERED'],
  ['CREATED', 'CANCELLED'],
  ['PICKED_UP', 'CANCELLED'],
  ['IN_TRANSIT', 'CANCELLED'],
  ['OUT_FOR_DELIVERY', 'CANCELLED'],
];

const isLegal = (f: ShipmentStatus, t: ShipmentStatus): boolean =>
  LEGAL.some(([a, b]) => a === f && b === t);

describe('shipment state machine', () => {
  // Exhaustive: every ordered pair of statuses, not just the happy path.
  // This is what catches a transition accidentally added to the table.
  it.each(
    SHIPMENT_STATUSES.flatMap((from) => SHIPMENT_STATUSES.map((to) => ({ from, to }))),
  )('$from -> $to', ({ from, to }) => {
    expect(canTransition(from, to)).toBe(isLegal(from, to));
  });

  it('never allows a shipment to stay in the same status', () => {
    for (const s of SHIPMENT_STATUSES) expect(canTransition(s, s)).toBe(false);
  });

  it('never allows moving backwards through the happy path', () => {
    const forward: ShipmentStatus[] = [
      'CREATED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED',
    ];
    for (let i = 0; i < forward.length; i++) {
      for (let j = 0; j < i; j++) {
        expect(canTransition(forward[i]!, forward[j]!)).toBe(false);
      }
    }
  });

  it('never allows skipping a step', () => {
    expect(canTransition('CREATED', 'IN_TRANSIT')).toBe(false);
    expect(canTransition('CREATED', 'DELIVERED')).toBe(false);
    expect(canTransition('PICKED_UP', 'OUT_FOR_DELIVERY')).toBe(false);
  });

  it('treats DELIVERED and CANCELLED as terminal', () => {
    expect(isTerminal('DELIVERED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(nextStatuses('DELIVERED')).toHaveLength(0);
    expect(nextStatuses('CANCELLED')).toHaveLength(0);
  });

  it('cannot cancel an already delivered shipment', () => {
    expect(canTransition('DELIVERED', 'CANCELLED')).toBe(false);
  });

  it('cannot revive a cancelled shipment', () => {
    for (const s of SHIPMENT_STATUSES) expect(canTransition('CANCELLED', s)).toBe(false);
  });

  it('allows cancelling from every non-terminal status', () => {
    for (const s of SHIPMENT_STATUSES) {
      if (!isTerminal(s)) expect(canTransition(s, 'CANCELLED')).toBe(true);
    }
  });
});

describe('assertTransition', () => {
  it('passes silently for a legal move', () => {
    expect(() => assertTransition('CREATED', 'PICKED_UP')).not.toThrow();
  });

  it('throws a 409 with the allowed moves listed', () => {
    try {
      assertTransition('CREATED', 'DELIVERED');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidTransitionError);
      const err = e as InvalidTransitionError;
      expect(err.statusCode).toBe(409);
      expect(err.message).toContain('PICKED_UP');
      expect(err.message).toContain('CANCELLED');
    }
  });

  it('explains terminality rather than listing an empty allow-list', () => {
    try {
      assertTransition('DELIVERED', 'CANCELLED');
      expect.unreachable('should have thrown');
    } catch (e) {
      expect((e as Error).message).toContain('terminal');
    }
  });
});

describe('helpers', () => {
  it('validates unknown status strings', () => {
    expect(isShipmentStatus('DELIVERED')).toBe(true);
    expect(isShipmentStatus('delivered')).toBe(false);
    expect(isShipmentStatus('LOST')).toBe(false);
    expect(isShipmentStatus(null)).toBe(false);
    expect(isShipmentStatus(42)).toBe(false);
  });

  it('derives the event name for each status', () => {
    expect(eventTypeForStatus('DELIVERED')).toBe('shipment.delivered');
    expect(eventTypeForStatus('OUT_FOR_DELIVERY')).toBe('shipment.out_for_delivery');
  });
});
