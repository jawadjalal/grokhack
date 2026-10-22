// The company network: every event and the companies that backed it, as a
// force-directed graph. Data comes from loadMap (Supabase or the seed), event
// details (date, organiser, link) from data/london.json when the names match.
import london from '@/data/london.json'
import NetworkGraph, { type NetCompany, type NetEvent, type NetLink } from '@/components/NetworkGraph'
import { loadMap } from '@/lib/data'

export const dynamic = 'force-dynamic'

type MetaEvent = { id: string; name: string; url?: string; date?: string | null; organiser?: string | null }

const key = (s: string) => s.toLowerCase().trim()

export default async function NetworkPage() {
  const map = await loadMap()
  const meta = new Map((london.events as MetaEvent[]).map(e => [key(e.name), e]))
  const sponsors = new Map(map.sponsors.map(s => [s.id, s]))

  const events = new Map<string, NetEvent>()
  const links: NetLink[] = []
  const seen = new Set<string>()
  for (const b of map.backings) {
    if (!sponsors.has(b.sponsorId) || !b.event) continue
    const id = key(b.event)
    const pair = `${b.sponsorId}|${id}`
    if (seen.has(pair)) continue
    seen.add(pair)
    let ev = events.get(id)
    if (!ev) {
      const m = meta.get(id)
      ev = { id, name: b.event, url: m?.url ?? b.url, date: m?.date ?? null, organiser: m?.organiser ?? undefined, count: 0 }
      events.set(id, ev)
    }
    ev.count++
    links.push({ c: b.sponsorId, e: id, role: b.role, url: b.url })
  }

  const linked = new Set(links.map(l => l.c))
  const companies: NetCompany[] = map.sponsors
    .filter(s => linked.has(s.id))
    .map(s => ({ id: s.id, name: s.name, domain: s.domain, kind: s.kind }))

  return (
    <main style={{ height: '100dvh', display: 'flex', flexDirection: 'column', background: 'var(--canvas)' }}>
      <div style={{ flex: 1, minHeight: 0 }}>
        <NetworkGraph events={[...events.values()]} companies={companies} links={links} source={map.source} />
      </div>
    </main>
  )
}
