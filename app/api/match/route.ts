import { loadMap } from '@/lib/data'
import { match } from '@/lib/match'
import type { EventInput } from '@/lib/types'

export async function POST(req: Request) {
  const map = await loadMap()
  return Response.json(match((await req.json()) as EventInput, map), { headers: { 'x-backer-source': map.source } })
}
