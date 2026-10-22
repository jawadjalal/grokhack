// Loads lib/seed.ts into Supabase through the REST API. Safe to re-run (upserts).
// Run: npm run db:seed
import { backings, sponsors } from '../lib/seed.ts'

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
if (!URL || !KEY) throw new Error('Need SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env.local (vercel env pull)')

async function upsert(table: string, rows: unknown[], onConflict: string) {
  const res = await fetch(`${URL}/rest/v1/${table}?on_conflict=${onConflict}`, {
    method: 'POST',
    headers: { apikey: KEY!, authorization: `Bearer ${KEY}`, 'content-type': 'application/json', prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(rows),
  })
  if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`)
  return res.json()
}

await upsert('sponsors', sponsors.map(s => ({ id: s.id, name: s.name, domain: s.domain, kind: s.kind, tags: s.tags, audience: s.audience, hackathons: s.hackathons ?? true, size: s.size })), 'id')

const eventRows = [...new Map(backings.map(b => [b.url, { name: b.event, url: b.url, topic: b.eventTopic }])).values()]
const events: { id: string; url: string }[] = await upsert('events', eventRows, 'url')
const idByUrl = new Map(events.map(e => [e.url, e.id]))

await upsert('backings', backings.map(b => ({ event_id: idByUrl.get(b.url), sponsor_id: b.sponsorId, role: b.role, source_url: b.url })), 'event_id,sponsor_id')
console.log(`seeded ${sponsors.length} sponsors, ${events.length} events, ${backings.length} backings`)
