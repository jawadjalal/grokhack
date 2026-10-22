// Public read API for agents: GET /api/v1/events?q=&lat=&lng=&radiusKm=&from=&to=&upcoming=1&limit=
import { authorised, searchEvents } from '@/lib/agent-api'

const num = (v: string | null) => (v === null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v))

export async function GET(req: Request) {
  if (!authorised(req)) return Response.json({ error: 'Missing or wrong API key' }, { status: 401 })
  const p = new URL(req.url).searchParams
  const result = await searchEvents({
    q: p.get('q') ?? undefined,
    lat: num(p.get('lat')),
    lng: num(p.get('lng')),
    radiusKm: num(p.get('radiusKm')),
    from: p.get('from') ?? undefined,
    to: p.get('to') ?? undefined,
    upcoming: p.get('upcoming') === '1' || p.get('upcoming') === 'true',
    limit: num(p.get('limit')),
  })
  return Response.json(result, { headers: { 'access-control-allow-origin': '*' } })
}
