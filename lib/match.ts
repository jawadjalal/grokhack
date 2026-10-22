// Avi: replace the scoring with the real thing (docs/02-matching.md).
// This baseline is deterministic so the UI and demo work without an LLM.
import { backings, sponsors } from './seed'
import type { EventInput, Lead } from './types'

const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length > 2))

export function match(event: EventInput): Lead[] {
  const want = words(`${event.topic} ${event.description ?? ''} ${event.name}`)
  return sponsors
    .map(s => {
      const past = backings.filter(b => b.sponsorId === s.id)
      const overlap = [...words(s.tags.join(' ') + ' ' + past.map(b => b.eventTopic).join(' '))].filter(w => want.has(w))
      const score = Math.min(97, 38 + past.length * 14 + overlap.length * 9)
      const reasons = [
        past.length ? `Backed ${past.length} London event${past.length > 1 ? 's' : ''} like this` : 'New to London events',
        overlap.length ? `Shares your focus: ${overlap.slice(0, 3).join(', ')}` : 'Adjacent audience',
      ]
      return {
        sponsorId: s.id,
        name: s.name,
        domain: s.domain,
        kind: s.kind,
        score,
        reasons,
        pastBackings: past.map(b => ({ event: b.event, role: b.role, url: b.url })),
      } satisfies Lead
    })
    .sort((a, b) => b.score - a.score)
}
