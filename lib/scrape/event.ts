// Fetch a Luma or event page and turn it into an EventInput.
// Sponsor links found under partner/sponsor/venue headings are returned too,
// so the seed script can record real backings. No LinkedIn, no guessed rows.
import type { EventInput } from '../types'

const UA = 'Mozilla/5.0 (compatible; Backer/1.0; +https://github.com/jawadjalal/grokhack)'

const MONTHS: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9,
  oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
}

const SOCIAL_HOSTS = [
  'linkedin.com', 'instagram.com', 'twitter.com', 'x.com', 'facebook.com', 'fb.com',
  'tiktok.com', 'youtube.com', 'youtu.be', 't.me', 'telegram.me', 'linktr.ee',
  'lu.ma', 'luma.com', 'google.com', 'goo.gl', 'bit.ly', 'github.com', 'mailto',
  'discord.gg', 'discord.com', 'meetup.com',
]

export type ScrapedPartner = {
  name: string
  domain: string
  role: string
  kind: 'sponsor' | 'venue'
  sourceUrl: string
}

export type ScrapeResult = {
  event: EventInput
  partners: ScrapedPartner[]
}

export function eventFromText(text: string): EventInput {
  const clean = text.replace(/\s+/g, ' ').trim()
  const name = (text.split('\n').map(l => l.trim()).find(Boolean) || 'Your event').slice(0, 120)
  const description = text.trim().slice(0, 2000)
  return {
    name,
    topic: (clean || name).slice(0, 400),
    description,
    date: findDate(clean),
    audienceSize: findAudience(clean),
  }
}

export async function scrapeEvent(url: string): Promise<ScrapeResult> {
  const target = normalizeUrl(url)
  const html = await fetchHtml(target)
  return parseEventHtml(target, html)
}

export function parseEventHtml(pageUrl: string, html: string): ScrapeResult {
  const luma = readLuma(html)
  const ld = readJsonLd(html)
  const title = cleanName(luma?.name || ld?.name || meta(html, 'og:title') || meta(html, 'twitter:title') || tagText(html, 'title') || 'Untitled event')
  const description = clip(
    luma?.description || ld?.description || meta(html, 'og:description') || meta(html, 'description') || visibleText(html).slice(0, 1500),
    2000,
  )
  const date = (luma?.date || ld?.date || findDate(`${title} ${description} ${visibleText(html).slice(0, 2500)}`))
  const audienceSize = luma?.audienceSize || ld?.audienceSize || findAudience(`${description} ${visibleText(html).slice(0, 4000)}`)
  const categories = luma?.categories ?? []
  const topic = buildTopic(title, description, categories)

  return {
    event: {
      name: title || 'Untitled event',
      url: pageUrl,
      date,
      topic,
      audienceSize,
      description: description || undefined,
    },
    partners: extractPartners(pageUrl, html),
  }
}

async function fetchHtml(url: string): Promise<string> {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
    signal: AbortSignal.timeout(15000),
  })
  if (!res.ok) throw new Error(`Could not fetch that page (${res.status})`)
  const html = await res.text()
  if (!html.trim()) throw new Error('That page was empty')
  return html.slice(0, 2_000_000)
}

function normalizeUrl(raw: string): string {
  let url: URL
  try {
    url = new URL(raw.trim())
  } catch {
    throw new Error('Provide a full http(s) URL')
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('Provide a full http(s) URL')
  return url.toString()
}

type LumaRead = { name?: string; description?: string; date?: string; audienceSize?: number; categories?: string[] }

function readLuma(html: string): LumaRead | undefined {
  const raw = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/)?.[1]
  if (!raw) return
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return
  }
  const payload = findLumaEventPayload(data)
  if (!payload) return
  const event = payload.event as Record<string, unknown>
  const name = typeof event.name === 'string' ? event.name : undefined
  const start = typeof event.start_at === 'string' ? event.start_at : undefined
  const description = mirrorText(payload.description_mirror)
  const categories = Array.isArray(payload.categories)
    ? payload.categories.map(c => (c && typeof c === 'object' && typeof (c as { name?: string }).name === 'string' ? (c as { name: string }).name : '')).filter(Boolean)
    : []
  let guests = 0
  if (Array.isArray(payload.ticket_types)) {
    for (const t of payload.ticket_types) {
      if (t && typeof t === 'object' && typeof (t as { num_guests?: number }).num_guests === 'number') guests += (t as { num_guests: number }).num_guests
    }
  }
  if (!guests && typeof payload.guest_count === 'number') guests = payload.guest_count
  return {
    name,
    description: description || undefined,
    date: start ? londonDate(start) : undefined,
    audienceSize: guests > 0 ? guests : undefined,
    categories,
  }
}

function findLumaEventPayload(root: unknown): Record<string, unknown> | undefined {
  const stack: unknown[] = [root]
  while (stack.length) {
    const cur = stack.pop()
    if (!cur || typeof cur !== 'object') continue
    if (Array.isArray(cur)) {
      // Calendar and discover pages list many events. Skip those lists.
      continue
    }
    const o = cur as Record<string, unknown>
    const event = o.event
    if (event && typeof event === 'object' && !Array.isArray(event)) {
      const ev = event as Record<string, unknown>
      if (typeof ev.name === 'string' && typeof ev.start_at === 'string' && ('description_mirror' in o || 'ticket_info' in o || 'ticket_types' in o)) {
        return o
      }
    }
    for (const v of Object.values(o)) if (v && typeof v === 'object') stack.push(v)
  }
  return
}

function mirrorText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const parts: string[] = []
  const blocks = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote'])
  const walk = (n: unknown) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) {
      n.forEach(walk)
      return
    }
    const o = n as Record<string, unknown>
    const block = typeof o.type === 'string' && blocks.has(o.type)
    if (block && parts.length && !parts[parts.length - 1].endsWith('\n')) parts.push('\n')
    if (typeof o.text === 'string') parts.push(o.text)
    if (o.type === 'hard_break') parts.push('\n')
    if (Array.isArray(o.content)) o.content.forEach(walk)
    if (block && !parts[parts.length - 1]?.endsWith('\n')) parts.push('\n')
  }
  walk(node)
  return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

type LdRead = { name?: string; description?: string; date?: string; audienceSize?: number }

function readJsonLd(html: string): LdRead | undefined {
  const blocks = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  for (const block of blocks) {
    let data: unknown
    try {
      data = JSON.parse(decode(block[1].trim()))
    } catch {
      continue
    }
    const event = findLdEvent(data)
    if (!event) continue
    const name = typeof event.name === 'string' ? event.name : undefined
    const description = typeof event.description === 'string' ? event.description : undefined
    const start = typeof event.startDate === 'string' ? event.startDate : undefined
    const offers = event.offers
    let audience: number | undefined
    const cap = typeof event.maximumAttendeeCapacity === 'number' ? event.maximumAttendeeCapacity : undefined
    if (cap && cap > 0) audience = cap
    if (!audience && offers && typeof offers === 'object' && !Array.isArray(offers)) {
      const n = (offers as { availability?: string }).availability
      void n
    }
    return { name, description, date: start ? londonDate(start) : undefined, audienceSize: audience }
  }
  return
}

function findLdEvent(node: unknown): Record<string, unknown> | undefined {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findLdEvent(item)
      if (found) return found
    }
    return
  }
  const o = node as Record<string, unknown>
  const type = o['@type']
  const types = Array.isArray(type) ? type : [type]
  if (types.some(t => t === 'Event' || t === 'BusinessEvent' || t === 'SocialEvent')) return o
  if (Array.isArray(o['@graph'])) return findLdEvent(o['@graph'])
  return
}

function buildTopic(name: string, description: string, categories: string[]): string {
  const lines = description.split('\n').map(s => s.replace(/\s+/g, ' ').trim()).filter(l => l.length > 12 && l.toLowerCase() !== name.toLowerCase())
  const body = lines[0] || description.replace(/\s+/g, ' ').trim() || name
  const sentence = body.split(/(?<=[.!?])\s/)[0] || body
  const head = categories.length ? `${categories.join(', ')}. ` : ''
  return `${head}${sentence}`.replace(/\s+/g, ' ').trim().slice(0, 400) || name
}

function findDate(text: string): string | undefined {
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})(?:[T\s]\d{2}:\d{2})?/)
  if (iso) return iso[1]
  const dayMonth = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${Object.keys(MONTHS).join('|')})\\.?\\s*,?\\s*(20\\d{2})\\b`, 'i'))
  if (dayMonth) return ymd(Number(dayMonth[3]), MONTHS[dayMonth[2].toLowerCase()], Number(dayMonth[1]))
  const monthDay = text.match(new RegExp(`\\b(${Object.keys(MONTHS).join('|')})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\s*,?\\s*(20\\d{2})\\b`, 'i'))
  if (monthDay) return ymd(Number(monthDay[3]), MONTHS[monthDay[1].toLowerCase()], Number(monthDay[2]))
  const dayMonthNoYear = text.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${Object.keys(MONTHS).join('|')})\\b`, 'i'))
  if (dayMonthNoYear) {
    const year = new Date().getFullYear()
    return ymd(year, MONTHS[dayMonthNoYear[2].toLowerCase()], Number(dayMonthNoYear[1]))
  }
  return
}

function findAudience(text: string): number | undefined {
  const m = text.match(/\b(\d{2,5})\s*(?:\+|plus)?\s*(?:people|attendees|guests|hackers|builders|participants|going|registered|rsvps?)\b/i)
  if (!m) return
  const n = Number(m[1])
  return n > 0 && n < 100000 ? n : undefined
}

function extractPartners(pageUrl: string, html: string): ScrapedPartner[] {
  const headings = [...html.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].map(m => ({
    level: Number(m[1]),
    label: cleanLabel(m[2]),
    index: m.index ?? 0,
  }))
  const found: ScrapedPartner[] = []
  const seen = new Set<string>()
  let pageHost = ''
  try {
    pageHost = new URL(pageUrl).hostname.toLowerCase().replace(/^www\./, '')
  } catch { /* ignore */ }

  for (const anchor of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const at = anchor.index ?? 0
    let owner: { level: number; label: string } | undefined
    for (const h of headings) {
      if (h.index >= at) break
      if (isPartnerHeading(h.label)) owner = h
      else if (owner && h.level <= owner.level) owner = undefined
    }
    if (!owner) continue
    const href = attr(anchor[1], 'href')
    if (!href) continue
    const absolute = absolutize(pageUrl, href)
    const domain = absolute ? domainOf(absolute) : null
    if (!domain || domain === pageHost) continue
    if (/^(docs|developer|developers|api|help|status|blog|support|edge)\./.test(domain)) continue
    const name = partnerName(anchor[1], anchor[2])
    if (!name || seen.has(domain)) continue
    seen.add(domain)
    found.push({
      name,
      domain,
      role: roleFromHeading(owner.label),
      kind: /\bvenue\b/i.test(owner.label) ? 'venue' : 'sponsor',
      sourceUrl: pageUrl,
    })
  }
  return found
}

function cleanLabel(inner: string): string {
  return decode(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function isPartnerHeading(label: string): boolean {
  if (/judge|speaker|mentor|schedule|prize|track|host|organiser|organizer/i.test(label)) return false
  if (/\b(sponsors?|partners?)\b/i.test(label)) return true
  return /^\s*venue\b/i.test(label) || /\bvenue partner\b/i.test(label)
}

function roleFromHeading(label: string): string {
  const clean = label.replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s+/g, ' ').trim()
  if (/^venue\b/i.test(clean)) return 'Venue partner'
  if (/technology|tech/i.test(clean)) return 'Tech partner'
  if (/community/i.test(clean)) return 'Community partner'
  return clean.replace(/partners$/i, 'partner').replace(/sponsors$/i, 'sponsor')
}

function partnerName(attrs: string, inner: string): string | undefined {
  const titled = attr(attrs, 'title') || attr(attrs, 'aria-label')
  const alt = inner.match(/<img\b[^>]*\balt=["']([^"']+)["']/i)?.[1]
  const svg = inner.match(/<svg\b[^>]*\baria-label=["']([^"']+)["']/i)?.[1]
  const text = decode(inner.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
  const name = decode(titled || alt || svg || text)
    .replace(/\s+/g, ' ')
    .replace(/\s*[→>]+\s*$/g, '')
    .trim()
  if (name.length < 2 || name.length > 60) return
  if (/^https?:/i.test(name)) return
  if (/^(register|learn more|website|read more|apply|tickets?|docs?|api docs?)$/i.test(name)) return
  return name
}

function domainOf(href: string): string | null {
  try {
    const u = new URL(href)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    const host = u.hostname.toLowerCase().replace(/^www\./, '')
    if (SOCIAL_HOSTS.some(b => host === b || host.endsWith(`.${b}`))) return null
    if (!host.includes('.')) return null
    return host
  } catch {
    return null
  }
}

function absolutize(base: string, href: string): string | null {
  try {
    return new URL(href, base).toString()
  } catch {
    return null
  }
}

function londonDate(iso: string): string | undefined {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return findDate(iso)
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)
  const y = parts.find(p => p.type === 'year')?.value
  const m = parts.find(p => p.type === 'month')?.value
  const day = parts.find(p => p.type === 'day')?.value
  if (!y || !m || !day) return
  return `${y}-${m}-${day}`
}

function ymd(year: number, month: number, day: number): string | undefined {
  if (!month || day < 1 || day > 31) return
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function meta(html: string, key: string): string | undefined {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? []
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const keyRe = new RegExp(`^(?:og:|twitter:)?${escaped}$`, 'i')
  for (const tag of tags) {
    const prop = attr(tag, 'property') || attr(tag, 'name') || ''
    if (!keyRe.test(prop) && prop.toLowerCase() !== key.toLowerCase()) continue
    const content = attr(tag, 'content')
    if (content) return decode(content).replace(/\s+/g, ' ').trim()
  }
  return
}

function tagText(html: string, tag: string): string | undefined {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'))
  if (!m) return
  return decode(m[1].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function visibleText(html: string): string {
  return decode(
    html
      .replace(/<(script|style|svg|noscript)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' '),
  ).trim()
}

function attr(tag: string, name: string): string | undefined {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))
  if (!m) return
  return decode(m[2] ?? m[3] ?? '')
}

function decode(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeChar(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeChar(parseInt(d, 10)))
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
}

function safeChar(code: number): string {
  if (!Number.isFinite(code) || code < 32 || code > 0x10ffff) return ''
  return String.fromCodePoint(code)
}

function cleanName(s: string): string {
  return decode(s)
    .replace(/\s*[|·•]\s*Luma\s*$/i, '')
    .replace(/\s*[|·•]\s*Events Calendar\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function clip(s: string, n: number): string {
  const t = s.replace(/\s+\n/g, '\n').replace(/[ \t]{2,}/g, ' ').trim()
  return t.length > n ? t.slice(0, n).trim() : t
}
