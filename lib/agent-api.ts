// What Grok Bot (or any agent) can ask Backer: the public read API and the MCP
// server both call these. Read-only. If BACKER_API_KEY is set on the server,
// callers must send it as `Authorization: Bearer <key>` (or ?key=).
import { loadMap } from './data'
import { geoByUrl, loadEvents, londonToday, type MapEventGeo } from './events'
import { haversineKm, LONDON, type GeoPoint } from './geo'
import { match } from './match'
import { scrapeEvent } from './scrape/event'
import type { EventInput } from './types'

export function authorised(req: Request): boolean {
  const key = process.env.BACKER_API_KEY?.trim()
  if (!key) return true
  const header = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '').trim()
  const query = new URL(req.url).searchParams.get('key')
  return header === key || query === key
}

export type EventQuery = { q?: string; lat?: number; lng?: number; radiusKm?: number; from?: string; to?: string; upcoming?: boolean; limit?: number }

export async function searchEvents(query: EventQuery) {
  const all = await loadEvents()
  const point: GeoPoint | null = typeof query.lat === 'number' && typeof query.lng === 'number' ? { lat: query.lat, lng: query.lng } : null
  const words = (query.q ?? '').toLowerCase().split(/\s+/).filter(Boolean)
  const from = query.from ?? (query.upcoming ? londonToday() : undefined)
  const limit = Math.min(100, Math.max(1, query.limit ?? 20))
  const rows = all
    .filter(e => !from || (e.date ?? '') >= from)
    .filter(e => !query.to || (e.date ?? '9999') <= query.to!)
    .filter(e => words.every(w => `${e.name} ${e.topic} ${e.organiser ?? ''}`.toLowerCase().includes(w)))
    .map(e => ({ ...shape(e), distanceKm: point ? Math.round(haversineKm(point, e) * 100) / 100 : undefined }))
    .filter(e => !point || !query.radiusKm || (e.distanceKm ?? 0) <= query.radiusKm)
    .sort((a, b) => (point ? (a.distanceKm ?? 0) - (b.distanceKm ?? 0) : 0) || (a.date ?? '').localeCompare(b.date ?? ''))
  return { total: rows.length, events: rows.slice(0, limit) }
}

function shape(e: MapEventGeo) {
  return { id: e.id, name: e.name, url: e.url, date: e.date, organiser: e.organiser, topic: e.topic, venue: e.venue, lat: e.lat, lng: e.lng, approxLocation: e.approx, backers: e.backers, image: e.image }
}

export async function findBackers(input: { event: string; lat?: number; lng?: number; radiusKm?: number; limit?: number }) {
  const text = input.event.trim()
  const known = (await loadEvents()).find(e => e.url === text || e.name.toLowerCase() === text.toLowerCase())
  let event: EventInput = known ? { name: known.name, url: known.url, topic: known.topic, date: known.date ?? undefined } : { name: text.slice(0, 120), topic: text }
  if (!known && /^https?:\/\//i.test(text)) {
    try {
      event = (await scrapeEvent(text)).event
    } catch {}
  }
  const point = typeof input.lat === 'number' && typeof input.lng === 'number' ? { lat: input.lat, lng: input.lng } : known ? { lat: known.lat, lng: known.lng } : LONDON
  const leads = await match(event, await loadMap(), { near: { point, radiusKm: input.radiusKm ?? 10, geoByUrl: await geoByUrl() } })
  return {
    event: event.name,
    leads: leads.slice(0, Math.min(40, input.limit ?? 10)).map(l => ({ name: l.name, domain: l.domain, kind: l.kind, score: l.score, reasons: l.reasons, pastBackings: l.pastBackings.slice(0, 5) })),
  }
}

export async function getSponsor(domain: string) {
  const map = await loadMap()
  const d = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
  const s = map.sponsors.find(x => x.domain.toLowerCase() === d || x.id === d)
  if (!s) return null
  return { name: s.name, domain: s.domain, kind: s.kind, tags: s.tags, backings: map.backings.filter(b => b.sponsorId === s.id).map(b => ({ event: b.event, role: b.role, url: b.url })) }
}
