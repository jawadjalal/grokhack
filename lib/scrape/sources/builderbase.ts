// Builderbase: London hackathons from its public discovery API (active and past,
// paged by cursor). Native events have a page at builderbase.com/event/<slug>,
// a detail endpoint and a sponsors endpoint. External events are listings that
// point at another site (Luma, Devpost...), so we keep that URL instead.
import { parseEventHtml } from '../event'
import type { ScrapedPartner } from '../event'
import { getJson } from '../http'
import type { Discover, DiscoverOptions, RawEvent, RawLink } from './types'

const API = 'https://edge.builderbase.com/super-events/public'
const PAGE = 'https://builderbase.com/event'
const MAX_PAGES = 6
const DAY_MS = 24 * 60 * 60 * 1000

type BbEvent = {
  kind?: string
  name?: string
  slug?: string | null
  description?: string | null
  start_at?: string
  format?: string
  event_type?: string | null
  location?: { city?: string | null; country?: string | null; lat?: number | null; lng?: number | null; precise?: boolean } | null
  participant_count?: number | null
  organization?: { name?: string } | null
  theme_tags?: string[] | null
  external_url?: string | null
}

type Discovery = { data?: { events?: BbEvent[]; next_cursor?: string | null } }

type Venue = { name?: string; streetAddress?: string; addressLocality?: string; postalCode?: string }
type Detail = {
  description?: string | null
  seo_description?: string | null
  venue?: Venue | null
  page_data?: { html?: string } | null
}
type Sponsors = { tiers?: { tier_name?: string | null; sponsors?: { name?: string; website?: string | null }[] }[] }

export const discover: Discover = async opts => {
  const { from, to, today } = dateRange(opts)
  const active = await list('active', from)
  const past = opts.pastDays > 0 ? await list('past', from) : []
  if (!active && !past) throw new Error('Builderbase discovery API is unreachable')

  const events = new Map<string, { event: RawEvent; slug?: string }>()
  for (const ev of [...(active ?? []), ...(past ?? [])]) {
    try {
      const item = toRaw(ev)
      const date = item?.event.date
      if (!item || !date || date < from || date > to || events.has(item.event.url)) continue
      events.set(item.event.url, item)
    } catch {
      // skip one odd listing
    }
  }

  const slugs = new Map([...events.values()].map(e => [e.event.url, e.slug]))
  const out: RawEvent[] = []
  for (const event of pick([...events.values()].map(e => e.event), opts.limit, today)) {
    const slug = slugs.get(event.url)
    out.push(slug ? await enrich(event, slug) : event)
  }
  return out
}

// Page through one status. Past is newest first per phase (native, then
// external), so stop once an external listing is older than the window.
async function list(status: 'active' | 'past', from: string): Promise<BbEvent[] | undefined> {
  const out: BbEvent[] = []
  let cursor: string | null | undefined
  for (let page = 0; page < MAX_PAGES; page++) {
    const url = `${API}/discovery?status=${status}&limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`
    let res: Discovery
    try {
      res = await getJson<Discovery>(url)
    } catch {
      return page ? out : undefined
    }
    const batch = res.data?.events ?? []
    out.push(...batch)
    cursor = res.data?.next_cursor
    const last = batch[batch.length - 1]
    const lastDate = londonDate(last?.start_at ?? '') ?? ''
    if (!cursor || !batch.length) break
    if (status === 'past' && last?.kind === 'external' && lastDate < from) break
  }
  return out
}

function toRaw(ev: BbEvent): { event: RawEvent; slug?: string } | undefined {
  const name = ev.name?.trim()
  if (!name || !ev.start_at || ev.format === 'online' || !isLondon(ev)) return
  const native = ev.kind !== 'external' && !!ev.slug
  const url = native ? `${PAGE}/${ev.slug}` : stripTracking(ev.external_url)
  if (!url) return
  const categories = [...(ev.theme_tags ?? []), ev.event_type ?? ''].filter(Boolean)
  return {
    slug: native ? ev.slug ?? undefined : undefined,
    event: {
      source: 'builderbase',
      url,
      name,
      date: londonDate(ev.start_at),
      city: ev.location?.city || undefined,
      country: ev.location?.country || undefined,
      geo: pointOf(ev.location),
      organiser: ev.organization?.name || undefined,
      audienceSize: ev.participant_count && ev.participant_count > 0 ? ev.participant_count : undefined,
      categories: categories.length ? categories : undefined,
      description: plain(ev.description),
      links: linksIn(ev.description),
    },
  }
}

// Native events: full description, venue, the custom page's links and sponsors.
async function enrich(event: RawEvent, slug: string): Promise<RawEvent> {
  const out = { ...event }
  try {
    const detail = (await getJson<{ data?: { super_event?: Detail } }>(`${API}/${slug}`)).data?.super_event
    if (detail) {
      out.description = plain(detail.description) ?? plain(detail.seo_description) ?? out.description
      out.venue = venueOf(detail.venue)
      out.links = mergeLinks(linksIn(detail.description), pageLinks(detail.page_data?.html)) ?? out.links
      if (detail.page_data?.html) out.partners = parseEventHtml(event.url, detail.page_data.html).partners
    }
  } catch {
    // keep the listing data
  }
  try {
    const sponsors = (await getJson<{ data?: Sponsors }>(`${API}/${slug}/sponsors`)).data
    out.partners = dedupe([...tierSponsors(sponsors, event.url), ...(out.partners ?? [])])
  } catch {
    // no sponsors endpoint for this one
  }
  if (!out.partners?.length) out.partners = undefined
  return out
}

function tierSponsors(data: Sponsors | undefined, sourceUrl: string): ScrapedPartner[] {
  const out: ScrapedPartner[] = []
  for (const tier of data?.tiers ?? []) {
    const role = tier.tier_name && !/^other$/i.test(tier.tier_name) ? `${tier.tier_name} sponsor` : 'Sponsor'
    for (const s of tier.sponsors ?? []) {
      const name = s.name?.trim()
      const domain = domainOf(s.website ?? undefined)
      if (name && domain) out.push({ name, domain, role, kind: 'sponsor', sourceUrl })
    }
  }
  return out
}

function venueOf(v: Venue | null | undefined): RawEvent['venue'] {
  if (!v) return
  const address = v.streetAddress ? [v.streetAddress, v.addressLocality, v.postalCode].filter(Boolean).join(', ') : undefined
  return v.name || address ? { name: v.name || undefined, address } : undefined
}

// Only coordinates Builderbase marks precise. Some precise ones are just the
// geocode of "London" itself (51.5074, -0.1278), which says nothing about the venue.
function pointOf(loc: BbEvent['location']): RawEvent['geo'] {
  const lat = loc?.lat
  const lng = loc?.lng
  if (loc?.precise !== true || typeof lat !== 'number' || typeof lng !== 'number') return
  if (lat === 51.5074 && lng === -0.1278) return
  return { lat, lng }
}

function isLondon(ev: BbEvent): boolean {
  const country = ev.location?.country ?? ''
  if (country && !/^(gb|uk|united kingdom)$/i.test(country)) return false
  return /\blondon\b/i.test(ev.location?.city ?? '')
}

// Links on the organiser's custom page (partner logos, venue map, socials).
function pageLinks(html: string | undefined): RawLink[] {
  if (!html) return []
  const out: RawLink[] = []
  for (const m of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = decode(m[1].match(/\bhref\s*=\s*"([^"]*)"/i)?.[1] ?? '')
    if (!/^https?:\/\//i.test(href) || /(^|\.)builderbase\.com$/i.test(hostOf(href))) continue
    if (out.some(l => l.href === href)) continue
    const label = decode(m[2].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
    const alt = m[2].match(/\balt\s*=\s*"([^"]+)"/i)?.[1] ?? m[1].match(/\baria-label\s*=\s*"([^"]+)"/i)?.[1]
    out.push({ text: label || decode(alt ?? '') || hostOf(href), href })
  }
  return out.slice(0, 40)
}

function mergeLinks(a: RawLink[] | undefined, b: RawLink[]): RawLink[] | undefined {
  const out: RawLink[] = []
  for (const link of [...(a ?? []), ...b]) if (!out.some(l => l.href === link.href)) out.push(link)
  return out.length ? out : undefined
}

function dedupe(partners: ScrapedPartner[]): ScrapedPartner[] {
  return partners.filter((p, i) => partners.findIndex(q => q.domain === p.domain) === i)
}

function domainOf(href: string | undefined): string | undefined {
  const host = href ? hostOf(href) : ''
  return host.includes('.') ? host : undefined
}

function hostOf(href: string): string {
  try {
    return new URL(href).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

// External URLs carry Builderbase referral tags; drop them so URLs match other sources.
function stripTracking(href: string | null | undefined): string | undefined {
  if (!href) return
  try {
    const u = new URL(href)
    for (const key of [...u.searchParams.keys()]) if (key.startsWith('utm_')) u.searchParams.delete(key)
    return u.toString()
  } catch {
    return
  }
}

function plain(md: string | null | undefined): string | undefined {
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

function linksIn(md: string | null | undefined): RawLink[] | undefined {
  if (!md) return
  const out: RawLink[] = []
  for (const m of md.matchAll(/\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)) {
    if (!out.some(l => l.href === m[2])) out.push({ text: m[1].replace(/\*\*/g, '').trim() || m[2], href: m[2] })
  }
  return out.length ? out : undefined
}

function decode(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
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
