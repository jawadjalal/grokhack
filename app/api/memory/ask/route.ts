import { cogneeEnabled, cogneeSearch } from '@/lib/cognee'
import { listTouches } from '@/lib/memory'
import { answerFromLog } from '@/lib/memory-graph'

export async function POST(req: Request) {
  const { question } = (await req.json().catch(() => ({}))) as { question?: string }
  const q = (question ?? '').trim()
  if (!q) return Response.json({ answer: 'Ask something, like "Who hasn\'t replied?"', source: 'log', cognee: cogneeEnabled() })
  const viaCognee = await cogneeSearch(q)
  if (viaCognee) return Response.json({ answer: viaCognee, source: 'cognee', cognee: true })
  return Response.json({ answer: answerFromLog(q, await listTouches()), source: 'log', cognee: cogneeEnabled() })
}
