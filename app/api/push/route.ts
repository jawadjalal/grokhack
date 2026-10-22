// Joel: Notion push lands here (docs/04-pipeline.md). Until then it echoes.
import type { EventInput, Lead } from '@/lib/types'

export async function POST(req: Request) {
  const { leads } = (await req.json()) as { event: EventInput; leads: Lead[] }
  return Response.json(leads)
}
