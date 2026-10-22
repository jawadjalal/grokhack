// Luma source: London tech events. Upcoming ones come from the London discover
// feed; past and upcoming ones from London tech community calendars (iCal).
// Each kept event is then read from Luma's event JSON for description, links,
// hosts and categories. Partners only when the description has a sponsor heading.
import { parseEventHtml, type ScrapedPartner } from '../event'
import { getJson, getText } from '../http'
import type { Discover, RawEvent, RawHost, RawLink } from './types'

const API = 'https://api.lu.ma'
const LONDON_PLACE = 'discplace-QCcNk3HXowOR97j'
const LONDON = { lat: 51.5072, lng: -0.1276 }
const LONDON_KM = 30
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_CALENDARS = 25
const MAX_FEED_PAGES = 20
const FEED_TTL_MS = 60 * 60 * 1000 // new listings appear all day; event pages keep the 12h cache
const MAX_MAYBE = 40 // feed events with no tech word in the title, checked by their Luma category
const TECH_CATEGORY = /^(?:ai|tech|technology|crypto|web3|science & tech)$/i

// London tech community calendars, verified 22 Oct 2026 with api.lu.ma/url?url=<slug>.
// Not found then: hackradar, ukaiagentslab, unicornmafia, aitinkererslondon, encode,
// techeurope. encodeclub is a user profile; aitinkerers is the global (SF) calendar.
// all: keep every event; otherwise only titles that look tech (Granola runs socials too).
const KNOWN_CALENDARS = [
  { slug: 'spacexai-london', id: 'cal-QQGEIJl1K33N0zb', all: true }, // SpaceXAI for London, England
  { slug: 'londonmaxxing-ai', id: 'cal-BwhGlJaFM1pBN79', all: true }, // London AI
  { slug: 'london-ai', id: 'cal-OErAx8480sqDAtW', all: true }, // AI Startup Events - London
  { slug: 'ai-london', id: 'cal-tHMETzkzdaPu3mK', all: true }, // London x AI Builder Network
  { slug: 'thehackcollective', id: 'cal-Qk1P4msjA8eRxCs', all: true }, // The Hack Collective
  { slug: 'aiagentslab', id: 'cal-ObXRLmBUISp8LQh', all: true }, // UK AI Agents Lab
  { slug: 'nightoffice', id: 'cal-pMjwAfN0msdzm8I', all: true }, // Night Office
  { slug: 'tokensand', id: 'cal-EVJ0XV6EJegxAT7', all: true }, // tokens&
  { slug: 'girlswhoml-events', id: 'cal-sV0fuGpbX06Jp8w', all: true }, // GirlsWhoML
  { slug: 'encode-club', id: 'cal-8LJYo5N7QObN2DI', all: true }, // Encode Club
  { slug: 'tech-europe', id: 'cal-qyEpCltsspbMoJR', all: true }, // {Tech: Europe}
  { slug: 'granola', id: 'cal-ofXMwxW9NLr0RDU', all: false }, // Granola
]
const KNOWN_IDS = new Set(KNOWN_CALENDARS.map(c => c.id))

// Tech/startup words, matched on word boundaries. Built for event titles and
// calendar names; long descriptions trip it more easily.
const TECH_WORDS = [
  'ai', 'agi', 'gen ?ai', 'artificial intelligence', 'ml', 'mlops', 'machine learning', 'deep learning', 'nlp',
  'computer vision', 'neural', 'llms?', 'gpts?', 'chatgpt', 'openai', 'anthropic', 'claude', 'gemini', 'grok',
  'mistral', 'hugging ?face', 'langchain', 'copilot', 'cursor', 'mcp', 'agents?', 'agentic', 'automation',
  'no-?code', 'low-?code', 'hack(?:s|ing|ers?|athons?|days?|nights?)?', 'buildathons?', 'builders?',
  'devs?', 'developers?', 'devrel', 'devops', 'devtools', 'engineering', 'engineers?', 'software',
  'programming', 'programmers?', 'code', 'coding', 'coders?', 'open[- ]source', 'github', 'apis?', 'saas',
  'cloud', 'aws', 'azure', 'gcp', 'kubernetes', 'serverless', 'python', 'pydata', 'javascript', 'typescript',
  'rust', 'golang', 'react', 'node\\.?js', 'next\\.?js', 'web ?dev', 'data', 'databases?', 'analytics',
  'security', 'cyber', 'cybersecurity', 'infosec', 'appsec', 'pentest(?:s|ing)?', 'startups?', 'start-ups?',
  'scale-?ups?', 'founders?', 'founding', 'vcs?', 'venture capital', 'ventures?', 'investors?', 'accelerators?',
  'incubators?', 'demo days?', 'pitch (?:nights?|competitions?|days?)', 'y ?combinator', 'yc', 'gtm',
  'product (?:managers?|management|leaders?|people|teams?|design(?:ers?)?|builders?|led)', 'product-led',
  'product hunt', 'ux', 'ui/ux', 'design systems?', 'figma', '[a-z]*techs?', 'technology', 'technologies',
  'techies?', 'crypto', 'web3', 'blockchain', 'ethereum', 'solana', 'bitcoin', 'defi', 'nfts?', 'zk',
  'robotics', 'robots?', 'drones?', 'quantum', 'iot', 'ar/vr', 'vr', 'xr', 'computing', 'computers?',
  'algorithms?', 'gpus?', 'semiconductors?',
]
const TECH_RE = new RegExp(`\\b(?:${TECH_WORDS.join('|')})\\b`, 'i')
// Phrases that contain a tech word but aren't tech.
const NOT_TECH_RE = /\b(?:dress code|code of conduct|(?:estate|travel|talent|letting|secret) agents?|data protection|personal data|your data|security (?:checks?|guards?|staff))\b/gi

export function looksTech(text: string): boolean {
  return TECH_RE.test(text.replace(NOT_TECH_RE, ' '))
}

type Geo = {
  city?: string | null
  city_state?: string | null
  address?: string | null
  full_address?: string | null
  country_code?: string | null
  mode?: string | null // 'obfuscated' until you register: no address, fuzzed coordinate
}
type LumaEvent = {
  api_id: string
  name: string
  start_at: string
  url: string
  calendar_api_id?: string
  geo_address_info?: Geo | null
  coordinate?: { latitude: number; longitude: number } | null
}
type LumaCalendar = { api_id: string; name?: string; is_personal?: boolean }
type FeedEntry = { api_id: string; event: LumaEvent; calendar?: LumaCalendar }
type FeedPage = { entries?: FeedEntry[]; has_more?: boolean; next_cursor?: string }
type LumaHost = { name?: string; website?: string | null; twitter_handle?: string | null; linkedin_handle?: string | null }
type PmMark = { type?: string; attrs?: { href?: string } }
type PmNode = { type?: string; text?: string; attrs?: { level?: number }; marks?: PmMark[]; content?: PmNode[] }
type EventPayload = {
  event: LumaEvent
  calendar?: LumaCalendar
  hosts?: LumaHost[]
  categories?: { name?: string }[]
  guest_count?: number
  description_mirror?: PmNode
}

// An event we may fetch details for. id is the evt- api_id, slug the luma.com path.
type Candidate = { id?: string; slug?: string; name: string; start: number; fromFeed: boolean }

export const discover: Discover = async opts => {
  const now = Date.now()
  const from = now - opts.pastDays * DAY_MS
  const to = now + opts.futureDays * DAY_MS
  const found = new Map<string, Candidate>()
  const add = (c: Candidate) => {
    const key = c.id ?? c.slug
    if (!key || c.start < from || c.start > to) return
    const seen = found.get(key)
    if (seen) seen.fromFeed ||= c.fromFeed
    else found.set(key, c)
  }

  const feed = await readFeed(to)
  const calendars = new Map<string, boolean>(KNOWN_CALENDARS.map(c => [c.id, c.all])) // id -> keep every event
  const maybe: Candidate[] = []
  for (const e of feed ?? []) {
    const cal = e.calendar
    const calName = cal?.name ?? ''
    const tech = looksTech(e.event.name) || (!cal?.is_personal && looksTech(calName)) || KNOWN_IDS.has(cal?.api_id ?? '')
    if (!tech) {
      // '200ms' by Jito Events: the title says nothing, the Luma category says Crypto.
      if (!cal?.is_personal) maybe.push({ id: e.event.api_id, slug: e.event.url, name: e.event.name, start: Date.parse(e.event.start_at), fromFeed: true })
      continue
    }
    add({ id: e.event.api_id, slug: e.event.url, name: e.event.name, start: Date.parse(e.event.start_at), fromFeed: true })
    if (cal?.api_id && !cal.is_personal && !calendars.has(cal.api_id) && calendars.size < MAX_CALENDARS) {
      calendars.set(cal.api_id, looksTech(calName))
    }
  }

  let calendarsRead = 0
  for (const [id, keepAll] of calendars) {
    const events = await readCalendar(id)
    if (!events) continue
    calendarsRead++
    for (const e of events) {
      if (!keepAll && !looksTech(e.summary)) continue
      if (!mayBeLondon(e)) continue
      add({ id: e.id, slug: e.slug, name: e.summary, start: e.start, fromFeed: false })
    }
  }
  if (!feed && !calendarsRead) throw new Error('Luma is unreachable')

  const today = londonDate(new Date(now))
  const all = [...found.values()]
  const upcoming = spreadSeries(all.filter(c => londonDate(new Date(c.start)) >= today).sort((a, b) => a.start - b.start))
  const past = spreadSeries(all.filter(c => londonDate(new Date(c.start)) < today).sort((a, b) => b.start - a.start))

  // Roughly half upcoming, half past; either side fills the other's gap.
  const out: RawEvent[] = []
  const urls = new Set<string>()
  let fetches = Math.ceil(opts.limit * 1.25) + 5
  const take = async (list: Candidate[], want: number) => {
    for (let got = 0; list.length && got < want && out.length < opts.limit && fetches > 0; ) {
      const c = list.shift()!
      fetches--
      const ev = await readEvent(c)
      if (ev && !urls.has(ev.url)) {
        urls.add(ev.url)
        out.push(ev)
        got++
      }
    }
  }
  await take(upcoming, Math.ceil(opts.limit / 2))
  await take(past, opts.limit - out.length)
  await take(upcoming, opts.limit - out.length)
  out.push(...(await byCategory(maybe.filter(c => c.start >= from && c.start <= to).slice(0, MAX_MAYBE), urls)))
  return out
}

// Feed events whose title has no tech word: kept only when Luma files them under a tech category.
async function byCategory(list: Candidate[], urls: Set<string>): Promise<RawEvent[]> {
  const out: RawEvent[] = []
  for (const c of list) {
    const ev = await readEvent(c)
    if (!ev || urls.has(ev.url) || !ev.categories?.some(cat => TECH_CATEGORY.test(cat.trim()))) continue
    urls.add(ev.url)
    out.push(ev)
  }
  return out
}

// Weekly classes and socials repeat the same title. Keep two of each series in
// place and move the rest to the back, so distinct events win the limit.
function spreadSeries(list: Candidate[]): Candidate[] {
  const count = new Map<string, number>()
  const head: Candidate[] = []
  const tail: Candidate[] = []
  for (const c of list) {
    const key = c.name.toLowerCase().split(/[:|–—]/)[0].replace(/[^a-z]+/g, ' ').trim()
    const n = (count.get(key) ?? 0) + 1
    count.set(key, n)
    ;(n <= 2 || !key ? head : tail).push(c)
  }
  return [...head, ...tail]
}

// Pages the London discover feed (upcoming only) until past the window.
async function readFeed(to: number): Promise<FeedEntry[] | undefined> {
  const entries: FeedEntry[] = []
  let cursor: string | undefined
  for (let page = 0; page < MAX_FEED_PAGES; page++) {
    const url = `${API}/discover/get-paginated-events?discover_place_api_id=${LONDON_PLACE}&pagination_limit=50` +
      (cursor ? `&pagination_cursor=${encodeURIComponent(cursor)}` : '')
    let data: FeedPage
    try {
      data = await getJson<FeedPage>(url, { ttlMs: FEED_TTL_MS })
    } catch {
      return page ? entries : undefined
    }
    const batch = (data.entries ?? []).filter(e => e?.event?.api_id && e.event.name && e.event.start_at)
    entries.push(...batch)
    const last = batch[batch.length - 1]
    if (!data.has_more || !data.next_cursor || !last || Date.parse(last.event.start_at) > to) break
    cursor = data.next_cursor
  }
  return entries
}

type IcsEvent = { id?: string; slug?: string; start: number; summary: string; text: string; geo?: { lat: number; lng: number } }

async function readCalendar(id: string): Promise<IcsEvent[] | undefined> {
  try {
    return parseIcs(await getText(`${API}/ics/get?entity=calendar&id=${encodeURIComponent(id)}`))
  } catch {
    return
  }
}

function parseIcs(ics: string): IcsEvent[] {
  const out: IcsEvent[] = []
  let cur: Record<string, string> | undefined
  for (const line of ics.replace(/\r?\n[ \t]/g, '').split(/\r?\n/)) {
    if (line === 'BEGIN:VEVENT') cur = {}
    else if (line === 'END:VEVENT') {
      const e = cur && icsEvent(cur)
      if (e) out.push(e)
      cur = undefined
    } else if (cur) {
      const m = line.match(/^([A-Z-]+)(?:;[^:]*)?:(.*)$/)
      if (m) cur[m[1]] = unescapeIcs(m[2])
    }
  }
  return out
}

function icsEvent(f: Record<string, string>): IcsEvent | undefined {
  const start = icsTime(f.DTSTART ?? '')
  if (!start) return
  const uid = (f.UID ?? '').split('@')[0]
  const slug = `${f.URL ?? ''} ${f.DESCRIPTION ?? ''}`.match(/https?:\/\/(?:lu\.ma|luma\.com)\/(?!event\/)([\w-]+)/)?.[1]
  const [lat, lng] = (f.GEO ?? '').split(';').map(Number)
  return {
    id: uid.startsWith('evt-') ? uid : undefined,
    slug,
    start,
    summary: f.SUMMARY ?? '',
    text: `${f.SUMMARY ?? ''} ${f.LOCATION ?? ''}`,
    geo: Number.isFinite(lat) && Number.isFinite(lng) && f.GEO ? { lat, lng } : undefined,
  }
}

// 20250617T170000Z, 20250617T170000 (treated as UTC; only used for windows) or 20250617.
function icsTime(v: string): number | undefined {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/)
  if (!m) return
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 0), +(m[5] ?? 0), +(m[6] ?? 0))
}

function unescapeIcs(s: string): string {
  return s.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1')
}

// Cheap pre-filter before fetching details: near London, or says London.
function mayBeLondon(e: IcsEvent): boolean {
  if (e.geo) return km(e.geo, LONDON) <= LONDON_KM
  return /\blondon\b/i.test(e.text)
}

async function readEvent(c: Candidate): Promise<RawEvent | undefined> {
  try {
    const payload = c.id
      ? await getJson<EventPayload>(`${API}/event/get?event_api_id=${encodeURIComponent(c.id)}`)
      : await bySlug(c.slug ?? '')
    if (!payload?.event?.url || !payload.event.name) return
    return toRawEvent(payload, c.fromFeed)
  } catch {
    return
  }
}

async function bySlug(slug: string): Promise<EventPayload | undefined> {
  if (!slug) return
  const res = await getJson<{ kind?: string; data?: EventPayload }>(`${API}/url?url=${encodeURIComponent(slug)}`)
  return res.kind === 'event' ? res.data : undefined
}

function toRawEvent(p: EventPayload, fromFeed: boolean): RawEvent | undefined {
  const ev = p.event
  const geo = ev.geo_address_info ?? {}
  if (!fromFeed && !inLondon(geo, ev.coordinate)) return
  const url = `https://luma.com/${ev.url}`
  const cal = p.calendar
  const venue = geo.address || geo.full_address ? { name: geo.address || undefined, address: geo.full_address || undefined } : undefined
  const point = geo.mode !== 'obfuscated' && ev.coordinate ? { lat: ev.coordinate.latitude, lng: ev.coordinate.longitude } : undefined
  const doc = p.description_mirror
  return {
    source: 'luma',
    url,
    name: ev.name.trim(),
    date: ev.start_at ? londonDate(new Date(ev.start_at)) : undefined,
    city: geo.city || geo.city_state || undefined,
    country: geo.country_code || undefined,
    venue,
    geo: point && Number.isFinite(point.lat) && Number.isFinite(point.lng) ? point : undefined,
    organiser: cal?.name && !cal.is_personal ? cal.name : undefined,
    audienceSize: p.guest_count && p.guest_count > 0 ? p.guest_count : undefined,
    categories: nonEmpty((p.categories ?? []).map(c => c?.name ?? '').filter(Boolean)),
    description: doc ? mirrorText(doc) || undefined : undefined,
    links: doc ? nonEmpty(mirrorLinks(doc)) : undefined,
    hosts: nonEmpty((p.hosts ?? []).map(toHost).filter((h): h is RawHost => !!h)),
    partners: doc ? partnersFrom(url, doc) : undefined,
  }
}

function inLondon(geo: Geo, coord: LumaEvent['coordinate']): boolean {
  if (geo.country_code && geo.country_code !== 'GB') return false
  if (/\blondon\b/i.test(`${geo.city ?? ''} ${geo.city_state ?? ''} ${geo.full_address ?? ''}`)) return true
  return !!coord && km({ lat: coord.latitude, lng: coord.longitude }, LONDON) <= LONDON_KM
}

function toHost(h: LumaHost): RawHost | undefined {
  const name = h?.name?.trim()
  if (!name) return
  const linkedin = h.linkedin_handle?.trim()
  return {
    name,
    website: h.website?.trim() || undefined,
    twitter: h.twitter_handle?.trim() ? `https://x.com/${h.twitter_handle.trim()}` : undefined,
    linkedin: linkedin ? (linkedin.startsWith('http') ? linkedin : `https://www.linkedin.com${linkedin.startsWith('/') ? '' : '/'}${linkedin}`) : undefined,
  }
}

// ProseMirror helpers. Luma uses snake_case node names; accept camelCase too.
function kind(n: PmNode): string {
  return (n.type ?? '').replace(/([A-Z])/g, '_$1').toLowerCase()
}

function inline(n: PmNode): string {
  if (kind(n) === 'text') return n.text ?? ''
  if (kind(n) === 'hard_break') return '\n'
  return (n.content ?? []).map(inline).join('')
}

// Plain text: one block per paragraph/heading, list items as "- " lines.
function mirrorText(doc: PmNode): string {
  const out: string[] = []
  const walk = (n: PmNode) => {
    const k = kind(n)
    if (k === 'horizontal_rule') return
    if (k === 'doc' || k === 'blockquote') (n.content ?? []).forEach(walk)
    else if (k === 'bullet_list' || k === 'ordered_list') out.push(listLines(n).join('\n'))
    else {
      const t = inline(n).replace(/[ \t]+\n/g, '\n').trim()
      if (t) out.push(t)
    }
  }
  walk(doc)
  return out.join('\n\n').trim()
}

function listLines(list: PmNode): string[] {
  return (list.content ?? []).map(li => `- ${(li.content ?? []).map(inline).join(' ').replace(/\s+/g, ' ').trim()}`)
}

// Every link mark, merging neighbouring text nodes that share one link.
function mirrorLinks(doc: PmNode): RawLink[] {
  const links: RawLink[] = []
  let open: RawLink | undefined
  const walk = (n: PmNode) => {
    if (kind(n) === 'text') {
      const href = n.marks?.find(m => m?.type === 'link')?.attrs?.href?.trim()
      if (href && open?.href === href) open.text += n.text ?? ''
      else if (href) links.push((open = { text: n.text ?? '', href }))
      else open = undefined
      return
    }
    open = undefined
    ;(n.content ?? []).forEach(walk)
    open = undefined
  }
  walk(doc)
  const seen = new Set<string>()
  return links
    .map(l => ({ text: anchorText(l.text), href: l.href }))
    .filter(l => {
      const key = `${l.text}\n${l.href}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

function anchorText(s: string): string {
  return s.replace(/\s+/g, ' ').replace(/\s*[:\u2013\u2014-]+\s*$/, '').trim()
}

// Renders the description as simple HTML so Jawad's partner finder can read
// links under Sponsors/Partners/Venue headings. Short label paragraphs such as
// "Technology Partners" or "Judges" become sub-headings. Rules/policy headings
// ("Venue Rules") are renamed so they don't read as a venue partner.
function partnersFrom(url: string, doc: PmNode): ScrapedPartner[] | undefined {
  const html: string[] = []
  const label = /\b(?:partners?|sponsors?|venue|judges?|speakers?|mentors?|hosts?|organi[sz]ers?|prizes?|schedule|agenda)\b/i
  const notes = /\b(?:rules?|polic(?:y|ies)|terms|faqs?|conduct|safety|access(?:ibility)?|directions|getting there)\b/i
  const heading = (level: number, text: string) => `<h${level}>${esc(notes.test(text) ? 'Notes' : text)}</h${level}>`
  const walk = (n: PmNode, depth: number) => {
    const k = kind(n)
    if (k === 'heading') {
      html.push(heading(Math.min(Math.max(n.attrs?.level ?? 2, 1), 3), inline(n)))
    } else if (k === 'paragraph' && !depth && isLabel(n, label)) {
      html.push(heading(3, inline(n)))
    } else if (k === 'text') {
      const href = n.marks?.find(m => m?.type === 'link')?.attrs?.href
      html.push(href ? `<a href="${esc(href)}">${esc(anchorText(n.text ?? ''))}</a>` : esc(n.text ?? ''))
    } else {
      html.push(k === 'paragraph' || k === 'list_item' ? '<p>' : '')
      ;(n.content ?? []).forEach(c => walk(c, k === 'doc' ? depth : depth + 1))
      html.push(k === 'paragraph' || k === 'list_item' ? '</p>' : '')
    }
  }
  walk(doc, 0)
  if (!/<h[1-3]>/.test(html.join(''))) return
  return nonEmpty(parseEventHtml(url, html.join('\n')).partners)
}

function isLabel(n: PmNode, label: RegExp): boolean {
  const text = inline(n).trim()
  const hasLink = JSON.stringify(n).includes('"link"')
  return !hasLink && text.length > 0 && text.length <= 40 && label.test(text)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function nonEmpty<T>(a: T[]): T[] | undefined {
  return a.length ? a : undefined
}

function londonDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}
