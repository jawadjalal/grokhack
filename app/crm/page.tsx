import { loadMap } from '@/lib/data'
import map from '@/data/london.json'
import CrmTable, { type CrmRow } from '@/components/CrmTable'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'CRM · Backer' }

type MapEvent = { id: string; name: string; date: string | null }
type MapBacking = { eventId: string; sponsorId: string; sourceUrl?: string }

export default async function CrmPage() {
  const { sponsors, backings, source } = await loadMap()

  // Events and per-backing source pages come straight from the scraped map.
  const events = map.events as MapEvent[]
  const dateByName = new Map(events.map(e => [e.name, e.date]))
  const nameById = new Map(events.map(e => [e.id, e.name]))
  const sourceBy = new Map<string, string>()
  for (const b of map.backings as MapBacking[]) {
    const name = nameById.get(b.eventId)
    if (name && b.sourceUrl) sourceBy.set(`${b.sponsorId}|${name}`, b.sourceUrl)
  }

  const bySponsor = new Map<string, CrmRow['backings']>()
  for (const b of backings) {
    const list = bySponsor.get(b.sponsorId) ?? []
    list.push({ event: b.event, role: b.role, date: dateByName.get(b.event) ?? null, url: sourceBy.get(`${b.sponsorId}|${b.event}`) ?? b.url })
    bySponsor.set(b.sponsorId, list)
  }

  const rows: CrmRow[] = sponsors.map(s => {
    const list = (bySponsor.get(s.id) ?? []).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
    return {
      id: s.id,
      name: s.name,
      domain: s.domain,
      kind: s.kind,
      tags: s.tags ?? [],
      audience: s.audience ?? [],
      backings: list,
      latest: list.find(b => b.date)?.date ?? null,
      latestEvent: list.find(b => b.date)?.event ?? null,
    }
  })

  return <CrmTable rows={rows} eventCount={events.length} source={source} />
}
