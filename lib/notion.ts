// Pushes leads into a Notion database the organiser already works from.
// Needs NOTION_TOKEN (an internal integration) and either NOTION_DATABASE_ID,
// or NOTION_PARENT_PAGE_ID to create "Backer pipeline" on first push.
// Share the page or database with the integration, or Notion returns 404.
import type { EventInput, Lead } from './types'

const API = 'https://api.notion.com/v1'

async function notion<T>(path: string, method: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${process.env.NOTION_TOKEN}`,
      'notion-version': '2022-06-28',
      'content-type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`Notion ${res.status}: ${(await res.text()).slice(0, 300)}`)
  return res.json()
}

const text = (content: string) => [{ type: 'text', text: { content: content.slice(0, 1900) } }]
const select = (...names: string[]) => ({ select: { options: names.map(name => ({ name })) } })

let databaseId = process.env.NOTION_DATABASE_ID

async function ensureDatabase(): Promise<string> {
  if (databaseId) return databaseId
  const parent = process.env.NOTION_PARENT_PAGE_ID
  if (!parent) throw new Error('Set NOTION_DATABASE_ID or NOTION_PARENT_PAGE_ID')
  const db = await notion<{ id: string }>('/databases', 'POST', {
    parent: { type: 'page_id', page_id: parent },
    title: text('Backer pipeline'),
    properties: {
      Name: { title: {} },
      Status: select('To contact', 'Contacted', 'Replied', 'Call', 'Signed', 'No'),
      Fit: { number: {} },
      Tier: select('Headline', 'Partner', 'Supporter', 'Venue'),
      'Price GBP': { number: { format: 'pound' } },
      Kind: select('sponsor', 'venue'),
      Domain: { url: {} },
      Event: { rich_text: {} },
      Why: { rich_text: {} },
    },
  })
  databaseId = db.id
  return db.id
}

export async function push(event: EventInput, leads: Lead[]): Promise<Lead[]> {
  if (!process.env.NOTION_TOKEN) throw new Error("Notion isn't connected yet: add NOTION_TOKEN")
  const db = await ensureDatabase()
  const out: Lead[] = []
  // Notion allows about 3 requests a second.
  for (const lead of leads) {
    const existing = await notion<{ results: { url: string }[] }>(`/databases/${db}/query`, 'POST', {
      filter: { and: [{ property: 'Domain', url: { equals: `https://${lead.domain}` } }, { property: 'Event', rich_text: { equals: event.name.slice(0, 1900) } }] },
    })
    if (existing.results[0]) {
      out.push({ ...lead, notionUrl: existing.results[0].url })
      continue
    }
    const page = await notion<{ url: string }>('/pages', 'POST', {
      parent: { database_id: db },
      properties: {
        Name: { title: text(lead.name) },
        Status: { select: { name: 'To contact' } },
        Fit: { number: lead.score },
        Tier: lead.suggestedTier ? { select: { name: lead.suggestedTier } } : undefined,
        'Price GBP': { number: lead.suggestedPriceGbp ?? null },
        Kind: { select: { name: lead.kind } },
        Domain: { url: `https://${lead.domain}` },
        Event: { rich_text: text(event.name) },
        Why: { rich_text: text(lead.reasons.join(' · ')) },
      },
      children: lead.pitch
        ? [
            { object: 'block', type: 'heading_3', heading_3: { rich_text: text(lead.pitch.subject) } },
            ...lead.pitch.body.split('\n\n').map(p => ({ object: 'block', type: 'paragraph', paragraph: { rich_text: text(p) } })),
          ]
        : [],
    })
    out.push({ ...lead, notionUrl: page.url })
  }
  return out
}
