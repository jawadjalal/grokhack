// Fit score, out of 100, from four parts you can see in the drawer:
//   Track record  40  have they backed events like this one, in London
//   Focus         35  does what they care about match the event's topic
//   Audience      15  do they want the people this event brings
//   Habit         10  do they back hackathons and community events at all
// Then, if XAI_API_KEY is set, Grok rewrites the reasons for the top 15.
// Scores stay rule-based either way.
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

type SponsorMap = Pick<BackerMap, 'sponsors' | 'backings'>

export async function match(event: EventInput, map: SponsorMap = { sponsors: seedSponsors, backings: seedBackings }): Promise<Lead[]> {
  return withGrokReasons(event, fit(event, map), map.sponsors)
}

function fit(event: EventInput, { sponsors, backings }: SponsorMap): Lead[] {
  const want = concepts(`${event.name} ${event.topic} ${event.description ?? ''}`)
  const audience = (Object.keys(AUDIENCE_HINTS) as Audience[]).filter(a => want.has(a))
  if (!audience.length) audience.push('developers')

  return sponsors
    .map(s => {
      const past = backings.filter(b => b.sponsorId === s.id && b.url !== event.url)
      const pastAll = backings.filter(b => b.sponsorId === s.id)

      // Track record: each past backing counts by how close its topic is to ours.
      // Mostly similarity, so backing an AI hackathon says little about a fintech one.
      const sims = pastAll.map(b => {
        const t = concepts(b.eventTopic)
        const shared = [...want].filter(w => t.has(w)).length
        return Math.min(1, shared / 4)
      })
      const track = Math.round(Math.min(40, sims.reduce((a, x) => a + 6 + 24 * x, 0)))

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
      const backed = pastAll.length ? `Backed ${pastAll[0].event.replace(/ London Hackathon$/, '')}${pastAll.length > 1 ? ` and ${pastAll.length - 1} more` : ''}` : ''
      // Lead with the backing only when it was a similar event.
      if (backed && Math.max(...sims) >= 0.5) reasons.push(backed)
      if (hits.length) reasons.push(`Cares about ${hits.slice(0, 3).join(', ')}`)
      if (backed && !reasons.includes(backed)) reasons.push(backed)
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

// Grok pass: better reasons for the top 15, citing only backings in the data.
// No key, a timeout or a bad reply keeps the rule-based reasons.
const GROK_TOP = 15
const GROK_BATCH = 3 // parallel calls of 3: ~2.5s for all 15, vs 6-10s in one call
const GROK_TIMEOUT_MS = 8000
const GROK_URL = `${process.env.XAI_BASE_URL ?? 'https://api.x.ai/v1'}/chat/completions`
// grok-4.7 takes 15s+ even on low effort, too slow for a live demo.
const MODEL = process.env.MODEL ?? 'grok-4.20-0309-non-reasoning'

// A reason that claims a backing must cite one by tag, e.g. "Backed [B1]".
const CLAIM = /\b(backed|backs|backing|backers?|sponsor\w*|partner\w*|hosted|supported|supporters?|funded|exhibit\w*|track record)\b/i

const written = new Map<string, Map<string, string[]>>()

async function withGrokReasons(event: EventInput, leads: Lead[], sponsors: SponsorMap['sponsors']): Promise<Lead[]> {
  const key = process.env.XAI_API_KEY
  if (!key) return leads
  const cacheKey = JSON.stringify([event.name, event.topic, event.description, event.audienceSize, event.url])
  try {
    const reasons = written.get(cacheKey) ?? (await grokReasons(key, event, leads.slice(0, GROK_TOP), sponsors))
    if (written.size > 50) written.clear()
    written.set(cacheKey, reasons)
    return leads.map(l => (reasons.get(l.sponsorId)?.length ? { ...l, reasons: reasons.get(l.sponsorId)! } : l))
  } catch (e) {
    console.warn('[match] Grok reasons skipped:', e instanceof Error ? e.message : e)
    return leads
  }
}

// Swap [B1] tags for the real event and role (whatever the model wrote after
// the tag, up to the end of that clause, is replaced). Drop any reason that claims a backing without a tag,
// or cites a tag that doesn't exist.
export function cite(reason: string, past: Lead['pastBackings']): string | null {
  let bad = false
  const tagged = /\[B\d+\]/.test(reason)
  const out = reason.replace(/\[B(\d+)\][^,;·.]*/g, (_, n: string) => {
    const b = past[Number(n) - 1]
    if (!b) bad = true
    return b ? `${b.event.replace(/ London Hackathon$/, '')} as ${b.role[0].toLowerCase()}${b.role.slice(1)}` : ''
  })
  if (bad || (CLAIM.test(reason) && !tagged)) return null
  const text = out.replace(/\s+/g, ' ').trim()
  return (text.length > 90 ? text.slice(0, text.lastIndexOf(' ', 90)) : text) || null
}

async function grokReasons(key: string, event: EventInput, top: Lead[], sponsors: SponsorMap['sponsors']): Promise<Map<string, string[]>> {
  const groups: Lead[][] = []
  for (let i = 0; i < top.length; i += GROK_BATCH) groups.push(top.slice(i, i + GROK_BATCH))
  const settled = await Promise.allSettled(groups.map(g => grokBatch(key, event, g, sponsors)))
  const done = settled.flatMap(r => (r.status === 'fulfilled' ? [r.value] : []))
  if (!done.length) throw (settled[0] as PromiseRejectedResult).reason
  return new Map(done.flatMap(m => [...m]))
}

async function grokBatch(key: string, event: EventInput, top: Lead[], sponsors: SponsorMap['sponsors']): Promise<Map<string, string[]>> {
  const candidates = top.map(l => {
    const s = sponsors.find(s => s.id === l.sponsorId)
    return {
      id: l.sponsorId,
      name: l.name,
      kind: l.kind,
      size: s?.size,
      caresAbout: s?.tags,
      wantsInTheRoom: s?.audience,
      fit: l.fit?.map(f => `${f.label} ${f.points}/${f.max}: ${f.note}`),
      backings: l.pastBackings.map((b, i) => `[B${i + 1}] ${b.event} (${b.role})`),
    }
  })
  const system = [
    'You help London community organisers find sponsors and venues. For one event you get candidates with a rule-based fit breakdown.',
    'For each candidate write 1 to 3 reasons, under 60 characters each, why they would back this exact event. Specific to this event and audience, plain words, no hype. Lead with the strongest. If the fit is weak, say plainly what is missing instead of stretching.',
    'Only mention a past backing by its tag, e.g. "Backed [B1]". The role is added for you. Never claim a backing, sponsorship or partnership that is not in that candidate\'s backings list. With no backings, argue from fit alone. For how often they back events, only restate the Habit line.',
    'Reply with JSON only: {"leads":[{"id":"...","reasons":["..."]}]}, one entry per candidate.',
  ].join('\n')

  const res = await fetch(GROK_URL, {
    method: 'POST',
    headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify({ event, candidates }) },
      ],
    }),
    signal: AbortSignal.timeout(GROK_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`)
  const text: string = (await res.json()).choices?.[0]?.message?.content ?? ''
  const json = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1))
  if (!Array.isArray(json.leads)) throw new Error('reply had no leads array')

  const out = new Map<string, string[]>()
  for (const j of json.leads as { id?: string; reasons?: unknown }[]) {
    const lead = top.find(l => l.sponsorId === j.id)
    if (!lead || !Array.isArray(j.reasons)) continue
    const ok = j.reasons.map(r => cite(String(r), lead.pastBackings)).filter((r): r is string => !!r)
    if (ok.length) out.set(lead.sponsorId, ok.slice(0, 3))
  }
  return out
}
