import { cogneeEnabled } from '@/lib/cognee'
import { listTouches } from '@/lib/memory'
import { buildGraph } from '@/lib/memory-graph'

export const dynamic = 'force-dynamic'

export async function GET() {
  const touches = await listTouches()
  const { nodes, edges } = await buildGraph(touches)
  return Response.json({ touches, nodes, edges, cognee: cogneeEnabled() })
}
