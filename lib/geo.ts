// Small geo helpers for the location feature. Safe on server and client.
// We never keep or send coordinates finer than 3 decimals (about 100 m).

export type GeoPoint = { lat: number; lng: number }

// Central London (Trafalgar Square), used when an event has no coordinates.
export const LONDON: GeoPoint = { lat: 51.5072, lng: -0.1276 }

const EARTH_KM = 6371

// Great-circle distance in km.
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(h)))
}

// 3 decimal places, about 100 m.
export function roundCoord(n: number): number {
  const r = Math.round(n * 1000) / 1000
  return r === 0 ? 0 : r // no -0
}

// '350 m', '1.2 km', '12 km'.
export function formatKm(km: number): string {
  if (!Number.isFinite(km) || km < 0) return ''
  const m = Math.round(km * 100) * 10
  if (m < 1000) return `${m} m`
  const tenths = Math.round(km * 10) / 10
  if (tenths < 10) return `${tenths.toFixed(1)} km`
  return `${Math.round(km).toLocaleString('en-GB')} km`
}

// How much a place counts by distance: 1 inside the radius, then a smooth
// (log-scale smoothstep) fall to 0.35 at 10x the radius, flat after that.
export const NEAR_FLOOR = 0.35

export function nearWeight(km: number, radiusKm: number): number {
  if (!Number.isFinite(km)) return NEAR_FLOOR
  const r = Number.isFinite(radiusKm) && radiusKm > 0 ? radiusKm : 0.5
  if (km <= r) return 1
  if (km >= r * 10) return NEAR_FLOOR
  const t = Math.log10(km / r) // 0 at the radius, 1 at 10x
  const s = t * t * (3 - 2 * t)
  return 1 - (1 - NEAR_FLOOR) * s
}
