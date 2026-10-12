import { internalFetch } from '../authz.js';
import type { AssignedDriver } from './shipments.js';

const BASE = (): string => process.env['DRIVER_SERVICE_URL'] ?? 'http://driver-service:3003';

export class DriverUnavailableError extends Error {
  readonly statusCode = 409;
  constructor(message: string) {
    super(message);
    this.name = 'DriverUnavailableError';
  }
}

export class UpstreamError extends Error {
  // 4xx so the message reaches the dispatcher: "try again" is actionable.
  readonly statusCode = 424;
  constructor(message: string) {
    super(message);
    this.name = 'UpstreamError';
  }
}

interface DriverView {
  id: string;
  userId: string;
  name: string;
  phone?: string | null;
  approvedAt?: string | null;
  status: 'OFFLINE' | 'AVAILABLE' | 'ON_JOB';
}

/**
 * Asks driver-service, synchronously, whether a driver can take a job. The
 * assignment used to accept any id at all - a typo or a driver already on a
 * job went straight through and surfaced later as a stuck shipment.
 */
export async function resolveAssignableDriver(driverId: string): Promise<AssignedDriver> {
  let res: Response;
  try {
    res = await internalFetch(`${BASE()}/drivers/${encodeURIComponent(driverId)}`);
  } catch {
    throw new UpstreamError('Driver service is unreachable; try again shortly');
  }
  if (res.status === 404) throw new DriverUnavailableError('That driver does not exist');
  if (!res.ok) throw new UpstreamError(`Driver service returned ${res.status}`);

  const d = (await res.json()) as DriverView;
  if (!d.approvedAt) throw new DriverUnavailableError(`${d.name} has not been approved yet`);
  if (d.status !== 'AVAILABLE') {
    throw new DriverUnavailableError(
      d.status === 'ON_JOB' ? `${d.name} is already on a job` : `${d.name} is offline`,
    );
  }
  return { id: d.id, userId: d.userId, name: d.name, phone: d.phone ?? null };
}
