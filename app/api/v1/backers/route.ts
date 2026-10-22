// Public read API for agents: GET /api/v1/backers?event=<luma url or description>&lat=&lng=&radiusKm=&limit=
import { authorised, findBackers } from '@/lib/agent-api'

const num = (v: string | null) => (v === null || v === '' || Number.isNaN(Number(v)) ? undefined : Number(v))

export async function GET(req: Request) {
  if (!authorised(req)) return Response.json({ error: 'Missing or wrong API key' }, { status: 401 })
  const p = new URL(req.url).searchParams
  const event = p.get('event')
  if (!event) return Response.json({ error: 'Pass ?event=<event url or description>' }, { status: 400 })
  return Response.json(await findBackers({ event, lat: num(p.get('lat')), lng: num(p.get('lng')), radiusKm: num(p.get('radiusKm')), limit: num(p.get('limit')) }), { headers: { 'access-control-allow-origin': '*' } })
}
