// The map of who backed what. Reads Supabase when it's configured, and falls
// back to lib/seed.ts so the app never breaks. Add rows with `npm run db:seed`
// or straight into the Supabase tables (db/schema.sql).
import { backings as seedBackings, sponsors as seedSponsors, type SeedBacking, type SeedSponsor } from './seed'

export type BackerMap = { sponsors: SeedSponsor[]; backings: SeedBacking[]; source: 'supabase' | 'seed' }

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${URL}/rest/v1/${path}`, { headers: { apikey: KEY!, authorization: `Bearer ${KEY}` }, cache: 'no-store' })
  if (!res.ok) throw new Error(`${path}: ${res.status}`)
  return res.json()
}

export async function loadMap(): Promise<BackerMap> {
  if (!URL || !KEY) return { sponsors: seedSponsors, backings: seedBackings, source: 'seed' }
  try {
    const [sponsors, backings] = await Promise.all([
      get<(SeedSponsor & { hackathons: boolean })[]>('sponsors?select=id,name,domain,kind,tags,audience,hackathons,size'),
      get<{ sponsor_id: string; event: string; event_topic: string; role: string; url: string }[]>('backings_view?select=*'),
    ])
    if (!sponsors.length) throw new Error('empty')
    // Scraped rows sometimes carry a broken domain; leave those out.
    const valid = (d: string) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(d)
    sponsors.splice(0, sponsors.length, ...sponsors.filter(s => valid(s.domain)))
    return {
      sponsors,
      backings: backings.map(b => ({ sponsorId: b.sponsor_id, event: b.event, eventTopic: b.event_topic, role: b.role, url: b.url })),
      source: 'supabase',
    }
  } catch {
    return { sponsors: seedSponsors, backings: seedBackings, source: 'seed' }
  }
}
