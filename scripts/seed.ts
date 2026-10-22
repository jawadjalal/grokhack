// Load data/london.json into Supabase. No-op until the project URL and a key are set.
// SUPABASE_URL: Project Settings → API → Project URL
// SUPABASE_SERVICE_ROLE_KEY: Project Settings → API → service_role (server only, never commit it)
import { readFileSync } from 'node:fs'

type MapEvent = {
  name: string
  url: string
  date: string | null
  city: string
  topic: string
  audienceSize: number | null
  organiser: string | null
}
type MapSponsor = { name: string; domain: string; kind: 'sponsor' | 'venue'; description?: string }
type MapBacking = { eventId: string; sponsorId: string; role: string; sourceUrl: string }
type MapFile = { events: (MapEvent & { id: string })[]; sponsors: (MapSponsor & { id: string })[]; backings: MapBacking[] }

const url = process.env.SUPABASE_URL?.replace(/\/$/, '')
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY

if (!url || !key) {
  console.log('Supabase is not configured. The app still runs on data/london.json via lib/seed.ts.')
  console.log('To load the tables, set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, then run: npm run seed')
  console.log('Create the tables from the SQL in docs/PLAN.md first.')
  process.exit(0)
}

const map = JSON.parse(readFileSync(new URL('../data/london.json', import.meta.url), 'utf8')) as MapFile

async function upsert<T>(table: string, rows: unknown[], onConflict: string): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100)
    const res = await fetch(`${url}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: 'POST',
      headers: {
        apikey: key!,
        authorization: `Bearer ${key}`,
        'content-type': 'application/json',
        prefer: 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(chunk),
    })
    const body = await res.text()
    if (!res.ok) throw new Error(`${table} ${res.status}: ${body.slice(0, 400)}`)
    out.push(...(JSON.parse(body) as T[]))
  }
  return out
}

const events = await upsert<{ id: string; url: string }>(
  'events',
  map.events.map(e => ({
    name: e.name,
    url: e.url,
    date: e.date,
    city: e.city,
    topic: e.topic,
    audience_size: e.audienceSize,
    organiser: e.organiser,
  })),
  'url',
)
const sponsors = await upsert<{ id: string; domain: string }>(
  'sponsors',
  map.sponsors.map(s => ({ name: s.name, domain: s.domain, kind: s.kind })),
  'domain',
)
const eventId = new Map(events.map(e => [e.url, e.id]))
const sponsorId = new Map(sponsors.map(s => [s.domain, s.id]))
const eventByOurId = new Map(map.events.map(e => [e.id, e.url]))
const backings = map.backings.flatMap(b => {
  const event_id = eventId.get(eventByOurId.get(b.eventId) ?? '')
  const sponsor_id = sponsorId.get(b.sponsorId)
  if (!event_id || !sponsor_id) return []
  return [{ event_id, sponsor_id, role: b.role, source_url: b.sourceUrl }]
})
await upsert('backings', backings, 'event_id,sponsor_id')
console.log(`Loaded ${events.length} events, ${sponsors.length} sponsors, ${backings.length} backings`)
