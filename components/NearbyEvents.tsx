'use client'

// Upcoming tech events near the saved location, on the empty state.
// Picking one fills the composer with its link and runs the search.
import { useEffect, useState } from 'react'
import type { MapEventGeo } from '@/lib/events'
import { formatKm } from '@/lib/geo'
import { shortLabel, type SavedLocation } from '@/lib/useLocation'

type NearEvent = MapEventGeo & { distanceKm: number }
type Loaded = { key: string; events: NearEvent[]; outside: boolean; failed: boolean }

const SHOW = 6
const COLS = '84px minmax(0, 1fr) auto'
const ROW_H = 62

const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'Europe/London' })

// 'Thu 22 Oct'. A bare date is read as that London day.
function day(date: string | null): string {
  if (!date) return ''
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(date) ? `${date}T12:00:00Z` : date)
  return Number.isFinite(t) ? dayFmt.format(t).replace(',', '') : ''
}

// An approximate point (a city centre) only earns whole km: '~4 km', never '~40 m'.
function distance(e: NearEvent): string {
  return e.approx ? `~${Math.max(1, Math.round(e.distanceKm)).toLocaleString('en-GB')} km` : formatKm(e.distanceKm)
}

function clean(raw: unknown): NearEvent[] {
  if (!Array.isArray(raw)) return []
  return raw.filter((e): e is NearEvent => !!e && typeof e.name === 'string' && typeof e.url === 'string' && Number.isFinite(e.distanceKm)).slice(0, SHOW)
}

export function NearbyEvents({ near, ready = true, onPick }: { near: SavedLocation; ready?: boolean; onPick: (url: string) => void }) {
  const key = `${near.lat},${near.lng},${near.radiusKm}`
  const [data, setData] = useState<Loaded | null>(null)

  useEffect(() => {
    if (!ready) return
    const ctrl = new AbortController()
    const qs = new URLSearchParams({ lat: String(near.lat), lng: String(near.lng), radiusKm: String(near.radiusKm), days: '60', limit: String(SHOW) })
    fetch(`/api/events?${qs}`, { signal: ctrl.signal })
      .then(async res => {
        const j = (await res.json()) as { events?: unknown; outside?: unknown }
        if (!res.ok) throw new Error(String(res.status))
        setData({ key, events: clean(j.events), outside: j.outside === true, failed: false })
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setData({ key, events: [], outside: false, failed: true })
      })
    return () => ctrl.abort()
  }, [key, ready, near.lat, near.lng, near.radiusKm])

  const place = shortLabel(near.label)
  const loading = !data || data.key !== key

  return (
    <section aria-labelledby="nearby-title" aria-busy={loading} style={{ marginTop: 48, maxWidth: 640 }}>
      <h2 id="nearby-title" style={{ fontSize: 18, fontWeight: 600, letterSpacing: '-0.015em', margin: 0 }}>
        Tech events near {place}
      </h2>

      {loading ? (
        <Rows>
          {Array.from({ length: SHOW }, (_, i) => (
            <li key={i} aria-hidden style={{ borderTop: '1px solid var(--divider)', opacity: 1 - i * 0.12 }}>
              <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', minHeight: ROW_H, padding: '0 8px' }}>
                {bar(70, 12)}
                <span style={{ display: 'grid', gap: 7 }}>
                  {bar('70%', 13)}
                  {bar('35%', 11)}
                </span>
                {bar(52, 12)}
              </div>
            </li>
          ))}
        </Rows>
      ) : data.failed ? (
        <p style={{ margin: '10px 0 0', fontSize: 14, color: 'var(--ink3)' }}>Couldn’t load events near you right now.</p>
      ) : !data.events.length ? (
        <p style={{ margin: '10px 0 0', fontSize: 14, color: 'var(--ink3)' }}>No upcoming events listed yet.</p>
      ) : (
        <>
          {data.outside && (
            <p style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--ink3)' }}>
              Nothing within <span className="mono">{near.radiusKm} km</span> of {place}. Closest:
            </p>
          )}
          <Rows>
            {data.events.map(e => (
              <li key={e.id || e.url} style={{ borderTop: '1px solid var(--divider)' }}>
                <button
                  type="button"
                  className="row"
                  onClick={() => onPick(e.url)}
                  aria-label={`${e.name}, ${day(e.date)}, ${distance(e).replace('~', 'about ')} away. Find backers for it`}
                  style={{ display: 'grid', gridTemplateColumns: COLS, gap: 14, alignItems: 'center', width: '100%', minHeight: ROW_H, padding: '9px 8px', border: 0, background: 'transparent', textAlign: 'left', borderRadius: 'var(--r-button)' }}
                >
                  <span className="mono" style={{ fontSize: 13, color: 'var(--ink3)', whiteSpace: 'nowrap' }}>
                    {day(e.date)}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span style={{ display: 'block', fontWeight: 500, fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{e.name}</span>
                    <span style={{ display: 'block', fontSize: 13, color: 'var(--ink3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {e.organiser}
                      {e.organiser && e.backers > 0 && ' · '}
                      {e.backers > 0 && (
                        <>
                          <span className="mono">{e.backers}</span> backer{e.backers > 1 ? 's' : ''}
                        </>
                      )}
                    </span>
                  </span>
                  <span className="mono" style={{ fontSize: 13, color: 'var(--ink2)', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {distance(e)}
                  </span>
                </button>
              </li>
            ))}
          </Rows>
        </>
      )}
    </section>
  )
}

function Rows({ children }: { children: React.ReactNode }) {
  return <ul style={{ listStyle: 'none', margin: '12px -8px 0', padding: 0 }}>{children}</ul>
}

function bar(w: number | string, h: number) {
  return <span style={{ display: 'block', width: w, height: h, borderRadius: 3, background: 'var(--chip)' }} />
}
