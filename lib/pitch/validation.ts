import { z } from 'zod'
import type { EventInput, Lead } from '../types'

const text = (max: number) => z.string().trim().min(1).max(max)
const url = z.url().max(2048).refine(value => /^https?:\/\//i.test(value), 'Use an HTTP or HTTPS URL')

const eventSchema = z.object({
  name: text(200),
  url: url.optional(),
  date: text(80).optional(),
  topic: text(2000),
  audienceSize: z.number().int().positive().max(1_000_000).optional(),
  description: z.string().max(10000).optional(),
})

const leadSchema = z.object({
  sponsorId: text(200),
  name: text(200),
  domain: text(253).refine(value => /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(value), 'Use a domain, without a URL scheme'),
  kind: z.enum(['sponsor', 'venue']),
  score: z.number().min(0).max(100),
  reasons: z.array(text(1000)).max(20),
  fit: z.array(z.object({
    label: text(200), points: z.number().nonnegative(), max: z.number().positive(), note: text(1000),
  })).max(20).optional(),
  pastBackings: z.array(z.object({ event: text(500), role: text(200), url })).max(100),
  pitch: z.object({ subject: text(500), body: text(10000) }).optional(),
  suggestedTier: z.enum(['Headline', 'Partner', 'Supporter', 'Venue']).optional(),
  suggestedPriceGbp: z.number().nonnegative().optional(),
  notionUrl: url.optional(),
})

// Local validation follows the shared contract without changing lib/types.ts.
export const pitchRequestSchema: z.ZodType<{ event: EventInput; lead: Lead }> = z.object({
  event: eventSchema,
  lead: leadSchema,
})
