import { z } from 'zod'
import type { EventInput, Lead } from '../types'
import { sponsors } from '../seed'

// Indicative asks for an 80-person event, not researched market prices.
// Company size must be supplied explicitly; match score is not company size.
export const PRICE_RULES = {
  unknown: { tier: 'Supporter', baseGbp: 300 },
  small: { tier: 'Supporter', baseGbp: 300 },
  medium: { tier: 'Partner', baseGbp: 750 },
  large: { tier: 'Headline', baseGbp: 1500 },
} as const

const sizesSchema = z.record(z.string(), z.enum(['small', 'medium', 'large']))
const SEED_SIZES = { startup: 'small', scaleup: 'medium', giant: 'large' } as const
const normaliseDomain = (value: string) => value.toLowerCase().replace(/^www\./, '')

function sponsorSize(domain: string): keyof typeof PRICE_RULES {
  const key = normaliseDomain(domain)
  try {
    const sizes = sizesSchema.safeParse(JSON.parse(process.env.PITCH_SPONSOR_SIZES || '{}'))
    const override = sizes.success ? sizes.data[key] : undefined
    if (override) return override
  } catch { /* Invalid overrides do not block the demo. */ }
  // Reuse the team's supplied company-size classifications from the map.
  const size = sponsors.find(sponsor => normaliseDomain(sponsor.domain) === key)?.size
  return size ? SEED_SIZES[size] : 'unknown'
}

export function price(event: EventInput, lead: Lead) {
  if (lead.kind === 'venue') return { suggestedTier: 'Venue' as const, suggestedPriceGbp: 0 }
  const rule = PRICE_RULES[sponsorSize(lead.domain)]
  // Unknown attendance uses the 80-person baseline for pricing only.
  const audience = event.audienceSize ?? 80
  const multiplier = Math.max(0.5, audience / 80)
  return {
    suggestedTier: rule.tier,
    suggestedPriceGbp: Math.round((rule.baseGbp * multiplier) / 50) * 50,
  }
}
