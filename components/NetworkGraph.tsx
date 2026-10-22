'use client'

// The company network. A small velocity-Verlet force simulation (repulsion,
// link springs, centering, collision) drawn in SVG with no libraries. React
// renders the elements once; the animation loop writes positions straight to
// the DOM so 500 nodes stay at 60fps.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Mark } from '@/components/Mark'

export type NetEvent = { id: string; name: string; url?: string; date?: string | null; organiser?: string; count: number }
export type NetCompany = { id: string; name: string; domain: string; kind: 'sponsor' | 'venue' }
export type NetLink = { c: string; e: string; role: string; url: string }
export type NetData = { events: NetEvent[]; companies: NetCompany[]; links: NetLink[]; source: 'supabase' | 'seed' }

type Props = NetData & { top?: number; cap?: number }
type Node = { id: string; ref: string; type: 'event' | 'company'; r: number; size: number; charge: number; color: string; x: number; y: number; vx: number; vy: number; fx?: number; fy?: number; deg: number; lw?: number }
type Edge = { id: string; s: string; t: string; color: string; heavy: boolean }
type Cam = { x: number; y: number; k: number }

const PALETTE = ['var(--reach)', 'var(--iggy)', 'var(--go)', 'var(--teal)', 'var(--gate)', 'var(--ink2)']
const TICKS = 300
const DECAY = 1 - Math.pow(0.001, 1 / TICKS)
const MIN_ALPHA = 0.002
const CARD_W = 344

function hash(s: string) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return (h >>> 0) / 4294967296
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v))
const ease = (t: number) => 1 - Math.pow(1 - t, 3)
const LABELS = 12
const short = (s: string | undefined, n = 28) => (!s ? '' : s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)
const logo = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`

function tick(ns: Node[], es: Edge[], byId: Map<string, Node>, a: number) {
  const n = ns.length
  // Repulsion and collision, every pair (fine up to ~600 nodes).
  for (let i = 0; i < n; i++) {
    const p = ns[i]
    for (let j = i + 1; j < n; j++) {
      const q = ns[j]
      let dx = q.x - p.x
      let dy = q.y - p.y
      let d2 = dx * dx + dy * dy
      if (d2 === 0) {
        dx = (hash(p.id + q.id) - 0.5) * 0.01
        dy = (hash(q.id + p.id) - 0.5) * 0.01
        d2 = dx * dx + dy * dy
      }
      if (d2 < 250000) {
        const inv = a / Math.max(d2, 36)
        p.vx += dx * q.charge * inv
        p.vy += dy * q.charge * inv
        q.vx -= dx * p.charge * inv
        q.vy -= dy * p.charge * inv
      }
      const min = p.r + q.r + 5
      if (d2 < min * min) {
        const d = Math.sqrt(d2)
        const k = ((min - d) / d) * 0.35
        const wp = q.r * q.r / (p.r * p.r + q.r * q.r)
        p.vx -= dx * k * wp
        p.vy -= dy * k * wp
        q.vx += dx * k * (1 - wp)
        q.vy += dy * k * (1 - wp)
      }
    }
  }
  // Link springs.
  for (const e of es) {
    const s = byId.get(e.s)
    const t = byId.get(e.t)
    if (!s || !t) continue
    let dx = t.x + t.vx - s.x - s.vx
    let dy = t.y + t.vy - s.y - s.vy
    const l = Math.sqrt(dx * dx + dy * dy) || 1
    const dist = (e.heavy ? 120 : 40) + s.r + t.r
    const str = (e.heavy ? 0.25 : 1) / Math.min(s.deg, t.deg)
    const f = ((l - dist) / l) * a * str
    dx *= f
    dy *= f
    const b = s.deg / (s.deg + t.deg)
    t.vx -= dx * b
    t.vy -= dy * b
    s.vx += dx * (1 - b)
    s.vy += dy * (1 - b)
  }
  // Centering (a little wider than tall) and integration.
  for (const p of ns) {
    p.vx -= p.x * 0.022 * a
    p.vy -= p.y * 0.036 * a
    if (p.fx != null && p.fy != null) {
      p.x = p.fx
      p.y = p.fy
      p.vx = 0
      p.vy = 0
      continue
    }
    p.vx *= 0.6
    p.vy *= 0.6
    p.x += p.vx
    p.y += p.vy
  }
}

function fit(ns: Node[], w: number, h: number, right: number): Cam {
  if (!ns.length) return { x: w / 2, y: h / 2, k: 1 }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity
  for (const n of ns) {
    const half = n.type === 'event' ? Math.max(n.size, (n.lw ?? 0) / 2) : n.size
    x0 = Math.min(x0, n.x - half)
    y0 = Math.min(y0, n.y - n.size)
    x1 = Math.max(x1, n.x + (n.type === 'company' ? n.size + (n.lw ?? 0) : half))
    y1 = Math.max(y1, n.y + n.size + (n.type === 'event' && n.lw ? 24 : 4))
  }
  // Leave room for the search bar on top and the caption at the bottom left.
  const aw = Math.max(200, w - right)
  const top = 76
  const bottom = 132
  const ah = Math.max(200, h - top - bottom)
  const k = clamp(Math.min((aw - 96) / (x1 - x0), ah / (y1 - y0)), 0.2, 1.6)
  return { k, x: aw / 2 - ((x0 + x1) / 2) * k, y: top + ah / 2 - ((y0 + y1) / 2) * k }
}

export default function NetworkGraph({ events, companies, links, source, top = 60, cap = 40 }: Props) {
  // ---------- data ----------
  const index = useMemo(() => {
    const byC = new Map<string, NetLink[]>()
    const byE = new Map<string, NetLink[]>()
    for (const l of links) {
      byC.set(l.c, [...(byC.get(l.c) ?? []), l])
      byE.set(l.e, [...(byE.get(l.e) ?? []), l])
    }
    const ev = new Map(events.map(e => [e.id, { ...e, count: byE.get(e.id)?.length ?? e.count }]))
    const co = new Map(companies.map(c => [c.id, c]))
    const order = [...ev.values()].sort((a, b) => b.count - a.count)
    const color = new Map(order.map((e, i) => [e.id, PALETTE[i % PALETTE.length]]))
    const heavy = new Set(order.filter(e => e.count > cap).map(e => e.id))
    const score = (cid: string) => (byC.get(cid) ?? []).reduce((s, l) => s + (heavy.has(l.e) ? 0.25 : 1), 0)
    const ranked = companies
      .filter(c => byC.has(c.id))
      .map(c => ({ id: c.id, s: score(c.id) }))
      .sort((a, b) => b.s - a.s || a.id.localeCompare(b.id))
      .map(x => x.id)
    return { byC, byE, ev, co, color, heavy, ranked }
  }, [events, companies, links, cap])

  const [mode, setMode] = useState<'top' | 'all'>('top')
  const [extra, setExtra] = useState<Set<string>>(() => new Set())
  const [hover, setHover] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const [active, setActive] = useState(0)

  const view = useMemo(() => {
    const cs = new Set(mode === 'all' ? index.ranked : index.ranked.slice(0, top))
    for (const id of extra) if (index.byC.has(id)) cs.add(id)
    const es = new Set<string>()
    const vl: NetLink[] = []
    for (const cid of cs) for (const l of index.byC.get(cid) ?? []) {
      es.add(l.e)
      vl.push(l)
    }
    return { cs, es, vl }
  }, [mode, extra, index, top])

  const sim = useRef(new Map<string, Node>())
  const { nodes, edges, byId, labelled } = useMemo(() => {
    const deg = new Map<string, number>()
    for (const l of view.vl) {
      deg.set('c:' + l.c, (deg.get('c:' + l.c) ?? 0) + 1)
      deg.set('e:' + l.e, (deg.get('e:' + l.e) ?? 0) + 1)
    }
    const out: Node[] = []
    const evIds = [...view.es].sort((a, b) => (index.ev.get(b)?.count ?? 0) - (index.ev.get(a)?.count ?? 0))
    evIds.forEach((eid, i) => {
      const id = 'e:' + eid
      const count = index.ev.get(eid)?.count ?? 1
      const size = 16 + Math.min(26, Math.sqrt(count) * 4)
      const prev = sim.current.get(id)
      const ang = i * 2.39996
      const rad = 40 + 90 * Math.sqrt(i)
      const n: Node = {
        id, ref: eid, type: 'event', size: size / 2, r: size * 0.72, charge: -(120 + size * 6),
        color: index.color.get(eid) ?? 'var(--ink)', deg: deg.get(id) ?? 1,
        x: prev?.x ?? Math.cos(ang) * rad, y: prev?.y ?? Math.sin(ang) * rad, vx: prev?.vx ?? 0, vy: prev?.vy ?? 0,
      }
      sim.current.set(id, n)
      out.push(n)
    })
    for (const cid of view.cs) {
      const id = 'c:' + cid
      const d = deg.get(id) ?? 1
      const r = 9 + Math.min(9, (d - 1) * 3.5)
      const first = index.byC.get(cid)?.[0]
      const home = first ? sim.current.get('e:' + first.e) : undefined
      const prev = sim.current.get(id)
      const ang = hash(cid) * Math.PI * 2
      const dist = 24 + hash(cid + 'r') * 30
      const n: Node = {
        id, ref: cid, type: 'company', size: r, r, charge: -(34 + r * 3),
        color: d >= 2 ? 'var(--ink)' : (first ? index.color.get(first.e) : undefined) ?? 'var(--ink3)', deg: d,
        x: prev?.x ?? (home?.x ?? 0) + Math.cos(ang) * dist, y: prev?.y ?? (home?.y ?? 0) + Math.sin(ang) * dist,
        vx: prev?.vx ?? 0, vy: prev?.vy ?? 0,
      }
      sim.current.set(id, n)
      out.push(n)
    }
    const es: Edge[] = view.vl.map(l => ({
      id: `${l.c}>${l.e}`, s: 'c:' + l.c, t: 'e:' + l.e, color: index.color.get(l.e) ?? 'var(--ink3)', heavy: index.heavy.has(l.e),
    }))
    // Only the largest nodes carry a permanent label; the rest appear on hover/selection.
    const big = [...out].sort((a, b) => b.size - a.size || b.deg - a.deg).slice(0, LABELS)
    const labelled = new Set(big.map(n => n.id))
    for (const n of out) {
      const name = n.type === 'event' ? short(index.ev.get(n.ref)?.name) : index.co.get(n.ref)?.name ?? ''
      n.lw = labelled.has(n.id) ? name.length * (n.type === 'event' ? 7 : 6.2) + 8 : 0
    }
    return { nodes: out, edges: es, byId: new Map(out.map(n => [n.id, n])), labelled }
  }, [view, index])

  // ---------- simulation + camera loop ----------
  const wrap = useRef<HTMLDivElement>(null)
  const svg = useRef<SVGSVGElement>(null)
  const vp = useRef<SVGGElement>(null)
  const nodeEls = useRef(new Map<string, SVGGElement>())
  const edgeEls = useRef(new Map<string, SVGLineElement>())
  const cam = useRef<Cam>({ x: 0, y: 0, k: 1 })
  const camAnim = useRef<{ from: Cam; to: Cam; t0: number; dur: number } | null>(null)
  const alpha = useRef(1)
  const alphaTarget = useRef(0)
  const autoFit = useRef(true)
  const size = useRef({ w: 900, h: 600 })
  const raf = useRef(0)
  const reduce = useRef(false)
  const live = useRef({ nodes, edges, byId, card: false })
  live.current = { nodes, edges, byId, card: selected != null }

  const draw = useCallback(() => {
    const c = cam.current
    vp.current?.setAttribute('transform', `translate(${c.x.toFixed(2)},${c.y.toFixed(2)}) scale(${c.k.toFixed(4)})`)
    svg.current?.setAttribute('data-zoom', c.k > 2.4 ? 'near' : 'far')
    const { nodes: ns, edges: es, byId: m } = live.current
    for (const n of ns) nodeEls.current.get(n.id)?.setAttribute('transform', `translate(${n.x.toFixed(1)},${n.y.toFixed(1)})`)
    for (const e of es) {
      const el = edgeEls.current.get(e.id)
      const s = m.get(e.s)
      const t = m.get(e.t)
      if (!el || !s || !t) continue
      el.setAttribute('x1', s.x.toFixed(1))
      el.setAttribute('y1', s.y.toFixed(1))
      el.setAttribute('x2', t.x.toFixed(1))
      el.setAttribute('y2', t.y.toFixed(1))
    }
  }, [])

  const fitRight = () => (live.current.card && size.current.w > 760 ? CARD_W + 24 : 0)

  const frame = useRef<() => void>(() => {})
  frame.current = () => {
    raf.current = 0
    const { nodes: ns, edges: es, byId: m } = live.current
    let busy = false
    if (alpha.current > MIN_ALPHA || alphaTarget.current > 0) {
      tick(ns, es, m, alpha.current)
      alpha.current += (alphaTarget.current - alpha.current) * DECAY
      busy = true
    }
    const anim = camAnim.current
    if (anim) {
      const t = clamp((performance.now() - anim.t0) / anim.dur, 0, 1)
      const e = ease(t)
      cam.current = {
        x: anim.from.x + (anim.to.x - anim.from.x) * e,
        y: anim.from.y + (anim.to.y - anim.from.y) * e,
        k: anim.from.k + (anim.to.k - anim.from.k) * e,
      }
      if (t >= 1) camAnim.current = null
      busy = true
    } else if (autoFit.current && busy) {
      const f = fit(ns, size.current.w, size.current.h, fitRight())
      const c = cam.current
      const s = 0.06
      cam.current = { x: c.x + (f.x - c.x) * s, y: c.y + (f.y - c.y) * s, k: c.k + (f.k - c.k) * s }
    }
    draw()
    if (busy) raf.current = requestAnimationFrame(() => frame.current())
  }
  const kick = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(() => frame.current())
  }, [])

  const animateCam = useCallback((to: Cam, dur = 650) => {
    autoFit.current = false
    if (reduce.current) {
      cam.current = to
      draw()
      return
    }
    camAnim.current = { from: { ...cam.current }, to, t0: performance.now(), dur }
    kick()
  }, [draw, kick])

  // Size, wheel zoom, reduced motion.
  useEffect(() => {
    reduce.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const first = size.current.w === 900 && cam.current.x === 0
      size.current = { w: r.width, h: r.height }
      if (first) cam.current = fit(live.current.nodes, r.width, r.height, 0)
      draw()
    })
    ro.observe(el)
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const r = el.getBoundingClientRect()
      const mx = e.clientX - r.left
      const my = e.clientY - r.top
      const c = cam.current
      const k = clamp(c.k * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0018)), 0.15, 5)
      cam.current = { k, x: mx - (mx - c.x) * (k / c.k), y: my - (my - c.y) * (k / c.k) }
      autoFit.current = false
      camAnim.current = null
      draw()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      ro.disconnect()
      el.removeEventListener('wheel', onWheel)
      cancelAnimationFrame(raf.current)
      raf.current = 0
    }
  }, [draw])

  // Reheat whenever the visible graph changes.
  useEffect(() => {
    alpha.current = Math.max(alpha.current, 0.7)
    if (reduce.current) {
      const { nodes: ns, edges: es, byId: m } = live.current
      while (alpha.current > MIN_ALPHA) {
        tick(ns, es, m, alpha.current)
        alpha.current += (0 - alpha.current) * DECAY
      }
      if (autoFit.current) cam.current = fit(ns, size.current.w, size.current.h, fitRight())
      draw()
      return
    }
    kick()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, kick, draw])

  // New elements mount at the origin; place them before paint.
  useLayoutEffect(() => draw())

  // ---------- focus ----------
  const pending = useRef<string | null>(null)
  const focus = useCallback((id: string) => {
    if (id.startsWith('c:') && !view.cs.has(id.slice(2))) setExtra(prev => new Set(prev).add(id.slice(2)))
    setSelected(id)
    pending.current = id
    setTimeout(() => {
      const n = live.current.byId.get(pending.current ?? '')
      if (!n) return
      const k = clamp(Math.max(cam.current.k, 1.5), 0.2, 2.2)
      const aw = size.current.w - (size.current.w > 760 ? CARD_W + 24 : 0)
      animateCam({ k, x: aw / 2 - n.x * k, y: size.current.h / 2 - n.y * k })
    }, 60)
  }, [view, animateCam])

  const zoomBy = (f: number) => {
    const c = cam.current
    const mx = size.current.w / 2
    const my = size.current.h / 2
    const k = clamp(c.k * f, 0.15, 5)
    animateCam({ k, x: mx - (mx - c.x) * (k / c.k), y: my - (my - c.y) * (k / c.k) }, 320)
  }
  const refit = () => animateCam(fit(live.current.nodes, size.current.w, size.current.h, fitRight()), 600)

  const switchMode = (m: 'top' | 'all') => {
    if (m === mode) return
    setMode(m)
    setExtra(new Set())
    autoFit.current = true
    alpha.current = 1
  }

  const expand = (ids: string[]) => {
    setExtra(prev => {
      const next = new Set(prev)
      for (const id of ids) next.add(id)
      return next
    })
    autoFit.current = true
  }

  // ---------- pointer: drag nodes, pan, click ----------
  const drag = useRef<{ id: string | null; sx: number; sy: number; cx: number; cy: number; moved: boolean } | null>(null)
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return
    const t = (e.target as Element).closest('[data-id]')
    drag.current = { id: t?.getAttribute('data-id') ?? null, sx: e.clientX, sy: e.clientY, cx: cam.current.x, cy: cam.current.y, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (!d.moved && Math.hypot(dx, dy) < 4) return
    if (!d.moved) {
      d.moved = true
      autoFit.current = false
      camAnim.current = null
      wrap.current?.setAttribute('data-drag', d.id ? 'node' : 'pan')
    }
    if (d.id) {
      const n = live.current.byId.get(d.id)
      const r = wrap.current?.getBoundingClientRect()
      if (!n || !r) return
      const c = cam.current
      n.fx = (e.clientX - r.left - c.x) / c.k
      n.fy = (e.clientY - r.top - c.y) / c.k
      alphaTarget.current = 0.25
      alpha.current = Math.max(alpha.current, 0.25)
      kick()
    } else {
      cam.current = { ...cam.current, x: d.cx + dx, y: d.cy + dy }
      draw()
    }
  }
  const onUp = () => {
    const d = drag.current
    drag.current = null
    wrap.current?.removeAttribute('data-drag')
    if (!d) return
    if (d.id) {
      const n = live.current.byId.get(d.id)
      if (n) {
        n.fx = undefined
        n.fy = undefined
      }
      alphaTarget.current = 0
    }
    if (!d.moved) setSelected(d.id)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.tagName === 'INPUT'
      if (e.key === '/' && !typing) {
        e.preventDefault()
        document.getElementById('nn-search')?.focus()
      }
      if (e.key === 'Escape' && !typing) setSelected(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ---------- highlight ----------
  const focusId = hover ?? selected
  const level = useMemo(() => {
    if (!focusId) return null
    const m = new Map<string, number>([[focusId, 0]])
    const nb = (id: string) => edges.filter(e => e.s === id || e.t === id).map(e => (e.s === id ? e.t : e.s))
    for (const a of nb(focusId)) m.set(a, 1)
    if (focusId.startsWith('c:')) {
      for (const [a, l] of [...m]) {
        if (l !== 1 || index.heavy.has(a.slice(2))) continue
        for (const b of nb(a)) if (!m.has(b)) m.set(b, 2)
      }
    }
    return m
  }, [focusId, edges, index])

  const nodeOpacity = (id: string) => {
    if (!level) return 1
    const l = level.get(id)
    return l == null ? 0.1 : l === 2 ? 0.5 : 1
  }
  const edgeStyle = (e: Edge) => {
    if (!level) return { opacity: e.heavy ? 0.07 : 0.16, width: 0.75 }
    const ls = level.get(e.s)
    const lt = level.get(e.t)
    if (e.s === focusId || e.t === focusId) return { opacity: 0.9, width: 1.5 }
    if (ls != null && lt != null) return { opacity: 0.22, width: 0.75 }
    return { opacity: 0.025, width: 0.75 }
  }

  // ---------- search ----------
  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    const out: { id: string; label: string; sub: string; domain?: string; color?: string }[] = []
    for (const e of index.ev.values()) if (e.name.toLowerCase().includes(q)) out.push({ id: 'e:' + e.id, label: e.name, sub: `${e.count} backers`, color: index.color.get(e.id) })
    for (const c of companies) {
      if (out.length > 40) break
      if (!index.byC.has(c.id)) continue
      if (c.name.toLowerCase().includes(q) || c.domain.toLowerCase().includes(q)) {
        const n = index.byC.get(c.id)?.length ?? 0
        out.push({ id: 'c:' + c.id, label: c.name, sub: `${n} event${n === 1 ? '' : 's'}`, domain: c.domain })
      }
    }
    return out
      .sort((a, b) => Number(!a.label.toLowerCase().startsWith(q)) - Number(!b.label.toLowerCase().startsWith(q)))
      .slice(0, 7)
  }, [query, index, companies])

  const pick = (id: string) => {
    focus(id)
    setQuery('')
    setSearchOpen(false)
    ;(document.activeElement as HTMLElement | null)?.blur()
  }

  // ---------- card ----------
  const card = useMemo(() => {
    if (!selected) return null
    const ref = selected.slice(2)
    if (selected.startsWith('c:')) {
      const c = index.co.get(ref)
      if (!c) return null
      const backed = (index.byC.get(ref) ?? []).map(l => ({ link: l, ev: index.ev.get(l.e) }))
      const co = new Map<string, { shared: string[]; w: number }>()
      for (const l of index.byC.get(ref) ?? []) {
        const at = index.byE.get(l.e) ?? []
        const w = 1 / Math.log2(1 + at.length)
        for (const o of at) {
          if (o.c === ref) continue
          const cur = co.get(o.c) ?? { shared: [], w: 0 }
          cur.shared.push(l.e)
          cur.w += w
          co.set(o.c, cur)
        }
      }
      const ranked = [...co.entries()]
        .map(([id, v]) => ({ id, ...v, c: index.co.get(id) }))
        .filter(x => x.c)
        .sort((a, b) => b.shared.length - a.shared.length || b.w - a.w || a.id.localeCompare(b.id))
      return { kind: 'company' as const, c, backed, ranked }
    }
    const ev = index.ev.get(ref)
    if (!ev) return null
    const backers = (index.byE.get(ref) ?? [])
      .map(l => ({ link: l, c: index.co.get(l.c), n: index.byC.get(l.c)?.length ?? 0 }))
      .filter(x => x.c)
      .sort((a, b) => b.n - a.n || a.link.c.localeCompare(b.link.c))
    const hidden = backers.filter(b => !view.cs.has(b.link.c)).length
    return { kind: 'event' as const, ev, backers, hidden }
  }, [selected, index, view])

  const stats = { companies: view.cs.size, events: view.es.size, links: view.vl.length }
  const heavyEvents = [...index.heavy].map(id => index.ev.get(id)).filter((e): e is NetEvent => !!e)

  return (
    <div ref={wrap} className="nn-root" onPointerLeave={() => setHover(null)}>
      <style>{CSS}</style>

      <svg
        ref={svg}
        className="nn-svg"
        data-zoom="far"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <defs>
          <pattern id="nn-dots" width="22" height="22" patternUnits="userSpaceOnUse">
            <circle cx="1" cy="1" r="0.9" fill="var(--border-strong)" opacity="0.55" />
          </pattern>
          <clipPath id="nn-clip" clipPathUnits="objectBoundingBox">
            <circle cx="0.5" cy="0.5" r="0.5" />
          </clipPath>
        </defs>
        <g ref={vp}>
          <rect x={-6000} y={-6000} width={12000} height={12000} fill="url(#nn-dots)" />
          <g className="nn-edges">
            {edges.map(e => {
              const st = edgeStyle(e)
              return (
                <line
                  key={e.id}
                  ref={el => {
                    if (el) edgeEls.current.set(e.id, el)
                    else edgeEls.current.delete(e.id)
                  }}
                  className="nn-edge"
                  stroke={e.color}
                  style={{ opacity: st.opacity, strokeWidth: st.width }}
                />
              )
            })}
          </g>
          <g>
            {nodes.map((n, i) => {
              const lvl = level?.get(n.id)
              const show = lvl != null && lvl < 2
              const isSel = selected === n.id
              const delay = `${Math.min(i * 7, 900)}ms`
              if (n.type === 'event') {
                const ev = index.ev.get(n.ref)
                const s = n.size * 2
                return (
                  <g
                    key={n.id}
                    data-id={n.id}
                    ref={el => {
                      if (el) nodeEls.current.set(n.id, el)
                      else nodeEls.current.delete(n.id)
                    }}
                    className="nn-node"
                    style={{ opacity: nodeOpacity(n.id) }}
                    onPointerEnter={() => !drag.current && setHover(n.id)}
                    onPointerLeave={() => setHover(h => (h === n.id ? null : h))}
                  >
                    <g className="nn-pop" style={{ animationDelay: delay }}>
                      {isSel && <rect className="nn-ring" x={-s / 2 - 4} y={-s / 2 - 4} width={s + 8} height={s + 8} rx={7} stroke={n.color} />}
                      <rect x={-s / 2} y={-s / 2} width={s} height={s} rx={5} fill={n.color} className="nn-square" />
                      <text className={`nn-label nn-elabel${labelled.has(n.id) || show || isSel ? ' nn-show' : ''}`} y={s / 2 + 15} textAnchor="middle">{short(ev?.name)}</text>
                      <text className="nn-count mono" y={4} textAnchor="middle" style={{ fontSize: Math.max(9, s * 0.3) }}>{ev?.count}</text>
                    </g>
                  </g>
                )
              }
              const c = index.co.get(n.ref)
              const img = n.r * 1.25
              return (
                <g
                  key={n.id}
                  data-id={n.id}
                  ref={el => {
                    if (el) nodeEls.current.set(n.id, el)
                    else nodeEls.current.delete(n.id)
                  }}
                  className="nn-node"
                  style={{ opacity: nodeOpacity(n.id) }}
                  onPointerEnter={() => !drag.current && setHover(n.id)}
                  onPointerLeave={() => setHover(h => (h === n.id ? null : h))}
                >
                  <g className="nn-pop" style={{ animationDelay: delay }}>
                    {isSel && <circle className="nn-ring" r={n.r + 5} stroke={n.color} />}
                    <circle r={n.r} fill="var(--card)" stroke={n.color} strokeWidth={n.deg >= 2 ? 2 : 1.5} className="nn-circle" />
                    {c && <image href={logo(c.domain)} x={-img / 2} y={-img / 2} width={img} height={img} clipPath="url(#nn-clip)" style={{ pointerEvents: 'none' }} />}
                    <text
                      className={`nn-label nn-clabel${labelled.has(n.id) || show || isSel ? ' nn-show' : ''}`}
                      x={n.r + 5}
                      y={4}
                      style={n.deg >= 2 ? { fontWeight: 550, fill: 'var(--ink)' } : undefined}
                    >
                      {short(c?.name, 24)}
                    </text>
                  </g>
                </g>
              )
            })}
          </g>
        </g>
      </svg>

      {/* Search + view switch */}
      <div className="nn-top">
        <div className="nn-search" style={{ position: 'relative' }}>
          <svg width="15" height="15" viewBox="0 0 16 16" style={{ position: 'absolute', left: 11, top: 11, pointerEvents: 'none' }}>
            <circle cx="7" cy="7" r="4.6" fill="none" stroke="var(--ink3)" strokeWidth="1.5" />
            <path d="M10.5 10.5 L14 14" stroke="var(--ink3)" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            id="nn-search"
            value={query}
            placeholder="Find a company or event"
            autoComplete="off"
            onChange={e => {
              setQuery(e.target.value)
              setActive(0)
              setSearchOpen(true)
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => setTimeout(() => setSearchOpen(false), 120)}
            onKeyDown={e => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setActive(a => Math.min(a + 1, results.length - 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setActive(a => Math.max(a - 1, 0))
              } else if (e.key === 'Enter' && results[active]) pick(results[active].id)
              else if (e.key === 'Escape') {
                setQuery('')
                ;(e.target as HTMLInputElement).blur()
              }
            }}
            style={{
              width: '100%', height: 38, padding: '0 34px 0 34px', fontSize: 14, fontFamily: 'inherit', color: 'var(--ink)',
              background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, outline: 'none', boxShadow: 'var(--lift)',
            }}
          />
          <span className="mono" style={{ position: 'absolute', right: 10, top: 10, fontSize: 11, color: 'var(--ink3)', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px', background: 'var(--subtle)' }}>/</span>
          {searchOpen && results.length > 0 && (
            <div className="nn-results">
              {results.map((r, i) => (
                <button
                  key={r.id}
                  className="nn-result"
                  data-active={i === active}
                  onMouseEnter={() => setActive(i)}
                  onMouseDown={e => {
                    e.preventDefault()
                    pick(r.id)
                  }}
                  style={{ animationDelay: `${i * 25}ms` }}
                >
                  {r.domain ? <Mark domain={r.domain} size={20} /> : <span style={{ width: 14, height: 14, margin: 3, borderRadius: 4, background: r.color, flex: 'none' }} />}
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                  <span style={{ fontSize: 12, color: 'var(--ink3)' }}>{r.sub}</span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className="nn-seg" role="tablist">
          {(['top', 'all'] as const).map(m => (
            <button key={m} role="tab" aria-selected={mode === m} data-on={mode === m} onClick={() => switchMode(m)}>
              {m === 'top' ? `Top ${Math.min(top, index.ranked.length)}` : 'Everyone'}
            </button>
          ))}
        </div>
      </div>

      {/* Caption + legend */}
      <div className="nn-caption">
        <div style={{ fontSize: 13, color: 'var(--ink)', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'baseline' }}>
          <span><span className="mono">{stats.companies}</span> companies</span>
          <span><span className="mono">{stats.events}</span> events</span>
          <span><span className="mono">{stats.links}</span> backings</span>
        </div>
        <div style={{ fontSize: 12, color: 'var(--ink3)', lineHeight: 1.5, marginTop: 6, maxWidth: 440 }}>
          {mode === 'top'
            ? `The ${Math.min(top, index.ranked.length)} most-connected companies and the events they backed.`
            : `Every company with a sourced backing.`}
          {heavyEvents.length > 0 && (
            <>
              {' '}
              {heavyEvents.map((e, i) => (
                <span key={e.id}>{i ? ', ' : ''}{e.name} (<span className="mono">{e.count}</span> exhibitors)</span>
              ))}
              {mode === 'top'
                ? ` counts for a quarter in the ranking, so it only shows companies that also back something else.`
                : ` is drawn with long, soft links so it does not swallow the rest.`}
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 12, color: 'var(--ink2)', alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 3, background: 'var(--reach)' }} />Event, sized by backers</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 5, border: '1.5px solid var(--iggy)' }} />Company</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}><span style={{ width: 10, height: 10, borderRadius: 5, border: '2px solid var(--ink)' }} />Backs 2+ events</span>
          <span style={{ color: 'var(--ink3)' }}>{source === 'supabase' ? 'Live from Supabase' : 'From the London seed'}</span>
        </div>
      </div>

      {/* Zoom controls */}
      <div className="nn-zoom">
        <button onClick={() => zoomBy(1.4)} aria-label="Zoom in">+</button>
        <button onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out">−</button>
        <button onClick={refit} aria-label="Fit to screen" style={{ fontSize: 12 }}>
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M2 6V2h4M10 2h4v4M14 10v4h-4M6 14H2v-4" /></svg>
        </button>
      </div>

      {/* Side card */}
      {card && (
        <aside key={selected} className="nn-card">
          <button className="nn-close" aria-label="Close" onClick={() => setSelected(null)}>
            <svg width="12" height="12" viewBox="0 0 12 12" stroke="currentColor" strokeWidth="1.5"><path d="M2 2l8 8M10 2l-8 8" /></svg>
          </button>
          {card.kind === 'company' ? (
            <>
              <div className="nn-rise" style={{ display: 'flex', gap: 12, alignItems: 'center', paddingRight: 28 }}>
                <Mark domain={card.c.domain} size={40} />
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>{card.c.name}</div>
                  <a href={`https://${card.c.domain}`} target="_blank" rel="noreferrer" className="mono" style={{ fontSize: 12, color: 'var(--ink3)', textDecoration: 'none' }}>{card.c.domain}</a>
                </div>
              </div>
              <div className="nn-rise" style={{ animationDelay: '40ms', fontSize: 13, color: 'var(--ink2)', marginTop: 12, lineHeight: 1.5 }}>
                {card.c.kind === 'venue' ? 'Venue' : 'Sponsor'} that backed <span className="mono">{card.backed.length}</span> London event{card.backed.length === 1 ? '' : 's'}
                {card.ranked.length > 0 && <>, alongside <span className="mono">{card.ranked.length}</span> other companies</>}.
              </div>

              <div className="nn-h nn-rise" style={{ animationDelay: '80ms' }}>Events backed</div>
              {card.backed.map((b, i) => (
                <div key={b.link.e} className="nn-row nn-rise" style={{ animationDelay: `${100 + i * 30}ms`, cursor: 'pointer' }} onClick={() => focus('e:' + b.link.e)}>
                  <span style={{ width: 10, height: 10, borderRadius: 3, background: index.color.get(b.link.e), flex: 'none' }} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.ev?.name ?? b.link.e}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink3)' }}>{b.link.role}{b.ev ? <> · <span className="mono">{b.ev.count}</span> backers</> : null}</span>
                  </span>
                  {b.link.url && (
                    <a href={b.link.url} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 12, color: 'var(--ink3)', textDecoration: 'none' }}>Source ↗</a>
                  )}
                </div>
              ))}

              {card.ranked.length > 0 && (
                <>
                  <div className="nn-h nn-rise" style={{ animationDelay: '160ms' }}>Co-sponsors</div>
                  <div className="nn-rise" style={{ animationDelay: '170ms', fontSize: 12, color: 'var(--ink3)', marginTop: -4, marginBottom: 6 }}>Ranked by shared events; a small shared event counts for more than a trade show.</div>
                  {card.ranked.slice(0, 8).map((o, i) => (
                    <div key={o.id} className="nn-row nn-rise" style={{ animationDelay: `${190 + i * 28}ms`, cursor: 'pointer' }} onClick={() => focus('c:' + o.id)}>
                      <Mark domain={o.c!.domain} size={22} />
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.c!.name}</span>
                        <span style={{ display: 'block', fontSize: 12, color: 'var(--ink3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.shared.map(e => index.ev.get(e)?.name ?? e).join(', ')}</span>
                      </span>
                      <span style={{ display: 'flex', gap: 2 }} aria-label={`${o.shared.length} shared`}>
                        {o.shared.map(e => <span key={e} style={{ width: 6, height: 14, borderRadius: 2, background: index.color.get(e) }} />)}
                      </span>
                    </div>
                  ))}
                  {card.ranked.length > 8 && <div style={{ fontSize: 12, color: 'var(--ink3)', padding: '8px 0 0' }}>and <span className="mono">{card.ranked.length - 8}</span> more</div>}
                  {card.ranked.some(o => !view.cs.has(o.id)) && (
                    <button className="nn-primary nn-rise" style={{ animationDelay: '320ms' }} onClick={() => expand(card.ranked.slice(0, 24).map(o => o.id))}>
                      Grow their network
                    </button>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <div className="nn-rise" style={{ display: 'flex', gap: 12, alignItems: 'center', paddingRight: 28 }}>
                <span style={{ width: 36, height: 36, borderRadius: 7, background: index.color.get(card.ev.id), flex: 'none', display: 'grid', placeItems: 'center', color: '#fff', fontSize: 13 }} className="mono">{card.ev.count}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', color: 'var(--ink)' }}>{card.ev.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--ink3)' }}>
                    {[card.ev.organiser, card.ev.date ? new Date(card.ev.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : null].filter(Boolean).join(' · ') || 'London'}
                  </div>
                </div>
              </div>
              <div className="nn-rise" style={{ animationDelay: '40ms', fontSize: 13, color: 'var(--ink2)', marginTop: 12, lineHeight: 1.5 }}>
                <span className="mono">{card.ev.count}</span> companies backed it{card.hidden > 0 && <>; <span className="mono">{card.ev.count - card.hidden}</span> are on the map right now</>}.
                {card.ev.url && <> <a href={card.ev.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink2)' }}>Source ↗</a></>}
              </div>
              <div className="nn-h nn-rise" style={{ animationDelay: '80ms' }}>Backers</div>
              {card.backers.slice(0, 12).map((b, i) => (
                <div key={b.link.c} className="nn-row nn-rise" style={{ animationDelay: `${100 + i * 26}ms`, cursor: 'pointer' }} onClick={() => focus('c:' + b.link.c)}>
                  <Mark domain={b.c!.domain} size={22} />
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.c!.name}</span>
                    <span style={{ fontSize: 12, color: 'var(--ink3)' }}>{b.link.role}</span>
                  </span>
                  {b.n > 1 && <span style={{ fontSize: 12, color: 'var(--ink3)' }}><span className="mono">{b.n}</span> events</span>}
                </div>
              ))}
              {card.backers.length > 12 && <div style={{ fontSize: 12, color: 'var(--ink3)', padding: '8px 0 0' }}>and <span className="mono">{card.backers.length - 12}</span> more</div>}
              {card.hidden > 0 && (
                <button className="nn-primary nn-rise" style={{ animationDelay: '300ms' }} onClick={() => expand(card.backers.map(b => b.link.c))}>
                  Show all {card.ev.count} backers
                </button>
              )}
            </>
          )}
        </aside>
      )}
    </div>
  )
}

const CSS = `
.nn-root { position: relative; width: 100%; height: 100%; min-height: 480px; overflow: hidden; background: var(--canvas); user-select: none; -webkit-user-select: none; }
.nn-svg { position: absolute; inset: 0; width: 100%; height: 100%; display: block; touch-action: none; cursor: grab; }
.nn-root[data-drag=pan] .nn-svg { cursor: grabbing; }
.nn-root[data-drag=node] .nn-svg { cursor: grabbing; }
.nn-node { cursor: pointer; transition: opacity 240ms cubic-bezier(.2,.8,.2,1); }
.nn-pop { animation: nnPop 560ms cubic-bezier(.2,.8,.2,1) both; }
.nn-edges { animation: nnFade 900ms ease 250ms both; }
.nn-edge { stroke-linecap: round; vector-effect: non-scaling-stroke; transition: opacity 240ms cubic-bezier(.2,.8,.2,1), stroke-width 240ms cubic-bezier(.2,.8,.2,1); }
.nn-circle { transition: r 240ms cubic-bezier(.2,.8,.2,1); filter: drop-shadow(0 1px 1.5px rgba(0,0,0,.08)); }
.nn-node:hover .nn-circle { stroke-width: 2.5px; }
.nn-square { filter: drop-shadow(0 2px 4px rgba(0,0,0,.14)); }
.nn-label { font-size: 11px; fill: var(--ink2); paint-order: stroke; stroke: var(--canvas); stroke-width: 4px; stroke-opacity: .92; stroke-linejoin: round; pointer-events: none; opacity: 0; transition: opacity 200ms ease; }
.nn-label.nn-show { opacity: 1; }
.nn-svg[data-zoom=near] .nn-clabel { opacity: 1; }
.nn-elabel { font-size: 12px; font-weight: 600; fill: var(--ink); letter-spacing: -0.01em; }
.nn-count { fill: #fff; font-weight: 500; pointer-events: none; font-family: var(--font-geist-mono), ui-monospace, monospace; }
.nn-ring { fill: none; stroke-width: 1.5px; animation: nnPulse 1.8s cubic-bezier(.2,.8,.2,1) infinite; }
.nn-top { position: absolute; top: 16px; left: 16px; display: flex; gap: 10px; align-items: flex-start; z-index: 2; animation: nnRise 420ms cubic-bezier(.2,.8,.2,1) both; }
.nn-search { width: 300px; }
.nn-search input:focus { border-color: var(--border-strong) !important; }
.nn-results { position: absolute; top: 44px; left: 0; right: 0; background: var(--card); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--pop); padding: 4px; overflow: hidden; }
.nn-result { display: flex; align-items: center; gap: 10px; width: 100%; padding: 7px 8px; border: 0; background: transparent; border-radius: 7px; font: inherit; font-size: 13.5px; color: var(--ink); text-align: left; cursor: pointer; animation: nnRise 260ms cubic-bezier(.2,.8,.2,1) both; }
.nn-result[data-active=true] { background: var(--hover); }
.nn-seg { display: flex; background: var(--card); border: 1px solid var(--border); border-radius: 10px; padding: 3px; box-shadow: var(--lift); }
.nn-seg button { border: 0; background: transparent; font: inherit; font-size: 13px; color: var(--ink2); padding: 0 12px; height: 30px; border-radius: 7px; cursor: pointer; transition: background 200ms ease, color 200ms ease; }
.nn-seg button[data-on=true] { background: var(--ink); color: var(--ink-on); }
.nn-seg button:not([data-on=true]):hover { background: var(--hover); color: var(--ink); }
.nn-caption { position: absolute; left: 16px; bottom: 16px; z-index: 1; padding: 12px 14px; background: color-mix(in srgb, var(--card) 86%, transparent); backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px); border: 1px solid var(--border); border-radius: 10px; animation: nnRise 520ms cubic-bezier(.2,.8,.2,1) 120ms both; max-width: calc(100% - 32px); }
.nn-zoom { position: absolute; bottom: 16px; right: ${CARD_W + 32}px; display: flex; flex-direction: column; background: var(--card); border: 1px solid var(--border); border-radius: 10px; box-shadow: var(--lift); overflow: hidden; z-index: 1; animation: nnRise 520ms cubic-bezier(.2,.8,.2,1) 160ms both; }
.nn-root:not(:has(.nn-card)) .nn-zoom { right: 16px; }
.nn-zoom button { width: 34px; height: 32px; border: 0; background: transparent; font: inherit; font-size: 16px; color: var(--ink2); cursor: pointer; display: grid; place-items: center; transition: background 160ms ease; }
.nn-zoom button + button { border-top: 1px solid var(--divider); }
.nn-zoom button:hover { background: var(--hover); color: var(--ink); }
.nn-card { position: absolute; top: 16px; right: 16px; bottom: 16px; width: ${CARD_W}px; overflow-y: auto; background: var(--card); border: 1px solid var(--border); border-radius: 12px; box-shadow: var(--pop); padding: 18px 18px 20px; z-index: 3; animation: nnSlide 380ms cubic-bezier(.2,.8,.2,1) both; }
.nn-close { position: absolute; top: 14px; right: 14px; width: 28px; height: 28px; border: 0; background: transparent; border-radius: 7px; color: var(--ink3); cursor: pointer; display: grid; place-items: center; }
.nn-close:hover { background: var(--hover); color: var(--ink); }
.nn-h { font-size: 13px; font-weight: 600; color: var(--ink); margin: 20px 0 6px; padding-top: 16px; border-top: 1px solid var(--divider); }
.nn-row { display: flex; align-items: center; gap: 10px; padding: 8px 6px; margin: 0 -6px; border-radius: 7px; transition: background 160ms ease; }
.nn-row + .nn-row { box-shadow: 0 -1px 0 var(--divider); }
.nn-row:hover { background: var(--hover); box-shadow: none; }
.nn-row:hover + .nn-row { box-shadow: none; }
.nn-primary { margin-top: 16px; width: 100%; height: 36px; border: 0; border-radius: 7px; background: var(--ink); color: var(--ink-on); font: inherit; font-size: 13.5px; font-weight: 500; cursor: pointer; transition: transform 160ms cubic-bezier(.2,.8,.2,1), opacity 160ms ease; }
.nn-primary:hover { opacity: .9; }
.nn-primary:active { transform: scale(.98); }
.nn-rise { animation: nnRise 380ms cubic-bezier(.2,.8,.2,1) both; }
@keyframes nnPop { from { transform: scale(0); opacity: 0 } 60% { opacity: 1 } to { transform: scale(1); opacity: 1 } }
@keyframes nnFade { from { opacity: 0 } to { opacity: 1 } }
@keyframes nnRise { from { transform: translateY(6px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes nnSlide { from { transform: translateX(18px); opacity: 0 } to { transform: none; opacity: 1 } }
@keyframes nnPulse { 0% { transform: scale(1); opacity: .7 } 100% { transform: scale(1.45); opacity: 0 } }
@media (max-width: 760px) {
  .nn-top { right: 16px; flex-direction: column; }
  .nn-search { width: 100%; }
  .nn-card { top: auto; left: 12px; right: 12px; bottom: 12px; width: auto; max-height: 58%; }
  .nn-zoom, .nn-root:not(:has(.nn-card)) .nn-zoom { right: 16px; bottom: auto; top: 112px; }
  .nn-caption { display: none; }
}
@media (prefers-reduced-motion: reduce) {
  .nn-pop, .nn-edges, .nn-rise, .nn-card, .nn-top, .nn-caption, .nn-zoom, .nn-result { animation: none !important; }
  .nn-ring { animation: none; opacity: .6; }
  .nn-node, .nn-edge, .nn-label { transition: none; }
}
`
