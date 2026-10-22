// Google Developer Groups: London chapters on Bevy (gdg.community.dev).
// The public event_slim API lists each chapter's events; the event API gives
// the venue, coordinates, tags and the partners Bevy shows on the event page.
// Only in-person or hybrid events whose venue is in London are kept.
import type { ScrapedPartner } from '../event'
import { getJson } from '../http'
import type { Discover, DiscoverOptions, RawEvent, RawLink } from './types'

const BASE = 'https://gdg.community.dev'
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_PAGES = 10 // per chapter and status, 50 events a page

// London chapters, verified on 22 Oct 2026 via /api/search/chapter/ and each
// chapter page's chapter_id. GDG Essex (Romford) runs some events in London.
// No Bevy chapter exists for KCL, QMUL, City or a London WTM group.
const CHAPTERS = [
  { id: 995, slug: 'gdg-london' },
  { id: 444, slug: 'gdg-cloud-london' },
  { id: 2413, slug: 'gdg-on-campus-imperial-college-london-london-united-kingdom' },
  { id: 2420, slug: 'gdg-on-campus-university-college-london-london-united-kingdom' },
  { id: 3403, slug: 'gdg-on-campus-lsbu-london-london-uk' },
  { id: 3476, slug: 'gdg-on-campus-university-of-east-london-docklands-campus-london-united-kingdom' },
  { id: 3344, slug: 'gdg-essex' },
]

const LONDON = { lat: 51.5072, lng: -0.1276 }
const LONDON_KM = 30
const LONDON_POSTCODE = /\b(?:EC|WC|E|N|NW|SE|SW|W)\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/i

type Page<T> = { links?: { next?: string | null }; results?: T[] }

type Slim = {
  id?: number
  title?: string
  start_date?: string
  audience_type?: string
  chapter_title?: string
}

type Company = { company?: string; name?: string; url?: string; visible?: boolean }

type Detail = {
  id?: number
  title?: string
  audience_type?: string
  description?: string
  description_short?: string
  start_date?: string
  url?: string
  hide_location?: boolean
  venue_name?: string | null
  venue_address?: string | null
  venue_city?: string | null
  venue_zip_code?: string | null
  venue_country?: string | null
  venue_latitude?: number | null
  venue_longitude?: number | null
  total_attendees?: number
  use_external_ticketing?: boolean
  tags?: string[]
  chapter?: { title?: string; city?: string; country?: string }
  [key: string]: unknown
}

type Candidate = { id: number; date: string; chapter?: string }

export const discover: Discover = async opts => {
  const { from, to, today } = dateRange(opts)
  const found = new Map<number, Candidate>()

  let reached = 0
  for (const chapter of CHAPTERS) {
    const live = await listEvents(chapter.id, 'Live', 'start_date', from, to)
    const done = opts.pastDays > 0 ? await listEvents(chapter.id, 'Completed', '-start_date', from, to) : []
    if (live) reached++
    for (const c of [...(live ?? []), ...(done ?? [])]) if (!found.has(c.id)) found.set(c.id, c)
  }
  if (!reached) throw new Error('GDG (Bevy) events API is unreachable')

  const out: RawEvent[] = []
  for (const c of order([...found.values()], today)) {
    if (out.length >= opts.limit) break
    const event = await readEvent(c)
    if (event) out.push(event)
  }
  return out
}

// In-window, in-person or hybrid events of one chapter. Undefined if the API failed.
async function listEvents(chapter: number, status: string, sort: string, from: string, to: string): Promise<Candidate[] | undefined> {
  const out: Candidate[] = []
  let url: string | null | undefined = `${BASE}/api/event_slim/for_chapter/${chapter}/?page_size=50&status=${status}&include_cohosted_events=true&visible_on_parent_chapter_only=true&order=${sort}`
  for (let page = 0; url && page < MAX_PAGES; page++) {
    let data: Page<Slim>
    try {
      data = await getJson<Page<Slim>>(url)
    } catch {
      return page ? out : undefined
    }
    const items = data.results ?? []
    let beyond = false
    for (const ev of items) {
      const date = ev.start_date ? londonDate(ev.start_date) : undefined
      if (!ev.id || !date) continue
      if (date < from || date > to) {
        // Pages are sorted by date, so one event past the window ends the walk.
        if (status === 'Live' ? date > to : date < from) beyond = true
        continue
      }
      if (ev.audience_type !== 'IN_PERSON' && ev.audience_type !== 'HYBRID') continue
      out.push({ id: ev.id, date, chapter: ev.chapter_title })
    }
    if (beyond || !items.length) break
    url = data.links?.next
  }
  return out
}

async function readEvent(c: Candidate): Promise<RawEvent | undefined> {
  let d: Detail
  try {
    d = await getJson<Detail>(`${BASE}/api/event/${c.id}/`)
  } catch {
    return
  }
  try {
    return toRaw(d, c)
  } catch {
    return
  }
}

function toRaw(d: Detail, c: Candidate): RawEvent | undefined {
  const name = clean(d.title)
  const url = d.url || undefined
  if (!name || !url) return
  if (d.audience_type !== 'IN_PERSON' && d.audience_type !== 'HYBRID') return
  const geo = pointOf(d)
  const address = joinAddress(d.venue_address, d.venue_zip_code)
  const venueName = clean(d.venue_name)
  if (!inLondon(d, address, geo)) return
  const html = d.description ?? ''
  return {
    source: 'gdg',
    url,
    name,
    date: d.start_date ? londonDate(d.start_date) : c.date,
    city: clean(d.venue_city) || (venueName || address ? undefined : clean(d.chapter?.city)),
    // Bevy defaults venue_country to US when a venue was typed in by hand, so
    // trust it only with coordinates; otherwise use the chapter's country.
    country: (geo && clean(d.venue_country)) || clean(d.chapter?.country),
    venue: venueName || address ? { name: venueName, address } : undefined,
    geo,
    organiser: chapterName(c.chapter || d.chapter?.title),
    audienceSize: !d.use_external_ticketing && typeof d.total_attendees === 'number' && d.total_attendees > 0 ? d.total_attendees : undefined,
    categories: d.tags?.length ? d.tags : undefined,
    description: plain(html) || clean(d.description_short),
    links: linksIn(html),
    partners: partnersOf(d, url, venueName),
  }
}

// Venue city or address says London, a London postcode, or coordinates near
// London. With the venue hidden, a London chapter's word is all we have.
function inLondon(d: Detail, address: string | undefined, geo: RawEvent['geo']): boolean {
  const place = [d.venue_city, d.venue_name, address].filter(Boolean).join(', ')
  if (/\blondon\b/i.test(place) || LONDON_POSTCODE.test(d.venue_zip_code ?? '') || LONDON_POSTCODE.test(address ?? '')) return true
  if (geo) return km(geo, LONDON) <= LONDON_KM
  return !place && d.chapter?.city === 'London' && d.chapter?.country === 'GB'
}

function pointOf(d: Detail): RawEvent['geo'] {
  const lat = d.venue_latitude
  const lng = d.venue_longitude
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) return
  if (lat === 0 && lng === 0) return
  return { lat, lng }
}

// Bevy lists event partners (partners_list) and tiered sponsors. A partner
// that is also the venue is recorded as the venue partner.
function partnersOf(d: Detail, sourceUrl: string, venueName: string | undefined): ScrapedPartner[] | undefined {
  const out: ScrapedPartner[] = []
  const add = (list: unknown, role: string) => {
    if (!Array.isArray(list)) return
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const co = item as Company
      if (co.visible === false) continue
      const name = clean(co.company || co.name)
      const domain = domainOf(co.url)
      if (!name || !domain || out.some(p => p.domain === domain)) continue
      const venue = !!venueName && sameName(name, venueName)
      out.push({ name, domain, role: venue ? 'Venue partner' : role, kind: venue ? 'venue' : 'sponsor', sourceUrl })
    }
  }
  for (const [key, value] of Object.entries(d)) {
    const tier = key.match(/^sponsors_([a-z]+)-\d+$/)?.[1]
    if (tier) add(value, `${tier[0].toUpperCase()}${tier.slice(1)} sponsor`)
  }
  add(d.sponsors, 'Sponsor')
  add(d.partners_list, 'Partner')
  return out.length ? out : undefined
}

function sameName(a: string, b: string): boolean {
  const x = a.toLowerCase().trim()
  const y = b.toLowerCase().trim()
  return x.length > 2 && y.length > 2 && (y.startsWith(x) || x.startsWith(y))
}

function domainOf(href: string | undefined): string | undefined {
  if (!href) return
  try {
    const u = new URL(/^https?:\/\//i.test(href) ? href : `https://${href}`)
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    if (!host.includes('.') || host.endsWith('community.dev')) return
    return host
  } catch {
    return
  }
}

function chapterName(title: string | undefined): string | undefined {
  // "GDG on Campus Imperial College London - London, United Kingdom" -> the name part
  return clean(title?.replace(/\s+-\s+[^-]+,\s*[^,-]+$/, ''))
}

function joinAddress(address: string | null | undefined, zip: string | null | undefined): string | undefined {
  const a = clean(address)
  const z = clean(zip)
  if (a && z && !a.toLowerCase().includes(z.toLowerCase())) return `${a}, ${z}`
  return a || z
}

function plain(html: string): string | undefined {
  const text = decode(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/​/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text ? text.slice(0, 4000) : undefined
}

function linksIn(html: string): RawLink[] | undefined {
  const links: RawLink[] = []
  const seen = new Set<string>()
  for (const m of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decode(m[1]).trim()
    if (!/^https?:\/\//i.test(href) || seen.has(href)) continue
    seen.add(href)
    links.push({ text: decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim() || href, href })
  }
  return links.length ? links : undefined
}

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function clean(s: string | null | undefined): string | undefined {
  const t = s?.replace(/\s+/g, ' ').trim()
  return t || undefined
}

// Nearest upcoming events first, interleaved with the most recent past ones.
function order(items: Candidate[], today: string): Candidate[] {
  const ahead = items.filter(c => c.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  const past = items.filter(c => c.date < today).sort((a, b) => b.date.localeCompare(a.date))
  const out: Candidate[] = []
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
