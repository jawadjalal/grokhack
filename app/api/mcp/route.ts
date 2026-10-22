// MCP server (Streamable HTTP, JSON responses) so Grok Bot can read Backer's map:
// point an MCP client at https://grokhack.vercel.app/api/mcp. Read-only tools.
import { authorised, findBackers, getSponsor, searchEvents } from '@/lib/agent-api'

const TOOLS = [
  {
    name: 'search_events',
    description: 'Search London tech events Backer has scraped (Luma, Devpost, Meetup, Eventbrite, dev.events, GDG and more). Filter by text, date range, upcoming only, or distance from a point.',
    inputSchema: {
      type: 'object',
      properties: {
        q: { type: 'string', description: 'Words to match in the name, topic or organiser' },
        lat: { type: 'number' }, lng: { type: 'number' },
        radiusKm: { type: 'number', description: 'Only events within this distance of lat/lng' },
        from: { type: 'string', description: 'YYYY-MM-DD' }, to: { type: 'string', description: 'YYYY-MM-DD' },
        upcoming: { type: 'boolean', description: 'Only events from today on' },
        limit: { type: 'number', description: 'Max results, default 20, max 100' },
      },
    },
  },
  {
    name: 'find_backers',
    description: 'Rank the sponsors and venues most likely to back an event, with reasons that cite only real past backings. Pass a Luma/event URL Backer knows, or a short description.',
    inputSchema: {
      type: 'object',
      properties: { event: { type: 'string' }, lat: { type: 'number' }, lng: { type: 'number' }, radiusKm: { type: 'number' }, limit: { type: 'number' } },
      required: ['event'],
    },
  },
  {
    name: 'get_sponsor',
    description: 'Everything Backer knows about one company by domain: kind, tags and every event it backed with source links.',
    inputSchema: { type: 'object', properties: { domain: { type: 'string', description: 'e.g. cursor.com' } }, required: ['domain'] },
  },
]

type Rpc = { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: Record<string, unknown> }

const ok = (id: Rpc['id'], result: unknown) => ({ jsonrpc: '2.0', id: id ?? null, result })
const fail = (id: Rpc['id'], code: number, message: string) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

async function call(name: string, args: Record<string, unknown>) {
  if (name === 'search_events') return searchEvents(args)
  if (name === 'find_backers') return findBackers(args as { event: string })
  if (name === 'get_sponsor') return (await getSponsor(String(args.domain ?? ''))) ?? { error: 'Not in the map' }
  throw new Error(`Unknown tool ${name}`)
}

async function handle(msg: Rpc) {
  switch (msg.method) {
    case 'initialize':
      return ok(msg.id, { protocolVersion: (msg.params?.protocolVersion as string) ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'backer', version: '1.0.0' }, instructions: 'Backer knows who sponsored London tech events. Use search_events to find events, find_backers to rank likely sponsors for an event, get_sponsor for one company.' })
    case 'ping':
      return ok(msg.id, {})
    case 'tools/list':
      return ok(msg.id, { tools: TOOLS })
    case 'tools/call': {
      const name = String(msg.params?.name ?? '')
      try {
        const data = await call(name, (msg.params?.arguments as Record<string, unknown>) ?? {})
        return ok(msg.id, { content: [{ type: 'text', text: JSON.stringify(data) }], structuredContent: data })
      } catch (e) {
        return ok(msg.id, { content: [{ type: 'text', text: e instanceof Error ? e.message : String(e) }], isError: true })
      }
    }
    default:
      return msg.id === undefined ? null : fail(msg.id, -32601, `Method not found: ${msg.method}`)
  }
}

export async function POST(req: Request) {
  if (!authorised(req)) return Response.json(fail(null, -32001, 'Missing or wrong API key'), { status: 401 })
  let body: Rpc | Rpc[]
  try {
    body = await req.json()
  } catch {
    return Response.json(fail(null, -32700, 'Parse error'), { status: 400 })
  }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map(handle))).filter(Boolean)
    return out.length ? Response.json(out) : new Response(null, { status: 202 })
  }
  const out = await handle(body)
  return out ? Response.json(out) : new Response(null, { status: 202 })
}

export async function GET() {
  return Response.json({ name: 'backer', transport: 'streamable-http', tools: TOOLS.map(t => t.name) })
}
