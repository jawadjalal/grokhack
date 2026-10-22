import { sendPitch } from '@/lib/email'

export async function POST(req: Request) {
  const { to, subject, body } = (await req.json()) as { to: string; subject: string; body: string }
  try {
    return Response.json({ id: await sendPitch({ to, subject, body }) })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}
