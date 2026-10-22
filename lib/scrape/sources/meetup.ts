// Meetup: London in-person tech events. The find page and each event page are
// Next.js pages whose Apollo state holds the events, groups and venues.
// Upcoming events come from keyword searches; past ones from the past-events
// page of each group we found. Group sponsors listed by Meetup become partners.
import type { ScrapedPartner } from '../event'
import { getText } from '../http'
import type { Discover, DiscoverOptions, RawEvent, RawLink } from './types'

const BASE = 'https://www.meetup.com'
const KEYWORDS = ['tech', 'ai', 'developer', 'startup', 'data']
const MAX_GROUPS = 15 // groups whose past events page we read
const DAY_MS = 24 * 60 * 60 * 1000

type Apollo = Record<string, Record<string, unknown>>
type Ref = { __ref?: string }
type Venue = { name?: string; address?: string; city?: string; country?: string; lat?: number; lon?: number }
type Group = { name?: string; urlname?: string; city?: string; sponsors?: { edges?: { node?: Ref }[] } }
type Sponsor = { name?: string; url?: string }
type MeetupEvent = {
  title?: string
  dateTime?: string
  eventUrl?: string
  eventType?: string
  description?: string
  group?: Ref
  venue?: Ref | Venue | null
  topics?: { edges?: { node?: Ref }[] }
  [key: string]: unknown
}

type Found = { event: RawEvent; urlname?: string }

export const discover: Discover = async opts => {
  const { from, to, today } = dateRange(opts)
  const found = new Map<string, Found>()

  let reached = 0
  for (const keyword of KEYWORDS) {
    const url = `${BASE}/find/?location=gb--17--London&source=EVENTS&eventType=inPerson&keywords=${keyword}`
    const state = await readPage(url)
    if (!state) continue
    reached++
    collect(state, found, from, to)
  }
  if (!reached) throw new Error('Meetup search is unreachable')

  if (opts.pastDays > 0) {
    const groups = [...new Set([...found.values()].map(f => f.urlname).filter((u): u is string => !!u))]
    for (const urlname of groups.slice(0, MAX_GROUPS)) {
      const state = await readPage(`${BASE}/${urlname}/events/?type=past`)
      if (state) collect(state, found, from, to)
    }
  }

  const picked = pick([...found.values()].map(f => f.event), opts.limit, today)
  const out: RawEvent[] = []
  for (const event of picked) out.push(await enrich(event))
  return out
}

// Fetch a Meetup page and return its Apollo state, or undefined on any failure.
async function readPage(url: string): Promise<Apollo | undefined> {
  try {
    const html = await getText(url)
    const raw = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1]
    if (!raw) return
    const state = JSON.parse(raw)?.props?.pageProps?.__APOLLO_STATE__
    return state && typeof state === 'object' ? (state as Apollo) : undefined
  } catch {
    return
  }
}

function collect(state: Apollo, found: Map<string, Found>, from: string, to: string) {
  for (const ev of eventsIn(state)) {
    try {
      const item = toFound(state, ev)
      if (!item || found.has(item.event.url)) continue
      const date = item.event.date
      if (!date || date < from || date > to) continue
      found.set(item.event.url, item)
    } catch {
      // one odd event never stops the rest
    }
  }
}

function eventsIn(state: Apollo): MeetupEvent[] {
  return Object.keys(state).filter(k => k.startsWith('Event:')).map(k => state[k] as MeetupEvent)
}

function toFound(state: Apollo, ev: MeetupEvent): Found | undefined {
  const url = cleanUrl(ev.eventUrl)
  const name = ev.title?.trim()
  if (!url || !name || !ev.dateTime) return
  if (ev.eventType !== 'PHYSICAL' && ev.eventType !== 'HYBRID') return
  const group = deref<Group>(state, ev.group)
  const venue = realVenue(deref<Venue>(state, ev.venue))
  if (!inLondon(venue, group, name)) return
  const text = unescape(ev.description)
  return {
    urlname: group?.urlname,
    event: {
      source: 'meetup',
      url,
      name,
      date: londonDate(ev.dateTime),
      city: venue?.city || undefined,
      country: venue?.country?.toUpperCase() || undefined,
      venue: venue ? { name: venue.name || undefined, address: venue.address || undefined } : undefined,
      geo: pointOf(venue),
      organiser: group?.name || undefined,
      audienceSize: attendees(ev),
      description: plain(text),
      links: linksIn(text),
    },
  }
}

// Read the event page for the full description, venue, topics and group sponsors.
async function enrich(event: RawEvent): Promise<RawEvent> {
  const state = await readPage(event.url)
  if (!state) return event
  try {
    const ev = eventsIn(state).find(e => cleanUrl(e.eventUrl) === event.url)
    if (!ev) return event
    const group = deref<Group>(state, ev.group)
    const venue = realVenue(deref<Venue>(state, ev.venue))
    const text = unescape(ev.description)
    const topics = (ev.topics?.edges ?? []).map(e => deref<{ name?: string }>(state, e.node)?.name).filter((n): n is string => !!n)
    return {
      ...event,
      city: venue?.city || event.city,
      country: venue?.country?.toUpperCase() || event.country,
      venue: venue ? { name: venue.name || undefined, address: venue.address || undefined } : event.venue,
      geo: pointOf(venue) ?? event.geo,
      organiser: group?.name || event.organiser,
      audienceSize: attendees(ev) ?? event.audienceSize,
      categories: topics.length ? topics : event.categories,
      description: plain(text) ?? event.description,
      links: linksIn(text) ?? event.links,
      partners: sponsorsOf(state, group, event.url),
    }
  } catch {
    return event
  }
}

function deref<T>(state: Apollo, value: unknown): T | undefined {
  if (!value || typeof value !== 'object') return
  const ref = (value as Ref).__ref
  if (typeof ref === 'string') return state[ref] as T | undefined
  return value as T
}

function realVenue(venue: Venue | undefined): Venue | undefined {
  if (!venue || /^online event$/i.test(venue.name ?? '')) return
  if (!venue.name && !venue.address && !venue.city) return
  return venue
}

// Venue coordinates as Meetup gives them (lat/lon); none for hidden venues.
function pointOf(venue: Venue | undefined): RawEvent['geo'] {
  const lat = venue?.lat
  const lon = venue?.lon
  if (typeof lat !== 'number' || typeof lon !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lon)) return
  return lat || lon ? { lat, lng: lon } : undefined
}

// London if the venue says so; with no venue, trust the group city or the title.
function inLondon(venue: Venue | undefined, group: Group | undefined, title: string): boolean {
  if (venue?.city) return /london/i.test(venue.city)
  if (venue?.address) return /london/i.test(venue.address)
  return /london/i.test(group?.city ?? '') || /london/i.test(title)
}

function attendees(ev: MeetupEvent): number | undefined {
  const keys = ['rsvps({"filter":{"rsvpStatus":["YES"]}})', 'going', 'rsvps']
  for (const key of keys) {
    const n = (ev[key] as { totalCount?: unknown } | undefined)?.totalCount
    if (typeof n === 'number' && n > 0) return n
  }
  return
}

function sponsorsOf(state: Apollo, group: Group | undefined, sourceUrl: string): ScrapedPartner[] | undefined {
  const out: ScrapedPartner[] = []
  for (const edge of group?.sponsors?.edges ?? []) {
    const sponsor = deref<Sponsor>(state, edge.node)
    const name = sponsor?.name?.trim()
    const domain = domainOf(sponsor?.url)
    if (!name || !domain || out.some(p => p.domain === domain)) continue
    if (PROMO_NAME.test(name) || LISTING_URL.test(sponsor?.url ?? '') || ownSite(domain, group)) continue
    out.push({ name, domain, role: 'Group sponsor', kind: 'sponsor', sourceUrl })
  }
  return out.length ? out : undefined
}

// Group "sponsor" slots also hold promos: a book on amazon.com/dp/..., 'Free Hands-on Online Training'.
const PROMO_NAME = /\b(?:free|training|course|webinar|e-?book|book|discount|coupon|tutorial|learn|download|buy|get started|sign up)\b/i
const LISTING_URL = /^https?:\/\/(?:[\w-]+\.)*amazon\.[a-z.]+\/|\/(?:dp|gp\/product|products?|books?|ebooks?|forums?|courses?|training)(?:\/|$)/i

// The group's own site (or a subdomain of it) is the organiser, not a sponsor.
function ownSite(domain: string, group: Group | undefined): boolean {
  const key = (group?.urlname ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  const label = domain.split('.').slice(-2)[0] ?? ''
  return label.length >= 3 && key.includes(label)
}

function domainOf(href: string | undefined): string | undefined {
  if (!href) return
  try {
    const host = new URL(href).hostname.toLowerCase().replace(/^www\./, '')
    if (!host.includes('.') || host === 'meetup.com' || host.endsWith('.meetup.com')) return
    return host
  } catch {
    return
  }
}

function cleanUrl(href: string | undefined): string | undefined {
  if (!href) return
  try {
    const u = new URL(href)
    return `${u.origin}${u.pathname}`
  } catch {
    return
  }
}

// Meetup descriptions are markdown with backslash escapes.
function unescape(md: string | undefined): string | undefined {
  return md?.replace(/​/g, '').replace(/\\([\\`*_{}[\]()#+\-.!~|])/g, '$1')
}

function plain(md: string | undefined): string | undefined {
  if (!md) return
  const text = md
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\(([^)]+)\)/g, '$1')
    .replace(/\*\*|__/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return text ? text.slice(0, 4000) : undefined
}

function linksIn(md: string | undefined): RawLink[] | undefined {
  if (!md) return
  const links: RawLink[] = []
  const seen = new Set<string>()
  const add = (text: string, raw: string) => {
    const href = raw.replace(/[.,;:!?*]+$/, '')
    if (seen.has(href)) return
    seen.add(href)
    links.push({ text: text.replace(/\*\*/g, '').trim() || href, href })
  }
  for (const m of md.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)) add(m[1], m[2])
  for (const m of md.matchAll(/https?:\/\/[^\s)\]<>]+/g)) add(m[0], m[0])
  return links.length ? links : undefined
}

// Mix the nearest upcoming and the most recent past events, up to the limit.
function pick(events: RawEvent[], limit: number, today: string): RawEvent[] {
  const ahead = events.filter(e => (e.date ?? '') >= today).sort((a, b) => (a.date ?? '').localeCompare(b.date ?? ''))
  const past = events.filter(e => (e.date ?? '') < today).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''))
  const out: RawEvent[] = []
  for (let i = 0; out.length < limit && (i < ahead.length || i < past.length); i++) {
    if (i < ahead.length) out.push(ahead[i])
    if (i < past.length && out.length < limit) out.push(past[i])
  }
  return out
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
