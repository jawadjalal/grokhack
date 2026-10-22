// Eventbrite source: in-person London events from Eventbrite's public search
// pages (/d/united-kingdom--london/<query>/, paginated with ?page=N only, as
// robots.txt allows). Each kept event's /e/ page is then read for the full
// description, its links, the organiser and any sponsor/partner section.
import { parseEventHtml, type ScrapedPartner } from '../event'
import { getText } from '../http'
import type { Discover, RawEvent, RawLink } from './types'

const BASE = 'https://www.eventbrite.co.uk'
const SEARCH = `${BASE}/d/united-kingdom--london`
// science-and-tech--events is mixed (lectures, theatre); the classifier filters later.
const SLUGS = ['tech--events', 'hackathon', 'ai', 'artificial-intelligence', 'developer', 'data', 'startups', 'science-and-tech--events']
const MAX_PAGES = 5
const MAX_SAME_NAME = 2 // weekly networking nights repeat one title; keep the soonest two
const LONDON = { lat: 51.5072, lng: -0.1276 }
const LONDON_KM = 25
const DAY_MS = 24 * 60 * 60 * 1000

// Hosts that are never useful as description links.
const SKIP_HOSTS = [
  'eventbrite.co.uk', 'eventbrite.com', 'eventbrite.ie', 'evbuc.com', 'eventbrite.app.link',
  'linkedin.com', 'lnkd.in', 'instagram.com', 'twitter.com', 'x.com', 'facebook.com', 'fb.com', 'fb.me',
  'tiktok.com', 'youtube.com', 'youtu.be', 't.me', 'telegram.me', 'whatsapp.com', 'wa.me', 'threads.net',
]

type EbAddress = {
  address_1?: string | null
  city?: string | null
  country?: string | null
  latitude?: string | number | null
  longitude?: string | number | null
  localized_address_display?: string | null
}
type EbResult = {
  id?: string
  name?: string
  summary?: string | null
  url?: string
  start_date?: string
  is_online_event?: boolean | null
  is_cancelled?: boolean | null
  tags?: { display_name?: string }[] | null
  primary_venue?: { name?: string | null; address?: EbAddress | null } | null
  primary_organizer?: { name?: string | null } | null
  locations?: { type?: string; name?: string }[] | null
}
type LdPlace = {
  '@type'?: string
  name?: string
  address?: string | { streetAddress?: string; addressLocality?: string; postalCode?: string; addressCountry?: string }
  geo?: { latitude?: string | number; longitude?: string | number }
}
type LdEvent = {
  '@type'?: string
  name?: string
  url?: string
  startDate?: string
  description?: string
  eventAttendanceMode?: string
  eventStatus?: string
  location?: LdPlace | LdPlace[]
  organizer?: { name?: string } | { name?: string }[]
}
type EbModule = { type?: string; text?: string | null; url?: string | null; alt?: string | null }
type EbContext = {
  basicInfo?: {
    summary?: string | null
    status?: string | null
    isOnline?: boolean | null
    organizer?: { name?: string | null } | null
    venue?: {
      name?: string | null
      address?: { localizedMultiLineAddressDisplay?: string[] | null; latitude?: string | null; longitude?: string | null; city?: string | null; country?: string | null } | null
    } | null
  }
  structuredContent?: { modules?: EbModule[] | null } | null
  taxonomies?: { category?: string | null; subcategory?: string | null; format?: string | null } | null
  goodToKnow?: { highlights?: { locationType?: string | null } | null } | null
}

// A search hit, already checked for London, in-person and not cancelled.
type Hit = RawEvent & { id: string; date: string }

export const discover: Discover = async opts => {
  const { from, to } = dateRange(opts.pastDays, opts.futureDays)
  const hits = new Map<string, Hit>()
  let reached = false

  for (const slug of SLUGS) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      const url = page === 1 ? `${SEARCH}/${slug}/` : `${SEARCH}/${slug}/?page=${page}`
      const html = await fetchPage(url)
      if (html === undefined) break
      reached = true
      const { results, pageCount } = readSearch(html)
      let added = 0
      for (const r of results) {
        if (hits.has(r.id)) continue
        hits.set(r.id, r) // remember out-of-range ones too, so they don't count as new
        added++
      }
      if (!added || (pageCount && page >= pageCount)) break
    }
  }
  if (!reached) throw new Error('Eventbrite search is unreachable')

  const picked = capRepeats([...hits.values()].filter(h => h.date >= from && h.date <= to).sort(byDate)).slice(0, opts.limit)
  const out: RawEvent[] = []
  for (const hit of picked) {
    const event = await withDetails(hit)
    if (event) out.push(event)
  }
  return out
}

// One retry on a network error; undefined when the page can't be had.
async function fetchPage(url: string): Promise<string | undefined> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await getText(url)
    } catch (err) {
      if (/^404 /.test(String((err as Error)?.message))) return
    }
  }
  return
}

// ---- search pages ----

function readSearch(html: string): { results: Hit[]; pageCount?: number } {
  const data = serverData(html)
  if (data) {
    const results = eventArrays(data).flat().map(fromResult).filter((h): h is Hit => !!h)
    const pageCount = pageCountOf(data)
    if (results.length) return { results, pageCount }
  }
  return { results: ldItems(html).map(fromLd).filter((h): h is Hit => !!h) }
}

// window.__SERVER_DATA__ = {...}; read the balanced object after the marker.
function serverData(html: string): unknown {
  const at = html.indexOf('window.__SERVER_DATA__')
  if (at < 0) return
  const start = html.indexOf('{', at)
  if (start < 0) return
  const end = balancedEnd(html, start)
  if (end < 0) return
  try {
    return JSON.parse(html.slice(start, end + 1))
  } catch {
    return
  }
}

function balancedEnd(s: string, start: number): number {
  let depth = 0
  let inString = false
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inString) {
      if (c === '\\') i++
      else if (c === '"') inString = false
    } else if (c === '"') inString = true
    else if (c === '{') depth++
    else if (c === '}' && --depth === 0) return i
  }
  return -1
}

// Search results live under search_data.events (or event_data.*_search.events on
// category pages); collect every array of event-shaped objects, promoted ones too.
function eventArrays(root: unknown): EbResult[][] {
  const found: EbResult[][] = []
  const walk = (node: unknown, depth: number) => {
    if (!node || typeof node !== 'object' || depth > 8) return
    if (Array.isArray(node)) {
      if (node.length && node.every(isResult)) found.push(node as EbResult[])
      else node.forEach(n => walk(n, depth + 1))
      return
    }
    for (const v of Object.values(node)) walk(v, depth + 1)
  }
  walk(root, 0)
  return found
}

function isResult(x: unknown): boolean {
  if (!x || typeof x !== 'object') return false
  const r = x as EbResult
  return typeof r.name === 'string' && typeof r.url === 'string' && typeof r.start_date === 'string'
}

function pageCountOf(data: unknown): number | undefined {
  const d = data as { page_count?: unknown; search_data?: { events?: { pagination?: { page_count?: unknown } } } }
  const n = d?.search_data?.events?.pagination?.page_count ?? d?.page_count
  return typeof n === 'number' ? n : undefined
}

function fromResult(r: EbResult): Hit | undefined {
  try {
    const canon = canonical(r.url ?? '')
    if (!canon || !r.name?.trim() || !r.start_date) return
    if (r.is_online_event || r.is_cancelled) return
    const venue = r.primary_venue
    const addr = venue?.address
    const geo = toGeo(addr?.latitude, addr?.longitude)
    if (!addr || (!addr.address_1 && !addr.localized_address_display && !geo)) return // no physical address
    if (!inLondon(r.locations ?? undefined, addr.city ?? undefined, geo)) return
    return {
      source: 'eventbrite',
      id: canon.id,
      url: canon.url,
      name: r.name.trim(),
      date: r.start_date.slice(0, 10),
      city: addr.city?.trim() || undefined,
      country: addr.country || undefined,
      venue: venueOf(venue?.name, addr.localized_address_display),
      geo,
      organiser: r.primary_organizer?.name?.trim() || undefined,
      categories: nonEmpty(unique((r.tags ?? []).map(t => t?.display_name ?? ''))),
      description: r.summary?.trim() || undefined,
    }
  } catch {
    return
  }
}

function ldItems(html: string): LdEvent[] {
  const items: LdEvent[] = []
  for (const block of ldBlocks(html)) {
    for (const node of Array.isArray(block) ? block : [block]) {
      const list = (node as { '@type'?: string; itemListElement?: { item?: LdEvent }[] })
      if (list?.['@type'] !== 'ItemList' || !Array.isArray(list.itemListElement)) continue
      for (const el of list.itemListElement) if (el?.item) items.push(el.item)
    }
  }
  return items
}

function fromLd(e: LdEvent): Hit | undefined {
  try {
    const canon = canonical(e.url ?? '')
    if (!canon || !e.name?.trim() || !e.startDate) return
    if (/Online/i.test(e.eventAttendanceMode ?? '') && !/Mixed/i.test(e.eventAttendanceMode ?? '')) return
    if (/Cancelled/i.test(e.eventStatus ?? '')) return
    const place = (Array.isArray(e.location) ? e.location : [e.location]).find(p => p?.['@type'] === 'Place')
    if (!place) return
    const a = typeof place.address === 'object' ? place.address : undefined
    const address = typeof place.address === 'string' ? place.address : joinParts([a?.streetAddress, a?.addressLocality, a?.postalCode])
    const geo = toGeo(place.geo?.latitude, place.geo?.longitude)
    if (!address && !geo) return
    if (!inLondon(undefined, a?.addressLocality, geo)) return
    const date = londonDay(e.startDate)
    if (!date) return
    return {
      source: 'eventbrite',
      id: canon.id,
      url: canon.url,
      name: decode(e.name).trim(),
      date,
      city: a?.addressLocality || undefined,
      country: a?.addressCountry || undefined,
      venue: venueOf(place.name, address),
      geo,
      organiser: ldOrganiser(e),
      description: e.description ? decode(e.description).trim() || undefined : undefined,
    }
  } catch {
    return
  }
}

// /e/<slug>-tickets-<id> on eventbrite.co.uk, no query string.
function canonical(raw: string): { id: string; url: string } | undefined {
  let u: URL
  try {
    u = new URL(raw, BASE)
  } catch {
    return
  }
  if (!/(^|\.)eventbrite\.[a-z.]+$/i.test(u.hostname)) return
  const m = u.pathname.match(/^\/e\/([^/]*?)(\d{6,})\/?$/)
  if (!m) return
  return { id: m[2], url: `${BASE}/e/${m[1]}${m[2]}` }
}

// Greater London by Eventbrite's own place tags, else by city or distance.
function inLondon(locations: { type?: string; name?: string }[] | undefined, city: string | undefined, geo: RawEvent['geo']): boolean {
  if (locations?.length) {
    return locations.some(l => (l.type === 'region' && /greater london/i.test(l.name ?? '')) || (l.type === 'locality' && /^london$/i.test(l.name ?? '')))
  }
  if (geo) return km(geo, LONDON) <= LONDON_KM
  return /\blondon\b/i.test(city ?? '')
}

// ---- event pages ----

async function withDetails(hit: Hit): Promise<RawEvent | undefined> {
  const { id: _id, ...event } = hit
  const html = await fetchPage(hit.url)
  if (!html) return event
  try {
    const ctx = nextContext(html)
    const ld = ldEvent(html)
    if (ctx?.goodToKnow?.highlights?.locationType === 'online' || ctx?.basicInfo?.isOnline === true) return
    if (/cancel/i.test(ctx?.basicInfo?.status ?? '') || /Cancelled/i.test(ld?.eventStatus ?? '')) return

    const body = ctx ? modulesHtml(ctx.structuredContent?.modules ?? []) : overviewHtml(html)
    const summary = ctx?.basicInfo?.summary?.trim() || event.description
    const text = body ? htmlToText(body) : ''
    const fallback = ld?.description ? decode(ld.description).trim() : ''
    event.description = joinDescription(summary, text) || fallback || event.description
    event.organiser ||= ctx?.basicInfo?.organizer?.name?.trim() || ldOrganiser(ld)
    if (!event.categories && ctx?.taxonomies) {
      const t = ctx.taxonomies
      event.categories = nonEmpty(unique([t.category ?? '', t.subcategory ?? '', t.format ?? '']))
    }
    const v = ctx?.basicInfo?.venue
    if (!event.geo) event.geo = toGeo(v?.address?.latitude, v?.address?.longitude)
    if (!event.venue && v) event.venue = venueOf(v.name, (v.address?.localizedMultiLineAddressDisplay ?? []).join(', '))
    if (body) {
      event.links = nonEmpty(linksIn(body))
      event.partners = nonEmpty(partnersIn(hit.url, body))
    }
  } catch {
    // keep what the search page gave us
  }
  return event
}

function nextContext(html: string): EbContext | undefined {
  const raw = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1]
  if (!raw) return
  try {
    const data = JSON.parse(raw) as { props?: { pageProps?: { context?: EbContext } } }
    return data.props?.pageProps?.context
  } catch {
    return
  }
}

function ldEvent(html: string): LdEvent | undefined {
  for (const block of ldBlocks(html)) {
    for (const node of Array.isArray(block) ? block : [block]) {
      const e = node as LdEvent
      if (typeof e?.['@type'] === 'string' && /Event$/.test(e['@type']) && e.name) return e
    }
  }
  return
}

function ldBlocks(html: string): unknown[] {
  const out: unknown[] = []
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      out.push(JSON.parse(m[1].trim()))
    } catch {}
  }
  return out
}

function ldOrganiser(e: LdEvent | undefined): string | undefined {
  const o = e?.organizer
  const first = Array.isArray(o) ? o[0] : o
  return first?.name ? decode(first.name).trim() || undefined : undefined
}

// The organiser's description: text modules as they are, linked images as <a><img>.
function modulesHtml(modules: EbModule[]): string {
  return modules
    .map(m => {
      if (m?.type === 'text' && m.text) return m.text
      if (m?.type === 'image' && m.url) return `<p><a href="${escapeAttr(m.url)}"><img alt="${escapeAttr(m.alt ?? '')}"></a></p>`
      return ''
    })
    .join('\n')
}

// Fallback when the page has no __NEXT_DATA__: the rendered Overview section.
function overviewHtml(html: string): string {
  const at = html.indexOf('data-testid="section-wrapper-overview"')
  if (at < 0) return ''
  const end = html.indexOf('data-testid="section-wrapper-', at + 40)
  return html.slice(at, end > at ? end : at + 60000)
}

function linksIn(html: string): RawLink[] {
  const links: RawLink[] = []
  const seen = new Set<string>()
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = decode(m[1].match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i)?.slice(1).find(Boolean) ?? '').trim()
    if (!keepHost(href) || seen.has(href)) continue
    seen.add(href)
    const alt = m[2].match(/<img\b[^>]*\balt=["']([^"']+)["']/i)?.[1]
    const text = decode(m[2].replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim() || (alt ? decode(alt).trim() : '')
    links.push({ text: text || href, href })
  }
  return links
}

function keepHost(href: string): boolean {
  try {
    const u = new URL(href)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    return !SKIP_HOSTS.some(h => host === h || host.endsWith(`.${h}`)) && !/(^|\.)eventbrite\./.test(host)
  } catch {
    return false
  }
}

// Sponsors only from sponsor/partner/venue headings in the organiser's own text.
function partnersIn(url: string, body: string): ScrapedPartner[] {
  return parseEventHtml(url, `<div>${body}</div>`).partners.filter(p => !/(^|\.)(eventbrite\.[a-z.]+|evbuc\.com)$/i.test(p.domain))
}

// ---- helpers ----

function htmlToText(html: string): string {
  return decode(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<\/?(p|div|h[1-6]|li|ul|ol|tr|table|blockquote)\b[^>]*>/gi, '\n')
      .replace(/<\/?(td|th|img)\b[^>]*>/gi, ' ')
      .replace(/<[^>]+>/g, ''), // inline tags (strong, span, a) can split a word
  )
    .replace(/[ \t\xa0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function joinDescription(summary: string | undefined, body: string): string | undefined {
  const s = summary?.trim() ?? ''
  let text = body
  if (s && !body.startsWith(s)) text = body ? `${s}\n\n${body}` : s
  text = text.trim()
  return text ? (text.length > 4000 ? text.slice(0, 4000).trim() : text) : undefined
}

function venueOf(name: string | null | undefined, address: string | null | undefined): RawEvent['venue'] {
  const n = name?.trim() || undefined
  const a = address?.trim() || undefined
  return n || a ? { name: n, address: a } : undefined
}

function toGeo(lat: unknown, lng: unknown): RawEvent['geo'] {
  const la = Number(lat)
  const ln = Number(lng)
  if (lat == null || lng == null || lat === '' || lng === '') return
  if (!Number.isFinite(la) || !Number.isFinite(ln) || (la === 0 && ln === 0)) return
  return { lat: la, lng: ln }
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.sqrt(h))
}

function capRepeats(hits: Hit[]): Hit[] {
  const counts = new Map<string, number>()
  return hits.filter(h => {
    const key = h.name.toLowerCase().replace(/\d+(st|nd|rd|th)?/g, '').replace(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b/g, '').replace(/[^a-z]+/g, ' ').trim()
    const n = (counts.get(key) ?? 0) + 1
    counts.set(key, n)
    return n <= MAX_SAME_NAME
  })
}

function byDate(a: Hit, b: Hit): number {
  return a.date.localeCompare(b.date) || a.name.localeCompare(b.name)
}

function dateRange(pastDays: number, futureDays: number) {
  const now = Date.now()
  return {
    from: londonDay(new Date(now - pastDays * DAY_MS).toISOString()) ?? '',
    to: londonDay(new Date(now + futureDays * DAY_MS).toISOString()) ?? '',
  }
}

// YYYY-MM-DD in London. A bare date is already local.
function londonDay(iso: string): string | undefined {
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function joinParts(parts: (string | undefined)[]): string | undefined {
  const s = parts.map(p => p?.trim()).filter(Boolean).join(', ')
  return s || undefined
}

function unique(list: string[]): string[] {
  const seen = new Set<string>()
  return list
    .map(s => s.trim())
    .filter(s => {
      const k = s.toLowerCase()
      if (!s || seen.has(k)) return false
      seen.add(k)
      return true
    })
}

function nonEmpty<T>(list: T[]): T[] | undefined {
  return list.length ? list : undefined
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => char(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => char(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function char(code: number): string {
  return Number.isFinite(code) && code >= 32 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
}
