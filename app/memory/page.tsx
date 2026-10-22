'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mark } from '@/components/Mark'
import { ago, VERB } from '@/components/Touches'
import type { GEdge, GNode } from '@/lib/memory-graph'
import type { Touch } from '@/lib/memory'

type Data = { touches: Touch[]; nodes: GNode[]; edges: GEdge[]; cognee: boolean }
type Sim = { x: number; y: number; vx: number; vy: number }
type Packet = { edge: string; t0: number; reverse: boolean; green: boolean }

const R = { event: 22, pastEvent: 9, sponsor: 17, person: 5 }
const radius = (n: GNode) => (n.type === 'event' ? (n.past ? R.pastEvent : R.event) : n.type === 'sponsor' ? R.sponsor : R.person)
const LEN = { backing: 110, outreach: 150, reply: 100 }
const PACKET_MS = 1300

export default function MemoryPage() {
  const [data, setData] = useState<Data>({ touches: [], nodes: [], edges: [], cognee: false })
  const [loaded, setLoaded] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const [, frame] = useState(0)
  const wrap = useRef<HTMLDivElement>(null)
  const sim = useRef(new Map<string, Sim>())
  const alpha = useRef(1)
  const seen = useRef<Set<string> | null>(null)
  const packets = useRef<Packet[]>([])
  const dataRef = useRef(data)
  const sizeRef = useRef(size)
  dataRef.current = data
  sizeRef.current = size

  const load = useCallback(() => {
    fetch('/api/memory', { cache: 'no-store' })
      .then(r => r.json())
      .then((d: Data) => {
        // New touches send a packet along their edge (not on the first load).
        const ids = new Set(d.touches.map(t => t.id ?? ''))
        if (seen.current) {
          for (const t of d.touches) {
            if (seen.current.has(t.id ?? '')) continue
            const sid = t.sponsor_id ? `s:${t.sponsor_id}` : `s:name:${(t.sponsor_name ?? 'unknown').toLowerCase()}`
            const eid = `event:${t.event_name.toLowerCase().trim()}`
            const replied = t.kind === 'replied'
            const pid = t.to_email ? `p:${t.to_email.toLowerCase()}` : ''
            const cand = replied
              ? [pid && `reply:${pid}>${sid}`, `reply:${sid}>${eid}`]
              : [t.kind === 'sent' && pid ? `outreach:${sid}>${pid}` : '', `outreach:${eid}>${sid}`]
            const edge = cand.find(c => c && d.edges.some(e => e.id === c))
            if (edge) packets.current.push({ edge, t0: performance.now(), reverse: false, green: replied })
          }
        }
        seen.current = ids
        alpha.current = Math.max(alpha.current, 0.6)
        setData(d)
        setLoaded(true)
      })
      .catch(() => setLoaded(true))
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load])

  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [])

  // Our own small force simulation: repulsion, springs along edges, gentle pull to the centre.
  useEffect(() => {
    let raf = 0
    const step = () => {
      const { nodes, edges } = dataRef.current
      const { w, h } = sizeRef.current
      const m = sim.current
      for (const n of nodes) {
        if (!m.has(n.id)) {
          const a = Math.random() * Math.PI * 2
          m.set(n.id, { x: w / 2 + Math.cos(a) * 20, y: h / 2 + Math.sin(a) * 20, vx: 0, vy: 0 })
        }
      }
      const live = packets.current.length > 0
      if (alpha.current > 0.015 || live) {
        const a = 0.6 + alpha.current * 0.4
        const arr = nodes.map(n => ({ n, s: m.get(n.id)! }))
        for (let i = 0; i < arr.length; i++) {
          for (let j = i + 1; j < arr.length; j++) {
            const A = arr[i].s
            const B = arr[j].s
            let dx = A.x - B.x
            let dy = A.y - B.y
            const d2 = Math.max(dx * dx + dy * dy, 25)
            const d = Math.sqrt(d2)
            const k = ((radius(arr[i].n) + radius(arr[j].n)) * 18 + 900) / d2
            dx = (dx / d) * k * 10
            dy = (dy / d) * k * 10
            A.vx += dx * a
            A.vy += dy * a
            B.vx -= dx * a
            B.vy -= dy * a
          }
        }
        for (const e of edges) {
          const A = m.get(e.from)
          const B = m.get(e.to)
          if (!A || !B) continue
          const dx = B.x - A.x
          const dy = B.y - A.y
          const d = Math.max(Math.hypot(dx, dy), 1)
          const f = ((d - LEN[e.kind]) / d) * 0.04
          A.vx += dx * f
          A.vy += dy * f
          B.vx -= dx * f
          B.vy -= dy * f
        }
        for (const { n, s } of arr) {
          s.vx += (w / 2 - s.x) * 0.012 * (n.type === 'event' && !n.past ? 1.6 : 1)
          s.vy += (h / 2 - s.y) * 0.012 * (n.type === 'event' && !n.past ? 1.6 : 1)
          s.vx *= 0.82
          s.vy *= 0.82
          const pad = radius(n) + 14
          s.x = Math.min(w - pad, Math.max(pad, s.x + s.vx))
          s.y = Math.min(h - pad, Math.max(pad, s.y + s.vy))
        }
        alpha.current *= 0.992
      }
      const now = performance.now()
      packets.current = packets.current.filter(p => now - p.t0 < PACKET_MS)
      frame(f => (f + 1) % 1e9)
      raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [])

  const { nodes, edges } = data
  const pos = (id: string) => sim.current.get(id)
  const near = new Set<string>()
  if (hover) {
    near.add(hover)
    for (const e of edges) {
      if (e.from === hover) near.add(e.to)
      if (e.to === hover) near.add(e.from)
    }
  }
  const dim = (id: string) => (hover && !near.has(id) ? 0.18 : 1)
  const now = performance.now()
  const empty = loaded && !data.touches.length

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', minHeight: 0 }}>
        <div ref={wrap} style={{ position: 'relative', height: '100vh', borderRight: '1px solid var(--divider)' }}>
          <div style={{ position: 'absolute', left: 24, top: 20, zIndex: 1, pointerEvents: 'none' }}>
            <h1 style={{ fontSize: 28, letterSpacing: '-0.025em', margin: 0, fontWeight: 600 }}>Memory</h1>
            <p style={{ margin: '6px 0 0', color: 'var(--ink2)', fontSize: 14.5, maxWidth: 520 }}>
              Every email and reply, remembered. {nodes.filter(n => n.type === 'sponsor').length} sponsors, {data.touches.length} touches.
            </p>
            <div style={{ display: 'flex', gap: 14, marginTop: 10, color: 'var(--ink3)', fontSize: 12.5 }}>
              <Key color="var(--border-strong)" w={1} label="backed before" />
              <Key color="var(--ink)" w={1.5} label="outreach" />
              <Key color="var(--go)" w={3} label="reply" />
            </div>
          </div>
          {empty && (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--ink3)', textAlign: 'center', padding: 24 }}>
              <div>
                <div style={{ color: 'var(--ink2)', fontSize: 16, marginBottom: 6 }}>Nothing remembered yet.</div>
                <div style={{ fontSize: 14 }}>
                  Send a pitch or push leads to Notion from the <a href="/">ranking</a> and they land here.
                </div>
              </div>
            </div>
          )}
          <svg width={size.w} height={size.h} style={{ display: 'block' }}>
            {edges.map(e => {
              const A = pos(e.from)
              const B = pos(e.to)
              if (!A || !B) return null
              const on = !hover || (near.has(e.from) && near.has(e.to))
              return (
                <line
                  key={e.id}
                  x1={A.x}
                  y1={A.y}
                  x2={B.x}
                  y2={B.y}
                  stroke={e.kind === 'reply' ? 'var(--go)' : e.kind === 'outreach' ? 'var(--ink)' : 'var(--border-strong)'}
                  strokeWidth={e.kind === 'reply' ? 3 : e.kind === 'outreach' ? 1.4 : 1}
                  opacity={on ? 1 : 0.1}
                />
              )
            })}
            {packets.current.map((p, i) => {
              const e = edges.find(x => x.id === p.edge)
              const A = e && pos(e.from)
              const B = e && pos(e.to)
              if (!A || !B) return null
              const t = Math.min(1, (now - p.t0) / PACKET_MS)
              const k = 1 - Math.pow(1 - t, 3)
              return <rect key={i} x={A.x + (B.x - A.x) * k - 4} y={A.y + (B.y - A.y) * k - 4} width={8} height={8} rx={2} fill={p.green ? 'var(--go)' : 'var(--ink)'} />
            })}
            {nodes.map(n => {
              const s = pos(n.id)
              if (!s) return null
              const r = radius(n)
              return (
                <g key={n.id} transform={`translate(${s.x},${s.y})`} opacity={dim(n.id)} onMouseEnter={() => setHover(n.id)} onMouseLeave={() => setHover(null)} style={{ cursor: 'default', transition: 'opacity .2s' }}>
                  {n.type === 'event' && <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={5} fill={n.past ? 'var(--chip)' : 'var(--ink)'} stroke={n.past ? 'var(--border-strong)' : 'none'} />}
                  {n.type === 'person' && <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={1.5} fill="var(--ink2)" />}
                  {n.type === 'sponsor' && (
                    <foreignObject x={-r} y={-r} width={r * 2} height={r * 2}>
                      <Mark domain={n.domain ?? 'example.com'} size={r * 2} />
                    </foreignObject>
                  )}
                  {(n.type !== 'person' || hover === n.id) && (
                    <text y={r + 14} textAnchor="middle" fontSize={n.type === 'event' && !n.past ? 13 : 11.5} fill={n.past ? 'var(--ink3)' : 'var(--ink)'} fontWeight={n.type === 'event' && !n.past ? 600 : 450} style={{ pointerEvents: 'none', paintOrder: 'stroke', stroke: 'var(--canvas)', strokeWidth: 4 }}>
                      {n.label.length > 26 ? n.label.slice(0, 25) + '…' : n.label}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        </div>

        <aside style={{ height: '100vh', overflow: 'auto', background: 'var(--bg)', display: 'flex', flexDirection: 'column' }}>
          <Ask cognee={data.cognee} />
          <Timeline touches={data.touches} />
        </aside>
      </div>
    </div>
  )
}

function Key({ color, w, label }: { color: string; w: number; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 18, height: w, background: color, display: 'inline-block' }} />
      {label}
    </span>
  )
}

function Ask({ cognee }: { cognee: boolean }) {
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<{ answer: string; source: 'cognee' | 'log' } | null>(null)
  async function ask(text: string) {
    if (!text.trim() || busy) return
    setBusy(true)
    try {
      const r = await fetch('/api/memory/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: text }) })
      setRes(await r.json())
    } catch {
      setRes({ answer: 'Could not reach memory just now.', source: 'log' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <section style={{ padding: 20, borderBottom: '1px solid var(--divider)' }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 10px' }}>Ask memory</h2>
      <form
        onSubmit={e => {
          e.preventDefault()
          ask(q)
        }}
        style={{ display: 'flex', gap: 6, alignItems: 'center', background: 'var(--subtle)', borderRadius: 9, padding: 4, boxShadow: 'inset 0 1px 2px rgba(0,0,0,.05), inset 0 0 0 1px var(--divider)' }}
      >
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Who hasn't replied?" style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', fontSize: 14, padding: '7px 8px' }} />
        <button className={`btn btn-primary${busy ? ' pushing' : ''}`} type="submit" disabled={busy || !q.trim()} style={{ height: 32, padding: '0 12px', fontSize: 13.5, opacity: q.trim() ? 1 : 0.4 }}>
          {busy ? 'Asking…' : 'Ask'}
        </button>
      </form>
      {res && (
        <div className="rise" style={{ marginTop: 12 }}>
          <div style={{ fontSize: 14.5, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{res.answer}</div>
          <div style={{ marginTop: 6, fontSize: 12.5, color: res.source === 'cognee' ? 'var(--go)' : 'var(--ink3)' }}>{res.source === 'cognee' ? 'via Cognee' : 'from your log'}</div>
        </div>
      )}
      {!cognee && (
        <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--ink3)' }}>
          Connect Cognee to answer from the knowledge graph. <span style={{ color: 'var(--ink2)' }}>Set COGNEE_API_KEY.</span>
        </div>
      )}
    </section>
  )
}

function Timeline({ touches }: { touches: Touch[] }) {
  const cutoff = Date.now() - 24 * 3600 * 1000
  const rows = touches.filter(t => new Date(t.created_at ?? 0).getTime() > cutoff)
  return (
    <section style={{ padding: '16px 20px 40px' }}>
      <h2 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 6px' }}>Last 24 hours</h2>
      {!rows.length && <div style={{ color: 'var(--ink3)', fontSize: 13.5, paddingTop: 6 }}>Quiet so far.</div>}
      {rows.map((t, i) => (
        <div key={t.id ?? i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '9px 0', borderTop: '1px solid var(--divider)', fontSize: 14 }}>
          <span style={{ width: 7, height: 7, borderRadius: 2, flex: 'none', background: t.kind === 'replied' || t.kind === 'signed' ? 'var(--go)' : 'var(--ink)', transform: 'translateY(-1px)' }} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ fontWeight: 550 }}>{t.sponsor_name ?? t.sponsor_id}</span> <span style={{ color: 'var(--ink2)' }}>{(VERB[t.kind] ?? t.kind).toLowerCase()}</span>
            {t.note && <span style={{ display: 'block', color: 'var(--ink3)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{t.note}</span>}
          </span>
          <span style={{ color: 'var(--ink3)', fontSize: 12.5, flex: 'none' }}>{ago(t.created_at)}</span>
        </div>
      ))}
    </section>
  )
}
