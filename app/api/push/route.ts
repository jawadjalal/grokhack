import { push } from '@/lib/notion/index'
import type { EventInput, Lead } from '@/lib/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function isEventInput(value: unknown): value is EventInput {
  return (
    isRecord(value) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.topic) &&
    isOptionalString(value.url) &&
    isOptionalString(value.date) &&
    isOptionalString(value.description) &&
    (value.audienceSize === undefined ||
      (typeof value.audienceSize === 'number' &&
        Number.isSafeInteger(value.audienceSize) &&
        value.audienceSize >= 0))
  )
}

function isLead(value: unknown): value is Lead {
  if (!isRecord(value)) return false

  return (
    isNonEmptyString(value.sponsorId) &&
    isNonEmptyString(value.name) &&
    isNonEmptyString(value.domain) &&
    (value.kind === 'sponsor' || value.kind === 'venue') &&
    typeof value.score === 'number' &&
    Number.isFinite(value.score) &&
    value.score >= 0 &&
    value.score <= 100 &&
    Array.isArray(value.reasons) &&
    value.reasons.every(reason => typeof reason === 'string') &&
    Array.isArray(value.pastBackings) &&
    value.pastBackings.every(
      backing =>
        isRecord(backing) &&
        typeof backing.event === 'string' &&
        typeof backing.role === 'string' &&
        typeof backing.url === 'string',
    ) &&
    (value.pitch === undefined ||
      (isRecord(value.pitch) &&
        typeof value.pitch.subject === 'string' &&
        typeof value.pitch.body === 'string')) &&
    (value.suggestedTier === undefined ||
      value.suggestedTier === 'Headline' ||
      value.suggestedTier === 'Partner' ||
      value.suggestedTier === 'Supporter' ||
      value.suggestedTier === 'Venue') &&
    (value.suggestedPriceGbp === undefined ||
      (typeof value.suggestedPriceGbp === 'number' &&
        Number.isFinite(value.suggestedPriceGbp) &&
        value.suggestedPriceGbp >= 0)) &&
    isOptionalString(value.notionUrl)
  )
}

export async function POST(req: Request) {
  let body: unknown

  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Request body must be valid JSON.' }, { status: 400 })
  }

  if (
    !isRecord(body) ||
    !isEventInput(body.event) ||
    !Array.isArray(body.leads) ||
    !body.leads.every(isLead)
  ) {
    return Response.json(
      { error: 'Expected { event: EventInput, leads: Lead[] }.' },
      { status: 400 },
    )
  }

  try {
    return Response.json(await push(body.event, body.leads))
  } catch (error) {
    console.error('Failed to push leads to Notion:', error)
    return Response.json({ error: 'Failed to push leads to Notion.' }, { status: 502 })
  }
}
