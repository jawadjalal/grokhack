// Place search and reverse lookup, no API keys.
//   GET /api/geocode?q=<text>   -> { results: [{ label, lat, lng, kind }] } (max 5)
//   GET /api/geocode?lat=&lng=  -> { label }
// UK postcodes and outcodes via postcodes.io, names via Open-Meteo, reverse via
// postcodes.io in the UK and Nominatim elsewhere (1 req/s). Coordinates are
// rounded to ~100 m before they go anywhere, and never logged. A failed lookup
// returns no results (or a plain label), never an error page.
import type { NextRequest } from 'next/server'
import { roundCoord } from '@/lib/geo'

type Result = { label: string; lat: number; lng: number; kind: 'postcode' | 'place' }

const UA = 'Backer/1.0 (+https://github.com/jawadjalal/grokhack)'
const TIMEOUT_MS = 5000
const MAX_RESULTS = 5

const bad = (error: string) => Response.json({ error }, { status: 400 })

// In-memory cache. Only successful lookups are kept (a throw is not cached).
const TTL_MS = 24 * 60 * 60 * 1000
const cache = new Map<string, { at: number; value: unknown }>()

async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value as T
  const value = await fn()
  cache.delete(key)
  cache.set(key, { at: Date.now(), value })
  if (cache.size > 500) cache.delete(cache.keys().next().value as string)
  return value
}

// JSON or null on 404; throws on timeouts and other failures. Errors never carry the url.
async function getJson<T>(service: string, url: string): Promise<T | null> {
  const res = await fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`${service} ${res.status}`)
  return (await res.json()) as T
}

function warn(service: string, e: unknown) {
  const why = e instanceof Error ? (e.name === 'Error' ? e.message : e.name) : 'failed'
  console.warn(`[geocode] ${service}: ${why}`)
}

// postcodes.io

type Postcode = {
  postcode: string
  latitude: number | null
  longitude: number | null
  admin_ward: string | null
  parish: string | null
  admin_district: string | null
}
type Outcode = { outcode: string; latitude: number | null; longitude: number | null; admin_district: string[] }

const PC = 'https://api.postcodes.io'
const FULL_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/
const OUTCODE = /^[A-Z]{1,2}\d[A-Z\d]?$/

// "<ward or parish>, <district>", e.g. "Hoxton East & Shoreditch, Hackney".
function postcodeLabel(p: Postcode): string {
  const parish = p.parish && !/unparished/i.test(p.parish) ? p.parish : null
  const area = p.admin_ward || parish
  const parts = [area, p.admin_district].filter((x, i, a): x is string => !!x && a.indexOf(x) === i)
  return parts.join(', ') || p.postcode
}

async function postcode(pc: string): Promise<Result[] | null> {
  const j = await getJson<{ result: Postcode }>('postcodes.io', `${PC}/postcodes/${encodeURIComponent(pc)}`)
  const p = j?.result
  if (!p || p.latitude == null || p.longitude == null) return null
  return [{ label: postcodeLabel(p), lat: roundCoord(p.latitude), lng: roundCoord(p.longitude), kind: 'postcode' }]
}

// Outcodes (E1, SW1A) are labelled "<outcode>, <district at its centre>".
async function outcode(code: string): Promise<Result[] | null> {
  const j = await getJson<{ result: Outcode }>('postcodes.io', `${PC}/outcodes/${encodeURIComponent(code)}`)
  const o = j?.result
  if (!o || o.latitude == null || o.longitude == null) return null
  const lat = roundCoord(o.latitude)
  const lng = roundCoord(o.longitude)
  let district = o.admin_district?.[0] ?? null
  try {
    district = (await nearestPostcode(lat, lng))?.admin_district ?? district
  } catch (e) {
    warn('postcodes.io', e)
  }
  return [{ label: [o.outcode, district].filter(Boolean).join(', '), lat, lng, kind: 'postcode' }]
}

function nearestPostcode(lat: number, lng: number): Promise<Postcode | null> {
  return cached(`near:${lat},${lng}`, async () => {
    const j = await getJson<{ result: Postcode[] | null }>('postcodes.io', `${PC}/postcodes?lon=${lng}&lat=${lat}&limit=1&radius=1000`)
    return j?.result?.[0] ?? null
  })
}

// Open-Meteo place names

type Place = {
  name: string
  latitude: number
  longitude: number
  country_code?: string
  country?: string
  admin1?: string
  admin2?: string
  admin3?: string
}

async function places(q: string): Promise<Result[]> {
  // "Shoreditch, London": search the name, use the rest to rank.
  const [name, ...rest] = q.split(',').map(s => s.trim())
  const hint = rest.join(' ').toLowerCase()
  if (!name) return []
  const j = await getJson<{ results?: Place[] }>('open-meteo', `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=10&language=en`)
  const found = (j?.results ?? []).filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
  const rank = (p: Place) => {
    const where = [p.admin1, p.admin2, p.admin3, p.country, p.country_code].filter(Boolean).join(' ').toLowerCase()
    return (hint && where.includes(hint) ? 0 : 2) + (p.country_code === 'GB' ? 0 : 1)
  }
  const sorted = found.map((p, i) => ({ p, i })).sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map(x => x.p)

  // "<name>, <admin1 or country>"; when two share a label, add the county or borough.
  const short = (p: Place) => [p.name, p.admin1 || p.country].filter(Boolean).join(', ')
  const long = (p: Place) => [p.name, p.admin2 || p.admin3, p.admin1 || p.country].filter((x, i, a) => !!x && a.indexOf(x) === i).join(', ')
  const counts = new Map<string, number>()
  for (const p of sorted) counts.set(short(p), (counts.get(short(p)) ?? 0) + 1)

  const out: Result[] = []
  const seen = new Set<string>()
  for (const p of sorted) {
    const label = (counts.get(short(p)) ?? 0) > 1 ? long(p) : short(p)
    if (seen.has(label)) continue
    seen.add(label)
    out.push({ label, lat: roundCoord(p.latitude), lng: roundCoord(p.longitude), kind: 'place' })
  }
  return out.slice(0, MAX_RESULTS)
}

async function search(q: string): Promise<Result[]> {
  const pc = q.toUpperCase().replace(/\s+/g, '')
  if (FULL_POSTCODE.test(pc)) {
    const hit = (await cached(`pc:${pc}`, () => postcode(pc))) ?? (await cached(`oc:${pc.slice(0, -3)}`, () => outcode(pc.slice(0, -3))))
    if (hit) return hit
  } else if (OUTCODE.test(pc)) {
    const hit = await cached(`oc:${pc}`, () => outcode(pc))
    if (hit) return hit
  }
  return cached(`name:${q.toLowerCase()}`, () => places(q))
}

// Reverse

type Nominatim = { name?: string; error?: string; address?: Record<string, string | undefined> }

// Nominatim allows 1 request a second: queue calls and space them out.
let nominatimQueue: Promise<unknown> = Promise.resolve()
let nominatimLast = 0

function throttled<T>(fn: () => Promise<T>): Promise<T> {
  const run = nominatimQueue.then(async () => {
    const wait = nominatimLast + 1000 - Date.now()
    if (wait > 0) await new Promise(r => setTimeout(r, wait))
    nominatimLast = Date.now()
    return fn()
  })
  nominatimQueue = run.catch(() => undefined)
  return run
}

async function nominatim(lat: number, lng: number): Promise<string | null> {
  const j = await throttled(() => getJson<Nominatim>('nominatim', `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&lat=${lat}&lon=${lng}`))
  if (!j || j.error) return null
  const a = j.address ?? {}
  const local = a.suburb ?? a.city_district ?? a.borough ?? a.quarter ?? a.neighbourhood ?? a.village ?? a.town ?? a.city ?? a.municipality ?? j.name
  const wide = [a.city, a.town, a.municipality, a.county, a.state, a.country].find(x => x && x !== local)
  return [local, wide].filter(Boolean).join(', ') || null
}

const inUk = (lat: number, lng: number) => lat >= 49.8 && lat <= 60.9 && lng >= -8.7 && lng <= 1.8

async function reverse(lat: number, lng: number): Promise<string | null> {
  if (inUk(lat, lng)) {
    try {
      const p = await nearestPostcode(lat, lng)
      if (p) return postcodeLabel(p)
    } catch (e) {
      warn('postcodes.io', e)
    }
  }
  return cached(`rev:${lat},${lng}`, () => nominatim(lat, lng))
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const q = p.get('q')?.trim()

  if (q) {
    if (q.length > 100) return bad('q is too long')
    try {
      return Response.json({ results: (await search(q)).slice(0, MAX_RESULTS) })
    } catch (e) {
      warn('search', e)
      return Response.json({ results: [] })
    }
  }

  const latRaw = p.get('lat')
  const lngRaw = p.get('lng')
  if (!latRaw?.trim() || !lngRaw?.trim()) return bad('Send q, or lat and lng')
  const lat = Number(latRaw)
  const lng = Number(lngRaw)
  if (!(lat >= -90 && lat <= 90)) return bad('lat must be a number from -90 to 90')
  if (!(lng >= -180 && lng <= 180)) return bad('lng must be a number from -180 to 180')

  try {
    return Response.json({ label: (await reverse(roundCoord(lat), roundCoord(lng))) ?? 'Current location' })
  } catch (e) {
    warn('reverse', e)
    return Response.json({ label: 'Current location' })
  }
}
