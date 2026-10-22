import { match } from '@/lib/match'
import type { EventInput } from '@/lib/types'

export async function POST(req: Request) {
  return Response.json(match((await req.json()) as EventInput))
}
