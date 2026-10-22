'use client'

import { useEffect, useState } from 'react'
import type { EventInput, Lead } from '@/lib/types'
import type { DraftSet } from '@/lib/drafts'
import { Icon } from './Mark'

export const DRAFT_CSS = `
@keyframes bk-rise { from { opacity: 0; transform: translateY(8px) } to { opacity: 1; transform: none } }
@keyframes bk-fade { from { opacity: 0 } to { opacity: 1 } }
@keyframes bk-shimmer { from { background-position: -320px 0 } to { background-position: 320px 0 } }
.bk-rise { animation: bk-rise .38s cubic-bezier(.2,.8,.2,1) both }
.bk-tab { height: 30px; padding: 0 10px; border: 0; background: transparent; color: var(--ink3); border-radius: var(--r-button); font-size: 13.5px; transition: color .2s cubic-bezier(.2,.8,.2,1), background .2s cubic-bezier(.2,.8,.2,1) }
.bk-tab:hover { color: var(--ink); background: var(--hover) }
.bk-tab[aria-selected="true"] { color: var(--ink); }
.bk-ghost { display: inline-flex; align-items: center; gap: 6px; height: 30px; padding: 0 10px; border: 0; background: transparent; color: var(--ink2); border-radius: var(--r-button); font-size: 13.5px; text-decoration: none; transition: background .15s, color .15s, transform .15s }
.bk-ghost:hover { background: var(--hover); color: var(--ink) }
.bk-ghost:active { transform: translateY(1px) }
.bk-skel { height: 12px; border-radius: 4px; background: linear-gradient(90deg, var(--chip) 0, var(--hover) 40%, var(--chip) 80%); background-size: 640px 100%; animation: bk-shimmer 1.3s linear infinite }
@media (prefers-reduced-motion: reduce) { .bk-rise, .bk-skel { animation: none } }
`

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false)
  return (
    <button
      className="bk-ghost"
      onClick={() => {
        navigator.clipboard?.writeText(text).catch(() => {})
        setDone(true)
        setTimeout(() => setDone(false), 1400)
      }}
    >
      <Icon name={done ? 'check' : 'copy'} size={15} />
      <span style={{ display: 'inline-block', minWidth: 44, textAlign: 'left' }}>{done ? 'Copied' : label}</span>
    </button>
  )
}

// Tabs per channel with a sliding underline and the active draft below.
export function DraftTabs({ set, compact }: { set: DraftSet; compact?: boolean }) {
  const [i, setI] = useState(0)
  const d = set.drafts[Math.min(i, set.drafts.length - 1)]
  if (!d) return null
  const full = d.subject ? `${d.subject}\n\n${d.body}` : d.body
  return (
    <div>
      <div role="tablist" style={{ position: 'relative', display: 'flex', gap: 2, borderBottom: '1px solid var(--divider)', paddingBottom: 6, overflowX: 'auto' }}>
        {set.drafts.map((x, k) => (
          <button key={x.channel + k} role="tab" aria-selected={k === i} className="bk-tab" onClick={() => setI(k)}>
            {x.label}
            <span style={{ display: 'block', height: 2, marginTop: 4, marginBottom: -8, background: 'var(--ink)', transform: `scaleX(${k === i ? 1 : 0})`, transition: 'transform .3s cubic-bezier(.2,.8,.2,1)' }} />
          </button>
        ))}
      </div>
      <div key={d.channel + i} className="bk-rise" style={{ padding: compact ? '12px 2px 4px' : '14px 2px 4px' }}>
        {d.subject && <div style={{ fontWeight: 560, fontSize: 14.5, marginBottom: 8 }}>{d.subject}</div>}
        <div style={{ whiteSpace: 'pre-wrap', fontSize: 14, lineHeight: 1.55, color: 'var(--ink2)', maxHeight: compact ? 220 : 320, overflowY: 'auto' }}>{d.body}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 10 }}>
          <CopyButton text={full} />
          <span style={{ fontSize: 12.5, color: 'var(--ink3)' }}>
            <span className="mono">{d.body.length}</span> characters
          </span>
          <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--ink3)', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <Icon name="sparkle" size={13} /> {set.source === 'grok' ? 'Written by Grok' : 'From template'}
          </span>
        </div>
        {set.citations.length > 0 && (
          <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--divider)', fontSize: 12.5, color: 'var(--ink3)', display: 'flex', flexWrap: 'wrap', gap: 10 }}>
            Cites
            {set.citations.map(c => (
              <a key={c.url + c.event} href={c.url} target="_blank" rel="noreferrer" style={{ color: 'var(--ink2)', textDecoration: 'none', borderBottom: '1px solid var(--border)' }}>
                {c.event}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function Skeleton() {
  return (
    <div style={{ display: 'grid', gap: 10, padding: '14px 2px' }}>
      {[92, 100, 76, 88, 54].map((w, k) => <div key={k} className="bk-skel" style={{ width: `${w}%`, animationDelay: `${k * 80}ms` }} />)}
    </div>
  )
}

// Lead drawer section: outreach on every channel, plus launch posts for the event.
export default function DraftsPanel({ event, lead }: { event: EventInput; lead: Lead }) {
  const [view, setView] = useState<'outreach' | 'social'>('outreach')
  const [sets, setSets] = useState<{ outreach?: DraftSet; social?: DraftSet }>({})
  const [failed, setFailed] = useState(false)

  const key = `${event.name}|${event.date ?? ''}|${lead.sponsorId}`
  useEffect(() => {
    let live = true
    setSets({})
    setFailed(false)
    const get = (kind: 'outreach' | 'social') =>
      fetch('/api/drafts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind, event, lead }) })
        .then(r => (r.ok ? r.json() : null))
        .then((s: DraftSet | null) => {
          if (!live) return
          if (s?.drafts) setSets(prev => ({ ...prev, [kind]: s }))
          else if (kind === 'outreach') setFailed(true)
        })
        .catch(() => live && kind === 'outreach' && setFailed(true))
    get('outreach')
    get('social')
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const set = sets[view]
  return (
    <section style={{ paddingTop: 16 }}>
      <style>{DRAFT_CSS}</style>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 8 }}>
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Drafts</h3>
        {(['outreach', 'social'] as const).map(v => (
          <button key={v} className="bk-ghost" style={{ height: 26, padding: '0 6px', color: view === v ? 'var(--ink)' : 'var(--ink3)', fontWeight: view === v ? 560 : 400 }} onClick={() => setView(v)}>
            {v === 'outreach' ? `To ${lead.name}` : 'Launch posts'}
          </button>
        ))}
      </div>
      {set ? <DraftTabs key={view} set={set} /> : failed && view === 'outreach' ? (
        <p style={{ color: 'var(--ink3)', fontSize: 14 }}>Drafts are taking a moment. Try reopening this lead.</p>
      ) : <Skeleton />}
    </section>
  )
}
