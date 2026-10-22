'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import ChatDock from '@/components/ChatDock'
import DraftsPanel from '@/components/DraftsPanel'
import { DitherBar } from '@/components/DitherBar'
import { Icon, Mark } from '@/components/Mark'
import { LocationPicker } from '@/components/LocationPicker'
import { NearbyEvents, useMapStats } from '@/components/NearbyEvents'
import { LeadMemory, track } from '@/components/Touches'
import type { EventInput, Lead } from '@/lib/types'
import { leadKey, readLocal, writeLocal, type PipelineLead } from '@/lib/pipeline'
import { shortLabel, useLocation, type LocationApi } from '@/lib/useLocation'

const STEPS = ['Reading your event', 'Checking who backed London events like it', 'Scoring fit and pricing each ask']
const PUSH_LIMIT = 15
const LAST_KEY = 'backer.last.v1'
const SHOW = 40 // rows pitched and shown; the rest are counted
const STRONG = 60 // fit at or above this counts toward the money on the table

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `${path} failed: ${res.status}`)
  return data
}

// One hue for fit, everywhere. Weak fits fall back to grey.
function fitColor(score: number) {
  return score >= 55 ? 'var(--go)' : 'var(--ink3)'
}

// The screen's one finding: who to email first, and why, with the action beside it.
function Finding({ leads, onOpen }: { leads: Lead[]; onOpen: (l: Lead) => void }) {
  const proven = leads.filter(l => l.pastBackings.length).slice(0, 2)
  const first = proven[0] ?? leads[0]
  if (!first) return null
  const Name = ({ l }: { l: Lead }) => (
    <button onClick={() => onOpen(l)} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: 0, padding: '1px 6px 1px 3px', borderRadius: 6, background: 'var(--bg)', boxShadow: '0 0 0 1px var(--border)', color: 'var(--ink)', fontWeight: 550, verticalAlign: 'baseline' }}>
      <Mark domain={l.domain} size={18} /> {l.name}
    </button>
  )
  return (
    <p style={{ margin: '10px 0 0', fontSize: 16, color: 'var(--ink2)', lineHeight: 1.7, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
      {proven.length ? (
        <>
          <Name l={proven[0]} />
          {proven[1] && (
            <>
              and <Name l={proven[1]} />
            </>
          )}
          {proven.length > 1 ? 'have' : 'has'} already backed an event like this.
        </>
      ) : (
        <>
          Nobody on record has backed one like this yet. <Name l={first} /> fits best.
        </>
      )}
      <button className="btn" onClick={() => onOpen(first)} style={{ height: 28, padding: '0 8px', color: 'var(--ink)', fontWeight: 550 }}>
        Email {first.name} first <span className="chev">›</span>
      </button>
    </p>
  )
}

// How the money on the table splits across tiers. Zero tiers are left out.
function Ladder({ leads }: { leads: Lead[] }) {
  const tiers = (['Headline', 'Partner', 'Supporter'] as const)
    .map(t => {
      const ls = leads.filter(l => l.kind === 'sponsor' && l.score >= STRONG && l.suggestedTier === t)
      return { t, n: ls.length, gbp: ls.reduce((a, l) => a + (l.suggestedPriceGbp ?? 0), 0) }
    })
    .filter(x => x.n)
  const sum = tiers.reduce((a, x) => a + x.gbp, 0) || 1
  const shade = { Headline: 'var(--go)', Partner: '#4f9c6c', Supporter: '#a7cdb4' }
  if (!tiers.length) return null
  return (
    <div style={{ marginTop: 12, width: 260, marginLeft: 'auto' }}>
      <div style={{ display: 'flex', height: 8, gap: 2 }}>
        {tiers.map((x, i) => (
          <span key={x.t} className="reveal" style={{ width: `${(x.gbp / sum) * 100}%`, minWidth: 6, background: shade[x.t], borderRadius: 2, animationDelay: `${200 + i * 120}ms` }} />
        ))}
      </div>
      <div style={{ display: 'grid', gap: 3, marginTop: 8 }}>
        {tiers.map(x => (
          <div key={x.t} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: 'var(--ink3)' }}>
            <span style={{ width: 8, height: 8, borderRadius: 2, background: shade[x.t], flex: 'none' }} />
            <span style={{ flex: 1, textAlign: 'left' }}>
              {x.n} {x.t.toLowerCase()}
              {x.n > 1 ? 's' : ''}
            </span>
            <span className="mono" style={{ color: 'var(--ink2)' }}>£{x.gbp.toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Loading keeps the final layout: the title, the table frame and rows at their real size.
function Skeleton({ step }: { step: number }) {
  const bar = (w: number | string, h = 12) => <span style={{ display: 'block', width: w, height: h, borderRadius: 3, background: 'var(--chip)' }} />
  return (
    <section style={{ paddingTop: 24 }}>
      <div style={{ color: 'var(--ink3)', fontSize: 13, display: 'flex', gap: 8, alignItems: 'center' }}>
        <span style={{ width: 7, height: 7, borderRadius: 2, background: 'var(--go)', animation: 'blink 1s infinite' }} />
        {STEPS[Math.max(0, step)]}…
      </div>
      <div style={{ marginTop: 12 }}>{bar(420, 28)}</div>
      <div style={{ marginTop: 12 }}>{bar(520, 14)}</div>
      <div style={{ marginTop: 26, background: 'var(--card)', borderRadius: 'var(--r-panel)', boxShadow: '0 0 0 1px var(--border)', overflow: 'hidden' }}>
        <div style={{ height: 55, borderBottom: '1px solid var(--divider)' }} />
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, alignItems: 'center', padding: '15px 20px', borderTop: i ? '1px solid var(--divider)' : 0, opacity: 1 - i * 0.11 }}>
            {bar(12)}
            <span style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {bar(28, 28)}
              <span style={{ display: 'grid', gap: 6 }}>
                {bar(90)}
                {bar(70, 10)}
              </span>
            </span>
            <span style={{ display: 'flex', justifyContent: 'flex-end' }}>{bar(120, 10)}</span>
            <span style={{ display: 'grid', gap: 6 }}>
              {bar('80%')}
              {bar('55%', 10)}
            </span>
            <span style={{ display: 'flex', justifyContent: 'flex-end' }}>{bar(60)}</span>
            <span />
          </div>
        ))}
      </div>
    </section>
  )
}

function ErrorLine({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <p style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 22, color: 'var(--ink2)', fontSize: 14.5 }}>
      <span style={{ width: 7, height: 7, borderRadius: 2, background: '#c62f35' }} />
      Couldn&apos;t rank backers: {message}
      <button className="btn" onClick={onRetry} style={{ height: 30, padding: '0 10px', color: 'var(--ink)' }}>
        Retry
      </button>
    </p>
  )
}

function tierTag(tier?: Lead['suggestedTier']) {
  if (tier === 'Headline') return 'tag tag-go'
  if (tier === 'Partner') return 'tag tag-reach'
  if (tier === 'Venue') return 'tag tag-teal'
  return 'tag'
}

type Filter = 'all' | 'sponsor' | 'venue'
const FILTERS: [Filter, string][] = [
  ['all', 'All'],
  ['sponsor', 'Sponsors'],
  ['venue', 'Venues'],
]
const TAB_W = 104

function exportCsv(event: EventInput, leads: Lead[]) {
  const q = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const rows = [['Rank', 'Name', 'Domain', 'Kind', 'Fit', 'Tier', 'Price GBP', 'Why', 'Subject', 'Email']]
  leads.forEach((l, i) => rows.push([String(i + 1), l.name, l.domain, l.kind, String(l.score), l.suggestedTier ?? '', String(l.suggestedPriceGbp ?? ''), l.reasons.join(' · '), l.pitch?.subject ?? '', l.pitch?.body ?? '']))
  const blob = new Blob([rows.map(r => r.map(q).join(',')).join('\n')], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `backer-${event.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)}.csv`
  a.click()
}

// Counts up to the score when a row appears.
function CountUp({ to, delay = 0 }: { to: number; delay?: number }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    let raf = 0
    const t0 = performance.now() + delay
    const tick = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - t0) / 700))
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [to, delay])
  return <>{n}</>
}

export default function Home() {
  const [lastQuery, setLastQuery] = useState('')
  const [step, setStep] = useState(-1)
  const [ms, setMs] = useState(0)
  const [ranked, setRanked] = useState(0)
  const [event, setEvent] = useState<EventInput | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<Lead | null>(null)
  const [pushing, setPushing] = useState(false)
  const [error, setError] = useState('')
  const loc = useLocation()
  const [place, setPlace] = useState('London') // where the shown results were ranked for

  const [saved, setSaved] = useState(0)
  const [note, setNote] = useState('')
  const [prefill, setPrefill] = useState('')

  // The last ranking survives a reload or a trip to another page.
  useEffect(() => {
    try {
      const last = JSON.parse(localStorage.getItem(LAST_KEY) ?? 'null')
      if (last?.event && Array.isArray(last.leads) && last.leads.length) {
        setEvent(last.event)
        setLeads(last.leads)
        setRanked(last.ranked ?? last.leads.length)
        setMs(last.ms ?? 0)
        setLastQuery(last.query ?? '')
      }
    } catch { /* storage blocked */ }
  }, [])

  useEffect(() => {
    if (!event || !leads.length) return
    try { localStorage.setItem(LAST_KEY, JSON.stringify({ event, leads, ranked, ms, query: lastQuery })) } catch { /* ignore */ }
  }, [event, leads, ranked, ms, lastQuery])

  // From the CRM: /?sponsor=<domain> opens the chat on outreach to that company.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('sponsor')
    if (!id) return
    const name = new URLSearchParams(window.location.search).get('name') || id
    setPrefill(`Draft outreach to ${name}`)
    window.history.replaceState(null, '', '/')
  }, [])

  // Links and event descriptions rank every backer; everything else goes to the chat.
  function intercept(text: string) {
    const t = text.trim()
    const find = t.match(/^(?:find|rank|get)\s+(?:me\s+)?(?:backers|sponsors|venues)\s+(?:for|to)\s+(.+)$/i)
    if (/^https?:\/\/\S+$/i.test(t)) { run(t); return true }
    if (find) { run(find[1]); return true }
    return false
  }

  async function run(q?: string) {
    const input = (q ?? '').trim()
    if (!input || step >= 0) return
    setLastQuery(input)
    const t0 = performance.now()
    setError('')
    setOpen(null)
    try {
      setStep(0)
      const isUrl = /^https?:\/\//.test(input)
      const ev = await post<EventInput>('/api/event', isUrl ? { url: input } : { text: input })
      setStep(1)
      const { lat, lng, radiusKm, label } = loc.location
      const matched = await post<Lead[]>('/api/match', { ...ev, near: { lat, lng, radiusKm, label } })
      setStep(2)
      // Pitch the top of the list; a lead whose pitch fails still shows, without one.
      const head = matched.slice(0, SHOW)
      const priced = await Promise.all(head.map(l => post<Lead>('/api/pitch', { event: ev, lead: l }).catch(() => l)))
      setRanked(matched.length)
      setPlace(shortLabel(label))
      setEvent(ev)
      setLeads(priced)
      setFilter('all')
      setSaved(0)
      setNote('')
      setMs(performance.now() - t0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStep(-1)
    }
  }

  const shown = useMemo(() => leads.filter(l => filter === 'all' || l.kind === filter), [leads, filter])
  const top = shown.slice(0, PUSH_LIMIT)

  async function push() {
    if (!event) return
    setPushing(true)
    setError('')
    setNote('')
    // The pipeline always gets the leads; Notion gets them too when it is connected.
    const save = (ls: Lead[]) => {
      const now = new Date().toISOString()
      const have = readLocal()
      const known = new Set(have.map(leadKey))
      const fresh: PipelineLead[] = ls.map(l => ({ sponsorId: l.sponsorId, name: l.name, domain: l.domain, kind: l.kind, score: l.score, status: 'To contact', tier: l.suggestedTier, priceGbp: l.suggestedPriceGbp, event: event.name, notionUrl: l.notionUrl, updatedAt: now }))
      const byKey = new Map(fresh.map(l => [leadKey(l), l]))
      writeLocal([...have.map(h => { const f = byKey.get(leadKey(h)); return f ? { ...h, notionUrl: f.notionUrl ?? h.notionUrl, score: f.score } : h }), ...fresh.filter(f => !known.has(leadKey(f)))])
      setSaved(ls.length)
    }
    save(top)
    try {
      const done = await post<Lead[]>('/api/push', { event, leads: top })
      const byId = new Map(done.map(l => [l.sponsorId, l]))
      setLeads(ls => ls.map(l => byId.get(l.sponsorId) ?? l))
      setOpen(o => (o ? (byId.get(o.sponsorId) ?? o) : o))
      track(event, done.filter(l => l.notionUrl), 'pushed')
      save(top.map(l => byId.get(l.sponsorId) ?? l))
    } catch {
      setNote('Notion is not connected, saved to your pipeline')
    } finally {
      setPushing(false)
    }
  }

  const busy = step >= 0
  const strong = shown.filter(l => l.score >= STRONG)
  const total = strong.filter(l => l.kind === 'sponsor').reduce((s, l) => s + (l.suggestedPriceGbp ?? 0), 0)
  const allPushed = saved > 0 || (top.length > 0 && top.every(l => l.notionUrl))

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 5, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', background: 'var(--canvas)', borderBottom: '1px solid var(--divider)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14.5 }}>
          <strong style={{ fontWeight: 600, letterSpacing: '-0.01em' }}>Find backers</strong>
          {event && !busy && (
            <span style={{ color: 'var(--ink3)', display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
              <span>/</span>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 420 }}>{event.name}</span>
            </span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          {saved > 0 && (
            <Link className="btn pop" href="/pipeline" style={{ fontSize: 13.5 }}>
              <Icon name="chart" size={16} /> {saved} in pipeline <span className="chev">›</span>
            </Link>
          )}
        </div>
      </header>

      <main style={{ width: '100%', maxWidth: 1120, margin: '0 auto', padding: '0 24px 220px' }}>
        {busy && <Skeleton step={step} />}

        {!leads.length && !busy && (
          <section style={{ paddingTop: '9vh', maxWidth: 1040 }}>
            <h1 className="rise" style={{ fontSize: 'clamp(52px, 7vw, 104px)', lineHeight: 0.92, letterSpacing: '-0.055em', margin: 0, fontWeight: 600 }}>
              Who will back
              <br />
              <span style={{ color: 'var(--ink3)' }}>your event?</span>
            </h1>
            <p className="rise" style={{ fontSize: 20, color: 'var(--ink2)', margin: '26px 0 0', maxWidth: 460, lineHeight: 1.45, letterSpacing: '-0.01em', animationDelay: '.08s' }}>
              The sponsors and venues most likely to say yes, ranked by who already paid for events like yours.
            </p>
            <div className="rise" style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px 18px', marginTop: 28, fontSize: 13.5, color: 'var(--ink2)', animationDelay: '.16s' }}>
              <LocationPicker loc={loc} />
              <span aria-hidden style={{ width: 1, height: 16, background: 'var(--divider)' }} />
              <HeroStats />
            </div>
            {error && !busy && <ErrorLine message={error} onRetry={() => run(lastQuery)} />}
            <div style={{ width: '100%', textAlign: 'left' }}>
              <NearbyEvents near={loc.location} ready={loc.ready} onPick={url => run(url)} />
            </div>
          </section>
        )}

        {!!leads.length && event && !busy && (
          <section className="rise" style={{ paddingTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 32 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--ink3)', fontSize: 13, display: 'flex', gap: 7, alignItems: 'center' }}>
                  <Icon name="sparkle" size={15} /> {ranked.toLocaleString()} {place === 'London' ? 'London backers' : `backers near ${place}`} ranked in {(ms / 1000).toFixed(1)}s · top {leads.length} shown
                </div>
                <h2 style={{ fontSize: 28, lineHeight: 1.12, letterSpacing: '-0.028em', margin: '8px 0 0', fontWeight: 600, maxWidth: 640, textWrap: 'balance' }}>{event.name}</h2>
                <Finding leads={shown} onOpen={setOpen} />
              </div>
              <div style={{ textAlign: 'right', flex: 'none', minWidth: 220 }}>
                <div className="mono" style={{ fontSize: 32, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1 }}>
                  {filter === 'venue' ? shown.length : `£${total.toLocaleString()}`}
                </div>
                <div style={{ color: 'var(--ink3)', fontSize: 13, marginTop: 6 }}>
                  {filter === 'venue' ? 'venues to ask for space' : `on the table from ${strong.filter(l => l.kind === 'sponsor').length} strong fits`}
                </div>
                {filter !== 'venue' && <Ladder leads={shown} />}
              </div>
            </div>

            <div style={{ marginTop: 22, background: 'var(--card)', borderRadius: 'var(--r-panel)', boxShadow: '0 0 0 1px var(--border)', overflow: 'hidden' }}>
              {/* Toolbar lives inside the table: filter on the left, actions on the right. */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px 10px 12px', borderBottom: '1px solid var(--divider)' }}>
                <div style={{ position: 'relative', display: 'flex', padding: 3, borderRadius: 9, background: 'var(--chip)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,.07)' }}>
                  <span aria-hidden style={{ position: 'absolute', top: 3, bottom: 3, left: 3, width: TAB_W, borderRadius: 7, background: 'var(--bg)', boxShadow: 'var(--shadow), 0 0 0 1px var(--border)', transform: `translateX(${FILTERS.findIndex(f => f[0] === filter) * TAB_W}px)`, transition: 'transform .35s var(--ease)' }} />
                  {FILTERS.map(([key, label]) => (
                    <button key={key} onClick={() => setFilter(key)} style={{ position: 'relative', width: TAB_W, height: 30, border: 0, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13.5, color: filter === key ? 'var(--ink)' : 'var(--ink3)', fontWeight: filter === key ? 550 : 400, transition: 'color .2s' }}>
                      {label}
                      <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink3)' }}>
                        {key === 'all' ? leads.length : leads.filter(l => l.kind === key).length}
                      </span>
                    </button>
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {note && !error && <Link href="/pipeline" className="pop" style={{ color: 'var(--ink3)', fontSize: 13, marginRight: 8, textDecoration: 'none', whiteSpace: 'nowrap' }}>{note} ›</Link>}
                  {error && <span style={{ color: 'var(--ink2)', fontSize: 13, marginRight: 8, maxWidth: 340, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'flex', gap: 6, alignItems: 'center' }} title={error}><span style={{ width: 6, height: 6, borderRadius: 1.5, background: '#c62f35', flex: 'none' }} />{error}</span>}
                  <button className="btn" onClick={() => exportCsv(event, shown)} style={{ height: 34, fontSize: 13.5 }}>
                    <Icon name="doc" size={16} /> Export CSV
                  </button>
                  <button className={`btn btn-primary${pushing ? ' pushing' : ''}`} onClick={push} disabled={pushing || allPushed} style={{ height: 34, fontSize: 13.5, minWidth: 196, justifyContent: 'center' }}>
                    <Icon name={allPushed ? 'check' : 'chart'} size={16} />
                    {allPushed ? (top.every(l => l.notionUrl) ? `${top.length} in pipeline and Notion` : `${top.length} in pipeline`) : pushing ? 'Adding to pipeline…' : `Add top ${top.length} to pipeline`}
                  </button>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '12px 20px 8px', color: 'var(--ink3)', fontSize: 12 }}>
                <span>#</span>
                <span>Backer</span>
                <span style={{ textAlign: 'right' }}>Fit</span>
                <span>Why they&apos;d say yes</span>
                <span style={{ textAlign: 'right' }}>The ask</span>
                <span />
              </div>
              {shown.map((l, i) => (
                <Row key={`${filter}-${l.sponsorId}`} lead={l} rank={i + 1} active={open?.sponsorId === l.sponsorId} onOpen={() => setOpen(l)} />
              ))}
            </div>
          </section>
        )}
      </main>

      <ChatDock context={{ event: event ?? undefined, leads, location: 'London' }} onFindBackers={q => run(q || lastQuery)} intercept={intercept} prefill={prefill} />
      {open && event && <Drawer lead={open} event={event} onClose={() => setOpen(null)} />}
    </div>
  )
}

const COLS = '24px minmax(170px, 1.3fr) 150px minmax(160px, 1.6fr) 100px 70px'

function Row({ lead: l, rank, active, onOpen }: { lead: Lead; rank: number; active: boolean; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
      className="row rise"
      style={{
        animationDelay: `${Math.min(rank, 12) * 35}ms`,
        display: 'grid',
        gridTemplateColumns: COLS,
        gap: 16,
        alignItems: 'center',
        width: '100%',
        textAlign: 'left',
        padding: '13px 20px',
        border: 0,
        borderTop: rank > 1 ? '1px solid var(--divider)' : 0,
        background: active ? 'var(--hover)' : 'transparent',
      }}
    >
      <span className="mono" style={{ color: 'var(--ink3)', fontSize: 13 }}>
        {rank}
      </span>
      <span style={{ display: 'flex', gap: 12, alignItems: 'center', minWidth: 0 }}>
        <Mark domain={l.domain} size={28} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 550, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.name}</span>
          <span className="mono" style={{ display: 'block', fontSize: 12, color: 'var(--ink3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {l.domain}
          </span>
        </span>
      </span>
      <span style={{ display: 'flex', gap: 10, alignItems: 'center', justifyContent: 'flex-end' }}>
        <span className="reveal" style={{ animationDelay: `${Math.min(rank, 12) * 35 + 120}ms` }}>
          <DitherBar value={l.score} color={fitColor(l.score)} width={96} height={8} />
        </span>
        <span className="mono" style={{ fontSize: 17, fontWeight: 600, width: 26, textAlign: 'right', color: l.score >= 55 ? 'var(--ink)' : 'var(--ink3)' }}>
          <CountUp to={l.score} delay={Math.min(rank, 12) * 35 + 120} />
        </span>
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', color: 'var(--ink)', fontSize: 14, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.reasons[0]}</span>
        {l.reasons[1] && <span style={{ display: 'block', color: 'var(--ink3)', fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.reasons[1]}</span>}
      </span>
      <span style={{ textAlign: 'right' }}>
        <span className="mono" style={{ display: 'block', fontSize: 14, color: 'var(--ink)' }}>
          {l.kind === 'venue' ? 'In kind' : `£${(l.suggestedPriceGbp ?? 0).toLocaleString()}`}
        </span>
        <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink3)' }}>{l.suggestedTier}</span>
      </span>
      <span style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 5, fontSize: 13.5, color: 'var(--ink)' }}>
        {l.notionUrl ? (
          <span className="pop" style={{ animationDelay: `${rank * 40}ms`, display: 'inline-flex', gap: 5, alignItems: 'center', color: 'var(--go)' }}>
            <Icon name="check" size={15} /> Notion
          </span>
        ) : (
          <>
            Pitch <span className="chev">›</span>
          </>
        )}
      </span>
    </button>
  )
}

// Sends the pitch to an address a person types. Nothing goes out on its own.
function SendBox({ subject, body, onSent }: { subject: string; body: string; onSent?: (to: string) => void }) {
  const [to, setTo] = useState('')
  const [state, setState] = useState<{ kind: 'idle' | 'sending' | 'sent' | 'error'; note?: string }>({ kind: 'idle' })
  async function send() {
    setState({ kind: 'sending' })
    try {
      await post<{ id: string }>('/api/send', { to, subject, body })
      setState({ kind: 'sent', note: `Sent to ${to}` })
      onSent?.(to)
    } catch (e) {
      setState({ kind: 'error', note: e instanceof Error ? e.message : String(e) })
    }
  }
  return (
    <form
      onSubmit={e => {
        e.preventDefault()
        if (state.kind !== 'sending') send()
      }}
      style={{ marginTop: 10 }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center', background: 'var(--subtle)', borderRadius: 9, padding: 4, boxShadow: 'inset 0 1px 2px rgba(0,0,0,.05), inset 0 0 0 1px var(--divider)' }}>
        <span style={{ color: 'var(--ink3)', fontSize: 13.5, padding: '0 4px 0 8px' }}>To</span>
        <input
          type="email"
          required
          value={to}
          onChange={e => {
            setTo(e.target.value)
            if (state.kind !== 'sending') setState({ kind: 'idle' })
          }}
          placeholder="partnerships@company.com"
          style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', fontSize: 14, padding: '7px 0' }}
        />
        <button className={`btn btn-primary${state.kind === 'sending' ? ' pushing' : ''}`} type="submit" disabled={!to || state.kind === 'sending'} style={{ height: 32, padding: '0 12px', fontSize: 13.5, opacity: to ? 1 : 0.4 }}>
          <Icon name={state.kind === 'sent' ? 'check' : 'send'} size={15} />
          {state.kind === 'sending' ? 'Sending…' : state.kind === 'sent' ? 'Sent' : 'Send'}
        </button>
      </div>
      {state.note && (
        <div className={state.kind === 'sent' ? 'pop' : undefined} style={{ marginTop: 6, fontSize: 12.5, color: state.kind === 'sent' ? 'var(--go)' : 'var(--ink2)', display: 'flex', gap: 6, alignItems: 'center' }}>
          {state.kind === 'error' && <span style={{ width: 6, height: 6, borderRadius: 1.5, background: '#c62f35', flex: 'none' }} />}
          {state.note}
        </div>
      )}
    </form>
  )
}

function Drawer({ lead, event, onClose }: { lead: Lead; event: EventInput; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  // Keeps the chat composer clear of the drawer while it is open.
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--drawer-w', '470px')
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => { root.style.removeProperty('--drawer-w'); window.removeEventListener('keydown', onKey) }
  }, [onClose])
  return (
    <aside key={lead.sponsorId} style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 470, zIndex: 10, background: 'var(--bg)', boxShadow: 'var(--drawer), 0 0 0 1px var(--divider)', display: 'flex', flexDirection: 'column', animation: 'slide .35s var(--ease)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px' }}>
        <Mark domain={lead.domain} size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: 18, letterSpacing: '-0.01em' }}>{lead.name}</div>
          <a className="mono" href={`https://${lead.domain}`} target="_blank" rel="noreferrer" style={{ fontSize: 12, color: 'var(--ink3)', textDecoration: 'none' }}>
            {lead.domain}
          </a>
        </div>
        <button className="btn" onClick={onClose} aria-label="Close" style={{ padding: '0 9px' }}>
          <Icon name="close" />
        </button>
      </div>

      <div style={{ overflow: 'auto', padding: '4px 20px 20px', display: 'grid', gap: 26, alignContent: 'start' }}>
        <section>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span className="mono" style={{ fontSize: 44, fontWeight: 600, letterSpacing: '-0.04em', lineHeight: 1 }}>
              {lead.score}
            </span>
            <span style={{ color: 'var(--ink3)' }}>fit out of 100</span>
          </div>
          <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
            {lead.fit?.map(f => (
              <div key={f.label} style={{ display: 'grid', gridTemplateColumns: '96px 1fr 44px', alignItems: 'center', gap: 12 }}>
                <span style={{ fontSize: 13.5 }}>{f.label}</span>
                <span className="reveal" style={{ minWidth: 0, animationDelay: '150ms' }}>
                  <DitherBar value={(f.points / f.max) * 100} color={fitColor((f.points / f.max) * 100)} width={200} height={8} />
                  <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink3)', marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{f.note}</span>
                </span>
                <span className="mono" style={{ fontSize: 12.5, color: 'var(--ink2)', textAlign: 'right' }}>
                  {f.points}/{f.max}
                </span>
              </div>
            ))}
          </div>
        </section>

        {!!lead.pastBackings.length && (
          <section>
            <h3 style={H3}>Backed before</h3>
            {lead.pastBackings.map(b => (
              <a key={b.url + b.event} href={b.url} target="_blank" rel="noreferrer" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, textDecoration: 'none', padding: '9px 0', borderTop: '1px solid var(--divider)' }}>
                <span style={{ fontWeight: 500, fontSize: 14 }}>{b.event}</span>
                <span style={{ color: 'var(--ink3)', fontSize: 13, flex: 'none' }}>{b.role}</span>
              </a>
            ))}
          </section>
        )}

        {lead.pitch && (
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <h3 style={{ ...H3, margin: 0 }}>The email</h3>
              <button
                className="btn"
                style={{ height: 30, padding: '0 9px', fontSize: 13.5 }}
                onClick={() => {
                  navigator.clipboard.writeText(`${lead.pitch!.subject}\n\n${lead.pitch!.body}`)
                  setCopied(true)
                }}
              >
                <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div style={{ background: 'var(--subtle)', borderRadius: 'var(--r-card)', boxShadow: 'inset 0 0 0 1px var(--divider)', padding: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 10, fontSize: 14.5 }}>{lead.pitch.subject}</div>
              <div style={{ whiteSpace: 'pre-wrap', color: 'var(--ink2)', fontSize: 14.5, lineHeight: 1.55 }}>{lead.pitch.body}</div>
            </div>
            <SendBox subject={lead.pitch.subject} body={lead.pitch.body} onSent={to => track(event, [lead], 'sent', { to_email: to, subject: lead.pitch!.subject, body: lead.pitch!.body })} />
          </section>
        )}

        <section>
          <h3 style={H3}>Drafts</h3>
          <DraftsPanel event={event} lead={lead} />
        </section>

        <LeadMemory lead={lead} event={event} />
      </div>

      <div style={{ marginTop: 'auto', padding: '14px 20px', borderTop: '1px solid var(--divider)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={tierTag(lead.suggestedTier)}>{lead.suggestedTier}</span>
          <span className="mono" style={{ fontSize: 14 }}>
            {lead.kind === 'venue' ? 'Space, in kind' : `£${(lead.suggestedPriceGbp ?? 0).toLocaleString()}`}
          </span>
        </span>
        {lead.notionUrl ? (
          <a className="btn btn-primary" href={lead.notionUrl} target="_blank" rel="noreferrer" style={{ height: 34, fontSize: 14 }}>
            <Icon name="notion" size={16} /> Open in Notion
          </a>
        ) : (
          <span style={{ color: 'var(--ink3)', fontSize: 13 }}>Not in Notion yet</span>
        )}
      </div>
    </aside>
  )
}

const H3: React.CSSProperties = { fontSize: 14.5, fontWeight: 600, margin: '0 0 6px' }

// A quiet line of what Backer has on record, counted from data/london.json.
function HeroStats() {
  const stats = useMapStats()
  const item = (n: number | undefined, label: string) => (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span className="mono" style={{ color: 'var(--ink)', fontWeight: 500 }}>
        {n === undefined ? '\u2007\u2007\u2007' : n.toLocaleString('en-GB')}
      </span>{' '}
      {label}
    </span>
  )
  return (
    <p aria-live="polite" style={{ margin: 0, fontSize: 13.5, color: 'var(--ink3)', display: 'flex', gap: '6px 18px', flexWrap: 'wrap', opacity: stats ? undefined : 0.6, transition: 'opacity .3s' }}>
      {item(stats?.events, 'London tech events')}
      <span aria-hidden style={{ width: 1, alignSelf: 'stretch', background: 'var(--divider)' }} />
      {item(stats?.sponsors, 'sponsors on record')}
      <span aria-hidden style={{ width: 1, alignSelf: 'stretch', background: 'var(--divider)' }} />
      {item(stats?.backings, 'sourced backings')}
    </p>
  )
}
