import { logTouch, type Touch } from '@/lib/memory'

// Logging never fails the caller.
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Touch | { touches: Touch[] }
    const list = 'touches' in body ? body.touches : [body]
    const saved = await Promise.all(list.slice(0, 50).map(logTouch))
    return Response.json({ ok: true, saved: saved.filter(Boolean).length })
  } catch {
    return Response.json({ ok: false })
  }
}
