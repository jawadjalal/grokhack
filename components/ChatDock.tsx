'use client'

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react'
import type { EventInput, Lead } from '@/lib/types'
import type { ChatReply } from '@/app/api/chat/route'
import { DRAFT_CSS, DraftTabs, CopyButton } from './DraftsPanel'
import { DitherBar } from './DitherBar'
import { Icon, Mark } from './Mark'

type Msg = { id: string; role: 'user' | 'assistant'; content: string; data?: Omit<ChatReply, 'reply'> }
type Ctx = { event?: EventInput; leads?: Lead[]; location?: string }

const STORE = 'backer.chat.v1'
const EASE = 'cubic-bezier(.2,.8,.2,1)'
const SPRING = 'cubic-bezier(.34,1.32,.5,1)'

function suggestions(ctx?: Ctx): string[] {
  const ev = ctx?.event?.name
  const top = ctx?.leads?.[0]?.name
  const out = [
    ev ? `Find backers for ${ev}` : 'Find backers for my AI hackathon on 14 Nov',
    ev ? `Draft a LinkedIn post for ${ev}` : 'Draft a LinkedIn post for tonight',
    'Create a Luma event for an 80-person agents meetup',
  ]
  if (top && ev) out.splice(1, 0, `Draft outreach to ${top}`)
  return out.slice(0, 4)
}

// Bold, inline code and simple lists. Enough for Grok's replies.
function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? <strong key={i} style={{ fontWeight: 600, color: 'var(--ink)' }}>{part.slice(2, -2)}</strong>
      : part.startsWith('`') && part.endsWith('`') ? <code key={i} className="mono" style={{ fontSize: 13, background: 'var(--chip)', padding: '1px 4px', borderRadius: 4 }}>{part.slice(1, -1)}</code>
        : <Fragment key={i}>{part}</Fragment>,
  )
}

function Rich({ text }: { text: string }) {
  const blocks: ReactNode[] = []
  let list: { ordered: boolean; items: string[] } | null = null
  const flush = () => {
    if (!list) return
    const L = list.ordered ? 'ol' : 'ul'
    blocks.push(<L key={blocks.length} style={{ margin: '4px 0', paddingLeft: 20, display: 'grid', gap: 3 }}>{list.items.map((it, i) => <li key={i}>{inline(it)}</li>)}</L>)
    list = null
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/)
    if (m) {
      const ordered = !!m[2]
      if (!list || list.ordered !== ordered) { flush(); list = { ordered, items: [] } }
      list.items.push(m[3])
    } else {
      flush()
      if (line.trim()) blocks.push(<p key={blocks.length} style={{ margin: '0 0 6px' }}>{inline(line.replace(/^#+\s*/, ''))}</p>)
    }
  }
  flush()
  return <>{blocks}</>
}

function Typing() {
  return (
    <div className="bk-rise" style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'var(--ink3)', fontSize: 13.5 }}>
      <span style={{ display: 'inline-flex', gap: 4 }}>
        {[0, 1, 2].map(i => <span key={i} className="bk-dot" style={{ width: 6, height: 6, borderRadius: 2, background: 'var(--ink3)', animationDelay: `${i * 140}ms` }} />)}
      </span>
      Thinking with Grok
    </div>
  )
}

function Leads({ data, onOpen }: { data: NonNullable<ChatReply['leads']>; onOpen?: () => void }) {
  return (
    <div style={{ marginTop: 6 }}>
      {data.map((l, i) => (
        <div key={l.domain + i} className="bk-rise" style={{ animationDelay: `${80 + i * 45}ms`, display: 'grid', gridTemplateColumns: '22px 1fr auto', gap: 12, alignItems: 'center', padding: '9px 0', borderTop: i ? '1px solid var(--divider)' : 0 }}>
          <Mark domain={l.domain} size={22} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, fontWeight: 540, display: 'flex', gap: 8, alignItems: 'baseline' }}>
              {l.name}
              <span className="mono" style={{ fontSize: 12, color: 'var(--ink3)', fontWeight: 400 }}>{l.domain}</span>
            </div>
            {l.reason && <div style={{ fontSize: 13, color: 'var(--ink3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.reason}</div>}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <DitherBar value={l.score} width={64} height={10} />
            <span className="mono" style={{ fontSize: 12.5, color: 'var(--ink2)', width: 22, textAlign: 'right' }}>{l.score}</span>
          </div>
        </div>
      ))}
      {onOpen && (
        <button className="bk-ghost" style={{ marginTop: 6, marginLeft: -10 }} onClick={onOpen}>
          <Icon name="chart" size={15} /> Rank every backer
        </button>
      )}
    </div>
  )
}

function Luma({ set }: { set: NonNullable<ChatReply['drafts']> }) {
  const l = set.luma!
  const fmt = (s: string) => {
    const d = new Date(s)
    return isNaN(+d) ? s : d.toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  }
  const rows: [string, ReactNode][] = [
    ['Starts', <span key="s" className="mono">{fmt(l.start)}</span>],
    ['Ends', <span key="e" className="mono">{fmt(l.end)}</span>],
    ['Where', l.location],
    ['Capacity', <span key="c" className="mono">{l.capacity}</span>],
  ]
  if (l.tags.length) rows.push(['Tags', l.tags.join(', ')])
  return (
    <div className="bk-rise" style={{ marginTop: 8, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', background: 'var(--card)' }}>
      <div style={{ padding: '14px 16px 10px' }}>
        <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: '-0.01em' }}>{l.name}</div>
      </div>
      {rows.map(([k, v], i) => (
        <div key={k} className="bk-rise" style={{ animationDelay: `${120 + i * 50}ms`, display: 'grid', gridTemplateColumns: '92px 1fr', padding: '7px 16px', borderTop: '1px solid var(--divider)', fontSize: 13.5 }}>
          <span style={{ color: 'var(--ink3)' }}>{k}</span><span>{v}</span>
        </div>
      ))}
      <div style={{ padding: '10px 16px', borderTop: '1px solid var(--divider)', fontSize: 13.5, color: 'var(--ink2)', whiteSpace: 'pre-wrap', maxHeight: 180, overflowY: 'auto' }}>{l.description}</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderTop: '1px solid var(--divider)', background: 'var(--subtle)' }}>
        <a className="btn btn-primary" href={l.createUrl} target="_blank" rel="noreferrer" style={{ height: 32 }}>
          <Icon name="arrow" size={15} /> Open Luma
        </a>
        <CopyButton text={set.drafts[0]?.body ?? l.description} label="Copy details" />
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink3)' }}>Luma&apos;s API needs Luma Plus</span>
      </div>
    </div>
  )
}

export default function ChatDock({ context, onFindBackers, intercept, prefill }: { context?: Ctx; onFindBackers?(input: string): void; intercept?(text: string): boolean; prefill?: string }) {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [focus, setFocus] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)
  const field = useRef<HTMLTextAreaElement>(null)
  const loaded = useRef(false)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE) ?? '[]')
      if (Array.isArray(saved)) setMsgs(saved.slice(-40))
    } catch { /* storage blocked */ }
    loaded.current = true
  }, [])

  useEffect(() => {
    if (!loaded.current) return
    try { localStorage.setItem(STORE, JSON.stringify(msgs.slice(-40))) } catch { /* ignore */ }
  }, [msgs])

  useEffect(() => {
    const el = scroller.current
    if (el) requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }))
  }, [msgs, busy, open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); field.current?.focus() }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // A prompt handed in from elsewhere (e.g. the CRM's Draft outreach) is sent once.
  const sentPrefill = useRef('')
  useEffect(() => {
    if (!prefill || sentPrefill.current === prefill) return
    sentPrefill.current = prefill
    const t = setTimeout(() => send(prefill), 350)
    return () => clearTimeout(t)
  }, [prefill]) // eslint-disable-line react-hooks/exhaustive-deps

  async function send(text: string) {
    const content = text.trim()
    if (!content || busy) return
    if (intercept?.(content)) {
      setInput('')
      setOpen(false)
      field.current?.blur()
      return
    }
    const user: Msg = { id: crypto.randomUUID?.() ?? String(Date.now()), role: 'user', content }
    const next = [...msgs, user]
    setMsgs(next)
    setInput('')
    setOpen(true)
    setBusy(true)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          messages: next.slice(-10).map(m => ({ role: m.role, content: m.content })),
          context: context ? { event: context.event, leads: context.leads?.slice(0, 15), location: context.location } : undefined,
        }),
      })
      const data = (await res.json()) as ChatReply
      const { reply, ...rest } = data
      setMsgs(m => [...m, { id: `${user.id}-a`, role: 'assistant', content: reply || 'Done.', data: rest }])
    } catch {
      setMsgs(m => [...m, { id: `${user.id}-a`, role: 'assistant', content: 'I lost the connection for a second. Try that again?' }])
    } finally {
      setBusy(false)
      field.current?.focus()
    }
  }

  const shown = open && (msgs.length > 0 || busy)
  const tips = suggestions(context)

  return (
    <div style={{ position: 'fixed', left: 'var(--side-w, 0px)', right: 'var(--drawer-w, 0px)', bottom: 0, zIndex: 60, transition: 'right .35s cubic-bezier(.2,.8,.2,1)', pointerEvents: 'none', display: 'flex', justifyContent: 'center', padding: '0 16px 18px' }}>
      <style>{DRAFT_CSS + `
@keyframes bk-bounce { 0%, 80%, 100% { transform: translateY(0); opacity: .35 } 40% { transform: translateY(-4px); opacity: 1 } }
.bk-dot { animation: bk-bounce 1.1s ${EASE} infinite }
.bk-tip { border: 0; background: transparent; color: var(--ink3); font-size: 13.5px; padding: 4px 8px; border-radius: 7px; text-align: left; transition: color .2s ${EASE}, background .2s ${EASE}, transform .2s ${EASE} }
.bk-tip:hover { color: var(--ink); background: var(--hover); transform: translateY(-1px) }
.bk-send { transition: transform .2s ${SPRING}, opacity .2s ${EASE}, background .2s }
.bk-send:disabled { opacity: .35; transform: scale(.92) }
@media (prefers-reduced-motion: reduce) { .bk-dot { animation: none } .bk-dock, .bk-panel { transition: none !important } }
`}</style>
      <div
        className="bk-dock"
        style={{
          pointerEvents: 'auto', width: 'min(760px, 100%)', background: 'var(--card)', borderRadius: 12,
          boxShadow: focus || shown ? '0 30px 80px -24px rgba(0,0,0,.35), 0 0 0 1px var(--border)' : 'var(--pop), 0 0 0 1px var(--border)',
          transition: `box-shadow .35s ${EASE}, transform .4s ${SPRING}`, transform: focus && !shown ? 'translateY(-2px)' : 'none', overflow: 'hidden',
        }}
      >
        <div
          className="bk-panel"
          style={{ display: 'grid', gridTemplateRows: shown ? '1fr' : '0fr', transition: `grid-template-rows .5s ${SPRING}` }}
        >
          <div style={{ minHeight: 0, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px 10px 16px', borderBottom: '1px solid var(--divider)' }}>
              <Icon name="sparkle" size={16} />
              <span style={{ fontSize: 14, fontWeight: 560 }}>Backer</span>
              <span style={{ fontSize: 13, color: 'var(--ink3)' }}>{context?.event?.name ? `on ${context.event.name}` : 'sponsors, outreach, launch posts, Luma'}</span>
              <button className="bk-ghost" style={{ marginLeft: 'auto' }} onClick={() => { setMsgs([]); setOpen(false) }}>Clear</button>
              <button className="bk-ghost" aria-label="Collapse" onClick={() => setOpen(false)}><Icon name="close" size={15} /></button>
            </div>
            <div ref={scroller} style={{ height: 'min(58vh, 560px)', overflowY: 'auto', padding: '18px 20px 8px', display: 'grid', alignContent: 'start', gap: 18 }}>
              {msgs.map(m => (
                <div key={m.id} className="bk-rise" style={{ justifySelf: m.role === 'user' ? 'end' : 'stretch', maxWidth: m.role === 'user' ? '78%' : '100%' }}>
                  {m.role === 'user' ? (
                    <div style={{ background: 'var(--chip)', padding: '8px 12px', borderRadius: 10, fontSize: 14.5, whiteSpace: 'pre-wrap' }}>{m.content}</div>
                  ) : (
                    <div style={{ fontSize: 14.5, lineHeight: 1.55, color: 'var(--ink2)' }}>
                      <Rich text={m.content} />
                      {m.data?.leads && m.data.leads.length > 0 && (
                        <Leads data={m.data.leads} onOpen={onFindBackers ? () => { onFindBackers(m.data?.query ?? ''); setOpen(false) } : undefined} />
                      )}
                      {m.data?.drafts?.luma && <Luma set={m.data.drafts} />}
                      {m.data?.drafts && !m.data.drafts.luma && (
                        <div className="bk-rise" style={{ marginTop: 10, border: '1px solid var(--border)', borderRadius: 10, padding: '8px 14px 10px', background: 'var(--card)' }}>
                          <DraftTabs set={m.data.drafts} compact />
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {busy && <Typing />}
            </div>
          </div>
        </div>

        {!shown && focus && !input && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, padding: '10px 10px 0' }}>
            {tips.map((t, i) => (
              <button key={t} className="bk-tip bk-rise" style={{ animationDelay: `${i * 50}ms` }} onMouseDown={e => e.preventDefault()} onClick={() => send(t)}>{t}</button>
            ))}
          </div>
        )}

        <form
          onSubmit={e => { e.preventDefault(); send(input) }}
          style={{ display: 'flex', alignItems: 'flex-end', gap: 10, padding: '12px 12px 12px 16px', borderTop: shown ? '1px solid var(--divider)' : 0 }}
        >
          <textarea
            ref={field}
            value={input}
            rows={1}
            placeholder={busy ? 'Working on it…' : 'Ask Backer to find sponsors, draft outreach or create a Luma event'}
            onChange={e => {
              setInput(e.target.value)
              e.target.style.height = 'auto'
              e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`
            }}
            onFocus={() => { setFocus(true); if (msgs.length) setOpen(true) }}
            onBlur={() => setFocus(false)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input) } }}
            style={{ flex: 1, resize: 'none', border: 0, outline: 'none', background: 'transparent', fontSize: 15, lineHeight: '22px', padding: '6px 0', minHeight: 34, maxHeight: 140 }}
          />
          {!shown && msgs.length > 0 && (
            <button type="button" className="bk-ghost" onClick={() => setOpen(true)}>
              <span className="mono" style={{ fontSize: 12.5 }}>{msgs.length}</span> messages
            </button>
          )}
          <span className="mono" style={{ fontSize: 12, color: 'var(--ink3)', alignSelf: 'center', display: focus ? 'none' : 'inline' }}>⌘K</span>
          <button type="submit" className="btn btn-primary bk-send" disabled={!input.trim() || busy} aria-label="Send" style={{ height: 34, width: 34, padding: 0, justifyContent: 'center' }}>
            <Icon name="send" size={16} />
          </button>
        </form>
      </div>
    </div>
  )
}
