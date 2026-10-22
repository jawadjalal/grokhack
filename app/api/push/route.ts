import { push } from '@/lib/notion'
import type { EventInput, Lead } from '@/lib/types'

export async function POST(req: Request) {
  const { event, leads } = (await req.json()) as { event: EventInput; leads: Lead[] }
  try {
    return Response.json(await push(event, leads))
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}
