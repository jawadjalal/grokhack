import { pitch } from '@/lib/pitch'
import type { EventInput, Lead } from '@/lib/types'

export async function POST(req: Request) {
  const { event, lead } = (await req.json()) as { event: EventInput; lead: Lead }
  return Response.json(pitch(event, lead))
}
