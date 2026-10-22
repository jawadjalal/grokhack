// dev.events: London tech conferences from the city listing (/EU/GB/London,
// paged with ?page=N). Each listed event carries JSON-LD with name, dates and
// city. Its dev.events page links the official website ("Visit"); we read that
// site, plus one same-site sponsors/partners page, for sponsor sections.
// dev.events only lists upcoming events: there is no past archive to page into.
// readOfficialSite is shared with confstech.ts.
import { parseEventHtml } from '../event'
import type { ScrapedPartner } from '../event'
import { getText } from '../http'
import type { Discover, DiscoverOptions, RawEvent } from './types'

const BASE = 'https://dev.events'
const LIST = `${BASE}/EU/GB/London`
const MAX_PAGES = 6
const WORKERS = 4
const DAY_MS = 24 * 60 * 60 * 1000

type Ld = Record<string, unknown>
type Listed = { page: string; name: string; date: string; country?: string; description?: string }

export const discover: Discover = async opts => {
  const { from, to, today } = dateRange(opts)
  const listed = (await readListing()).filter(e => e.date >= from && e.date <= to)
  const ordered = pick(listed, today)

  // Read candidates in small batches until we have `limit` distinct events.
  const out: RawEvent[] = []
  const seen = new Set<string>()
  for (let i = 0; i < ordered.length && out.length < opts.limit; i += WORKERS) {
    const batch = await Promise.all(ordered.slice(i, i + WORKERS).map(toEvent))
    for (const event of batch) {
      if (!event || out.length >= opts.limit) continue
      const key = siteKey(event)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(event)
    }
  }
  return out
}

// All London listing pages. Throws only when the first page can't be read.
async function readListing(): Promise<Listed[]> {
  const found = new Map<string, Listed>()
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = page === 1 ? LIST : `${LIST}?page=${page}`
    let html: string
    try {
      html = await getTextRetry(url)
    } catch (err) {
      if (page === 1) throw new Error(`dev.events London listing is unreachable: ${String(err)}`)
      break
    }
    const before = found.size
    for (const ld of jsonLd(html)) {
      const item = listedEvent(ld)
      if (item && !found.has(dupeKey(item))) found.set(dupeKey(item), item)
    }
    const shown = html.match(/showing\s+(\d+)\s+out of\s+(\d+)/i)
    if (found.size === before || !shown || Number(shown[1]) >= Number(shown[2])) break
  }
  return [...found.values()]
}

function listedEvent(ld: Ld): Listed | undefined {
  if (!isEventType(ld['@type'])) return
  const name = str(ld.name)
  const page = str(ld.url)
  const date = ymd(str(ld.startDate))
  if (!name || !page || !date || !page.startsWith(`${BASE}/`)) return
  if (/OnlineEventAttendanceMode/i.test(str(ld.eventAttendanceMode) ?? '')) return
  const address = obj(obj(ld.location)?.address)
  if (!/^london$/i.test(str(address?.addressLocality) ?? '')) return
  const region = str(address?.addressRegion)
  if (region && !isUk(region)) return
  return { page, name, date, country: region ? 'GB' : undefined, description: str(ld.description) }
}

// Open the dev.events page for the official website, then read that site.
async function toEvent(item: Listed): Promise<RawEvent | undefined> {
  const event: RawEvent = {
    source: 'devevents',
    url: item.page,
    name: item.name,
    date: item.date,
    city: 'London',
    country: item.country,
    description: item.description,
  }
  let official: string | undefined
  try {
    official = officialLink(await getTextRetry(item.page))
  } catch {
    return event
  }
  if (!official) return event
  event.links = [{ text: 'Website', href: official }]
  const site = await readOfficialSite(official, item.date)
  if (!site) return { ...event, url: official }
  return {
    ...event,
    url: site.url,
    description: site.description ?? event.description,
    organiser: site.organiser,
    venue: site.venue,
    geo: site.geo,
    partners: site.partners.length ? site.partners : undefined,
  }
}

// The embedded site preview, the external "Visit" link, else JSON-LD url/sameAs.
function officialLink(html: string): string | undefined {
  for (const tag of html.match(/<iframe\b[^>]*>/gi) ?? []) {
    const src = attr(tag, 'src')
    if (src && isExternal(src) && /embedded event/i.test(attr(tag, 'title') ?? '')) return src
  }
  for (const a of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(a[1], 'href')
    if (!href || !isExternal(href)) continue
    if (/^(visit|website|official website|visit website|register)$/i.test(textOf(a[2]))) return href
  }
  for (const ld of jsonLd(html)) {
    if (!isEventType(ld['@type'])) continue
    const sameAs = Array.isArray(ld.sameAs) ? ld.sameAs : [ld.sameAs]
    const hit = [ld.url, ...sameAs].find((v): v is string => typeof v === 'string' && isExternal(v))
    if (hit) return hit
  }
  return
}

function isExternal(href: string): boolean {
  try {
    const u = new URL(href)
    return /^https?:$/.test(u.protocol) && !/(^|\.)dev\.events$/i.test(u.hostname)
  } catch {
    return false
  }
}

// ---- official conference sites (shared with confstech.ts) ----

export type OfficialSite = {
  url: string // page the partners came from, else the homepage
  homepage: string
  description?: string
  organiser?: string
  venue?: { name?: string; address?: string }
  geo?: { lat: number; lng: number }
  partners: ScrapedPartner[]
}

// Ticketing, forms, social and site tooling: never a sponsor.
const JUNK_HOSTS = [
  'eventbrite.com', 'eventbrite.co.uk', 'ti.to', 'tito.io', 'sessionize.com', 'papercall.io', 'pretalx.com',
  'hopin.com', 'bizzabo.com', 'cvent.com', 'swapcard.com', 'brella.io', 'whova.com', 'hubspot.com',
  'hs-sites.com', 'hsforms.com', 'mailchimp.com', 'list-manage.com', 'typeform.com', 'forms.gle',
  'jotform.com', 'airtable.com', 'calendly.com', 'zoom.us', 'vimeo.com', 'medium.com', 'substack.com',
  'spotify.com', 'apple.com', 'slack.com', 'whatsapp.com', 'wa.me', 'bsky.app', 'threads.net', 'reddit.com',
  'flickr.com', 'cookiebot.com', 'onetrust.com', 'wordpress.org', 'wordpress.com', 'wix.com',
  'squarespace.com', 'webflow.io', 'webflow.com', 'framer.com', 'framer.website', 'creativecommons.org',
  'w3.org', 'maps.apple.com', 'citymapper.com', 'tfl.gov.uk', 'booking.com', 'airbnb.com', 'airbnb.co.uk',
  'gitnation.com', 'gitnation.org', 'mastodon.social', 'hachyderm.io', 'fosstodon.org', 'paypal.com',
  'amazonaws.com', 'cloudfront.net', 'asp.events', 'zohobackstage.eu', 'zohobackstage.com', 'pretix.eu',
  'cookiedatabase.org', 'cookieyes.com', 'termly.io', 'iubenda.com', 'safelinks.protection.outlook.com',
]

// Link labels that are site navigation or calls to action, not a company.
const JUNK_NAME = new RegExp(
  '^(home|about( us)?|contact( us)?|tickets?|buy tickets?|get (your )?tickets?|book( now| (your )?tickets?)?|' +
    'register( now| here)?|sign ?(up|in)|log ?in|agenda|schedule|programme|program|speakers?|sponsors?|' +
    'partners?|venue|faq|blog|news|privacy( policy)?|terms.*|cookies?.*|code of conduct|cfp|' +
    'call for (papers|speakers)|menu|more|see all|view all|learn more|read more|find out more|click here|here|' +
    'watch|download|subscribe|apply( now)?|become an? .*|sponsor us|.*sponsorship.*|contact sales|jobs|' +
    'careers|press|media|visit( website| site)?|website|directions|map|get directions)$',
  'i',
)

// Footer credits, downloads, spam links and bare URLs.
const JUNK_TEXT = /@|^www\.|^(about|download|see more|read more)\b|website by|:$|\b(sloto|casino|betting|poker|gambl)/i

export async function readOfficialSite(homepage: string, date?: string): Promise<OfficialSite | undefined> {
  let html: string
  try {
    html = await getTextRetry(homepage)
  } catch {
    return
  }
  const hosts = siteHosts(homepage, html)
  const ld = siteEvent(html, date)
  const homeRaw = parseEventHtml(homepage, html).partners
  const extra = sponsorPage(homepage, html, hosts)
  let extraRaw: ScrapedPartner[] = []
  if (extra) {
    try {
      extraRaw = parseEventHtml(extra, await getTextRetry(extra)).partners
    } catch {
      // sponsor page down: homepage result stands
    }
  }
  // Sister events listed as "co-located" on either page aren't sponsors anywhere.
  const sisters = new Set([...homeRaw, ...extraRaw].filter(p => SISTER_ROLE.test(p.role)).map(p => bare(p.domain)))
  const home = cleanPartners(homeRaw, hosts, sisters, ld?.organiser)
  const found = cleanPartners(extraRaw, hosts, sisters, ld?.organiser)
  // Keep the page with the longer list so url always shows every partner.
  const best = extra && found.length > home.length ? { url: extra, partners: found } : { url: homepage, partners: home }
  return {
    ...best,
    homepage,
    description: short(meta(html, 'og:description') ?? meta(html, 'description') ?? meta(html, 'twitter:description')),
    organiser: ld?.organiser,
    venue: ld?.venue,
    geo: ld?.geo,
  }
}

const SISTER_ROLE = /co-?located|sister event/i

// One same-host page whose path or link text mentions sponsors or partners.
// When the event lives under a path (/events/x), stay under its first segment,
// so a site-wide partners page isn't credited to one event.
function sponsorPage(homepage: string, html: string, hosts: Set<string>): string | undefined {
  const base = canonical(html) ?? homepage
  const scope = firstSegment(homepage)
  let best: { href: string; score: number } | undefined
  for (const a of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const raw = attr(a[1], 'href')
    if (!raw || raw.startsWith('#')) continue
    let u: URL
    try {
      u = new URL(raw, base)
    } catch {
      continue
    }
    if (!/^https?:$/.test(u.protocol) || !hosts.has(bare(u.hostname))) continue
    if (/\.(pdf|png|jpe?g|svg|zip)$/i.test(u.pathname)) continue
    u.hash = ''
    if (samePage(u.href, homepage) || samePage(u.href, base)) continue
    const path = safeDecode(u.pathname).toLowerCase()
    if (scope && !path.startsWith(scope)) continue
    const hay = `${path} ${textOf(a[2]).toLowerCase()}`
    if (!/sponsor|partner/.test(hay)) continue
    let score = 2
    if (/\/(our-)?(sponsors?|partners?)(-\d{4})?\/?$/.test(path)) score += 2
    if (/become|prospectus|enquir|inquir|opportunit|package|why-|sponsor-us|apply|form|contact|brochure/.test(hay)) score -= 3
    if (!best || score > best.score) best = { href: u.href, score }
  }
  return best && best.score > 0 ? best.href : undefined
}

function firstSegment(url: string): string | undefined {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)[0]
    return seg ? `/${safeDecode(seg).toLowerCase()}` : undefined
  } catch {
    return
  }
}

function safeDecode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

// Drop the site's own links, its organiser, sister events and tool/nav links.
function cleanPartners(partners: ScrapedPartner[], hosts: Set<string>, sisters: Set<string>, organiser?: string): ScrapedPartner[] {
  const org = organiser?.toLowerCase().replace(/[^a-z0-9]/g, '')
  const out: ScrapedPartner[] = []
  for (const p of partners) {
    const domain = bare(p.domain)
    if ([...hosts].some(h => sameSite(h, domain))) continue
    if (JUNK_HOSTS.some(j => domain === j || domain.endsWith(`.${j}`))) continue
    if (org && root(domain).split('.')[0] === org) continue
    if (sisters.has(domain) || SISTER_ROLE.test(p.role)) continue
    let name = p.name
      .replace(/\s*\((opens )?in a new (window|tab)\)|\s*\(external link\)/gi, '')
      .replace(/\.(png|jpe?g|svg|webp|gif)$/i, '')
      .replace(/[\s_-]+logo\b.*$/i, '')
      .replace(/\s+(website|site)$/i, '')
      .trim()
    if (JUNK_NAME.test(name) || JUNK_TEXT.test(name)) continue
    // Logo alt text like "Image" names nothing: the link's domain is all we know.
    if (!name || /^(image|img|logo|icon|banner|picture|photo|sponsor|partner)\s*\d*$/i.test(name)) name = domain
    if (out.some(q => q.domain === domain)) continue
    out.push({ ...p, name, domain })
  }
  // A long list from one page is a link dump, not a sponsor wall.
  return out.length > 80 ? [] : out
}

// Hosts that belong to the site itself: the requested URL plus canonical/og:url.
function siteHosts(url: string, html: string): Set<string> {
  const hosts = new Set<string>()
  for (const u of [url, canonical(html), meta(html, 'og:url')]) {
    try {
      if (u) hosts.add(bare(new URL(u).hostname))
    } catch {}
  }
  return hosts
}

type SiteLd = { organiser?: string; venue?: { name?: string; address?: string }; geo?: { lat: number; lng: number } }

// The site's own Event JSON-LD, only when its start date matches ours.
function siteEvent(html: string, date?: string): SiteLd | undefined {
  const events = jsonLd(html).filter(ld => isEventType(ld['@type']))
  const ld = events.find(e => !date || ymd(str(e.startDate)) === date)
  if (!ld) return
  const org = Array.isArray(ld.organizer) ? ld.organizer[0] : ld.organizer
  const place = obj(Array.isArray(ld.location) ? ld.location.find(l => obj(l)?.['@type'] === 'Place') : ld.location)
  const geo = obj(place?.geo)
  const lat = Number(geo?.latitude)
  const lng = Number(geo?.longitude)
  const address = addressText(place?.address)
  const venueName = str(place?.name)
  return {
    organiser: str(obj(org)?.name) ?? str(org),
    venue: venueName || address ? { name: venueName, address } : undefined,
    // Only trust coordinates that are actually in London.
    geo: geo && lat > 51.2 && lat < 51.8 && lng > -0.6 && lng < 0.4 ? { lat, lng } : undefined,
  }
}

function addressText(raw: unknown): string | undefined {
  if (typeof raw === 'string') return raw.trim() || undefined
  const a = obj(raw)
  if (!a) return
  const parts = [a.streetAddress, a.addressLocality, a.postalCode].map(str).filter(Boolean)
  return parts.length ? parts.join(', ') : undefined
}

// ---- shared small helpers ----

export async function getTextRetry(url: string): Promise<string> {
  try {
    return await getText(url)
  } catch (err) {
    if (/^(404|410|403|401) /.test(String((err as Error).message))) throw err
    await new Promise(r => setTimeout(r, 1500))
    return getText(url)
  }
}

export function jsonLd(html: string): Ld[] {
  const out: Ld[] = []
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk)
    const o = obj(node)
    if (!o) return
    out.push(o)
    if (Array.isArray(o['@graph'])) o['@graph'].forEach(walk)
  }
  for (const m of html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1].trim()))
    } catch {
      // broken block: skip it
    }
  }
  return out
}

function isEventType(type: unknown): boolean {
  const types = Array.isArray(type) ? type : [type]
  return types.some(t => typeof t === 'string' && /Event$/.test(t))
}

export function isUk(text: string): boolean {
  return /^(gb|uk|u\.k\.|united kingdom|england|great britain)$/i.test(text.trim())
}

// One event per official site (dev.events lists some events twice).
function siteKey(event: RawEvent): string {
  const site = event.links?.[0]?.href
  return site ? normalUrl(site) : dupeKey({ name: event.name, date: event.date ?? '' })
}

function dupeKey(e: { name: string; date: string }): string {
  return `${e.date}|${e.name.toLowerCase().replace(/\b20\d{2}\b/g, '').replace(/[^a-z0-9]/g, '')}`
}

export function normalUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${bare(u.hostname)}${u.pathname.replace(/\/+$/, '')}`.toLowerCase()
  } catch {
    return url.toLowerCase()
  }
}

function samePage(a: string, b: string): boolean {
  return normalUrl(a) === normalUrl(b)
}

function bare(host: string): string {
  return host.toLowerCase().replace(/^www\./, '')
}

// Same registrable domain: london.droidcon.com and droidcon.com are one site.
function sameSite(a: string, b: string): boolean {
  return root(a) === root(b)
}

function root(host: string): string {
  const parts = host.split('.')
  const n = /^(co|org|ac|gov|com|net)\.[a-z]{2}$/.test(parts.slice(-2).join('.')) ? 3 : 2
  return parts.slice(-n).join('.')
}

function canonical(html: string): string | undefined {
  for (const tag of html.match(/<link\b[^>]*>/gi) ?? []) {
    if (/\brel=["']canonical["']/i.test(tag)) {
      const href = attr(tag, 'href')
      if (href && /^https?:\/\//i.test(href)) return href
    }
  }
  return
}

function meta(html: string, key: string): string | undefined {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const prop = attr(tag, 'property') ?? attr(tag, 'name')
    if (prop?.toLowerCase() !== key) continue
    const content = attr(tag, 'content')?.replace(/\s+/g, ' ').trim()
    if (content) return content
  }
  return
}

// First sentence or two, under ~300 characters.
export function short(text: string | undefined): string | undefined {
  const t = text?.replace(/\s+/g, ' ').trim()
  if (!t) return
  if (t.length <= 300) return t
  const cut = t.slice(0, 300)
  const end = cut.lastIndexOf('. ')
  return end > 80 ? cut.slice(0, end + 1) : `${cut.slice(0, cut.lastIndexOf(' '))}…`
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))
  return m ? decode(m[2] ?? m[3] ?? '') : undefined
}

function textOf(inner: string): string {
  return decode(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? decode(v.trim()) : undefined
}

function obj(v: unknown): Ld | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Ld) : undefined
}

// dev.events and confs.tech dates are calendar dates (midnight UTC or bare).
export function ymd(raw: string | undefined): string | undefined {
  return raw?.match(/^(\d{4}-\d{2}-\d{2})/)?.[1]
}

// Nearest upcoming first, then the most recent past ones.
export function pick<T extends { date: string }>(events: T[], today: string): T[] {
  const ahead = events.filter(e => e.date >= today).sort((a, b) => a.date.localeCompare(b.date))
  const past = events.filter(e => e.date < today).sort((a, b) => b.date.localeCompare(a.date))
  return [...ahead, ...past]
}

export function dateRange(opts: DiscoverOptions) {
  const now = Date.now()
  const day = (ms: number) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'Europe/London' })
  return { from: day(now - opts.pastDays * DAY_MS), to: day(now + opts.futureDays * DAY_MS), today: day(now) }
}
