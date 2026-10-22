// Server only (it bundles data/london.json): client code may `import type` from here, nothing else.
// Events from data/london.json with a point on the map. lat/lng come from the
// scraper when it has them; a London event without them sits at central London
// with approx: true. Events we can't place are left out.
import map from '../data/london.json'
import { LONDON, roundCoord, type GeoPoint } from './geo'

export type MapEventGeo = {
  id: string
  name: string
  url: string
  date: string | null
  city: string
  topic: string
  organiser: string | null
  audienceSize: number | null
  lat: number
  lng: number
  approx: boolean
  venue?: string
  image?: string // Luma cover image, when the scraper saw one
  backers: number // backings of this event in data/london.json
}

type RawEvent = {
  id: string
  name: string
  url: string
  date?: string | null
  city?: string | null
  topic?: string | null
  organiser?: string | null
  audienceSize?: number | null
  sourceUrl?: string | null
  image?: string | null
  lat?: unknown
  lng?: unknown
  venue?: string | null
  address?: string | null
  country?: string | null
  source?: string | null
}
type RawBacking = { eventId: string; sourceUrl?: string }

// City centres for events that name a city but have no coordinates.
const CITIES: Record<string, GeoPoint> = {
  london: LONDON,
  manchester: { lat: 53.4808, lng: -2.2426 },
  birmingham: { lat: 52.4862, lng: -1.8904 },
  bristol: { lat: 51.4545, lng: -2.5879 },
  cambridge: { lat: 52.2053, lng: 0.1218 },
  oxford: { lat: 51.752, lng: -1.2577 },
  leeds: { lat: 53.8008, lng: -1.5491 },
  edinburgh: { lat: 55.9533, lng: -3.1883 },
  glasgow: { lat: 55.8642, lng: -4.2518 },
}

// Map key for an event url: trimmed, no trailing slash.
export function urlKey(url: string): string {
  return url.trim().replace(/\/+$/, '')
}

function coord(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN
  return Number.isFinite(n) && Math.abs(n) <= max ? n : null
}

function place(e: RawEvent): (GeoPoint & { approx: boolean }) | null {
  const lat = coord(e.lat, 90)
  const lng = coord(e.lng, 180)
  if (lat !== null && lng !== null && !(lat === 0 && lng === 0)) return { lat: roundCoord(lat), lng: roundCoord(lng), approx: false }
  const city = (e.city ?? '').toLowerCase()
  const hit = Object.keys(CITIES).find(c => city.includes(c))
  return hit ? { ...CITIES[hit], approx: true } : null
}

function build(): MapEventGeo[] {
  const raw = map.events as unknown as RawEvent[]
  const backers = new Map<string, number>()
  for (const b of map.backings as RawBacking[]) backers.set(b.eventId, (backers.get(b.eventId) ?? 0) + 1)

  return raw.flatMap(e => {
    const at = place(e)
    if (!at || !e.url) return []
    const out: MapEventGeo = {
      id: e.id,
      name: e.name,
      url: e.url,
      date: e.date || null,
      city: e.city ?? '',
      topic: e.topic ?? '',
      organiser: e.organiser || null,
      audienceSize: typeof e.audienceSize === 'number' ? e.audienceSize : null,
      lat: at.lat,
      lng: at.lng,
      approx: at.approx,
      backers: backers.get(e.id) ?? 0,
    }
    if (e.venue) out.venue = e.venue
    if (e.image) out.image = e.image
    return [out]
  })
}

let events: MapEventGeo[] | null = null
let byUrl: Map<string, GeoPoint & { approx: boolean }> | null = null

export async function loadEvents(): Promise<MapEventGeo[]> {
  return (events ??= build())
}

// Event url (see urlKey) -> where it was. Backing source pages point at their event too.
export async function geoByUrl(): Promise<Map<string, GeoPoint & { approx: boolean }>> {
  if (byUrl) return byUrl
  const list = await loadEvents()
  const m = new Map<string, GeoPoint & { approx: boolean }>()
  const byId = new Map(list.map(e => [e.id, e]))
  for (const e of list) m.set(urlKey(e.url), { lat: e.lat, lng: e.lng, approx: e.approx })
  const extra = [
    ...(map.events as unknown as RawEvent[]).map(e => ({ eventId: e.id, sourceUrl: e.sourceUrl ?? undefined })),
    ...(map.backings as RawBacking[]),
  ]
  for (const { eventId, sourceUrl } of extra) {
    const e = byId.get(eventId)
    if (!e || !sourceUrl) continue
    const k = urlKey(sourceUrl)
    if (!m.has(k)) m.set(k, { lat: e.lat, lng: e.lng, approx: e.approx })
  }
  return (byUrl = m)
}

// Today's date in London, YYYY-MM-DD.
export function londonToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

// An event's London day (YYYY-MM-DD), from a plain date or a full timestamp.
export function londonDay(date: string | null): string | null {
  if (!date) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date
  const t = new Date(date)
  return Number.isNaN(t.getTime()) ? null : londonToday(t)
}
