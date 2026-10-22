import { pitch } from '@/lib/pitch'
import { pitchRequestSchema } from '@/lib/pitch/validation'

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Send a valid JSON body containing event and lead.' }, { status: 400 })
  }
  const parsed = pitchRequestSchema.safeParse(body)
  if (!parsed.success) {
    return Response.json({
      error: 'Invalid event or lead.',
      fields: parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })),
    }, { status: 400 })
  }
  const { event, lead } = parsed.data
  return Response.json(await pitch(event, lead, { signal: req.signal }))
}
