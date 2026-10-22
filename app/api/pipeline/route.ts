import { cleanDomain, isStatus, type PipelineLead } from '@/lib/pipeline'

export const dynamic = 'force-dynamic'

const NOTION_API = 'https://api.notion.com/v1'
const NOTION_VERSION = '2026-03-11'

type Rich = { plain_text?: string }[]
type Page = {
  id: string
  url: string
  last_edited_time?: string
  properties: Record<string, {
    title?: Rich
    rich_text?: Rich
    url?: string | null
    number?: number | null
    select?: { name?: string } | null
  }>
}

function config() {
  const token = process.env.NOTION_TOKEN?.trim()
  const dataSourceId = process.env.NOTION_DATA_SOURCE_ID?.trim()
  if (!token || !dataSourceId) return null
  if (!/^[0-9a-f]{32}$|^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(dataSourceId)) return null
  return { token, dataSourceId }
}

async function notion<T>(path: string, method: 'POST' | 'PATCH', body: unknown, token: string): Promise<T> {
  const res = await fetch(`${NOTION_API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(9000),
    cache: 'no-store',
  })
  const payload = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(`Notion ${res.status}: ${(payload as { message?: string }).message ?? res.statusText}`)
  return payload as T
}

function text(rich?: Rich) {
  return (rich ?? []).map((r) => r.plain_text ?? '').join('')
}

function toLead(page: Page): PipelineLead | null {
  const p = page.properties
  const domain = cleanDomain(p.Domain?.url ?? '')
  const name = text(p.Name?.title)
  if (!domain || !name) return null
  const status = p.Status?.select?.name
  const price = p['Price GBP']?.number
  return {
    sponsorId: domain,
    name,
    domain,
    kind: p.Kind?.select?.name === 'venue' ? 'venue' : 'sponsor',
    score: typeof p.Score?.number === 'number' ? p.Score.number : 0,
    status: isStatus(status) ? status : 'To contact',
    tier: p.Tier?.select?.name || undefined,
    priceGbp: typeof price === 'number' ? price : undefined,
    event: text(p.Event?.rich_text),
    notionUrl: page.url,
    pageId: page.id,
    updatedAt: page.last_edited_time ?? new Date(0).toISOString(),
  }
}

// GET: the Notion pipeline if configured. Otherwise { source: 'local' } and the page reads localStorage.
export async function GET() {
  const cfg = config()
  if (!cfg) return Response.json({ source: 'local', leads: [] })
  try {
    const leads: PipelineLead[] = []
    let cursor: string | null = null
    do {
      const result: { results: Page[]; has_more: boolean; next_cursor: string | null } = await notion(
        `/data_sources/${cfg.dataSourceId}/query`, 'POST',
        { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) }, cfg.token)
      for (const page of result.results) {
        const lead = toLead(page)
        if (lead) leads.push(lead)
      }
      cursor = result.has_more ? result.next_cursor : null
    } while (cursor)
    return Response.json({ source: 'notion', leads })
  } catch (error) {
    console.error('Pipeline read from Notion failed:', error)
    return Response.json({ source: 'local', leads: [], error: 'Notion is unreachable, showing saved leads.' })
  }
}

// PATCH { pageId, status }: moves a card in Notion. The page keeps its own copy in localStorage either way.
export async function PATCH(req: Request) {
  const body = await req.json().catch(() => null) as { pageId?: unknown; status?: unknown } | null
  if (!body || typeof body.pageId !== 'string' || !/^[0-9a-f-]{32,36}$/i.test(body.pageId) || !isStatus(body.status)) {
    return Response.json({ error: 'Expected { pageId, status }.' }, { status: 400 })
  }
  const cfg = config()
  if (!cfg) return Response.json({ synced: false, reason: 'Notion is not configured.' })
  try {
    await notion(`/pages/${body.pageId}`, 'PATCH', { properties: { Status: { select: { name: body.status } } } }, cfg.token)
    return Response.json({ synced: true })
  } catch (error) {
    console.error('Pipeline status sync failed:', error)
    return Response.json({ synced: false, reason: 'Notion rejected the update.' })
  }
}
