// Upcoming events near a point: GET /api/events?lat=&lng=&radiusKm=10&days=60&limit=8
// Inside the radius, nearest first then soonest. If nothing is inside, the
// nearest upcoming ones come back with outside: true. No lat/lng means central London.
import type { NextRequest } from 'next/server'
import { loadEvents, londonDay, londonToday, type MapEventGeo } from '@/lib/events'
import { LONDON, haversineKm, roundCoord } from '@/lib/geo'

type NearEvent = MapEventGeo & { distanceKm: number }

const bad = (error: string) => Response.json({ error }, { status: 400 })

// undefined when missing, NaN when not a number.
function param(p: URLSearchParams, name: string): number | undefined {
  const raw = p.get(name)
  if (raw === null || raw.trim() === '') return undefined
  return Number(raw)
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const lat = param(p, 'lat')
  const lng = param(p, 'lng')
  const radiusKm = param(p, 'radiusKm') ?? 10
  const days = param(p, 'days') ?? 60
  const limit = param(p, 'limit') ?? 8

  if ((lat === undefined) !== (lng === undefined)) return bad('Send lat and lng together')
  if (lat !== undefined && !(lat >= -90 && lat <= 90)) return bad('lat must be a number from -90 to 90')
  if (lng !== undefined && !(lng >= -180 && lng <= 180)) return bad('lng must be a number from -180 to 180')
  if (!(radiusKm >= 0.5 && radiusKm <= 500)) return bad('radiusKm must be a number from 0.5 to 500')
  if (!Number.isFinite(days)) return bad('days must be a number')
  if (!Number.isFinite(limit)) return bad('limit must be a number')

  const near = lat === undefined || lng === undefined ? LONDON : { lat: roundCoord(lat), lng: roundCoord(lng) }
  const today = londonToday()
  const last = addDays(today, Math.min(366, Math.max(0, Math.round(days))))
  const take = Math.min(50, Math.max(1, Math.round(limit)))

  const upcoming: (NearEvent & { day: string })[] = []
  for (const e of await loadEvents()) {
    const day = londonDay(e.date)
    if (!day || day < today || day > last) continue
    upcoming.push({ ...e, day, distanceKm: Math.round(haversineKm(near, e) * 100) / 100 })
  }
  upcoming.sort((a, b) => a.distanceKm - b.distanceKm || a.day.localeCompare(b.day) || a.name.localeCompare(b.name))

  const inside = upcoming.filter(e => e.distanceKm <= radiusKm)
  const outside = !inside.length && upcoming.length > 0
  const events: NearEvent[] = (outside ? upcoming : inside).slice(0, take).map(({ day: _day, ...e }) => e)

  return Response.json({ near: { ...near, radiusKm }, events, outside })
}
