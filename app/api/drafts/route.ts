import { loadMap } from '@/lib/data'
import { draftLuma, draftOutreach, draftSocial, leadFromMap, resolveEvent } from '@/lib/drafts'
import type { EventInput, Lead } from '@/lib/types'

export const maxDuration = 30

type Body = { kind?: 'outreach' | 'social' | 'luma'; event?: EventInput | string; lead?: Lead | string; confirmed?: { name: string }[]; location?: string }

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body
  const kind = body.kind ?? 'outreach'
  try {
    if (kind === 'luma') {
      const text = typeof body.event === 'string' ? body.event : [body.event?.name, body.event?.date, body.event?.topic].filter(Boolean).join('. ')
      return Response.json(await draftLuma(text || 'London tech meetup', body.location))
    }
    const event = await resolveEvent(body.event)
    if (kind === 'social') return Response.json(await draftSocial(event, body.confirmed ?? []))
    let lead = typeof body.lead === 'object' ? body.lead : null
    if (!lead && typeof body.lead === 'string') lead = leadFromMap(body.lead, await loadMap())
    if (!lead) return Response.json({ error: 'Pick a sponsor to draft outreach for.' }, { status: 400 })
    return Response.json(await draftOutreach(event, lead))
  } catch {
    return Response.json({ error: 'Drafts are unavailable right now.' }, { status: 500 })
  }
}
