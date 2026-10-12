// Quote for a shipment, in kobo. Integer maths throughout - floats lose
// precision on money.

const BASE_KOBO = Number(process.env['PRICE_BASE_KOBO'] ?? 150_000); // ₦1,500
const PER_KM_KOBO = Number(process.env['PRICE_PER_KM_KOBO'] ?? 25_000); // ₦250
const MIN_KOBO = Number(process.env['PRICE_MIN_KOBO'] ?? 200_000); // ₦2,000
// Without coordinates there is no distance; charge a typical intra-city fare.
const FLAT_KOBO = Number(process.env['PRICE_FLAT_KOBO'] ?? 350_000); // ₦3,500
// Quotes end in ₦50 so they read like prices, not computations.
const ROUND_KOBO = 5_000;

export interface Point { lat: number; lng: number }

// Great-circle distance. Roads are longer, which the per-km rate absorbs.
export function haversineKm(a: Point, b: Point): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function quote(origin?: Point | null, dest?: Point | null): { priceKobo: number; distanceKm: number | null } {
  if (!origin || !dest) return { priceKobo: FLAT_KOBO, distanceKm: null };
  const km = haversineKm(origin, dest);
  const raw = Math.max(MIN_KOBO, BASE_KOBO + Math.round(km * PER_KM_KOBO));
  return {
    priceKobo: Math.ceil(raw / ROUND_KOBO) * ROUND_KOBO,
    distanceKm: Math.round(km * 10) / 10,
  };
}
