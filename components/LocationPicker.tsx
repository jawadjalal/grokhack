'use client'

// The location chip in the composer footer, and the small panel it opens above
// the composer: use my location, search a postcode / area / city, pick a radius.
import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '@/components/Mark'
import { RADII, shortLabel, type LocationApi } from '@/lib/useLocation'

type Hit = { label: string; lat: number; lng: number; kind: 'postcode' | 'place' }
type Search = { q: string; hits: Hit[]; failed: boolean }

const PANEL_W = 400
const hidden: React.CSSProperties = { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)', whiteSpace: 'nowrap' }

export function LocationPicker({ loc }: { loc: LocationApi }) {
  const { location, setLocation, locate, status, error } = loc
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ left: number; bottom: number; width: number; maxHeight: number } | null>(null)
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<Search>({ q: '', hits: [], failed: false })
  const wrap = useRef<HTMLSpanElement>(null)
  const chip = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const id = useId()

  const place = shortLabel(location.label)
  const q = query.trim()
  const searching = q.length >= 2 && search.q !== q

  function close(refocus = true) {
    setOpen(false)
    setQuery('')
    if (refocus) chip.current?.focus()
  }

  // Sit just above the composer, aligned with its left edge.
  useEffect(() => {
    if (!open) return
    const measure = () => {
      const form = chip.current?.closest('form')
      if (!form) return
      const r = form.getBoundingClientRect()
      setPos({ left: r.left, bottom: window.innerHeight - r.top + 8, width: Math.min(PANEL_W, r.width), maxHeight: Math.max(160, r.top - 72) })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])

  // Escape and clicks outside close it.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        close()
      }
    }
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) close(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  // Debounced place search; a newer query cancels the older one.
  useEffect(() => {
    if (q.length < 2) return
    const ctrl = new AbortController()
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/geocode?q=${encodeURIComponent(q)}`, { signal: ctrl.signal })
        const j = (await res.json()) as { results?: unknown }
        const hits = Array.isArray(j.results) ? (j.results as Hit[]).filter(h => h && typeof h.label === 'string' && Number.isFinite(h.lat) && Number.isFinite(h.lng)).slice(0, 5) : []
        setSearch({ q, hits, failed: !res.ok })
      } catch {
        if (!ctrl.signal.aborted) setSearch({ q, hits: [], failed: true })
      }
    }, 300)
    return () => {
      clearTimeout(t)
      ctrl.abort()
    }
  }, [q])

  function pick(h: Hit) {
    setLocation({ lat: h.lat, lng: h.lng, label: h.label, source: 'search' })
    close()
  }

  async function locateMe() {
    if (status === 'locating') return
    if (await locate()) close()
  }

  // Arrow keys move between the input and the results.
  function onListKey(e: React.KeyboardEvent) {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = Array.from(list.current?.querySelectorAll('button') ?? [])
    if (!items.length) return
    e.preventDefault()
    const at = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1
    if (next < 0) input.current?.focus()
    else items[Math.min(next, items.length - 1)].focus()
  }

  const hits = q.length >= 2 && search.q === q ? search.hits : []
  const note = q.length < 2 ? '' : searching ? 'Searching…' : search.failed ? 'Search isn’t working right now. Try again in a moment.' : hits.length ? '' : 'No matches. Try a postcode like E1 6AN.'
  const r = RADII.indexOf(location.radiusKm as (typeof RADII)[number])

  return (
    <span ref={wrap} style={{ display: 'flex', minWidth: 0 }}>
      <button
        ref={chip}
        type="button"
        className="btn"
        onClick={() => (open ? close() : setOpen(true))}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? `${id}-panel` : undefined}
        aria-label={`Location: ${location.label}, within ${location.radiusKm} km. Change`}
        title={location.label}
        style={{ height: 22, padding: '0 6px', margin: '0 -6px', gap: 5, fontSize: 12.5, minWidth: 0, whiteSpace: 'nowrap' }}
      >
        <Icon name="globe" size={14} />
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 'clamp(70px, 26vw, 220px)' }}>{place}</span>
        <span style={{ flex: 'none' }}>
          · <span className="mono">{location.radiusKm} km</span>
        </span>
      </button>

      {open && pos && (
        <div
          id={`${id}-panel`}
          role="dialog"
          aria-label="Your location"
          className="rise"
          onKeyDown={onListKey}
          style={{ position: 'fixed', left: pos.left, bottom: pos.bottom, width: pos.width, maxHeight: pos.maxHeight, overflowY: 'auto', zIndex: 6, background: 'var(--bg)', borderRadius: 'var(--r-panel)', boxShadow: 'var(--pop), 0 0 0 1px var(--border)', color: 'var(--ink)', fontSize: 14, textAlign: 'left', animationDuration: '.25s' }}
        >
          <div style={{ padding: 6 }}>
            <button type="button" className="btn" onClick={locateMe} aria-disabled={status === 'locating'} style={{ width: '100%', height: 34, padding: '0 10px', fontSize: 14, color: 'var(--ink)' }}>
              <Icon name="flag" size={16} />
              {status === 'locating' ? 'Locating…' : 'Use my location'}
            </button>
            {(status === 'denied' || status === 'error') && error && (
              <p role="status" style={{ margin: '2px 10px 6px', fontSize: 12.5, color: 'var(--ink3)', lineHeight: 1.4 }}>
                {error}
              </p>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--divider)', padding: '10px 12px' }}>
            <label htmlFor={`${id}-q`} style={hidden}>
              Postcode, area or city
            </label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--subtle)', borderRadius: 'var(--r-button)', padding: '0 10px', boxShadow: 'inset 0 1px 2px rgba(0,0,0,.05), inset 0 0 0 1px var(--divider)' }}>
              <Icon name="search" size={15} />
              <input
                ref={input}
                id={`${id}-q`}
                autoFocus
                value={query}
                onChange={e => setQuery(e.target.value)}
                onKeyDown={e => {
                  // Enter picks the first match and never submits the composer form.
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    if (hits[0]) pick(hits[0])
                  }
                }}
                placeholder="Postcode, area or city"
                autoComplete="off"
                spellCheck={false}
                aria-describedby={`${id}-note`}
                style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: 'transparent', fontSize: 15, padding: '8px 0' }}
              />
            </div>
            <div id={`${id}-note`} aria-live="polite" style={{ fontSize: 12.5, color: 'var(--ink3)', padding: note ? '8px 2px 0' : 0 }}>
              {note}
              {!!hits.length && <span style={hidden}>{`${hits.length} place${hits.length > 1 ? 's' : ''} found`}</span>}
            </div>
            {!!hits.length && (
              <ul ref={list} style={{ listStyle: 'none', margin: '6px -6px 0', padding: 0 }}>
                {hits.map((h, i) => {
                  const [name, ...rest] = h.label.split(',').map(s => s.trim())
                  return (
                    <li key={`${h.label}-${h.lat}-${h.lng}`} style={{ borderTop: i ? '1px solid var(--divider)' : 0 }}>
                      <button type="button" className="row" onClick={() => pick(h)} style={{ display: 'flex', alignItems: 'baseline', gap: 10, width: '100%', border: 0, background: 'transparent', textAlign: 'left', padding: '8px 6px', borderRadius: 'var(--r-button)' }}>
                        <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          <span style={{ fontWeight: 500 }}>{name}</span>
                          {rest.length > 0 && <span style={{ color: 'var(--ink3)' }}>, {rest.join(', ')}</span>}
                        </span>
                        <span style={{ flex: 'none', fontSize: 12.5, color: 'var(--ink3)' }}>{h.kind === 'postcode' ? 'Postcode' : 'Place'}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          <div role="group" aria-label="Search radius" style={{ borderTop: '1px solid var(--divider)', padding: '10px 12px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontSize: 13.5, color: 'var(--ink2)', flex: 'none' }}>Within</span>
            <div style={{ position: 'relative', display: 'flex', flex: 1, padding: 3, borderRadius: 9, background: 'var(--chip)', boxShadow: 'inset 0 1px 2px rgba(0,0,0,.07)' }}>
              {r >= 0 && (
                <span aria-hidden style={{ position: 'absolute', top: 3, bottom: 3, left: 3, width: `calc((100% - 6px) / ${RADII.length})`, borderRadius: 7, background: 'var(--bg)', boxShadow: 'var(--shadow), 0 0 0 1px var(--border)', transform: `translateX(${r * 100}%)`, transition: 'transform .35s var(--ease)' }} />
              )}
              {RADII.map(km => {
                const on = location.radiusKm === km
                return (
                  <button
                    key={km}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${km} km`}
                    onClick={() => setLocation({ radiusKm: km })}
                    style={{ position: 'relative', flex: 1, minWidth: 0, height: 28, border: 0, background: 'transparent', borderRadius: 7, fontSize: 13, color: on ? 'var(--ink)' : 'var(--ink3)', fontWeight: on ? 550 : 400, transition: 'color .2s', whiteSpace: 'nowrap' }}
                  >
                    <span className="mono">{km}</span>
                    {km === RADII[RADII.length - 1] && <span style={{ fontSize: 12 }}> km</span>}
                  </button>
                )
              })}
            </div>
          </div>

          <p style={{ margin: 0, borderTop: '1px solid var(--divider)', padding: '9px 14px 10px', fontSize: 12.5, color: 'var(--ink3)' }}>Saved on this device only.</p>
        </div>
      )}
    </span>
  )
}
