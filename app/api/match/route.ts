import { loadMap } from '@/lib/data'
import { geoByUrl } from '@/lib/events'
import { LONDON, roundCoord, type GeoPoint } from '@/lib/geo'
import { match } from '@/lib/match'
import type { EventInput } from '@/lib/types'

// Optional near: { lat, lng, radiusKm?, label? }. Anything invalid is ignored, and so is
// the device default (central London, 'London', 25 km): no location set means today's ranking.
function readNear(v: unknown): { point: GeoPoint; radiusKm: number; label?: string } | null {
  if (!v || typeof v !== 'object') return null
  const { lat, lng, radiusKm, label } = v as Record<string, unknown>
  if (typeof lat !== 'number' || typeof lng !== 'number' || !(Math.abs(lat) <= 90) || !(Math.abs(lng) <= 180)) return null
  const r = radiusKm ?? 25
  if (typeof r !== 'number' || !(r >= 0.5 && r <= 500)) return null
  const name = typeof label === 'string' ? label.replace(/\s+/g, ' ').trim().slice(0, 80) : ''
  const point = { lat: roundCoord(lat), lng: roundCoord(lng) }
  if (point.lat === roundCoord(LONDON.lat) && point.lng === roundCoord(LONDON.lng) && r === 25 && (name || 'London') === 'London') return null
  return { point, radiusKm: r, ...(name ? { label: name } : {}) }
}

export async function POST(req: Request) {
  const { near: rawNear, ...event } = (await req.json()) as EventInput & { near?: unknown }
  const near = readNear(rawNear)
  const map = await loadMap()
  const leads = await match(event, map, near ? { near: { ...near, geoByUrl: await geoByUrl() } } : {})
  // Header values must be plain ASCII.
  const label = near?.label?.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').trim()
  const where = near ? `${label || `${near.point.lat},${near.point.lng}`}; ${near.radiusKm} km` : 'none'
  return Response.json(leads, { headers: { 'x-backer-source': map.source, 'x-backer-near': where } })
}
