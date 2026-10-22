'use client'

import { useState } from 'react'
import { DitherBar } from '@/components/DitherBar'
import { Icon, Mark } from '@/components/Mark'
import type { EventInput, Lead } from '@/lib/types'

const STEPS = ['Reading your event', 'Finding who backed similar London events', 'Ranking fit and writing reasons']

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) {
    const payload = await res.json().catch(() => ({})) as { error?: string }
    throw new Error(payload.error || `${path} failed: ${res.status}`)
  }
  return res.json()
}

function fitColor(score: number) {
  if (score >= 80) return 'var(--go)'
  if (score >= 60) return 'var(--reach)'
  return 'var(--ink3)'
}

function tierTag(tier?: Lead['suggestedTier']) {
  if (tier === 'Headline') return 'tag tag-iggy'
  if (tier === 'Partner') return 'tag tag-reach'
  if (tier === 'Venue') return 'tag tag-teal'
  return 'tag'
}

export default function Home() {
  const [input, setInput] = useState('')
  const [step, setStep] = useState(-1)
  const [ms, setMs] = useState(0)
  const [event, setEvent] = useState<EventInput | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [open, setOpen] = useState<Lead | null>(null)
  const [pushed, setPushed] = useState(false)
  const [pushing, setPushing] = useState(false)
  const [error, setError] = useState('')

  async function run() {
    if (!input.trim()) return
    const t0 = performance.now()
    setError('')
    setLeads([])
    setOpen(null)
    setPushed(false)
    try {
      setStep(0)
      const isUrl = /^https?:\/\//.test(input.trim())
      const ev = await post<EventInput>('/api/event', isUrl ? { url: input.trim() } : { text: input })
      setEvent(ev)
      setStep(1)
      const matched = await post<Lead[]>('/api/match', ev)
      setStep(2)
      const priced = await Promise.all(matched.map(l => post<Lead>('/api/pitch', { event: ev, lead: l })))
      setLeads(priced)
      setMs(performance.now() - t0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setStep(-1)
    }
  }

  async function push() {
    if (!event) return
    setError('')
    setPushing(true)
    try {
      setLeads(await post<Lead[]>('/api/push', { event, leads }))
      setPushed(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setPushing(false)
    }
  }

  const busy = step >= 0
  const total = leads.filter(l => l.kind === 'sponsor').reduce((s, l) => s + (l.suggestedPriceGbp ?? 0), 0)

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ height: 60, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 24px', background: 'var(--bg)', borderBottom: '1px solid var(--divider)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="star" size={24} />
          <strong style={{ fontSize: 17, letterSpacing: '-0.01em' }}>Backer</strong>
          <span style={{ color: 'var(--ink3)', fontSize: 14 }}>Find who will back your event</span>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          <a className="btn" href="https://github.com/jawadjalal/grokhack" target="_blank" rel="noreferrer">
            Open source
          </a>
          <button className="btn btn-primary" disabled={!leads.length || pushed || pushing} onClick={push} style={{ opacity: leads.length ? 1 : 0.4 }}>
            <Icon name="notion" />
            {pushed ? 'In Notion' : pushing ? 'Pushing…' : 'Push to Notion'}
          </button>
        </div>
      </header>

      <main style={{ width: '100%', maxWidth: 1080, margin: '0 auto', padding: leads.length ? '28px 24px 80px' : '14vh 24px 80px', transition: 'padding .5s var(--ease)' }}>
        {!leads.length && (
          <div className="rise" style={{ marginBottom: 28 }}>
            <h1 style={{ fontSize: 56, lineHeight: 1.02, letterSpacing: '-0.035em', margin: 0, fontWeight: 600 }}>
              Who will back
              <br />
              your event?
            </h1>
            <p style={{ fontSize: 18, color: 'var(--ink2)', margin: '16px 0 0', maxWidth: 560 }}>
              Paste your event. Backer finds the London sponsors and venues that backed events like it, ranks them, and writes the pitch.
            </p>
          </div>
        )}

        {/* Composer: one row to type in, a quiet bar below, one send button. */}
        <form
          onSubmit={e => {
            e.preventDefault()
            run()
          }}
          style={{ background: 'var(--card)', borderRadius: 'var(--r-panel)', boxShadow: 'var(--pop)', padding: '14px 14px 10px', outline: '1px solid var(--border)' }}
        >
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="Paste a Luma link, or describe your event"
            style={{ width: '100%', border: 0, outline: 0, fontSize: 18, padding: '6px 4px 14px', background: 'transparent' }}
          />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 6, color: 'var(--ink3)', fontSize: 13.5 }}>
              <span className="tag">
                <Icon name="globe" size={14} /> London
              </span>
              <span className="tag">
                <Icon name="building" size={14} /> Sponsors and venues
              </span>
              <span className="tag">
                <Icon name="approve" size={14} /> Nothing sends without you
              </span>
            </div>
            <button className="btn btn-primary" type="submit" disabled={busy} style={{ height: 40, padding: '0 16px' }}>
              <Icon name="send" />
              {busy ? 'Finding' : 'Find backers'}
            </button>
          </div>
        </form>

        {busy && (
          <ol style={{ listStyle: 'none', padding: 0, margin: '22px 4px 0', display: 'grid', gap: 10 }}>
            {STEPS.map((s, i) => (
              <li key={s} style={{ display: 'flex', gap: 10, alignItems: 'center', color: i <= step ? 'var(--ink)' : 'var(--ink3)', opacity: i <= step ? 1 : 0.5 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: i < step ? 'var(--go)' : i === step ? 'var(--iggy)' : 'var(--border-strong)', animation: i === step ? 'blink 1s infinite' : undefined }} />
                {s}
                {i === step ? '…' : ''}
              </li>
            ))}
          </ol>
        )}

        {error && <p style={{ color: '#c62f35', marginTop: 18 }}>{error}</p>}

        {!!leads.length && event && (
          <section className="rise" style={{ marginTop: 30 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 20, marginBottom: 14 }}>
              <div>
                <div style={{ color: 'var(--ink3)', fontSize: 13.5, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <Icon name="sparkle" size={16} /> ran 3 steps · {(ms / 1000).toFixed(1)}s
                </div>
                <h2 style={{ fontSize: 26, letterSpacing: '-0.02em', margin: '6px 0 0', fontWeight: 600 }}>
                  {leads.length} likely backers for {event.name}
                </h2>
              </div>
              <div style={{ textAlign: 'right', flex: 'none' }}>
                <div className="mono" style={{ fontSize: 30, fontWeight: 600, letterSpacing: '-0.02em' }}>
                  £{total.toLocaleString()}
                </div>
                <div style={{ color: 'var(--ink3)', fontSize: 13 }}>on the table if they all say yes</div>
              </div>
            </div>

            <div style={{ background: 'var(--card)', borderRadius: 'var(--r-card)', outline: '1px solid var(--border)', overflow: 'hidden' }}>
              <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '10px 18px', color: 'var(--ink3)', fontSize: 13, borderBottom: '1px solid var(--divider)' }}>
                <span>Backer</span>
                <span>Fit</span>
                <span>Why</span>
                <span>Ask</span>
                <span />
              </div>
              {leads.map((l, i) => (
                <button
                  key={l.sponsorId}
                  onClick={() => setOpen(l)}
                  className="rise"
                  style={{
                    animationDelay: `${i * 60}ms`,
                    display: 'grid',
                    gridTemplateColumns: COLS,
                    alignItems: 'center',
                    width: '100%',
                    textAlign: 'left',
                    padding: '14px 18px',
                    border: 0,
                    borderTop: i ? '1px solid var(--divider)' : 0,
                    background: open?.sponsorId === l.sponsorId ? 'var(--hover)' : 'transparent',
                  }}
                >
                  <span style={{ display: 'flex', gap: 10, alignItems: 'center', minWidth: 0 }}>
                    <Mark domain={l.domain} />
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 500 }}>{l.name}</span>
                      <span className="mono" style={{ display: 'block', fontSize: 12, color: 'var(--ink3)' }}>
                        {l.domain}
                      </span>
                    </span>
                  </span>
                  <span style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                    <span className="mono" style={{ fontSize: 20, fontWeight: 600, width: 30 }}>
                      {l.score}
                    </span>
                    <DitherBar value={l.score} color={fitColor(l.score)} />
                  </span>
                  <span style={{ color: 'var(--ink2)', fontSize: 14, paddingRight: 16 }}>{l.reasons[0]}</span>
                  <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span className={tierTag(l.suggestedTier)}>{l.suggestedTier}</span>
                    {!!l.suggestedPriceGbp && <span className="mono" style={{ fontSize: 14 }}>£{l.suggestedPriceGbp.toLocaleString()}</span>}
                  </span>
                  <span style={{ color: 'var(--ink3)', fontSize: 13.5, textAlign: 'right' }}>{l.notionUrl ? 'In Notion' : 'Pitch →'}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>

      {open && <Drawer lead={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

const COLS = 'minmax(180px,1.2fr) 160px minmax(200px,1.6fr) 170px 80px'

function Drawer({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  return (
    <aside
      key={lead.sponsorId}
      style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 480, background: 'var(--bg)', boxShadow: 'var(--drawer)', borderLeft: '1px solid var(--divider)', display: 'flex', flexDirection: 'column', animation: 'slide .35s var(--ease)' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 20px', borderBottom: '1px solid var(--divider)' }}>
        <Mark domain={lead.domain} size={32} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 17 }}>{lead.name}</div>
          <div className="mono" style={{ fontSize: 12, color: 'var(--ink3)' }}>
            {lead.domain}
          </div>
        </div>
        <button className="btn" onClick={onClose} aria-label="Close" style={{ padding: '0 10px' }}>
          <Icon name="close" />
        </button>
      </div>

      <div style={{ overflow: 'auto', padding: 20, display: 'grid', gap: 26 }}>
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span className="mono" style={{ fontSize: 34, fontWeight: 600, letterSpacing: '-0.02em' }}>
              {lead.score}
            </span>
            <DitherBar value={lead.score} color={fitColor(lead.score)} width={180} height={14} />
          </div>
          <ul style={{ margin: '10px 0 0', paddingLeft: 18, color: 'var(--ink2)' }}>
            {lead.reasons.map(r => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </section>

        {!!lead.pastBackings.length && (
          <section>
            <h3 style={H3}>Backed before</h3>
            {lead.pastBackings.map(b => (
              <a key={b.url + b.event} href={b.url} target="_blank" rel="noreferrer" style={{ display: 'block', textDecoration: 'none', padding: '8px 0', borderTop: '1px solid var(--divider)' }}>
                <div style={{ fontWeight: 500 }}>{b.event}</div>
                <div style={{ color: 'var(--ink3)', fontSize: 13.5 }}>{b.role}</div>
              </a>
            ))}
          </section>
        )}

        {lead.pitch && (
          <section>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <h3 style={H3}>The pitch</h3>
              <button
                className="btn"
                style={{ height: 30, padding: '0 10px', fontSize: 13.5 }}
                onClick={() => {
                  navigator.clipboard.writeText(`${lead.pitch!.subject}\n\n${lead.pitch!.body}`)
                  setCopied(true)
                }}
              >
                <Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <div style={{ background: 'var(--subtle)', borderRadius: 'var(--r-card)', outline: '1px solid var(--divider)', padding: 16 }}>
              <div style={{ fontWeight: 600, marginBottom: 10 }}>{lead.pitch.subject}</div>
              <div style={{ whiteSpace: 'pre-wrap', color: 'var(--ink2)' }}>{lead.pitch.body}</div>
            </div>
          </section>
        )}
      </div>

      <div style={{ marginTop: 'auto', padding: '14px 20px', borderTop: '1px solid var(--divider)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span className={tierTag(lead.suggestedTier)}>{lead.suggestedTier}</span>
          {!!lead.suggestedPriceGbp && <span className="mono">£{lead.suggestedPriceGbp.toLocaleString()}</span>}
        </span>
        {lead.notionUrl ? (
          <a className="btn btn-primary" href={lead.notionUrl} target="_blank" rel="noreferrer">
            <Icon name="notion" /> Open in Notion
          </a>
        ) : (
          <span style={{ color: 'var(--ink3)', fontSize: 13.5 }}>Push to Notion to start the pipeline</span>
        )}
      </div>
    </aside>
  )
}

const H3: React.CSSProperties = { fontSize: 15, fontWeight: 600, margin: '0 0 8px' }
