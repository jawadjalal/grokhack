// Devpost source: in-person London hackathons from Devpost's public listing
// API, plus the explicit sponsor tiles on each hackathon page.
// Hackathon pages can sit behind a Cloudflare challenge for scripts. When one
// does, we stop fetching pages for the run and keep the API fields only.
import { parseEventHtml, type ScrapedPartner } from '../event'
import { getJson, getText } from '../http'
import type { Discover, RawEvent, RawLink } from './types'

const API = 'https://devpost.com/api/hackathons'
const STATUSES = ['upcoming', 'open', 'ended'] as const
const MAX_PAGES = 30

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

const SKIP_HOSTS = [
  'devpost.com', 'challengepost.com', 'linkedin.com', 'instagram.com', 'twitter.com', 'x.com',
  'facebook.com', 'fb.com', 'tiktok.com', 'youtube.com', 'youtu.be', 't.me', 'linktr.ee',
  'discord.gg', 'discord.com', 'github.com', 'google.com', 'goo.gl', 'bit.ly', 'amazonaws.com',
  'cloudfront.net', 'lu.ma', 'luma.com', 'meetup.com', 'eventbrite.com', 'eventbrite.co.uk',
]

type Hackathon = {
  id: number
  title?: string
  url?: string
  submission_period_dates?: string
  displayed_location?: { location?: string; icon?: string }
  themes?: { name?: string }[]
  prize_amount?: string
  registrations_count?: number
  organization_name?: string | null
}

type ListResponse = { hackathons?: Hackathon[]; meta?: { total_count?: number; per_page?: number } }

type Tile = { name: string; domain: string; href?: string; role: string; kind: 'sponsor' | 'venue' }

type Page = { description?: string; address?: string; place?: string; country?: string; tiles: Tile[] }

type PageState = { blocked: boolean }

export const discover: Discover = async opts => {
  const today = londonToday()
  const from = addDays(today, -opts.pastDays)
  const to = addDays(today, opts.futureDays)

  const listed = await listAll(from)
  const candidates = listed
    .map(h => ({ h, date: endDate(h.submission_period_dates ?? '') }))
    .filter((c): c is { h: Hackathon; date: string } => !!c.date && c.date >= from && c.date <= to)
    .filter(c => !!c.h.url && !!c.h.title && inPerson(c.h) && !inCanada(c.h))
    .sort((a, b) => b.date.localeCompare(a.date))

  const state: PageState = { blocked: false }
  const events: RawEvent[] = []
  for (const { h, date } of candidates) {
    if (events.length >= opts.limit) break
    try {
      const event = await toEvent(h, date, state)
      if (event) events.push(event)
    } catch {
      // one bad hackathon never stops the run
    }
  }
  return events
}

// Pages through each status. Ended is sorted by deadline, newest first, so we
// stop once a whole page is older than the window.
async function listAll(from: string): Promise<Hackathon[]> {
  const byId = new Map<number, Hackathon>()
  let failures = 0
  let firstError: unknown
  for (const status of STATUSES) {
    try {
      for (const h of await listStatus(status, from)) byId.set(h.id, h)
    } catch (err) {
      failures++
      firstError ??= err
    }
  }
  if (failures === STATUSES.length) throw firstError
  return [...byId.values()]
}

async function listStatus(status: string, from: string): Promise<Hackathon[]> {
  const out: Hackathon[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    let data: ListResponse
    try {
      data = await getJson<ListResponse>(listUrl(status, page))
    } catch (err) {
      if (page === 1) throw err
      break // keep what we already have
    }
    const list = data.hackathons ?? []
    out.push(...list)
    const perPage = data.meta?.per_page ?? 9
    const total = data.meta?.total_count ?? 0
    if (list.length < perPage || page * perPage >= total) break
    if (status === 'ended' && list.every(h => (endDate(h.submission_period_dates ?? '') ?? '') < from)) break
  }
  return out
}

function listUrl(status: string, page: number): string {
  const params = new URLSearchParams({ search: 'london', order_by: 'deadline', page: String(page) })
  params.append('status[]', status)
  params.append('challenge_type[]', 'in-person')
  return `${API}?${params}`
}

async function toEvent(h: Hackathon, date: string, state: PageState): Promise<RawEvent | undefined> {
  const location = h.displayed_location?.location?.trim()
  const listedInLondon = isLondon(location) || isLondon(h.title) || LONDON_VENUE.test(location ?? '')
  const page = await readPage(h.url!, state)
  // Every candidate came from search=london. With the page blocked, a bare venue or
  // company name ('Tessl AI Limited') that names no other place is taken as London.
  const bare = !page && !!location && !location.includes(',') && !ELSEWHERE.test(location)
  if (!listedInLondon && !isLondon(page?.place) && !bare) return

  const tiles = page?.tiles ?? []
  const partners: ScrapedPartner[] = tiles.map(t => ({ name: t.name, domain: t.domain, role: t.role, kind: t.kind, sourceUrl: h.url! }))
  const links: RawLink[] = tiles.flatMap(t => (t.href ? [{ text: t.name, href: t.href }] : []))
  const themes = (h.themes ?? []).map(t => t.name?.trim() ?? '').filter(Boolean)
  const venue = location || page?.address ? { name: location || undefined, address: page?.address } : undefined

  return {
    source: 'devpost',
    url: h.url!,
    name: squash(h.title!),
    date,
    city: 'London',
    country: page?.country,
    venue,
    organiser: h.organization_name?.trim() || undefined,
    audienceSize: h.registrations_count && h.registrations_count > 0 ? h.registrations_count : undefined,
    categories: themes.length ? themes : undefined,
    description: page?.description,
    links: links.length ? links : undefined,
    partners: partners.length ? partners : undefined,
  }
}

// Fetches a hackathon page once. A 403 means Cloudflare is challenging us, so
// stop asking for pages this run rather than keep knocking.
async function readPage(url: string, state: PageState): Promise<Page | undefined> {
  if (state.blocked) return
  let html: string
  try {
    html = await getText(url)
  } catch (err) {
    if (/^403\b/.test(err instanceof Error ? err.message : '')) state.blocked = true
    return
  }
  if (/<title>\s*Just a moment/i.test(html)) {
    state.blocked = true
    return
  }
  return parsePage(url, html)
}

export function parsePage(url: string, html: string): Page {
  let tiles = sponsorTiles(html)
  if (!tiles.length) tiles = fallbackPartners(url, html)
  return { description: description(html), ...ldAddress(html), tiles }
}

// Devpost's own sponsor block: <div id="sponsor-tiles"><a title="Go to X page" href><img alt="X"></a>...
function sponsorTiles(html: string): Tile[] {
  const start = html.search(/id=["']sponsor-tiles["']/i)
  if (start < 0) return []
  const end = html.indexOf('</article>', start)
  const block = html.slice(start, end > start ? end : start + 30000)
  const out: Tile[] = []
  const seen = new Set<string>()
  for (const a of block.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(a[1], 'href')
    const domain = href ? partnerDomain(href) : undefined
    const name = tileName(a[1], a[2])
    if (!href || !domain || !name || seen.has(domain)) continue
    seen.add(domain)
    out.push({ name, domain, href, role: 'Sponsor', kind: 'sponsor' })
  }
  return out
}

function tileName(attrs: string, inner: string): string | undefined {
  const alt = inner.match(/<img\b[^>]*\balt=["']([^"']*)["']/i)?.[1]
  const title = attr(attrs, 'title')?.replace(/^\s*go to\s+/i, '').replace(/\s+page\s*$/i, '')
  const text = inner.replace(/<[^>]+>/g, ' ')
  const name = squash(decode(alt || title || text))
  if (name.length < 2 || name.length > 80 || /^https?:/i.test(name)) return
  return name
}

// Organisers sometimes put a Sponsors heading with links in their own text.
function fallbackPartners(url: string, html: string): Tile[] {
  let partners: ScrapedPartner[]
  try {
    partners = parseEventHtml(url, html).partners
  } catch {
    return []
  }
  const out: Tile[] = []
  for (const p of partners) {
    if (skipHost(p.domain)) continue
    out.push({ name: p.name, domain: p.domain, role: p.role || 'Sponsor', kind: p.kind })
  }
  return out
}

function description(html: string): string | undefined {
  const body = html.match(/<article\b[^>]*id=["']challenge-description["'][^>]*>([\s\S]*?)<\/article>/i)?.[1]
  const text = body ? plain(body) : decode(metaContent(html, 'og:description') ?? '').trim()
  if (!text) return
  return text.length > 1500 ? text.slice(0, 1500).replace(/\s+\S*$/, '') : text
}

// JSON-LD Event > location > address. Street for display, every part for the London check.
function ldAddress(html: string): { address?: string; place?: string; country?: string } {
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    let data: unknown
    try {
      data = JSON.parse(m[1])
    } catch {
      continue
    }
    const a = (data as { location?: { address?: Record<string, unknown> } })?.location?.address
    if (!a || typeof a !== 'object') continue
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? squash(decode(v)) : undefined)
    const street = text(a.streetAddress)
    const rest = [text(a.addressLocality), text(a.postalCode)].filter(Boolean).join(', ')
    const place = [street, rest].filter(Boolean).join(', ')
    const country = text(a.addressCountry) ?? text((a.addressCountry as { name?: unknown } | undefined)?.name)
    if (place) return { address: street || rest, place, country }
  }
  return {}
}

function endDate(dates: string): string | undefined {
  // "Sep 12, 2026" | "Sep 10 - 12, 2026" | "Aug 30 - Sep 02, 2026" | "Dec 28, 2025 - Jan 02, 2026"
  const end = dates.match(/(?:([A-Za-z]{3,9})\.?\s+)?(\d{1,2}),\s*(\d{4})\s*$/)
  if (!end) return
  const monthName = end[1] ?? dates.match(/[A-Za-z]{3,9}/)?.[0]
  const month = monthName ? MONTHS.indexOf(monthName.slice(0, 3).toLowerCase()) + 1 : 0
  const day = Number(end[2])
  if (!month || day < 1 || day > 31) return
  return `${end[3]}-${pad(month)}-${pad(day)}`
}

function inPerson(h: Hackathon): boolean {
  const loc = h.displayed_location
  if (loc?.icon === 'globe') return false
  return !!loc?.location && !/^\s*online\s*$/i.test(loc.location)
}

// London universities and venues that Devpost locations name without the city.
const LONDON_VENUE = /\b(?:qmul|queen mary|ucl|imperial college|king'?s college|kcl|bush house|lse|london school of economics|encode hub|shoreditch|makerversity|somerset house|canary wharf|king'?s cross|here east|plexal|level39|google deepmind)\b/i
// Another city or country named in a location.
const ELSEWHERE = /\b(?:usa|united states|canada|india|germany|france|spain|italy|netherlands|ireland|scotland|wales|nigeria|kenya|singapore|australia|new york|nyc|san francisco|sf|boston|toronto|berlin|paris|madrid|amsterdam|dublin|edinburgh|glasgow|manchester|birmingham|bristol|cambridge|oxford|leeds|lagos|bangalore|bengaluru|mumbai|delhi|online|virtual)\b/i

function inCanada(h: Hackathon): boolean {
  return /\bCAD\b/.test(h.prize_amount ?? '') || isCanadian(h.displayed_location?.location)
}

function isLondon(text?: string): boolean {
  if (!text || isCanadian(text)) return false
  return /london(?!derry)/i.test(text) && !/\bnew london\b/i.test(text)
}

function isCanadian(text?: string): boolean {
  return !!text && (/\b(canada|ontario)\b/i.test(text) || /,\s*ON\b/.test(text))
}

function partnerDomain(href: string): string | undefined {
  try {
    const u = new URL(href)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    if (!host.includes('.') || skipHost(host)) return
    return host
  } catch {
    return
  }
}

function skipHost(host: string): boolean {
  return SKIP_HOSTS.some(s => host === s || host.endsWith(`.${s}`))
}

function londonToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function plain(html: string): string {
  const text = html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|tr|blockquote)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
  return decode(text)
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function metaContent(html: string, key: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    if ((attr(tag, 'property') ?? attr(tag, 'name')) === key) return attr(tag, 'content')
  }
  return
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))
  return m ? decode(m[2] ?? m[3] ?? '') : undefined
}

function squash(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => char(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => char(parseInt(d, 10)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function char(code: number): string {
  return Number.isFinite(code) && code >= 32 && code <= 0x10ffff ? String.fromCodePoint(code) : ''
}
