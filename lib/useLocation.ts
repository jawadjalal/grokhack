'use client'

// Where the user is, kept on their device only (localStorage 'backer.location.v1').
// The server and the first client render always see the London default; the
// saved place swaps in after mount, so hydration never mismatches.
import { useCallback, useEffect, useRef, useState } from 'react'
import { LONDON, roundCoord } from './geo'

export type SavedLocation = {
  lat: number
  lng: number
  label: string
  radiusKm: number
  source: 'gps' | 'search'
  savedAt: string // ISO time
}
export type LocationStatus = 'idle' | 'locating' | 'denied' | 'error'
export type LocationApi = ReturnType<typeof useLocation>

export const LOCATION_KEY = 'backer.location.v1'
export const RADII = [2, 5, 10, 25, 50] as const
export const DEFAULT_LOCATION: SavedLocation = { ...LONDON, label: 'London', radiusKm: 25, source: 'search', savedAt: '' }

// 'Shoreditch, Greater London, England' -> 'Shoreditch'; outcodes keep their district ('SW1A, Westminster').
export function shortLabel(label: string): string {
  const parts = label.split(',').map(s => s.trim()).filter(Boolean)
  if (!parts.length) return 'London'
  return /^[A-Z]{1,2}\d/.test(parts[0]) && parts[1] ? `${parts[0]}, ${parts[1]}` : parts[0]
}

// Anything odd in storage is ignored, never trusted.
function parse(raw: string | null): SavedLocation | null {
  if (!raw) return null
  try {
    const v = JSON.parse(raw) as Partial<SavedLocation>
    const lat = Number(v.lat)
    const lng = Number(v.lng)
    const radiusKm = Number(v.radiusKm)
    if (!(lat >= -90 && lat <= 90) || !(lng >= -180 && lng <= 180)) return null
    if (typeof v.label !== 'string' || !v.label.trim()) return null
    return {
      lat: roundCoord(lat),
      lng: roundCoord(lng),
      label: v.label.trim().slice(0, 120),
      radiusKm: radiusKm >= 0.5 && radiusKm <= 500 ? radiusKm : DEFAULT_LOCATION.radiusKm,
      source: v.source === 'gps' ? 'gps' : 'search',
      savedAt: typeof v.savedAt === 'string' ? v.savedAt : '',
    }
  } catch {
    return null
  }
}

function read(): SavedLocation | null {
  try {
    return parse(window.localStorage.getItem(LOCATION_KEY))
  } catch {
    return null
  }
}

function write(loc: SavedLocation) {
  try {
    window.localStorage.setItem(LOCATION_KEY, JSON.stringify(loc))
  } catch {
    // Private mode or storage blocked: the choice still holds for this visit.
  }
}

const MESSAGES = {
  denied: 'Location access is off for this site. Search for a postcode, area or city instead.',
  unsupported: 'This browser can’t share your location. Search for a place instead.',
  timeout: 'Finding you took too long. Try again, or search for a place.',
  failed: 'Couldn’t find your location. Search for a place instead.',
}

export function useLocation() {
  const [location, setLoc] = useState<SavedLocation>(DEFAULT_LOCATION)
  const [ready, setReady] = useState(false) // true once storage has been read
  const [status, setStatus] = useState<LocationStatus>('idle')
  const [error, setError] = useState('')
  const current = useRef<SavedLocation>(DEFAULT_LOCATION)

  useEffect(() => {
    const sync = () => {
      const next = read() ?? DEFAULT_LOCATION
      current.current = next
      setLoc(next)
    }
    sync()
    setReady(true)
    // Another tab changed it (or cleared storage).
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === LOCATION_KEY) sync()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Merge a change (a new place, or just a radius), keep it in state and on the device.
  const setLocation = useCallback((patch: Partial<Omit<SavedLocation, 'savedAt'>>) => {
    const base = current.current
    const next: SavedLocation = {
      ...base,
      ...patch,
      lat: roundCoord(patch.lat ?? base.lat),
      lng: roundCoord(patch.lng ?? base.lng),
      savedAt: new Date().toISOString(),
    }
    current.current = next
    setLoc(next)
    write(next)
    setStatus('idle')
    setError('')
  }, [])

  // Ask the browser where we are. Resolves true when a place was saved.
  const locate = useCallback((): Promise<boolean> => {
    const fail = (s: LocationStatus, message: string) => {
      setStatus(s)
      setError(message)
      return false
    }
    if (typeof navigator === 'undefined' || !navigator.geolocation) return Promise.resolve(fail('error', MESSAGES.unsupported))
    setStatus('locating')
    setError('')
    return new Promise(resolve => {
      navigator.geolocation.getCurrentPosition(
        async pos => {
          const lat = roundCoord(pos.coords.latitude)
          const lng = roundCoord(pos.coords.longitude)
          let label = 'Current location'
          try {
            const res = await fetch(`/api/geocode?lat=${lat}&lng=${lng}`, { signal: AbortSignal.timeout(8000) })
            const j = (await res.json()) as { label?: unknown }
            if (res.ok && typeof j.label === 'string' && j.label.trim()) label = j.label.trim()
          } catch {
            // Keep the plain label; the point is what matters.
          }
          setLocation({ lat, lng, label, source: 'gps' })
          resolve(true)
        },
        err => {
          if (err.code === err.PERMISSION_DENIED) resolve(fail('denied', MESSAGES.denied))
          else resolve(fail('error', err.code === err.TIMEOUT ? MESSAGES.timeout : MESSAGES.failed))
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
      )
    })
  }, [setLocation])

  return { location, setLocation, locate, status, error, ready }
}
