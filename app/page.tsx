'use client'

import { useMemo, useState } from 'react'
import { DitherBar } from '@/components/DitherBar'
import { Icon, Mark } from '@/components/Mark'
import type { EventInput, Lead } from '@/lib/types'

const STEPS = ['Reading your event', 'Checking who backed London events like it', 'Scoring fit and pricing each ask']
const PUSH_LIMIT = 15

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `${path} failed: ${res.status}`)
  return data
}

function fitColor(score: number) {
  if (score >= 75) return 'var(--go)'
  if (score >= 55) return 'var(--reach)'
  return 'var(--ink3)'
}

function tierTag(tier?: Lead['suggestedTier']) {
  if (tier === 'Headline') return 'tag tag-iggy'
  if (tier === 'Partner') return 'tag tag-reach'
  if (tier === 'Venue') return 'tag tag-teal'
  return 'tag'
}

type Filter = 'all' | 'sponsor' | 'venue'

export default function Home() {
  const [input, setInput] = useState('')
  const [step, setStep] = useState(-1)
  const [ms, setMs] = useState(0)
  const [event, setEvent] = useState<EventInput | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<Lead | null>(null)
  const [pushing, setPushing] = useState(false)
  const [error, setError] = useState('')

  async function run() {
    if (!input.trim() || step >= 0) return
    const t0 = performance.now()
    setError('')
    setOpen(null)
    try {
      setStep(0)
      const isUrl = /^https?:\/\//.test(input.trim())
      const ev = await post<EventInput>('/api/event', isUrl ? { url: input.trim() } : { text: input })
      setStep(1)
      const matched = await post<Lead[]>('/api/match', ev)
      setStep(2)
      const priced = await Promise.all(matched.map(l => post<Lead>('/api/pitch', { event: ev, lead: l })))
      setEvent(ev)
      setLeads(priced)
      setFilter('all')
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
    try {
      const done = await post<Lead[]>('/api/push', { event, leads: top })
      const byId = new Map(done.map(l => [l.sponsorId, l]))
      setLeads(ls => ls.map(l => byId.get(l.sponsorId) ?? l))
      setOpen(o => (o ? (byId.get(o.sponsorId) ?? o) : o))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPushing(false)
    }
  }

  const busy = step >= 0
  const strong = shown.filter(l => l.score >= 75)
  const total = strong.filter(l => l.kind === 'sponsor').reduce((s, l) => s + (l.suggestedPriceGbp ?? 0), 0)
  const allPushed = top.length > 0 && top.every(l => l.notionUrl)

  return (
    <div style={{ minHeight: '100vh' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 5, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', background: 'color-mix(in srgb, var(--canvas) 86%, transparent)', backdropFilter: 'blur(10px)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <Icon name="star" size={22} />
          <strong style={{ fontSize: 16.5, letterSpacing: '-0.01em' }}>Backer</strong>
        </div>
        <a className="btn" href="https://github.com/jawadjalal/grokhack" target="_blank" rel="noreferrer" style={{ fontSize: 14 }}>
          <Icon name="star" size={16} /> Open source, MIT
        </a>
      </header>

      <main style={{ width: '100%', maxWidth: 1120, margin: '0 auto', padding: '0 24px 220px' }}>
        {!leads.length && (
          <section className="rise" style={{ paddingTop: '12vh' }}>
            <h1 style={{ fontSize: 'clamp(44px, 6vw, 72px)', lineHeight: 0.98, letterSpacing: '-0.045em', margin: 0, fontWeight: 600 }}>
              Who will back
              <br />
              your event?
            </h1>
            <p style={{ fontSize: 19, color: 'var(--ink2)', margin: '20px 0 0', maxWidth: 520, lineHeight: 1.5 }}>
              Backer knows who paid for London&apos;s tech events. Paste yours and get the sponsors and venues most likely to say yes, what to ask for, and the email.
            </p>
            {busy && <Steps step={step} />}
            {error && <p style={{ color: 'var(--danger, #c62f35)', marginTop: 18 }}>{error}</p>}
          </section>
        )}

        {!!leads.length && event && (
          <section className="rise" style={{ paddingTop: 24 }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ color: 'var(--ink3)', fontSize: 13.5, display: 'flex', gap: 7, alignItems: 'center' }}>
                  <Icon name="sparkle" size={15} /> Ranked {leads.length} backers · {(ms / 1000).toFixed(1)}s
                </div>
                <h2 style={{ fontSize: 30, lineHeight: 1.1, letterSpacing: '-0.03em', margin: '8px 0 0', fontWeight: 600, maxWidth: 680 }}>{event.name}</h2>
              </div>
              <div style={{ textAlign: 'right', flex: 'none' }}>
                <div className="mono" style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1 }}>
                  £{total.toLocaleString()}
                </div>
                <div style={{ color: 'var(--ink3)', fontSize: 13, marginTop: 6 }}>
                  from the {strong.filter(l => l.kind === 'sponsor').length} strongest fits
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 22, marginBottom: 10 }}>
              <div style={{ display: 'flex', gap: 2 }}>
                {(
                  [
                    ['all', 'All', leads.length],
                    ['sponsor', 'Sponsors', leads.filter(l => l.kind === 'sponsor').length],
                    ['venue', 'Venues', leads.filter(l => l.kind === 'venue').length],
                  ] as const
                ).map(([key, label, n]) => (
                  <button key={key} className="btn" onClick={() => setFilter(key)} style={{ height: 32, padding: '0 11px', fontSize: 14, color: filter === key ? 'var(--ink)' : 'var(--ink3)', background: filter === key ? 'var(--bg)' : 'transparent', boxShadow: filter === key ? 'var(--shadow), 0 0 0 1px var(--border)' : 'none' }}>
                    {label}
                    <span className="mono" style={{ fontSize: 12, color: 'var(--ink3)' }}>
                      {n}
                    </span>
                  </button>
                ))}
              </div>
              <button className="btn btn-primary" onClick={push} disabled={pushing || allPushed} style={{ height: 34, fontSize: 14 }}>
                <Icon name="notion" size={16} />
                {allPushed ? `Top ${top.length} in Notion` : pushing ? 'Pushing…' : `Push top ${top.length} to Notion`}
              </button>
            </div>
            {error && <p style={{ color: 'var(--danger, #c62f35)', margin: '0 0 10px', fontSize: 14 }}>{error}</p>}

            <div style={{ background: 'var(--card)', borderRadius: 'var(--r-panel)', boxShadow: 'var(--shadow), 0 0 0 1px var(--border)', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '11px 20px', color: 'var(--ink3)', fontSize: 13, background: 'var(--subtle)', borderBottom: '1px solid var(--divider)' }}>
                <span className="mono">#</span>
                <span>Backer</span>
                <span>Fit</span>
                <span>Why they&apos;d say yes</span>
                <span>The ask</span>
                <span />
              </div>
              {shown.map((l, i) => (
                <Row key={l.sponsorId} lead={l} rank={i + 1} active={open?.sponsorId === l.sponsorId} onOpen={() => setOpen(l)} />
              ))}
            </div>
          </section>
        )}
        {busy && !!leads.length && <Steps step={step} />}
      </main>

      <Composer value={input} onChange={setInput} onRun={run} busy={busy} compact={!!leads.length} />
      {open && event && <Drawer lead={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

const COLS = '28px minmax(190px, 1.15fr) 168px minmax(220px, 1.6fr) 150px 20px'

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
      <span style={{ display: 'flex', gap: 11, alignItems: 'center', minWidth: 0 }}>
        <Mark domain={l.domain} size={26} />
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontWeight: 550 }}>
            {l.name}
            {l.pastBackings.length > 0 && (
              <span title="Has backed London events" style={{ width: 6, height: 6, borderRadius: 1.5, background: 'var(--go)' }} />
            )}
          </span>
          <span className="mono" style={{ display: 'block', fontSize: 12, color: 'var(--ink3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {l.domain}
          </span>
        </span>
      </span>
      <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <span className="mono" style={{ fontSize: 19, fontWeight: 600, width: 26, color: l.score >= 55 ? 'var(--ink)' : 'var(--ink3)' }}>
          {l.score}
        </span>
        <DitherBar value={l.score} color={fitColor(l.score)} width={104} height={10} />
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: 'block', color: 'var(--ink)', fontSize: 14 }}>{l.reasons[0]}</span>
        {l.reasons[1] && <span style={{ display: 'block', color: 'var(--ink3)', fontSize: 13 }}>{l.reasons[1]}</span>}
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 3 }}>
        <span className={tierTag(l.suggestedTier)}>{l.suggestedTier}</span>
        <span className="mono" style={{ fontSize: 13, color: 'var(--ink2)' }}>
          {l.kind === 'venue' ? 'Space, in kind' : `£${(l.suggestedPriceGbp ?? 0).toLocaleString()}`}
        </span>
      </span>
      <span style={{ color: 'var(--ink3)', display: 'flex', justifyContent: 'flex-end' }}>{l.notionUrl ? <Icon name="check" size={16} /> : '›'}</span>
    </button>
  )
}

function Steps({ step }: { step: number }) {
  return (
    <ol style={{ listStyle: 'none', padding: 0, margin: '28px 0 0', display: 'grid', gap: 10 }}>
      {STEPS.map((s, i) => (
        <li key={s} style={{ display: 'flex', gap: 10, alignItems: 'center', color: i <= step ? 'var(--ink)' : 'var(--ink3)', opacity: i <= step ? 1 : 0.45, fontSize: 15 }}>
          <span style={{ width: 8, height: 8, borderRadius: 2, background: i < step ? 'var(--go)' : i === step ? 'var(--iggy)' : 'var(--border-strong)', animation: i === step ? 'blink 1s infinite' : undefined }} />
          {s}
          {i === step ? '…' : ''}
        </li>
      ))}
    </ol>
  )
}

// Hand-drawn arrow for the annotations around the composer.
function Squiggle({ flip }: { flip?: boolean }) {
  return (
    <svg width="46" height="34" viewBox="0 0 46 34" fill="none" style={{ transform: flip ? 'scaleX(-1)' : undefined, flex: 'none' }}>
      <path d="M3 4c9 1 22 4 28 12 3 4 4 8 4 13" stroke="var(--ink3)" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M30 24l5 6 4-7" stroke="var(--ink3)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function Composer({ value, onChange, onRun, busy, compact }: { value: string; onChange: (v: string) => void; onRun: () => void; busy: boolean; compact: boolean }) {
  return (
    <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: '28px 24px 22px', background: 'linear-gradient(to top, var(--canvas) 62%, transparent)', zIndex: 4, pointerEvents: 'none' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', position: 'relative', pointerEvents: 'auto' }}>
        {!compact && (
          <div className="rise" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', padding: '0 18px 4px', color: 'var(--ink3)', fontSize: 13.5, animationDelay: '250ms' }}>
            <span style={{ display: 'flex', alignItems: 'flex-end', gap: 4 }}>
              <span style={{ paddingBottom: 18 }}>a Luma link works best</span>
              <Squiggle />
            </span>
            <span style={{ display: 'flex', alignItems: 'flex-end', gap: 4 }}>
              <Squiggle flip />
              <span style={{ paddingBottom: 18 }}>nothing is sent until you say so</span>
            </span>
          </div>
        )}
        <form
          onSubmit={e => {
            e.preventDefault()
            onRun()
          }}
          style={{ background: 'var(--bg)', borderRadius: 16, padding: 6, boxShadow: 'var(--pop), 0 0 0 1px var(--border)' }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--subtle)', borderRadius: 11, padding: '6px 6px 6px 16px', boxShadow: 'inset 0 1px 2px rgba(0,0,0,.06), inset 0 0 0 1px var(--divider)' }}>
            <Icon name="search" size={18} />
            <input
              value={value}
              onChange={e => onChange(e.target.value)}
              placeholder="Paste your event link, or describe it"
              autoFocus
              style={{ flex: 1, minWidth: 0, border: 0, outline: 0, fontSize: 16.5, padding: '10px 0', background: 'transparent' }}
            />
            <button className="btn btn-primary" type="submit" disabled={busy || !value.trim()} style={{ height: 40, padding: '0 16px', opacity: value.trim() ? 1 : 0.35 }}>
              <Icon name="send" />
              {busy ? 'Finding' : 'Find backers'}
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '7px 10px 3px', color: 'var(--ink3)', fontSize: 12.5 }}>
            <span style={{ display: 'flex', gap: 14 }}>
              <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <Icon name="globe" size={14} /> London
              </span>
              <span style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                <Icon name="building" size={14} /> Sponsors and venues
              </span>
            </span>
            <span>
              <span className="mono" style={{ padding: '1px 5px', borderRadius: 4, background: 'var(--chip)' }}>
                ↵
              </span>{' '}
              to run
            </span>
          </div>
        </form>
      </div>
    </div>
  )
}

function Drawer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
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
                <span style={{ minWidth: 0 }}>
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
          </section>
        )}
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
