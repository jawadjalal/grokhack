'use client'

// Upcoming tech events near the saved location, on the empty state.
// Picking one fills the composer with its link and runs the search.
import { useEffect, useState } from 'react'
import { Mark } from '@/components/Mark'
import type { MapEventGeo } from '@/lib/events'
import { formatKm } from '@/lib/geo'
import { shortLabel, type SavedLocation } from '@/lib/useLocation'

type NearEvent = MapEventGeo & { distanceKm: number }
type Loaded = { key: string; events: NearEvent[]; total: number; outside: boolean; failed: boolean }

// What data/london.json holds, loaded lazily in its own chunk after first paint.
export type MapStats = { events: number; sponsors: number; backings: number; backersByEvent: Map<string, string[]> }
type RawMap = { events: { id: string; city?: string | null }[]; sponsors: { id: string; domain?: string }[]; backings: { eventId: string; sponsorId: string }[] }

let statsPromise: Promise<MapStats> | null = null
function loadStats(): Promise<MapStats> {
  return (statsPromise ??= import('@/data/london.json').then(mod => {
    const m = (mod.default ?? mod) as unknown as RawMap
    const domain = new Map(m.sponsors.map(s => [s.id, s.domain || s.id]))
    const backersByEvent = new Map<string, string[]>()
    for (const b of m.backings) {
      const d = domain.get(b.sponsorId) ?? b.sponsorId
      const list = backersByEvent.get(b.eventId) ?? []
      if (!list.includes(d)) list.push(d)
      backersByEvent.set(b.eventId, list)
    }
    return {
      events: m.events.filter(e => /london/i.test(e.city ?? '')).length,
      sponsors: m.sponsors.length,
      backings: m.backings.length,
      backersByEvent,
    }
  }))
}

export function useMapStats(): MapStats | null {
  const [stats, setStats] = useState<MapStats | null>(null)
  useEffect(() => {
    let live = true
    loadStats()
      .then(s => live && setStats(s))
      .catch(() => {})
    return () => {
      live = false
    }
  }, [])
  return stats
}

const SHOW = 6
const FETCH = 50
const COLS = '64px minmax(0, 1fr) auto 72px'
const ROW_H = 72

const wd = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'Europe/London' })
const dd = new Intl.DateTimeFormat('en-GB', { day: 'numeric', timeZone: 'Europe/London' })
const mm = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'Europe/London' })

// A bare date is read as that London day.
function when(date: string | null): { t: number; day: string; week: string; month: string } | null {
  if (!date) return null
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00Z` : date)
  if (!Number.isFinite(t)) return null
  return { t, day: dd.format(t), week: wd.format(t), month: mm.format(t) }
}

// An approximate point (a city centre) only earns whole km: '~4 km', never '~40 m'.
function distance(e: NearEvent): string {
  return e.approx ? `~${Math.max(1, Math.round(e.distanceKm)).toLocaleString('en-GB')} km` : formatKm(e.distanceKm)
}

function clean(raw: unknown): NearEvent[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((e): e is NearEvent => !!e && typeof e.name === 'string' && typeof e.url === 'string' && Number.isFinite(e.distanceKm))
}

const css = `
.ne-row { transition: transform .22s var(--ease), box-shadow .22s var(--ease), background .15s var(--ease); }
.ne-row:hover { transform: translateY(-2px); background: var(--card) !important; box-shadow: var(--lift), 0 0 0 1px var(--border); }
.ne-row:active { transform: translateY(0); box-shadow: 0 0 0 1px var(--border); }
.ne-row:hover .ne-go { opacity: 1; transform: none; }
@media (prefers-reduced-motion: reduce) { .ne-row, .ne-row:hover, .ne-row:active { transform: none; transition: background .15s; } }
`

export function NearbyEvents({ near, ready = true, onPick }: { near: SavedLocation; ready?: boolean; onPick: (url: string) => void }) {
  const key = `${near.lat},${near.lng},${near.radiusKm}`
  const [data, setData] = useState<Loaded | null>(null)
  const stats = useMapStats()

  useEffect(() => {
    if (!ready) return
    const ctrl = new AbortController()
    const qs = new URLSearchParams({ lat: String(near.lat), lng: String(near.lng), radiusKm: String(near.radiusKm), days: '60', limit: String(FETCH) })
    fetch(`/api/events?${qs}`, { signal: ctrl.signal })
      .then(async res => {
        const j = (await res.json()) as { events?: unknown; outside?: unknown }
        if (!res.ok) throw new Error(String(res.status))
        const all = clean(j.events)
        setData({ key, events: all.slice(0, SHOW), total: all.length, outside: j.outside === true, failed: false })
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setData({ key, events: [], total: 0, outside: false, failed: true })
      })
    return () => ctrl.abort()
  }, [key, ready, near.lat, near.lng, near.radiusKm])

  const place = shortLabel(near.label)
  const loading = !data || data.key !== key

  return (
    <section aria-labelledby="nearby-title" aria-busy={loading} className="rise" style={{ margin: '56px auto 0', maxWidth: 760, animationDelay: '.32s' }}>
      <style>{css}</style>
      <div style={{ textAlign: 'center' }}>
        <h2 id="nearby-title" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.02em', margin: 0 }}>
          Tech events near {place}
        </h2>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--ink3)', minHeight: 21 }}>
          {loading ? (
            ' '
          ) : data.failed ? (
            'Couldn’t load events near you right now.'
          ) : data.outside ? (
            <>
              Nothing within <span className="mono">{near.radiusKm} km</span> of {place}. The closest coming up:
            </>
          ) : data.total ? (
            <>
              <span className="mono">{data.total >= FETCH ? `${FETCH}+` : data.total}</span> in the next <span className="mono">60</span> days within <span className="mono">{near.radiusKm} km</span>. Pick one to find its backers.
            </>
          ) : (
            'No upcoming events listed yet.'
          )}
        </p>
      </div>

      {loading ? (
        <Rows>
          {Array.from({ length: SHOW }, (_, i) => (
            <li key={i} aria-hidden className="ne-li" style={{ opacity: 1 - i * 0.12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 18, alignItems: 'center', minHeight: ROW_H, padding: '0 16px', borderTop: '1px solid var(--divider)' }}>
                {bar(40, 30)}
                <span style={{ display: 'grid', gap: 7 }}>
                  {bar('70%', 13)}
                  {bar('35%', 11)}
                </span>
                {bar(60, 18)}
                <span style={{ justifySelf: 'end' }}>{bar(44, 12)}</span>
              </div>
            </li>
          ))}
        </Rows>
      ) : (
        !!data.events.length && (
          <Rows>
            {data.events.map((e, i) => {
              const d = when(e.date)
              const backers = stats?.backersByEvent.get(e.id) ?? []
              const count = Math.max(e.backers, backers.length)
              return (
                <li key={e.id || e.url} className="ne-li rise" style={{ animationDelay: `${0.4 + i * 0.06}s` }}>
                  <button
                    type="button"
                    className="ne-row"
                    onClick={() => onPick(e.url)}
                    aria-label={`${e.name}, ${d ? `${d.week} ${d.day} ${d.month}` : 'date to be announced'}, ${distance(e).replace('~', 'about ')} away${count ? `, ${count} backer${count > 1 ? 's' : ''} on record` : ''}. Find backers for it`}
                    style={{ display: 'grid', gridTemplateColumns: COLS, gap: 18, alignItems: 'center', width: '100%', minHeight: ROW_H, padding: '12px 16px', border: 0, borderTop: `1px solid ${i ? 'var(--divider)' : 'transparent'}`, background: 'transparent', textAlign: 'left', borderRadius: 'var(--r-card)', cursor: 'pointer', color: 'var(--ink)' }}
                  >
                    <span className="mono" style={{ display: 'grid', justifyItems: 'center', lineHeight: 1, gap: 4, padding: '7px 0', borderRadius: 'var(--r-button)', background: 'var(--chip)' }}>
                      {d ? (
                        <>
                          <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: '-0.03em' }}>{d.day}</span>
                          <span style={{ fontSize: 11.5, color: 'var(--ink3)' }}>
                            {d.week} {d.month}
                          </span>
                        </>
                      ) : (
                        <span style={{ fontSize: 12, color: 'var(--ink3)', padding: '9px 0' }}>—</span>
                      )}
                    </span>
                    <span style={{ minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 550, fontSize: 15.5, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                      <span style={{ display: 'block', marginTop: 3, fontSize: 13.5, color: 'var(--ink3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {e.organiser || e.venue || e.city}
                      </span>
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, justifySelf: 'end', fontSize: 13, color: 'var(--ink2)', whiteSpace: 'nowrap' }}>
                      {count > 0 ? (
                        <>
                          {backers.length > 0 && (
                            <span aria-hidden style={{ display: 'flex' }}>
                              {backers.slice(0, 3).map((dom, k) => (
                                <span key={dom} style={{ display: 'flex', marginLeft: k ? -5 : 0, borderRadius: 6, boxShadow: '0 0 0 2px var(--canvas)', background: 'var(--card)' }}>
                                  <Mark domain={dom} size={20} />
                                </span>
                              ))}
                            </span>
                          )}
                          <span>
                            <span className="mono">{count}</span> backer{count > 1 ? 's' : ''}
                          </span>
                        </>
                      ) : (
                        <span style={{ color: 'var(--ink3)' }}>No backers yet</span>
                      )}
                    </span>
                    <span className="mono" style={{ fontSize: 13, color: 'var(--ink2)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {distance(e)}
                    </span>
                  </button>
                </li>
              )
            })}
          </Rows>
        )
      )}
    </section>
  )
}

function Rows({ children }: { children: React.ReactNode }) {
  return <ul style={{ listStyle: 'none', margin: '20px 0 0', padding: 0 }}>{children}</ul>
}

function bar(w: number | string, h: number) {
  return <span style={{ display: 'block', width: w, height: h, borderRadius: 3, background: 'var(--chip)' }} />
}
