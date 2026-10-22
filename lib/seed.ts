// Real London events and the companies that backed them.
// Every backing URL is a page we fetched. Tags and audience are words from
// those pages, so matching can rank fit. `size` is unknown, so it stays a
// placeholder matching does not read.
import map from '../data/london.json'

export type Audience = 'developers' | 'founders' | 'students' | 'designers' | 'community'

export type SeedSponsor = {
  id: string
  name: string
  domain: string
  kind: 'sponsor' | 'venue'
  tags: string[]
  audience: Audience[]
  hackathons?: boolean
  size: 'giant' | 'scaleup' | 'startup'
}

export type SeedBacking = {
  sponsorId: string
  event: string
  eventTopic: string
  role: string
  url: string
}

type MapEvent = { id: string; name: string; topic: string; url: string }
type MapSponsor = { id: string; name: string; domain: string; kind: 'sponsor' | 'venue' }
type MapBacking = { eventId: string; sponsorId: string; role: string; sourceUrl: string }

const events = new Map((map.events as MapEvent[]).map(e => [e.id, e]))
const rows = map.backings as MapBacking[]

const STOP = new Set(['with', 'from', 'that', 'this', 'your', 'have', 'been', 'will', 'they', 'their', 'about', 'into', 'which', 'where', 'what', 'when', 'more', 'than', 'also', 'just', 'over', 'such', 'each', 'other', 'some', 'only', 'both', 'most', 'meet', 'make'])

function words(text: string): string[] {
  const seen = new Set<string>()
  for (const w of text.toLowerCase().split(/[^a-z0-9-]+/)) {
    if (w.length < 4 || STOP.has(w) || seen.has(w)) continue
    seen.add(w)
  }
  return [...seen]
}

function audiences(text: string): Audience[] {
  const t = text.toLowerCase()
  const out: Audience[] = []
  if (/developer|engineer|hack|software|builder|coding/.test(t)) out.push('developers')
  if (/student|universit|college|imperial|hackathon/.test(t)) out.push('students')
  if (/founder|startup|venture|investor/.test(t)) out.push('founders')
  if (/community|meetup|organiser|organizer/.test(t)) out.push('community')
  if (/design/.test(t)) out.push('designers')
  return out.length ? out : ['developers']
}

function displayName(name: string): string {
  if (name.includes('_')) {
    return name
      .split('_')
      .filter(Boolean)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ')
  }
  if (/^[a-z0-9]+$/.test(name) && name.length <= 4) return name.toUpperCase()
  if (/^[a-z][a-z0-9]+$/.test(name)) return name.charAt(0).toUpperCase() + name.slice(1)
  return name
}

const bySponsor = new Map<string, MapBacking[]>()
for (const row of rows) {
  const list = bySponsor.get(row.sponsorId) ?? []
  list.push(row)
  bySponsor.set(row.sponsorId, list)
}

export const sponsors: SeedSponsor[] = (map.sponsors as MapSponsor[]).map(s => {
  const backed = bySponsor.get(s.id) ?? []
  const topic = backed
    .map(b => {
      const event = events.get(b.eventId)
      return event ? `${event.name} ${event.topic}` : ''
    })
    .join(' ')
  const hackathons = /hackathon|buildathon|\bhack\b|hacker/i.test(topic)
  return {
    id: s.id,
    name: displayName(s.name),
    domain: s.domain,
    kind: s.kind,
    tags: words(topic).slice(0, 16),
    audience: audiences(topic),
    hackathons,
    size: 'startup',
  }
})

export const backings: SeedBacking[] = rows.flatMap(b => {
  const event = events.get(b.eventId)
  if (!event) return []
  return [{ sponsorId: b.sponsorId, event: event.name, eventTopic: event.topic, role: b.role, url: b.sourceUrl }]
})
