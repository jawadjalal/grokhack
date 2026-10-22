'use client'

import { useCallback, useEffect, useState } from 'react'
import type { EventInput, Lead } from '@/lib/types'

export type ClientTouch = { id?: string; sponsor_name?: string | null; created_at?: string; kind: string; sponsor_id?: string | null; note?: string | null; to_email?: string | null; event_name?: string }

// Fire and forget: logging a touch must never get in the way.
export function track(event: EventInput, leads: Lead[], kind: string, extra?: { to_email?: string; subject?: string; body?: string; note?: string }) {
  const touches = leads.map(l => ({ event_name: event.name, event_url: event.url ?? null, sponsor_id: l.sponsorId, sponsor_name: l.name, kind, ...extra }))
  fetch('/api/memory/touch', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ touches }) })
    .then(() => window.dispatchEvent(new Event('backer:touch')))
    .catch(() => {})
}

export function ago(iso?: string | null) {
  if (!iso) return 'now'
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export const VERB: Record<string, string> = { pushed: 'Added to Notion', sent: 'Emailed', opened: 'Opened the email', replied: 'Replied', call: 'Call', signed: 'Signed', note: 'Note' }

// The lead's history in the drawer, plus a quiet way to log a reply.
export function LeadMemory({ lead, event }: { lead: Lead; event: EventInput }) {
  const [rows, setRows] = useState<ClientTouch[]>([])
  const [replying, setReplying] = useState(false)
  const [text, setText] = useState('')
  const load = useCallback(() => {
    fetch('/api/memory', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => setRows(((d.touches ?? []) as ClientTouch[]).filter(t => (t.sponsor_id === lead.sponsorId || t.sponsor_name === lead.name) &&t.event_name === event.name)))
      .catch(() => {})
  }, [lead.sponsorId, event.name])
  useEffect(() => {
    load()
    window.addEventListener('backer:touch', load)
    const t = setInterval(load, 8000)
    return () => {
      window.removeEventListener('backer:touch', load)
      clearInterval(t)
    }
  }, [load])
  function save() {
    if (!text.trim()) return
    track(event, [lead], 'replied', { note: text.trim() })
    setText('')
    setReplying(false)
    setTimeout(load, 900)
  }
  return (
    <section>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <h3 style={{ fontSize: 14.5, fontWeight: 600, margin: 0 }}>Memory</h3>
        {!replying && (
          <button className="btn" style={{ height: 30, padding: '0 9px', fontSize: 13.5 }} onClick={() => setReplying(true)}>
            Log a reply
          </button>
        )}
      </div>
      {replying && (
        <div style={{ marginBottom: 10 }}>
          <textarea
            autoFocus
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="What did they say?"
            rows={3}
            style={{ width: '100%', resize: 'vertical', border: 0, outline: 0, background: 'var(--subtle)', borderRadius: 9, padding: 10, fontSize: 14, boxShadow: 'inset 0 0 0 1px var(--divider)' }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 4, marginTop: 6 }}>
            <button className="btn" style={{ height: 30, fontSize: 13.5 }} onClick={() => setReplying(false)}>
              Cancel
            </button>
            <button className="btn btn-primary" style={{ height: 30, fontSize: 13.5, opacity: text.trim() ? 1 : 0.4 }} disabled={!text.trim()} onClick={save}>
              Save reply
            </button>
          </div>
        </div>
      )}
      {rows.length ? (
        rows.map((t, i) => (
          <div key={t.id ?? i} style={{ display: 'flex', gap: 10, alignItems: 'baseline', padding: '8px 0', borderTop: '1px solid var(--divider)', fontSize: 14 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, flex: 'none', background: t.kind === 'replied' || t.kind === 'signed' ? 'var(--go)' : 'var(--ink)', transform: 'translateY(-1px)' }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              {VERB[t.kind] ?? t.kind}
              {t.note && <span style={{ color: 'var(--ink3)' }}>{`: ${t.note}`}</span>}
            </span>
            <span style={{ color: 'var(--ink3)', fontSize: 12.5, flex: 'none' }}>{ago(t.created_at)}</span>
          </div>
        ))
      ) : (
        <div style={{ color: 'var(--ink3)', fontSize: 13.5 }}>Nothing yet. Sends and replies show up here.</div>
      )}
    </section>
  )
}
