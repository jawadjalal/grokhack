// Hack Club's hackathon directory (hackathons.hackclub.com): high-school
// hackathons worldwide. /api/events/all/ holds past and upcoming events,
// /api/events/upcoming/ is the fallback. We keep in-person or hybrid London
// events and read each hackathon's own site (and one sponsor page it links)
// for the sponsors it lists.
import type { ScrapedPartner } from '../event'
import { parseEventHtml } from '../event'
import { getJson, getText } from '../http'
import type { Discover, DiscoverOptions, RawEvent, RawLink } from './types'

const BASE = 'https://hackathons.hackclub.com/api/events'
const DAY_MS = 24 * 60 * 60 * 1000
const LONDON = { lat: 51.5072, lng: -0.1276 }
const LONDON_KM = 30

type HackClubEvent = {
  id?: string
  name?: string
  website?: string
  start?: string
  end?: string
  city?: string | null
  state?: string | null
  country?: string | null
  countryCode?: string | null
  latitude?: number | null
  longitude?: number | null
  virtual?: boolean
  hybrid?: boolean
  mlhAssociated?: boolean
  hack_club_event?: boolean
}

export const discover: Discover = async opts => {
  const { from, to, today } = dateRange(opts)
  const all = await listAll()

  const seen = new Set<string>()
  const picked: RawEvent[] = []
  for (const ev of all) {
    try {
      const raw = toRaw(ev)
      if (!raw?.date || raw.date < from || raw.date > to || seen.has(raw.url)) continue
      seen.add(raw.url)
      picked.push(raw)
    } catch {
      // one odd listing never stops the rest
    }
  }

  const out: RawEvent[] = []
  for (const event of order(picked, today).slice(0, opts.limit)) out.push(await enrich(event))
  return out
}

// Every listed hackathon; upcoming only if the full list fails.
async function listAll(): Promise<HackClubEvent[]> {
  for (const path of ['all/', 'upcoming/']) {
    try {
      const data = await getJson<unknown>(`${BASE}/${path}`)
      if (Array.isArray(data)) return data as HackClubEvent[]
    } catch {
      // try the next list
    }
  }
  throw new Error('Hack Club hackathons API is unreachable')
}

function toRaw(ev: HackClubEvent): RawEvent | undefined {
  const name = clean(ev.name)
  const url = siteUrl(ev.website)
  if (!name || !url || !ev.start) return
  if (ev.virtual && !ev.hybrid) return
  const geo = pointOf(ev)
  if (!inLondon(ev, geo)) return
  return {
    source: 'hackclub',
    url,
    name,
    date: londonDate(ev.start),
    city: clean(ev.city),
    country: clean(ev.countryCode) || clean(ev.country),
    geo,
    organiser: ev.hack_club_event ? 'Hack Club' : undefined,
    categories: ['Hackathon'],
  }
}

// City says London in the UK, or the coordinates sit in Greater London.
function inLondon(ev: HackClubEvent, geo: RawEvent['geo']): boolean {
  const code = (ev.countryCode ?? '').toUpperCase()
  if (code && code !== 'GB') return false
  if (/\blondon\b/i.test(ev.city ?? '')) return code === 'GB' || /united kingdom|england/i.test(`${ev.country} ${ev.state}`)
  return !!geo && code === 'GB' && km(geo, LONDON) <= LONDON_KM
}

// Read the hackathon's site for its description and listed sponsors, plus one
// same-host sponsor/partner page if the site links one.
async function enrich(event: RawEvent): Promise<RawEvent> {
  let html: string
  try {
    html = await getText(event.url)
  } catch {
    return event
  }
  try {
    const { event: page, partners } = parseEventHtml(event.url, html)
    const all: ScrapedPartner[] = [...partners]
    const extra = sponsorPage(event.url, html)
    if (extra) {
      try {
        const more = parseEventHtml(extra, await getText(extra)).partners
        for (const p of more) if (!all.some(q => q.domain === p.domain)) all.push(p)
      } catch {
        // the sponsor page is a bonus
      }
    }
    return {
      ...event,
      description: page.description || undefined,
      links: linksIn(event.url, html),
      partners: all.length ? all : undefined,
    }
  } catch {
    return event
  }
}

function sponsorPage(pageUrl: string, html: string): string | undefined {
  const host = hostOf(pageUrl)
  for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    let abs: URL
    try {
      abs = new URL(m[1], pageUrl)
    } catch {
      continue
    }
    if (hostOf(abs.href) !== host || abs.pathname === '/' || abs.href === pageUrl) continue
    if (/sponsor|partner/i.test(abs.pathname) || /^(our )?(sponsors?|partners?)$/i.test(text)) return abs.href
  }
  return
}

// Outbound links on the site that aren't navigation within it.
function linksIn(pageUrl: string, html: string): RawLink[] | undefined {
  const host = hostOf(pageUrl)
  const links: RawLink[] = []
  const seen = new Set<string>()
  for (const m of html.matchAll(/<a\b[^>]*\bhref=["'](https?:\/\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = m[1].trim()
    if (hostOf(href) === host || seen.has(href)) continue
    seen.add(href)
    const text = m[2].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
    links.push({ text: text || href, href })
    if (links.length >= 40) break
  }
  return links.length ? links : undefined
}

function siteUrl(href: string | undefined): string | undefined {
  if (!href) return
  try {
    const u = new URL(/^https?:\/\//i.test(href.trim()) ? href.trim() : `https://${href.trim()}`)
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : undefined
  } catch {
    return
  }
}

function hostOf(href: string): string {
  try {
    return new URL(href).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function pointOf(ev: HackClubEvent): RawEvent['geo'] {
  const lat = ev.latitude
  const lng = ev.longitude
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return
  if (lat === 0 && lng === 0) return
  return { lat, lng }
}

function clean(s: string | null | undefined): string | undefined {
  const t = s?.replace(/\s+/g, ' ').trim()
  return t || undefined
}

// Nearest upcoming events first, interleaved with the most recent past ones.
function order(events: RawEvent[], today: string): RawEvent[] {
  const ahead = events.filter(e => (e.date ?? '') >= today).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  const past = events.filter(e => (e.date ?? '') < today).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  const out: RawEvent[] = []
  for (let i = 0; i < ahead.length || i < past.length; i++) {
    if (i < ahead.length) out.push(ahead[i])
    if (i < past.length) out.push(past[i])
  }
  return out
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}

function dateRange(opts: DiscoverOptions) {
  const now = Date.now()
  return {
    from: londonDate(new Date(now - opts.pastDays * DAY_MS).toISOString()) ?? '',
    to: londonDate(new Date(now + opts.futureDays * DAY_MS).toISOString()) ?? '',
    today: londonDate(new Date(now).toISOString()) ?? '',
  }
}

function londonDate(iso: string): string | undefined {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return
  return d.toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
}
