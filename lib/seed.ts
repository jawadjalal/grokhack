// Real backings only. Every row needs a source URL you can open.
// The scraper (docs/01-scraper.md) replaces this with Supabase.

export type SeedSponsor = {
  id: string
  name: string
  domain: string
  kind: 'sponsor' | 'venue'
  tags: string[]
}

export type SeedBacking = {
  sponsorId: string
  event: string
  eventTopic: string
  role: string
  url: string
}

const GROK_HACK = {
  event: 'Grok Bot Community Engineering London Hackathon',
  eventTopic: 'community tools hackathon ai agents open source',
  url: 'https://gb-community-eng-hackathon-10-2026.teamdeel.workers.dev/hackathon',
}

export const sponsors: SeedSponsor[] = [
  { id: 'supabase', name: 'Supabase', domain: 'supabase.com', kind: 'sponsor', tags: ['database', 'developers', 'hackathon', 'open source'] },
  { id: 'cognee', name: 'Cognee', domain: 'cognee.ai', kind: 'sponsor', tags: ['ai', 'agents', 'memory', 'open source'] },
  { id: 'zero', name: 'Zero', domain: 'zero.inc', kind: 'sponsor', tags: ['gtm', 'sales', 'agents', 'founders'] },
  { id: 'notion', name: 'Notion', domain: 'notion.com', kind: 'sponsor', tags: ['productivity', 'students', 'community', 'ai'] },
  { id: 'cursor', name: 'Cursor', domain: 'cursor.com', kind: 'sponsor', tags: ['ai', 'developers', 'hackathon', 'agents'] },
  { id: 'expedite', name: 'Expedite', domain: 'expedite.london', kind: 'venue', tags: ['venue', 'london', 'hackathon', 'evening'] },
]

export const backings: SeedBacking[] = [
  { sponsorId: 'supabase', role: 'Tech partner', ...GROK_HACK },
  { sponsorId: 'cognee', role: 'Tech partner', ...GROK_HACK },
  { sponsorId: 'zero', role: 'Tech partner', ...GROK_HACK },
  { sponsorId: 'notion', role: 'Tech partner', ...GROK_HACK },
  { sponsorId: 'cursor', role: 'Host and tech partner', ...GROK_HACK },
  { sponsorId: 'expedite', role: 'Venue partner', ...GROK_HACK },
]
