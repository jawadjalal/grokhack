'use client'

import Link from 'next/link'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DitherBar } from '@/components/DitherBar'
import { Icon, Mark } from '@/components/Mark'
import { leadKey, mergeLeads, readLocal, STATUSES, writeLocal, type PipelineLead, type Status } from '@/lib/pipeline'

const dot: Record<Status, string> = {
  'To contact': 'var(--ink3)',
  Contacted: 'var(--reach)',
  Replied: 'var(--iggy)',
  Call: 'var(--teal)',
  Signed: 'var(--go)',
  No: 'var(--border-strong)',
}
const gbp = (n: number) => `£${Math.round(n).toLocaleString('en-GB')}`
const fit = (s: number) => (s >= 55 ? 'var(--go)' : 'var(--ink3)')

// Numbers ease to their new value instead of jumping.
function useTween(target: number) {
  const [v, setV] = useState(target)
  const from = useRef(target)
  useEffect(() => {
    const start = from.current
    if (start === target) return
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { from.current = target; setV(target); return }
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / 500)
      const e = 1 - Math.pow(1 - p, 3)
      const val = start + (target - start) * e
      from.current = val
      setV(val)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return v
}
function Num({ value, money }: { value: number; money?: boolean }) {
  const v = useTween(value)
  return <span className="mono">{money ? gbp(v) : Math.round(v)}</span>
}

type Toast = { text: string; key: string; from: Status; sync: string }

export function PipelineBoard() {
  const [leads, setLeads] = useState<PipelineLead[]>([])
  const [source, setSource] = useState<'notion' | 'local'>('local')
  const [note, setNote] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [event, setEvent] = useState('')
  const [drag, setDrag] = useState<string | null>(null)
  const [over, setOver] = useState<Status | null>(null)
  const [toast, setToast] = useState<Toast | null>(null)
  const [intro, setIntro] = useState(true)
  const board = useRef<HTMLDivElement>(null)
  const els = useRef(new Map<string, HTMLElement>())
  const rects = useRef(new Map<string, { x: number; y: number }>())
  const leadsRef = useRef<PipelineLead[]>([])
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const load = useCallback(async () => {
    const local = readLocal()
    try {
      const res = await fetch('/api/pipeline', { cache: 'no-store' })
      const data = await res.json()
      setSource(data.source === 'notion' ? 'notion' : 'local')
      setNote(data.error ?? '')
      setLeads(mergeLeads(Array.isArray(data.leads) ? data.leads : [], local))
    } catch {
      setLeads(local)
      setSource('local')
    }
    setLoaded(true)
  }, [])

  useEffect(() => {
    load()
    const onStore = () => setLeads((cur) => mergeLeads(cur, readLocal()))
    window.addEventListener('storage', onStore)
    const t = setTimeout(() => setIntro(false), 1400)
    return () => { window.removeEventListener('storage', onStore); clearTimeout(t) }
  }, [load])

  leadsRef.current = leads
  const events = useMemo(() => [...new Set(leads.map((l) => l.event).filter(Boolean))], [leads])
  const shown = useMemo(() => leads.filter((l) => !event || l.event === event), [leads, event])
  const cols = useMemo(() => STATUSES.map((s) => {
    const items = shown.filter((l) => l.status === s).sort((a, b) => b.score - a.score)
    return { s, items, sum: items.reduce((a, l) => a + (l.priceGbp ?? 0), 0) }
  }), [shown])
  const open = cols.filter((c) => c.s !== 'Signed' && c.s !== 'No').reduce((a, c) => a + c.sum, 0)
  const signed = cols.find((c) => c.s === 'Signed')?.sum ?? 0

  // FLIP: cards glide to their new place when a lead moves.
  useLayoutEffect(() => {
    const b = board.current
    if (!b) return
    const br = b.getBoundingClientRect()
    const next = new Map<string, { x: number; y: number }>()
    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches
    els.current.forEach((el, k) => {
      const r = el.getBoundingClientRect()
      const pos = { x: r.left - br.left + b.scrollLeft, y: r.top - br.top }
      next.set(k, pos)
      const prev = rects.current.get(k)
      if (prev && !calm && (Math.abs(prev.x - pos.x) > 1 || Math.abs(prev.y - pos.y) > 1)) {
        el.animate([{ transform: `translate(${prev.x - pos.x}px, ${prev.y - pos.y}px)` }, { transform: 'none' }], { duration: 340, easing: 'cubic-bezier(.2,.8,.2,1)' })
      }
    })
    rects.current = next
  })

  const move = useCallback(async (key: string, to: Status, announce = true) => {
    const cur = leadsRef.current
    const old = cur.find((l) => leadKey(l) === key)
    if (!old || old.status === to) return
    const moved: PipelineLead = { ...old, status: to, updatedAt: new Date().toISOString() }
    const next = cur.map((l) => (l === old ? moved : l))
    leadsRef.current = next
    setLeads(next)
    writeLocal(next)
    let sync = 'Saved here'
    if (moved.pageId) {
      try {
        const res = await fetch('/api/pipeline', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pageId: moved.pageId, status: to }) })
        const d = await res.json()
        sync = d.synced ? 'Synced to Notion' : 'Saved here, Notion did not update'
      } catch { sync = 'Saved here, Notion did not update' }
    }
    if (announce) {
      clearTimeout(toastTimer.current)
      setToast({ text: `${moved.name} to ${to}`, key, from: old.status, sync })
      toastTimer.current = setTimeout(() => setToast(null), 5000)
    }
  }, [])

  const undo = () => {
    if (!toast) return
    move(toast.key, toast.from, false)
    clearTimeout(toastTimer.current)
    setToast(null)
  }

  const total = shown.length
  const css = `
.pl-wrap { max-width: 1760px; margin: 0 auto; padding: 36px 32px 96px; }
.pl-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
.pl-stats { display: flex; gap: 32px; }
.pl-board { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(256px, 1fr); gap: 14px; overflow-x: auto; padding: 4px 2px 24px; margin: 22px -2px 0; scroll-snap-type: x proximity; }
.pl-col { scroll-snap-align: start; min-width: 0; min-height: 320px; border-radius: var(--r-panel); transition: background .2s var(--ease), box-shadow .2s var(--ease); padding: 0 8px 8px; }
.pl-col.over { background: var(--chip); box-shadow: inset 0 0 0 1px var(--border-strong); }
.pl-card { position: relative; background: var(--card); border-radius: var(--r-card); box-shadow: 0 0 0 1px var(--border), var(--shadow); padding: 12px 13px 12px; cursor: grab; transition: box-shadow .2s var(--ease), opacity .2s var(--ease), translate .2s var(--ease); user-select: none; }
.pl-card:hover { box-shadow: 0 0 0 1px var(--border-strong), var(--lift); translate: 0 -2px; }
.pl-card:active { cursor: grabbing; }
.pl-card.dragging { opacity: .35; box-shadow: 0 0 0 1px var(--border-strong); }
.pl-card .pl-act { opacity: 0; transition: opacity .15s var(--ease); }
.pl-card:hover .pl-act, .pl-card:focus-within .pl-act { opacity: 1; }
.pl-act { border: 0; background: transparent; width: 26px; height: 26px; border-radius: 6px; display: inline-flex; align-items: center; justify-content: center; color: var(--ink3); }
.pl-act:hover { background: var(--hover); color: var(--ink); }
.pl-intro { animation: rise .5s var(--ease) both; }
.pl-ghost { border: 1px dashed var(--border-strong); border-radius: var(--r-card); height: 64px; }
.pl-toast { position: fixed; left: 50%; bottom: 28px; transform: translateX(-50%); background: var(--ink); color: var(--ink-on); border-radius: var(--r-card); box-shadow: var(--pop); padding: 8px 8px 8px 16px; display: flex; align-items: center; gap: 14px; animation: rise .3s var(--ease) both; z-index: 50; }
.pl-toast button { border: 0; background: transparent; color: var(--ink-on); height: 28px; padding: 0 10px; border-radius: 6px; opacity: .8 }
.pl-toast button:hover { background: rgba(255,255,255,.12); opacity: 1 }
@keyframes pl-land { 0% { box-shadow: 0 0 0 1px var(--go), 0 0 0 5px var(--go-soft); } 100% { box-shadow: 0 0 0 1px var(--border), var(--shadow); } }
.pl-landed { animation: pl-land .9s var(--ease) both; }
@media (max-width: 720px) { .pl-wrap { padding: 24px 16px 96px; } .pl-board { grid-auto-columns: 82%; } }
`

  return (
    <main className="pl-wrap">
      <style>{css}</style>
      <header className="pl-head">
        <div className="rise">
          <h1 style={{ margin: 0, fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}>Pipeline</h1>
          <p style={{ margin: '6px 0 0', color: 'var(--ink3)' }}>
            {source === 'notion' ? 'Live from your Notion board. Moves sync back.' : 'Saved on this device. Connect Notion to share it with the team.'}
            {note && <span> {note}</span>}
          </p>
        </div>
        <div className="pl-stats rise" style={{ animationDelay: '80ms' }}>
          {[['Open', open], ['Signed', signed]].map(([label, val]) => (
            <div key={label as string}>
              <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: label === 'Signed' && signed ? 'var(--go)' : 'var(--ink)' }}><Num value={val as number} money /></div>
              <div style={{ fontSize: 13, color: 'var(--ink3)' }}>{label}</div>
            </div>
          ))}
          <div>
            <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em' }}><Num value={total} /></div>
            <div style={{ fontSize: 13, color: 'var(--ink3)' }}>Leads</div>
          </div>
        </div>
      </header>

      {total > 0 && (
        <div style={{ display: 'flex', height: 6, gap: 2, marginTop: 22 }} aria-hidden>
          {cols.filter((c) => c.items.length).map((c, i) => (
            <span key={c.s} className="reveal" style={{ flex: c.items.length, background: dot[c.s], borderRadius: 2, animationDelay: `${150 + i * 90}ms`, transition: 'flex .5s var(--ease)' }} />
          ))}
        </div>
      )}

      {events.length > 1 && (
        <div style={{ display: 'flex', gap: 4, marginTop: 16, flexWrap: 'wrap' }}>
          {['', ...events].map((e) => (
            <button key={e || 'all'} className="btn" onClick={() => setEvent(e)} style={{ height: 30, padding: '0 10px', background: event === e ? 'var(--chip)' : undefined, color: event === e ? 'var(--ink)' : undefined, fontWeight: event === e ? 550 : 400 }}>
              {e || 'All events'}
            </button>
          ))}
        </div>
      )}

      {loaded && total === 0 && (
        <section className="rise" style={{ marginTop: 28, background: 'var(--card)', borderRadius: 'var(--r-panel)', boxShadow: '0 0 0 1px var(--border)', padding: '28px 32px', display: 'flex', gap: 40, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 320px' }}>
            <h2 style={{ margin: 0, fontSize: 19, fontWeight: 600 }}>No leads yet</h2>
            <p style={{ margin: '8px 0 0', color: 'var(--ink2)', maxWidth: 460 }}>
              Describe an event on the home page and Backer ranks who to ask. Push the best fits here and they land in To contact, ready to work through to Signed.
            </p>
            <Link href="/" className="btn btn-primary" style={{ marginTop: 18 }}>Find sponsors <Icon name="arrow" size={16} /></Link>
          </div>
          <ol style={{ margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: 12, flex: '1 1 260px' }}>
            {['Paste your event link', 'Review the ranked leads and pitches', 'Push them to the pipeline'].map((t, i) => (
              <li key={t} className="rise" style={{ display: 'flex', gap: 12, alignItems: 'center', animationDelay: `${200 + i * 100}ms` }}>
                <span className="mono" style={{ width: 24, height: 24, borderRadius: 6, background: 'var(--chip)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, color: 'var(--ink2)' }}>{i + 1}</span>
                <span style={{ color: 'var(--ink2)' }}>{t}</span>
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="pl-board" ref={board}>
        {cols.map((c, ci) => (
          <section
            key={c.s}
            className={`pl-col${over === c.s ? ' over' : ''}`}
            onDragOver={(e) => { if (drag) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; if (over !== c.s) setOver(c.s) } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o === c.s ? null : o)) }}
            onDrop={(e) => { e.preventDefault(); const k = e.dataTransfer.getData('text/plain') || drag; setOver(null); setDrag(null); if (k) move(k, c.s) }}
          >
            <div className={intro ? 'pl-intro' : ''} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '12px 4px 12px', animationDelay: `${ci * 60}ms` }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: dot[c.s] }} />
              <span style={{ fontWeight: 600 }}>{c.s}</span>
              <span className="mono" style={{ color: 'var(--ink3)', fontSize: 13 }}><Num value={c.items.length} /></span>
              <span className="mono" style={{ marginLeft: 'auto', color: 'var(--ink3)', fontSize: 13 }}><Num value={c.sum} money /></span>
            </div>
            <div style={{ display: 'grid', gap: 8, alignContent: 'start' }}>
              {c.items.map((l, i) => {
                const k = leadKey(l)
                const next = STATUSES[STATUSES.indexOf(l.status) + 1]
                return (
                  <article
                    key={k}
                    ref={(el) => { if (el) els.current.set(k, el); else els.current.delete(k) }}
                    draggable
                    className={`pl-card${drag === k ? ' dragging' : ''}${toast?.key === k ? ' pl-landed' : ''}${intro ? ' pl-intro' : ''}`}
                    style={intro ? { animationDelay: `${120 + ci * 60 + i * 40}ms` } : undefined}
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', k); e.dataTransfer.effectAllowed = 'move'; requestAnimationFrame(() => setDrag(k)) }}
                    onDragEnd={() => { setDrag(null); setOver(null) }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <Mark domain={l.domain} size={26} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.name}</div>
                        <div className="mono" style={{ fontSize: 12, color: 'var(--ink3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.domain}</div>
                      </div>
                      {l.notionUrl && (
                        <a className="pl-act" href={l.notionUrl} target="_blank" rel="noreferrer" title="Open in Notion" draggable={false}><Icon name="notion" size={15} /></a>
                      )}
                    </div>
                    {l.event && <div style={{ marginTop: 10, fontSize: 13, color: 'var(--ink2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.event}</div>}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10 }}>
                      <DitherBar value={l.score} color={fit(l.score)} width={88} />
                      <span className="mono" style={{ fontSize: 12.5, color: 'var(--ink2)' }}>{Math.round(l.score)}</span>
                      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink3)' }}>
                        {l.tier && <span>{l.tier}</span>}
                        {l.priceGbp !== undefined && <span className="mono" style={{ color: 'var(--ink)' }}>{gbp(l.priceGbp)}</span>}
                      </span>
                    </div>
                    {next && (
                      <div style={{ position: 'absolute', right: 8, bottom: 8 }}>
                        <button className="pl-act" title={`Move to ${next}`} aria-label={`Move to ${next}`} onClick={() => move(k, next)}><Icon name="arrow" size={14} /></button>
                      </div>
                    )}
                  </article>
                )
              })}
              {!c.items.length && (loaded && total === 0
                ? <div className="pl-ghost rise" style={{ animationDelay: `${ci * 70}ms` }} />
                : <div style={{ padding: '18px 4px', color: 'var(--ink3)', fontSize: 13.5 }}>{drag ? 'Drop here' : 'Nothing here'}</div>)}
            </div>
          </section>
        ))}
      </div>

      {toast && (
        <div className="pl-toast" role="status">
          <span>{toast.text}</span>
          <span style={{ opacity: .6, fontSize: 13 }}>{toast.sync}</span>
          <button onClick={undo}>Undo</button>
        </div>
      )}
    </main>
  )
}
