// Fit score, out of 100, from four parts you can see in the drawer:
//   Track record  40  have they backed events like this one, in London
//   Focus         35  does what they care about match the event's topic
//   Audience      15  do they want the people this event brings
//   Habit         10  do they back hackathons and community events at all
// Avi: tune the weights or add an LLM pass on the top 15 (docs/02-matching.md).
import type { BackerMap } from './data'
import { type Audience, backings as seedBackings, sponsors as seedSponsors } from './seed'
import type { EventInput, Lead } from './types'

// Words that mean the same thing for matching purposes.
const SYNONYMS: Record<string, string[]> = {
  ai: ['ai', 'llm', 'agents', 'agent', 'ml', 'gpt', 'claude', 'grok', 'genai', 'model', 'models'],
  agents: ['agents', 'agent', 'agentic', 'automation'],
  developers: ['developers', 'developer', 'engineers', 'engineering', 'builders', 'hackers', 'coding', 'code', 'devs', 'dev'],
  hackathon: ['hackathon', 'hack', 'hackers', 'build', 'buildathon', 'jam'],
  'open-source': ['open-source', 'opensource', 'open', 'oss', 'mit', 'github'],
  community: ['community', 'communities', 'organisers', 'organizers', 'meetup', 'members', 'leads'],
  founders: ['founders', 'founder', 'startup', 'startups', 'entrepreneurs', 'vc', 'investors'],
  students: ['students', 'student', 'university', 'uni', 'campus', 'imperial', 'ucl', 'kcl', 'beginners'],
  designers: ['designers', 'design', 'ux', 'ui', 'figma', 'creative'],
  database: ['database', 'postgres', 'sql', 'data', 'backend'],
  voice: ['voice', 'audio', 'speech'],
  fintech: ['fintech', 'payments', 'finance', 'banking', 'revenue', 'money'],
  gtm: ['gtm', 'sales', 'outbound', 'crm', 'sponsors', 'revenue', 'growth', 'marketing'],
  events: ['events', 'event', 'ticketing', 'venue', 'venues', 'rsvp'],
  london: ['london', 'uk', 'shoreditch', 'kings', 'cross', 'hammersmith'],
}

function concepts(text: string): Set<string> {
  const words = new Set(text.toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean))
  const out = new Set<string>()
  for (const [concept, forms] of Object.entries(SYNONYMS)) if (forms.some(f => words.has(f))) out.add(concept)
  for (const w of words) if (w.length > 3) out.add(w)
  return out
}

const AUDIENCE_HINTS: Record<Audience, string> = {
  developers: 'developers',
  founders: 'founders',
  students: 'students',
  designers: 'designers',
  community: 'community',
}

export function match(event: EventInput, map: Pick<BackerMap, 'sponsors' | 'backings'> = { sponsors: seedSponsors, backings: seedBackings }): Lead[] {
  const { sponsors, backings } = map
  const want = concepts(`${event.name} ${event.topic} ${event.description ?? ''}`)
  const audience = (Object.keys(AUDIENCE_HINTS) as Audience[]).filter(a => want.has(a))
  if (!audience.length) audience.push('developers')

  return sponsors
    .map(s => {
      const past = backings.filter(b => b.sponsorId === s.id && b.url !== event.url)
      const pastAll = backings.filter(b => b.sponsorId === s.id)

      // Track record: each past backing counts by how close its topic is to ours.
      const sims = pastAll.map(b => {
        const t = concepts(b.eventTopic)
        const shared = [...want].filter(w => t.has(w)).length
        return Math.min(1, shared / 4)
      })
      const track = Math.round(Math.min(40, sims.reduce((a, x) => a + 18 + 12 * x, 0)))

      // Focus: share of their interests that this event hits, plus a bonus for the strongest overlaps.
      const theirs = s.tags.flatMap(t => [...concepts(t)])
      const hits = [...new Set(theirs.filter(t => want.has(t)))]
      const focus = Math.round(Math.min(35, (hits.length / Math.max(3, Math.min(6, s.tags.length))) * 35 + (hits.length >= 3 ? 4 : 0)))

      // Audience: overlap between who they want and who comes.
      const aud = s.audience.filter(a => audience.includes(a))
      const audPts = Math.round((aud.length / audience.length) * 15)

      // Habit: they back hackathons/community events, venues always do.
      const habit = s.hackathons ? 10 : 3

      const score = Math.max(12, Math.min(98, track + focus + audPts + habit))
      const fit = [
        { label: 'Track record', points: track, max: 40, note: pastAll.length ? `${pastAll.length} London event${pastAll.length > 1 ? 's' : ''} on record` : 'None on record yet' },
        { label: 'Focus', points: focus, max: 35, note: hits.length ? hits.slice(0, 4).join(', ') : 'Little overlap' },
        { label: 'Audience', points: audPts, max: 15, note: aud.length ? aud.join(', ') : `Wants ${s.audience.join(', ')}` },
        { label: 'Habit', points: habit, max: 10, note: s.hackathons ? 'Backs community events' : 'Rarely backs events' },
      ]

      const reasons: string[] = []
      if (pastAll.length) reasons.push(`Backed ${pastAll[0].event.replace(/ London Hackathon$/, '')}${pastAll.length > 1 ? ` and ${pastAll.length - 1} more` : ''}`)
      if (hits.length) reasons.push(`Cares about ${hits.slice(0, 3).join(', ')}`)
      if (aud.length) reasons.push(`Wants ${aud.join(' and ')} in the room`)
      if (!reasons.length) reasons.push('Adjacent audience')

      return {
        sponsorId: s.id,
        name: s.name,
        domain: s.domain,
        kind: s.kind,
        score,
        reasons,
        fit,
        pastBackings: (past.length ? past : pastAll).map(b => ({ event: b.event, role: b.role, url: b.url })),
      } satisfies Lead
    })
    .sort((a, b) => b.score - a.score)
}
