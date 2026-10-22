import { loadMap } from '@/lib/data'
import map from '@/data/london.json'
import CrmTable, { type CrmRow } from '@/components/CrmTable'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'CRM · Backer' }

type MapEvent = { id: string; name: string; date: string | null }
type MapSponsor = { id: string; name: string; domain: string; kind?: string; tags?: string[]; audience?: string[] }
type MapBacking = { eventId: string; sponsorId: string; role?: string; sourceUrl?: string }

const dom = (d: string) => d.trim().toLowerCase().replace(/^www\./, '')

export default async function CrmPage() {
  const { sponsors, backings, source } = await loadMap()

  // Events and per-backing source pages come straight from the scraped map.
  const events = map.events as MapEvent[]
  const dateByName = new Map(events.map(e => [e.name, e.date]))
  const eventById = new Map(events.map(e => [e.id, e]))

  // One row per domain: loadMap first (Supabase or seed), then every scraped
  // sponsor from data/london.json that it doesn't already have.
  const rowsByDomain = new Map<string, CrmRow>()
  const domainById = new Map<string, string>()
  const add = (s: MapSponsor) => {
    const d = dom(s.domain)
    domainById.set(s.id, d)
    const have = rowsByDomain.get(d)
    if (have) {
      if (!have.tags.length && s.tags?.length) have.tags = s.tags
      if (!have.audience.length && s.audience?.length) have.audience = s.audience
      return
    }
    rowsByDomain.set(d, {
      id: s.id,
      name: s.name,
      domain: s.domain,
      kind: s.kind === 'venue' ? 'venue' : 'sponsor',
      tags: s.tags ?? [],
      audience: s.audience ?? [],
      backings: [],
      latest: null,
      latestEvent: null,
    })
  }
  for (const s of sponsors) add(s)
  for (const s of map.sponsors as MapSponsor[]) add(s)

  // Backings from both sources, de-duplicated by domain + event name.
  const seen = new Set<string>()
  const push = (sponsorId: string, event: string, role: string, url: string) => {
    const d = domainById.get(sponsorId) ?? dom(sponsorId)
    const row = rowsByDomain.get(d)
    if (!row) return
    const key = `${d}|${event.toLowerCase()}`
    if (seen.has(key)) return
    seen.add(key)
    row.backings.push({ event, role, date: dateByName.get(event) ?? null, url })
  }
  for (const b of map.backings as MapBacking[]) {
    const e = eventById.get(b.eventId)
    if (e) push(b.sponsorId, e.name, b.role || 'Sponsor', b.sourceUrl ?? '')
  }
  for (const b of backings) push(b.sponsorId, b.event, b.role, b.url)

  const rows = [...rowsByDomain.values()].map(r => {
    r.backings.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    const last = r.backings.find(b => b.date)
    return { ...r, latest: last?.date ?? null, latestEvent: last?.event ?? r.backings[0]?.event ?? null }
  })

  return <CrmTable rows={rows} eventCount={events.length} source={source} />
}
