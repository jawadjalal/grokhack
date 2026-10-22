// Turns the touch log plus the backing map into nodes and edges, and answers simple questions from the log.
import { loadMap } from './data'
import type { Touch } from './memory'

export type GNode = { id: string; type: 'event' | 'sponsor' | 'person'; label: string; domain?: string; past?: boolean }
export type GEdge = { id: string; from: string; to: string; kind: 'backing' | 'outreach' | 'reply' }

const ev = (n: string) => `event:${n.toLowerCase().trim()}`

export async function buildGraph(touches: Touch[]): Promise<{ nodes: GNode[]; edges: GEdge[] }> {
  const map = await loadMap()
  const byId = new Map(map.sponsors.map(s => [s.id, s]))
  const nodes = new Map<string, GNode>()
  const edges = new Map<string, GEdge>()
  const edge = (from: string, to: string, kind: GEdge['kind']) => {
    const id = `${kind}:${from}>${to}`
    if (!edges.has(id)) edges.set(id, { id, from, to, kind })
  }
  const sponsorNode = (t: Touch) => {
    const id = t.sponsor_id ?? `name:${(t.sponsor_name ?? 'unknown').toLowerCase()}`
    const s = t.sponsor_id ? byId.get(t.sponsor_id) : undefined
    if (!nodes.has(`s:${id}`)) nodes.set(`s:${id}`, { id: `s:${id}`, type: 'sponsor', label: s?.name ?? t.sponsor_name ?? id, domain: s?.domain })
    return `s:${id}`
  }
  for (const t of [...touches].reverse()) {
    const eid = ev(t.event_name)
    if (!nodes.has(eid)) nodes.set(eid, { id: eid, type: 'event', label: t.event_name })
    const sid = sponsorNode(t)
    if (t.kind === 'replied') {
      edge(eid, sid, 'outreach')
      if (t.to_email) {
        const pid = `p:${t.to_email.toLowerCase()}`
        nodes.set(pid, { id: pid, type: 'person', label: t.to_email })
        edge(pid, sid, 'reply')
      } else edge(sid, eid, 'reply')
    } else {
      edge(eid, sid, 'outreach')
      if (t.kind === 'sent' && t.to_email) {
        const pid = `p:${t.to_email.toLowerCase()}`
        if (!nodes.has(pid)) nodes.set(pid, { id: pid, type: 'person', label: t.to_email })
        edge(sid, pid, 'outreach')
      }
    }
  }
  // Past backings for sponsors we have touched: real events, real sources.
  const touched = new Set([...nodes.values()].filter(n => n.type === 'sponsor').map(n => n.id.slice(2)))
  for (const b of map.backings) {
    if (!touched.has(b.sponsorId)) continue
    const eid = ev(b.event)
    if (!nodes.has(eid)) nodes.set(eid, { id: eid, type: 'event', label: b.event, past: true })
    edge(eid, `s:${b.sponsorId}`, 'backing')
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] }
}

const nm = (t: Touch) => t.sponsor_name ?? t.sponsor_id ?? 'Unknown'

// Cheap answers from the log when Cognee is not connected.
export function answerFromLog(q: string, touches: Touch[]): string {
  if (!touches.length) return 'Nothing logged yet. Send a pitch or push leads to Notion and it shows up here.'
  const contacted = new Map<string, Touch[]>()
  for (const t of touches) contacted.set(nm(t), [...(contacted.get(nm(t)) ?? []), t])
  const replied = [...contacted].filter(([, ts]) => ts.some(t => t.kind === 'replied')).map(([n]) => n)
  const sent = [...contacted].filter(([, ts]) => ts.some(t => t.kind === 'sent')).map(([n]) => n)
  const lq = q.toLowerCase()
  if (/(not|n't|no).*repl|silent|waiting|ghost|follow/.test(lq) || /hasn.?t replied/.test(lq)) {
    const quiet = sent.filter(n => !replied.includes(n))
    return quiet.length ? `Emailed but no reply yet: ${quiet.join(', ')}.` : 'Everyone you emailed has replied.'
  }
  if (/repl/.test(lq)) return replied.length ? `Replied: ${replied.join(', ')}.` : 'Nobody has replied yet.'
  if (/sign|won|yes|committed/.test(lq)) {
    const s = [...contacted].filter(([, ts]) => ts.some(t => t.kind === 'signed')).map(([n]) => n)
    return s.length ? `Signed: ${s.join(', ')}.` : 'Nobody has signed yet.'
  }
  const hit = [...contacted].find(([n]) => lq.includes(n.toLowerCase()))
  if (hit) return `${hit[0]}: ` + hit[1].map(t => `${t.kind}${t.note ? ` (${t.note.slice(0, 80)})` : ''}`).reverse().join(', then ') + '.'
  return `${contacted.size} leads touched, ${sent.length} emailed, ${replied.length} replied.`
}
