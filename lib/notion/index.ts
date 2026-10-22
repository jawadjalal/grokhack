import type { EventInput, Lead } from '../types'

const NOTION_API = 'https://api.notion.com/v1'
// A database ID is enough for the existing hackathon database. Pinning this
// version keeps its database query endpoint and page parent compatible.
const NOTION_VERSION = '2022-06-28'
const REQUEST_INTERVAL_MS = 350
const MAX_RETRIES = 3

type RichText = { type: 'text'; text: { content: string } }
type NotionPage = {
  url: string
  properties: {
    Domain?: { url?: string | null }
    Event?: { rich_text?: { plain_text?: string; text?: { content?: string } }[] }
  }
}
type QueryResult = { results: NotionPage[]; has_more: boolean; next_cursor: string | null }

let nextRequestAt = 0
let requestQueue: Promise<unknown> = Promise.resolve()
let pushQueue: Promise<unknown> = Promise.resolve()

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function queueRequest<T>(work: () => Promise<T>): Promise<T> {
  const run = requestQueue.then(async () => {
    const wait = nextRequestAt - Date.now()
    if (wait > 0) await sleep(wait)
    nextRequestAt = Date.now() + REQUEST_INTERVAL_MS
    return work()
  })
  requestQueue = run.catch(() => undefined)
  return run
}

function env(): { token: string; databaseId: string } {
  const token = process.env.NOTION_API_KEY?.trim()
  const databaseId = process.env.NOTION_DATABASE_ID?.trim()
  if (!token) throw new Error('Notion is not configured: set NOTION_API_KEY on the server.')
  if (!databaseId) throw new Error('Notion is not configured: set NOTION_DATABASE_ID on the server.')
  if (!/^[0-9a-f]{32}$|^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(databaseId)) {
    throw new Error('NOTION_DATABASE_ID must be a Notion database ID.')
  }
  return { token, databaseId }
}

async function notion<T>(path: string, body: unknown, token: string): Promise<T> {
  const response = await queueRequest(() => fetch(`${NOTION_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }))

  if (response.status === 429 || response.status === 529) {
    // Notion tells us how long its connection or workspace budget needs.
    const retryAfter = Number(response.headers.get('Retry-After'))
    const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000
    return retryNotion(path, body, token, delay, 1)
  }
  return readResponse<T>(response)
}

async function retryNotion<T>(path: string, body: unknown, token: string, delay: number, attempt: number): Promise<T> {
  await sleep(delay)
  const response = await queueRequest(() => fetch(`${NOTION_API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  }))
  if ((response.status === 429 || response.status === 529) && attempt < MAX_RETRIES) {
    const retryAfter = Number(response.headers.get('Retry-After'))
    const nextDelay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : delay * 2
    return retryNotion(path, body, token, nextDelay, attempt + 1)
  }
  return readResponse<T>(response)
}

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({})) as { message?: string; code?: string }
  if (!response.ok) {
    const hint = response.status === 404
      ? ' Check NOTION_DATABASE_ID and share that database with the Notion integration.'
      : response.status === 401
        ? ' Check NOTION_API_KEY.'
        : ''
    throw new Error(`Notion API ${response.status}${payload.code ? ` (${payload.code})` : ''}: ${payload.message || response.statusText}.${hint}`)
  }
  return payload as T
}

function richText(value: string): RichText[] {
  // Notion caps each text.content at 2,000 characters.
  const chunks = value.match(/[\s\S]{1,2000}/g) || ['']
  return chunks.map((content) => ({ type: 'text', text: { content } }))
}

function domainUrl(domain: string): string {
  const value = domain.trim().toLowerCase()
  if (!value) throw new Error('A lead is missing its domain.')
  const url = new URL(/^https?:\/\//.test(value) ? value : `https://${value}`)
  if (!url.hostname.includes('.')) throw new Error(`Invalid lead domain: ${domain}`)
  return `https://${url.hostname.replace(/^www\./, '')}`
}

function domainKey(domain: string): string {
  return domainUrl(domain).slice('https://'.length)
}

function blocks(lead: Lead): unknown[] {
  if (!lead.pitch) return []
  const paragraphs = [
    `Subject: ${lead.pitch.subject}`,
    ...lead.pitch.body.split(/\n\s*\n/).filter(Boolean),
  ]
  return paragraphs.flatMap((paragraph) => {
    const chunks = paragraph.match(/[\s\S]{1,2000}/g) || ['']
    return chunks.map((content) => ({
      object: 'block', type: 'paragraph',
      paragraph: { rich_text: richText(content) },
    }))
  })
}

function pageBody(databaseId: string, event: EventInput, lead: Lead): unknown {
  const price = lead.suggestedPriceGbp
  return {
    parent: { database_id: databaseId },
    properties: {
      Name: { title: richText(lead.name) },
      Domain: { url: domainUrl(lead.domain) },
      Kind: { select: { name: lead.kind } },
      Score: { number: lead.score },
      Status: { select: { name: 'To contact' } },
      ...(lead.suggestedTier ? { Tier: { select: { name: lead.suggestedTier } } } : {}),
      ...(price !== undefined ? { 'Price GBP': { number: price } } : {}),
      Event: { rich_text: richText(event.name) },
      Reasons: { rich_text: richText(lead.reasons.join('; ')) },
    },
    children: blocks(lead),
  }
}

async function existingPages(event: EventInput, token: string, databaseId: string): Promise<Map<string, string>> {
  const found = new Map<string, string>()
  let cursor: string | null = null
  do {
    const result: QueryResult = await notion<QueryResult>(`/databases/${databaseId}/query`, {
      filter: { property: 'Event', rich_text: { equals: event.name } },
      page_size: 100,
      ...(cursor ? { start_cursor: cursor } : {}),
    }, token)
    for (const page of result.results) {
      const domain = page.properties.Domain?.url
      if (domain) found.set(domainKey(domain), page.url)
    }
    cursor = result.has_more ? result.next_cursor : null
  } while (cursor)
  return found
}

async function pushNow(event: EventInput, leads: Lead[]): Promise<Lead[]> {
  if (!event?.name?.trim()) throw new Error('An event name is required for the Notion pipeline.')
  if (!Array.isArray(leads)) throw new Error('Leads must be an array.')
  if (leads.length === 0) return []

  const { token, databaseId } = env()
  const found = await existingPages(event, token, databaseId)
  const output: Lead[] = []
  for (const lead of leads) {
    const key = domainKey(lead.domain)
    let url = found.get(key)
    if (!url) {
      const page = await notion<NotionPage>('/pages', pageBody(databaseId, event, lead), token)
      url = page.url
      found.set(key, url)
    }
    output.push({ ...lead, notionUrl: url })
  }
  return output
}

/** Create one Notion page per event/domain pair and return their page URLs. */
export function push(event: EventInput, leads: Lead[]): Promise<Lead[]> {
  // Serialize calls in this server process, including duplicate checks.
  const run = pushQueue.then(() => pushNow(event, leads))
  pushQueue = run.catch(() => undefined)
  return run
}
