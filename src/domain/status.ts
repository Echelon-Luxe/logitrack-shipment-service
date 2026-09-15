export const SHIPMENT_STATUSES = [
  'CREATED',
  'PICKED_UP',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

/**
 * The only place shipment status transitions are defined.
 *
 * Every status maps to the complete set of statuses reachable from it.
 * DELIVERED and CANCELLED are terminal - an empty array, not a missing key,
 * so that `isTerminal` and `canTransition` never have to special-case them.
 */
const TRANSITIONS: Record<ShipmentStatus, readonly ShipmentStatus[]> = {
  CREATED:          ['PICKED_UP', 'CANCELLED'],
  PICKED_UP:        ['IN_TRANSIT', 'CANCELLED'],
  IN_TRANSIT:       ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'CANCELLED'],
  DELIVERED:        [],
  CANCELLED:        [],
};

export const isShipmentStatus = (v: unknown): v is ShipmentStatus =>
  typeof v === 'string' && (SHIPMENT_STATUSES as readonly string[]).includes(v);

export const isTerminal = (s: ShipmentStatus): boolean => TRANSITIONS[s].length === 0;

export const nextStatuses = (s: ShipmentStatus): readonly ShipmentStatus[] => TRANSITIONS[s];

export const canTransition = (from: ShipmentStatus, to: ShipmentStatus): boolean =>
  TRANSITIONS[from].includes(to);

export class InvalidTransitionError extends Error {
  readonly statusCode = 409;
  constructor(readonly from: ShipmentStatus, readonly to: ShipmentStatus) {
    super(
      isTerminal(from)
        ? `Shipment is ${from}, which is terminal; it cannot move to ${to}`
        : `Cannot move shipment from ${from} to ${to}. Allowed: ${TRANSITIONS[from].join(', ')}`,
    );
    this.name = 'InvalidTransitionError';
  }
}

/** Throws InvalidTransitionError unless the move is legal. */
export function assertTransition(from: ShipmentStatus, to: ShipmentStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

/**
 * Event name emitted for a transition INTO a status, e.g. 'shipment.delivered'.
 * Kept next to the transition table so adding a status forces you to think
 * about the event it produces.
 */
export const eventTypeForStatus = (s: ShipmentStatus): string =>
  `shipment.${s.toLowerCase()}`;
