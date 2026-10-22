// Vidit: swap the template for the LLM version (docs/03-pitch.md).
// Pricing stays a visible rule table so judges can see it isn't made up.
import type { EventInput, Lead } from './types'

const TIERS = [
  { min: 80, tier: 'Headline', base: 1500 },
  { min: 62, tier: 'Partner', base: 750 },
  { min: 0, tier: 'Supporter', base: 300 },
] as const

export function price(event: EventInput, lead: Lead) {
  if (lead.kind === 'venue') return { suggestedTier: 'Venue' as const, suggestedPriceGbp: 0 }
  const t = TIERS.find(t => lead.score >= t.min)!
  const size = Math.max(1, (event.audienceSize ?? 80) / 80)
  return { suggestedTier: t.tier, suggestedPriceGbp: Math.round((t.base * size) / 50) * 50 }
}

export function pitch(event: EventInput, lead: Lead): Lead {
  const p = price(event, lead)
  const past = lead.pastBackings[0]
  const hook = past ? `You backed ${past.event} as ${past.role.toLowerCase()}, and the people in that room are the people in ours.` : `Our room is exactly who ${lead.name} is building for.`
  const ask =
    lead.kind === 'venue'
      ? `Could we host it at your space? We'd bring ${event.audienceSize ?? 80} builders and credit you on every post.`
      : `We'd love ${lead.name} as a ${p.suggestedTier.toLowerCase()} sponsor at £${p.suggestedPriceGbp.toLocaleString()}: logo on the page, a 2-minute slot at kickoff, and prizes in your name.`
  return {
    ...lead,
    ...p,
    pitch: {
      subject: `${event.name} × ${lead.name}`,
      body: `Hi ${lead.name} team,\n\nI'm running ${event.name}${event.date ? ` on ${event.date}` : ''}: ${event.topic}. ${hook}\n\n${ask}\n\nWorth a 10-minute call this week?`,
    },
  }
}
