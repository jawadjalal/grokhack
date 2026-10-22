import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { performance } from 'node:perf_hooks'
import { MockLanguageModelV4 } from 'ai/test'
import { pitch, price, wordCount, PITCH_TIMEOUT_MS } from '../pitch'
import { match } from '../match'
import { pitchRequestSchema } from './validation'
import { POST } from '../../app/api/pitch/route'
import type { EventInput, Lead } from '../types'

const event: EventInput = {
  name: 'London Community Builders', topic: 'AI tools and community projects',
  audienceSize: 80, date: '2026-11-12',
}
const lead: Lead = {
  sponsorId: 'example', name: 'Example', domain: 'example.com', kind: 'sponsor', score: 95,
  reasons: ['Shares a focus on community projects'],
  pastBackings: [
    { event: 'London Builders Meetup', role: 'Tech partner', url: 'https://example.com/meetup' },
    { event: 'Community Tools Hackathon', role: 'Community partner', url: 'https://example.com/hack' },
  ],
}
const keys = ['MODEL', 'XAI_API_KEY', 'AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN', 'PITCH_SPONSOR_SIZES'] as const
let saved: Partial<Record<typeof keys[number], string>>
beforeEach(() => {
  saved = {}
  for (const key of keys) { saved[key] = process.env[key]; delete process.env[key] }
})
afterEach(() => {
  for (const key of keys) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

function modelReturning(text: string) {
  return new MockLanguageModelV4({ doGenerate: {
    content: [{ type: 'text', text }], finishReason: { unified: 'stop', raw: undefined },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 20, text: 20, reasoning: undefined },
    }, warnings: [],
  } })
}

test('five seed sponsors produce short drafts with supplied backing evidence', async () => {
  const sponsors = match(event).filter(item => ['supabase', 'cognee', 'zero', 'notion', 'cursor'].includes(item.sponsorId))
  assert.equal(sponsors.length, 5)
  for (const sponsor of sponsors) {
    const started = performance.now()
    const result = await pitch(event, sponsor)
    assert.ok(performance.now() - started < 5000)
    assert.ok(wordCount(`${result.pitch!.subject} ${result.pitch!.body}`) < 120)
    assert.match(result.pitch!.body, /Grok Bot Community Engineering London Hackathon/)
    assert.equal(result.pitch!.body.match(/\?/g)?.length, 1)
    assert.deepEqual(result.pastBackings, sponsor.pastBackings)
  }
})

test('venue draft requests hosting in kind and carries no cash ask', async () => {
  const result = await pitch(event, { ...lead, kind: 'venue' })
  assert.equal(result.suggestedTier, 'Venue')
  assert.equal(result.suggestedPriceGbp, 0)
  assert.match(result.pitch!.body, /in-kind venue partner/)
  assert.doesNotMatch(result.pitch!.body, /£/)
})

test('pricing uses explicit size and audience, independently of match score', () => {
  process.env.PITCH_SPONSOR_SIZES = '{"example.com":"large"}'
  assert.deepEqual(price(event, lead), { suggestedTier: 'Headline', suggestedPriceGbp: 1500 })
  assert.deepEqual(price(event, { ...lead, score: 0 }), price(event, lead))
  assert.equal(price({ ...event, audienceSize: 160 }, lead).suggestedPriceGbp, 3000)
  assert.equal(price({ ...event, audienceSize: 40 }, lead).suggestedPriceGbp, 750)
  process.env.PITCH_SPONSOR_SIZES = '{"example.com":"medium"}'
  assert.equal(price(event, { ...lead, domain: 'WWW.EXAMPLE.COM' }).suggestedTier, 'Partner')
  process.env.PITCH_SPONSOR_SIZES = '{"example.com":"small"}'
  assert.equal(price(event, lead).suggestedTier, 'Supporter')
})

test('missing or malformed size configuration uses a conservative unknown-size price', () => {
  for (const value of ['', 'not json', '{"example.com":"enormous"}', '{}']) {
    process.env.PITCH_SPONSOR_SIZES = value
    assert.deepEqual(price(event, lead), { suggestedTier: 'Supporter', suggestedPriceGbp: 300 })
  }
})

test('pricing reuses the latest team seed sizes and allows explicit overrides', () => {
  const candidates = match(event)
  assert.equal(price(event, candidates.find(item => item.sponsorId === 'notion')!).suggestedTier, 'Headline')
  assert.equal(price(event, candidates.find(item => item.sponsorId === 'supabase')!).suggestedTier, 'Partner')
  assert.equal(price(event, candidates.find(item => item.sponsorId === 'cognee')!).suggestedTier, 'Supporter')
  process.env.PITCH_SPONSOR_SIZES = '{"supabase.com":"large"}'
  assert.equal(price(event, candidates.find(item => item.sponsorId === 'supabase')!).suggestedTier, 'Headline')
})

test('AI fit sentence is combined with supplied evidence and code-calculated pricing', async () => {
  const fit = 'Your team could meet organisers exploring practical tools for their communities.'
  const model = modelReturning(JSON.stringify({ fit }))
  const result = await pitch(event, { ...lead, notionUrl: 'https://notion.so/existing' }, { model })
  assert.ok(result.pitch!.body.includes(fit))
  assert.match(result.pitch!.body, /London Builders Meetup/)
  assert.match(result.pitch!.body, /Community Tools Hackathon/)
  assert.match(result.pitch!.body, /£300/)
  assert.equal(result.notionUrl, 'https://notion.so/existing')
  assert.equal(model.doGenerateCalls.length, 1)
})

test('empty history and unknown attendance do not become invented facts', async () => {
  const result = await pitch({ ...event, audienceSize: undefined }, { ...lead, pastBackings: [] })
  assert.doesNotMatch(result.pitch!.body, /listed as|backed|80 people/)
  assert.equal(result.suggestedPriceGbp, 300)
})

test('current event and duplicate history are excluded from past sponsorship references', async () => {
  const result = await pitch(event, {
    ...lead, pastBackings: [
      { ...lead.pastBackings[0], event: event.name },
      lead.pastBackings[0], lead.pastBackings[0],
    ],
  })
  assert.equal(result.pitch!.body.match(/London Builders Meetup/g)?.length, 1)
  assert.doesNotMatch(result.pitch!.body, /for London Community Builders/)
})

test('same source URL with a different event title is not treated as past backing', async () => {
  const result = await pitch({ ...event, url: 'https://example.com/meetup/' }, {
    ...lead, pastBackings: [lead.pastBackings[0]],
  })
  assert.doesNotMatch(result.pitch!.body, /listed as/)
})

test('long supplied fields still produce a draft under 120 words', async () => {
  const longEvent = { ...event, name: 'Event '.repeat(30), topic: 'Topic '.repeat(200) }
  const longLead = { ...lead, name: 'Sponsor '.repeat(25), pastBackings: [
    { ...lead.pastBackings[0], event: 'Long event name '.repeat(30), role: 'Community partner '.repeat(10) },
  ] }
  const result = await pitch(longEvent, longLead)
  assert.ok(wordCount(`${result.pitch!.subject} ${result.pitch!.body}`) < 120)
})

test('malformed, overly long, or history-claiming AI text falls back safely', async () => {
  const fallback = await pitch(event, lead)
  for (const text of [
    'not JSON', '{}', '{"fit":""}',
    JSON.stringify({ fit: 'word '.repeat(40) }),
    JSON.stringify({ fit: 'You backed five other events last year.' }),
    JSON.stringify({ fit: 'You will reach 500 customers.' }),
    JSON.stringify({ fit: 'Would you sponsor us for £900?' }),
  ]) {
    assert.deepEqual(await pitch(event, lead, { model: modelReturning(text) }), fallback)
  }
})

test('provider failure falls back without retries or changing the response contract', async () => {
  const model = new MockLanguageModelV4({ doGenerate: async () => { throw new Error('unavailable') } })
  assert.deepEqual(await pitch(event, lead, { model }), await pitch(event, lead))
  assert.equal(model.doGenerateCalls.length, 1)
})

test('slow provider is aborted and falls back within the five-second budget', async () => {
  const model = new MockLanguageModelV4({ doGenerate: async ({ abortSignal }) => {
    return new Promise((_, reject) => {
      const abort = () => reject(abortSignal!.reason)
      if (abortSignal?.aborted) abort()
      else abortSignal?.addEventListener('abort', abort, { once: true })
    })
  } })
  const started = performance.now()
  assert.deepEqual(await pitch(event, lead, { model }), await pitch(event, lead))
  const elapsed = performance.now() - started
  assert.ok(elapsed >= PITCH_TIMEOUT_MS - 100)
  assert.ok(elapsed < 5000, `Elapsed ${elapsed}ms`)
})

test('request validation rejects invalid scores, audience sizes, domains, URLs and missing fields', () => {
  for (const body of [
    {}, { event }, { event, lead: { ...lead, score: 101 } },
    { event: { ...event, audienceSize: -1 }, lead },
    { event, lead: { ...lead, domain: 'https://example.com' } },
    { event, lead: { ...lead, pastBackings: [{ ...lead.pastBackings[0], url: 'javascript:alert(1)' }] } },
  ]) assert.equal(pitchRequestSchema.safeParse(body).success, false)
  assert.equal(pitchRequestSchema.safeParse({ event, lead }).success, true)
})

test('pitch route returns helpful 400s for malformed JSON or invalid fields', async () => {
  const malformed = await POST(new Request('http://localhost/api/pitch', { method: 'POST', body: '{' }))
  assert.equal(malformed.status, 400)
  const invalid = await POST(new Request('http://localhost/api/pitch', { method: 'POST', body: '{}' }))
  assert.equal(invalid.status, 400)
  assert.ok((await invalid.json()).fields.some((field: { path: string }) => field.path === 'event'))
})

test('pitch route awaits generation and returns a lead, including tracking fields', async () => {
  const fit = [{ label: 'Focus', points: 25, max: 35, note: 'community tools' }]
  const response = await POST(new Request('http://localhost/api/pitch', {
    method: 'POST', body: JSON.stringify({ event, lead: { ...lead, fit, notionUrl: 'https://notion.so/existing' } }),
  }))
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.sponsorId, lead.sponsorId)
  assert.equal(result.notionUrl, 'https://notion.so/existing')
  assert.deepEqual(result.fit, fit)
  assert.equal(typeof result.pitch.body, 'string')
})
