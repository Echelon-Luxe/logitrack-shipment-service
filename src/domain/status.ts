export const SHIPMENT_STATUSES = [
  'CREATED',
  'PICKED_UP',
  'IN_TRANSIT',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
] as const;

export type ShipmentStatus = (typeof SHIPMENT_STATUSES)[number];

// Terminal statuses map to an empty array, never a missing key.
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

export function assertTransition(from: ShipmentStatus, to: ShipmentStatus): void {
  if (!canTransition(from, to)) throw new InvalidTransitionError(from, to);
}

export const eventTypeForStatus = (s: ShipmentStatus): string =>
  `shipment.${s.toLowerCase()}`;
