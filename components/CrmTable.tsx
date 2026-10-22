'use client'

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { Icon, Mark } from '@/components/Mark'

export type CrmBacking = { event: string; role: string; date: string | null; url: string }
export type CrmRow = {
  id: string
  name: string
  domain: string
  kind: 'sponsor' | 'venue'
  tags: string[]
  audience: string[]
  backings: CrmBacking[]
  latest: string | null
  latestEvent: string | null
}

type Kind = 'all' | 'sponsor' | 'venue'
type SortKey = 'name' | 'events' | 'latest'

const COLS = 'minmax(220px, 1.5fr) minmax(130px, 1fr) 86px 70px 110px minmax(180px, 1.4fr)'
const TAB_W = 108
const PAGE = 60
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function fmtDate(d: string | null) {
  if (!d) return null
  const m = /^(\d{4})-(\d{2})/.exec(d)
  if (!m) return null
  const day = /^\d{4}-\d{2}-(\d{2})/.exec(d)
  return `${day ? `${Number(day[1])} ` : ''}${MONTHS[Number(m[2]) - 1] ?? ''} ${m[1]}`
}

function useCount(target: number, ms = 700) {
  const [v, setV] = useState(0)
  useEffect(() => {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return setV(target)
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms)
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}

export default function CrmTable({ rows, eventCount, source }: { rows: CrmRow[]; eventCount: number; source: string }) {
  const [kind, setKind] = useState<Kind>('all')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'events', dir: -1 })
  const [limit, setLimit] = useState(PAGE)
  const [openId, setOpenId] = useState<string | null>(null)
  const q = useDeferredValue(query).trim().toLowerCase()
  const sentinel = useRef<HTMLDivElement>(null)

  const counts = useMemo(
    () => ({ all: rows.length, sponsor: rows.filter(r => r.kind === 'sponsor').length, venue: rows.filter(r => r.kind === 'venue').length }),
    [rows],
  )
  const backingTotal = useMemo(() => rows.reduce((n, r) => n + r.backings.length, 0), [rows])

  // Lowercased haystack per row, built once.
  const haystack = useMemo(
    () => new Map(rows.map(r => [r.id, `${r.name} ${r.domain} ${r.tags.join(' ')} ${r.backings.map(b => b.event).join(' ')}`.toLowerCase()])),
    [rows],
  )

  const shown = useMemo(() => {
    const list = rows.filter(r => (kind === 'all' || r.kind === kind) && (!q || q.split(/\s+/).every(w => haystack.get(r.id)!.includes(w))))
    const { key, dir } = sort
    return list.sort((a, b) => {
      let c = 0
      if (key === 'name') c = a.name.localeCompare(b.name)
      else if (key === 'events') c = a.backings.length - b.backings.length
      else c = (a.latest ?? '').localeCompare(b.latest ?? '')
      return c * dir || a.name.localeCompare(b.name)
    })
  }, [rows, kind, q, sort, haystack])

  useEffect(() => setLimit(PAGE), [kind, q, sort])

  // Auto-reveal more rows as the sentinel scrolls into view.
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver(es => es[0].isIntersecting && setLimit(n => n + PAGE), { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [shown.length, limit])

  const visible = shown.slice(0, limit)
  const open = rows.find(r => r.id === openId) ?? null
  const step = useCallback(
    (d: number) => {
      const i = shown.findIndex(r => r.id === openId)
      const next = shown[i + d]
      if (next) setOpenId(next.id)
    },
    [shown, openId],
  )

  const nSponsors = useCount(counts.sponsor)
  const nVenues = useCount(counts.venue)
  const nBackings = useCount(backingTotal)
  const nEvents = useCount(eventCount)

  const toggle = (key: SortKey) => setSort(s => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: key === 'name' ? 1 : -1 }))
  const FILTERS: [Kind, string][] = [['all', 'All'], ['sponsor', 'Sponsors'], ['venue', 'Venues']]

  return (
    <div style={{ minHeight: '100vh' }}>
      <style>{CSS}</style>
      <main style={{ width: '100%', maxWidth: 1120, margin: '0 auto', padding: '32px 24px 120px' }}>
        <section className="crm-rise" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32, flexWrap: 'wrap' }}>
          <div>
            <div style={{ color: 'var(--ink3)', fontSize: 13, display: 'flex', gap: 7, alignItems: 'center' }}>
              <Icon name="crm" size={15} /> CRM · {source === 'supabase' ? 'live from the map' : 'from the London map'}
            </div>
            <h1 style={{ fontSize: 32, lineHeight: 1.1, letterSpacing: '-0.03em', margin: '8px 0 0', fontWeight: 600 }}>Everyone who has backed a London event</h1>
          </div>
          <div style={{ display: 'flex', gap: 28 }}>
            {([[nSponsors, 'sponsors'], [nVenues, 'venues'], [nBackings, 'backings'], [nEvents, 'events']] as const).map(([n, label], i) => (
              <div key={label} className="crm-rise" style={{ animationDelay: `${120 + i * 60}ms` }}>
                <div className="mono" style={{ fontSize: 24, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1 }}>{n.toLocaleString()}</div>
                <div style={{ color: 'var(--ink3)', fontSize: 12.5, marginTop: 5 }}>{label}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="crm-rise" style={{ animationDelay: '160ms', marginTop: 24, background: 'var(--card)', borderRadius: 'var(--r-panel)', boxShadow: '0 0 0 1px var(--border)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px', borderBottom: '1px solid var(--divider)', flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', display: 'flex', padding: 3, borderRadius: 9, background: 'var(--chip)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,.07)' }}>
              <span aria-hidden style={{ position: 'absolute', top: 3, bottom: 3, left: 3, width: TAB_W, borderRadius: 7, background: 'var(--bg)', boxShadow: 'var(--shadow), 0 0 0 1px var(--border)', transform: `translateX(${FILTERS.findIndex(f => f[0] === kind) * TAB_W}px)`, transition: 'transform .35s var(--ease)' }} />
              {FILTERS.map(([key, label]) => (
                <button key={key} onClick={() => setKind(key)} style={{ position: 'relative', width: TAB_W, height: 30, border: 0, background: 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 13.5, color: kind === key ? 'var(--ink)' : 'var(--ink3)', fontWeight: kind === key ? 550 : 400, transition: 'color .2s' }}>
                  {label}
                  <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink3)' }}>{counts[key]}</span>
                </button>
              ))}
            </div>
            <label className="crm-search" style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36, padding: '0 10px', borderRadius: 'var(--r-button)', boxShadow: 'inset 0 0 0 1px var(--border)', flex: '1 1 260px', maxWidth: 380, background: 'var(--bg)' }}>
              <Icon name="search" size={16} />
              <input
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Search name, domain, tag or event"
                aria-label="Search backers"
                style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', fontSize: 14 }}
              />
              {query && (
                <button aria-label="Clear search" onClick={() => setQuery('')} style={{ border: 0, background: 'transparent', padding: 0, display: 'flex', opacity: 0.6 }}>
                  <Icon name="close" size={14} />
                </button>
              )}
            </label>
          </div>

          <div style={{ overflowX: 'auto' }}>
            <div style={{ minWidth: 860 }}>
              <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 16, padding: '12px 20px 8px', color: 'var(--ink3)', fontSize: 12, alignItems: 'center' }}>
                <SortHead label="Backer" k="name" sort={sort} onSort={toggle} />
                <span>Domain</span>
                <span>Kind</span>
                <SortHead label="Events" k="events" sort={sort} onSort={toggle} align="right" />
                <SortHead label="Latest" k="latest" sort={sort} onSort={toggle} />
                <span>Tags</span>
              </div>

              {visible.map((r, i) => (
                <div
                  key={`${kind}-${r.id}`}
                  className="crm-row crm-rise"
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenId(r.id)}
                  onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setOpenId(r.id))}
                  style={{ animationDelay: `${Math.min(i % PAGE, 14) * 22}ms`, display: 'grid', gridTemplateColumns: COLS, gap: 16, alignItems: 'center', padding: '10px 20px', borderTop: '1px solid var(--divider)', background: openId === r.id ? 'var(--hover)' : undefined }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                    <Mark domain={r.domain} size={24} />
                    <span style={{ fontWeight: 550, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</span>
                  </div>
                  <span className="mono" style={{ fontSize: 12.5, color: 'var(--ink2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.domain}</span>
                  <span><span className={`tag${r.kind === 'venue' ? ' tag-teal' : ''}`}>{r.kind === 'venue' ? 'Venue' : 'Sponsor'}</span></span>
                  <span className="mono" style={{ textAlign: 'right', fontSize: 13.5 }}>{r.backings.length}</span>
                  <span className="mono" style={{ fontSize: 12.5, color: r.latest ? 'var(--ink2)' : 'var(--ink3)' }} title={r.latestEvent ?? undefined}>{fmtDate(r.latest) ?? 'n/a'}</span>
                  <div style={{ display: 'flex', gap: 5, minWidth: 0, overflow: 'hidden' }}>
                    {r.tags.slice(0, 3).map(t => <span key={t} className="tag">{t}</span>)}
                  </div>
                </div>
              ))}

              {!shown.length && (
                <div className="crm-rise" style={{ padding: '56px 20px', textAlign: 'center', color: 'var(--ink3)', borderTop: '1px solid var(--divider)' }}>
                  Nobody matches {q ? `"${query.trim()}"` : 'that filter'}.
                </div>
              )}
            </div>
          </div>

          {shown.length > visible.length && (
            <div ref={sentinel} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: 14, borderTop: '1px solid var(--divider)', color: 'var(--ink3)', fontSize: 13 }}>
              <span className="mono">{visible.length} of {shown.length}</span>
              <button className="btn" onClick={() => setLimit(n => n + PAGE)} style={{ height: 30, fontSize: 13 }}>Show more</button>
            </div>
          )}
          {shown.length > 0 && shown.length <= visible.length && (
            <div className="mono" style={{ padding: 12, textAlign: 'center', borderTop: '1px solid var(--divider)', color: 'var(--ink3)', fontSize: 12 }}>{shown.length} shown</div>
          )}
        </div>
      </main>

      {open && <CrmDrawer key={open.id} row={open} onClose={() => setOpenId(null)} onStep={step} />}
    </div>
  )
}

function SortHead({ label, k, sort, onSort, align }: { label: string; k: SortKey; sort: { key: SortKey; dir: 1 | -1 }; onSort: (k: SortKey) => void; align?: 'right' }) {
  const on = sort.key === k
  return (
    <button onClick={() => onSort(k)} style={{ border: 0, background: 'transparent', padding: 0, display: 'flex', alignItems: 'center', gap: 5, justifyContent: align === 'right' ? 'flex-end' : 'flex-start', fontSize: 12, color: on ? 'var(--ink)' : 'var(--ink3)', fontWeight: on ? 550 : 400 }}>
      {label}
      <span aria-hidden style={{ display: 'inline-block', width: 8, fontSize: 10, opacity: on ? 1 : 0, transform: `rotate(${on && sort.dir === 1 ? 180 : 0}deg)`, transition: 'transform .25s var(--ease), opacity .2s' }}>▼</span>
    </button>
  )
}

function CrmDrawer({ row, onClose, onStep }: { row: CrmRow; onClose: () => void; onStep: (d: number) => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.target instanceof HTMLElement && /INPUT|TEXTAREA/.test(e.target.tagName)) return
      else if (e.key === 'ArrowDown' || e.key === 'j') (e.preventDefault(), onStep(1))
      else if (e.key === 'ArrowUp' || e.key === 'k') (e.preventDefault(), onStep(-1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, onStep])

  return (
    <>
      <div className="crm-fade" onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 9, background: 'rgba(23,23,23,.14)' }} />
      <aside style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 'min(470px, 100vw)', zIndex: 10, background: 'var(--bg)', boxShadow: 'var(--drawer), 0 0 0 1px var(--divider)', display: 'flex', flexDirection: 'column', animation: 'slide .35s var(--ease)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, padding: '20px 20px 16px', borderBottom: '1px solid var(--divider)' }}>
          <Mark domain={row.domain} size={40} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.2 }}>{row.name}</div>
            <a className="mono" href={`https://${row.domain}`} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: 'var(--ink3)', textDecoration: 'none' }}>{row.domain}</a>
          </div>
          <button className="btn" aria-label="Close" onClick={onClose} style={{ width: 32, height: 32, padding: 0, justifyContent: 'center' }}>
            <Icon name="close" size={16} />
          </button>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '4px 20px 20px' }}>
          <div className="crm-rise" style={{ display: 'flex', gap: 28, padding: '16px 0', borderBottom: '1px solid var(--divider)' }}>
            <Stat n={String(row.backings.length)} label={row.backings.length === 1 ? 'event backed' : 'events backed'} />
            <Stat n={fmtDate(row.latest) ?? 'n/a'} label="most recent" />
            <div style={{ alignSelf: 'center' }}><span className={`tag${row.kind === 'venue' ? ' tag-teal' : ''}`}>{row.kind === 'venue' ? 'Venue' : 'Sponsor'}</span></div>
          </div>

          <h3 className="crm-rise" style={{ animationDelay: '60ms', fontSize: 14, fontWeight: 600, margin: '18px 0 4px' }}>Past backings</h3>
          {row.backings.length === 0 && <div style={{ color: 'var(--ink3)', fontSize: 13.5, padding: '8px 0' }}>No backings recorded yet.</div>}
          {row.backings.map((b, i) => (
            <div key={`${b.event}-${i}`} className="crm-rise" style={{ animationDelay: `${100 + Math.min(i, 10) * 40}ms`, display: 'flex', justifyContent: 'space-between', gap: 12, padding: '11px 0', borderTop: i ? '1px solid var(--divider)' : undefined }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 500 }}>{b.event}</div>
                <div style={{ fontSize: 12.5, color: 'var(--ink3)', marginTop: 3, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <span className="tag">{b.role}</span>
                  <span className="mono">{fmtDate(b.date) ?? 'date n/a'}</span>
                </div>
              </div>
              <a className="btn" href={b.url} target="_blank" rel="noreferrer" style={{ height: 30, padding: '0 8px', fontSize: 12.5, flex: 'none', alignSelf: 'center' }}>
                Source <Icon name="arrow" size={14} />
              </a>
            </div>
          ))}

          {row.tags.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: '22px 0 10px' }}>Tags</h3>
              <div className="crm-rise" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {row.tags.map(t => <span key={t} className="tag">{t}</span>)}
              </div>
            </>
          )}
          {row.audience.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, fontWeight: 600, margin: '22px 0 10px' }}>Audience</h3>
              <div className="crm-rise" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {row.audience.map(a => <span key={a} className="tag tag-iggy">{a}</span>)}
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '14px 20px', borderTop: '1px solid var(--divider)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--ink3)' }}>esc to close · j k to move</span>
          <a className="btn btn-primary" href={`/?sponsor=${encodeURIComponent(row.id)}&name=${encodeURIComponent(row.name)}`}>
            <Icon name="send" size={16} /> Draft outreach
          </a>
        </div>
      </aside>
    </>
  )
}

function Stat({ n, label }: { n: string; label: string }) {
  return (
    <div>
      <div className="mono" style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.03em', lineHeight: 1 }}>{n}</div>
      <div style={{ color: 'var(--ink3)', fontSize: 12.5, marginTop: 5 }}>{label}</div>
    </div>
  )
}

const CSS = `
@keyframes crm-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes crm-fade { from { opacity: 0; } to { opacity: 1; } }
.crm-rise { animation: crm-rise .4s cubic-bezier(.2,.8,.2,1) both; }
.crm-fade { animation: crm-fade .25s cubic-bezier(.2,.8,.2,1) both; }
.crm-row { cursor: pointer; transition: background .15s cubic-bezier(.2,.8,.2,1); outline: none; }
.crm-row:hover, .crm-row:focus-visible { background: var(--hover); }
.crm-row:active { background: var(--chip); }
.crm-search { transition: box-shadow .2s cubic-bezier(.2,.8,.2,1); }
.crm-search:focus-within { box-shadow: inset 0 0 0 1px var(--ink3), 0 0 0 3px rgba(23,23,23,.06) !important; }
@media (prefers-reduced-motion: reduce) { .crm-rise, .crm-fade { animation: none; } }
`
