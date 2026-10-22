// MLH: London hackathons from the season listings (mlh.io redirects to mlh.com).
// Each season page embeds its events as Inertia JSON in <script data-page="app">.
// Past events are paged (?page=2...). For each London event we read the MLH
// event page, then the hackathon's own website for sponsor sections.
import { parseEventHtml } from '../event'
import type { ScrapedPartner } from '../event'
import { getText } from '../http'
import type { Discover, DiscoverOptions, RawEvent, RawLink } from './types'

const BASE = 'https://www.mlh.com'
const MAX_PAST_PAGES = 6
const DAY_MS = 24 * 60 * 60 * 1000

type MlhEvent = {
  slug?: string
  name?: string
  startsAt?: string
  location?: string
  formatType?: string
  websiteUrl?: string | null
  venueAddress?: { city?: string | null; state?: string | null; country?: string | null } | null
  customFields?: { hackathon_focus?: unknown } | null
}

type SeasonProps = { upcomingEvents?: MlhEvent[]; pastEvents?: MlhEvent[] }
type SeasonPage = { props?: SeasonProps; scrollProps?: { pastEvents?: { nextPage?: number | null } } }
type ShowEvent = { organization?: { name?: string } | null; description?: string | null; links?: unknown }

export const discover: Discover = async opts => {
  const { from, to, today } = dateRange(opts)
  const found = new Map<string, MlhEvent>()

  let reached = 0
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)) + 1; year++) {
    if (await readSeason(year, from, found)) reached++
  }
  if (!reached) throw new Error('MLH season pages are unreachable')

  const events: RawEvent[] = []
  for (const ev of found.values()) {
    const event = toRaw(ev)
    if (event?.date && event.date >= from && event.date <= to) events.push(event)
  }

  const out: RawEvent[] = []
  for (const event of pick(events, opts.limit, today)) out.push(await enrich(event, found.get(event.url)))
  return out
}

// Read one season (all past pages back to `from`); true if the first page loaded.
async function readSeason(year: number, from: string, found: Map<string, MlhEvent>): Promise<boolean> {
  for (let page = 1; page <= MAX_PAST_PAGES; page++) {
    const url = `${BASE}/seasons/${year}/events${page > 1 ? `?page=${page}` : ''}`
    const data = await readPage<SeasonPage>(url)
    if (!data?.props) return page > 1
    const past = data.props.pastEvents ?? []
    for (const ev of [...(data.props.upcomingEvents ?? []), ...past]) {
      if (ev.slug && isLondon(ev) && isInPerson(ev)) found.set(pageUrl(ev.slug), ev)
    }
    const oldest = past.map(e => londonDate(e.startsAt ?? '') ?? '').sort()[0]
    if (!data.scrollProps?.pastEvents?.nextPage || !oldest || oldest < from) break
  }
  return true
}

async function readPage<T>(url: string): Promise<T | undefined> {
  try {
    const html = await getText(url)
    const raw = html.match(/<script[^>]*data-page="app"[^>]*>([\s\S]*?)<\/script>/)?.[1]
    return raw ? (JSON.parse(raw) as T) : undefined
  } catch {
    return
  }
}

function toRaw(ev: MlhEvent): RawEvent | undefined {
  const name = ev.name?.trim()
  if (!ev.slug || !name || !ev.startsAt) return
  const focus = Array.isArray(ev.customFields?.hackathon_focus)
    ? ev.customFields.hackathon_focus.filter((f): f is string => typeof f === 'string')
    : []
  return {
    source: 'mlh',
    url: pageUrl(ev.slug),
    name,
    date: londonDate(ev.startsAt),
    city: ev.venueAddress?.city || undefined,
    country: ev.venueAddress?.country || undefined,
    categories: ['Hackathon', ...focus],
    links: ev.websiteUrl ? [{ text: 'Event website', href: ev.websiteUrl }] : undefined,
  }
}

// MLH event page for organiser and description, then the event website for sponsors.
async function enrich(event: RawEvent, ev: MlhEvent | undefined): Promise<RawEvent> {
  const out = { ...event }
  try {
    const show = (await readPage<{ props?: { event?: ShowEvent; shortDescription?: string | null } }>(event.url))?.props
    out.organiser = show?.event?.organization?.name || undefined
    out.description = plain(show?.event?.description ?? show?.shortDescription ?? undefined)
    out.links = mergeLinks(out.links, linksOf(show?.event?.links))
  } catch {
    // keep the listing data
  }
  const site = ev?.websiteUrl
  if (!site) return out
  try {
    const { event: page, partners } = parseEventHtml(site, await getText(site))
    if (!out.description && page.description) out.description = plain(page.description)
    if (partners.length) out.partners = dedupe(partners)
  } catch {
    // website down or blocked: no partners
  }
  return out
}

function isLondon(ev: MlhEvent): boolean {
  const country = ev.venueAddress?.country
  if (country && !/^(gb|uk|united kingdom)$/i.test(country)) return false
  const place = `${ev.venueAddress?.city ?? ''} ${ev.location ?? ''}`
  return /\blondon\b/i.test(place) && !/ontario|canada/i.test(place)
}

function isInPerson(ev: MlhEvent): boolean {
  return /physical|hybrid/i.test(ev.formatType ?? '')
}

function pageUrl(slug: string): string {
  return `${BASE}/events/${slug}`
}

function linksOf(raw: unknown): RawLink[] {
  if (!Array.isArray(raw)) return []
  const out: RawLink[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const href = [o.url, o.href].find((v): v is string => typeof v === 'string' && /^https?:/i.test(v))
    if (!href) continue
    const text = [o.name, o.title, o.label, o.text].find((v): v is string => typeof v === 'string' && !!v.trim())
    out.push({ text: text?.trim() || href, href })
  }
  return out
}

function mergeLinks(a: RawLink[] | undefined, b: RawLink[]): RawLink[] | undefined {
  const out: RawLink[] = []
  for (const link of [...(a ?? []), ...b]) if (!out.some(l => l.href === link.href)) out.push(link)
  return out.length ? out : undefined
}

function dedupe(partners: ScrapedPartner[]): ScrapedPartner[] {
  return partners.filter((p, i) => partners.findIndex(q => q.domain === p.domain) === i)
}

function plain(text: string | undefined): string | undefined {
  if (!text) return
  const clean = text
    .replace(/<br\s*\/?>|<\/(p|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
  return clean ? clean.slice(0, 4000) : undefined
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
