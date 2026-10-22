// Who sponsored, partnered with or hosted one event, read only from that
// event's own data: explicit partners, description, links and venue.
// Grok plus a heading heuristic (alone when there's no key) pull names out of
// the description, a guard drops any name that isn't literally in the text,
// and domains come only from the event's own links or the known sponsor list.
// Never guessed: a partner we can't place gets domain '' and is still
// returned, so the integrator decides whether to keep it. Script-only.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ScrapedPartner } from './event'
import { CACHE_DIR } from './http'
import type { RawEvent, RawLink } from './sources/types'

type Known = { name: string; domain: string }
type Found = { name: string; role: string; kind: 'sponsor' | 'venue' }

const XAI_URL = 'https://api.x.ai/v1/chat/completions'
const MAX_TEXT = 15000
const MAX_GROK = 4

const PLATFORMS = /^(luma|lu\.ma|meetup|meetup\.com|devpost|eventbrite)$/i
const GENERIC = /^(tba|tbc|tbd|sponsors?|partners?|venue|hosts?|organi[sz]ers?|judges?|speakers?|mentors?|you|we|us|everyone|community|the community|others?|more|our (sponsors|partners|community)|docs?|website|here|link|register|tickets?|apply|sign up|learn more)$/i

// Social, link-shortener, form and event-platform hosts never name a partner.
const IGNORED_HOSTS = [
  'linkedin.com', 'lnkd.in', 'x.com', 'twitter.com', 't.co', 'instagram.com', 'facebook.com', 'fb.com', 'fb.me',
  'tiktok.com', 'youtube.com', 'youtu.be', 't.me', 'telegram.me', 'linktr.ee', 'lu.ma', 'luma.com', 'meetup.com',
  'devpost.com', 'forms.gle', 'goo.gl', 'docs.google.com', 'drive.google.com', 'maps.google.com', 'calendar.google.com',
  'bit.ly', 'tinyurl.com', 'rebrand.ly', 'ow.ly', 'buff.ly', 'shorturl.at', 'discord.gg', 'discord.com', 'github.com',
  'notion.site', 'wa.me', 'whatsapp.com', 'calendly.com', 'typeform.com', 'tally.so',
]

// Subdomains that belong to the same company as their parent (docs.cognee.ai -> cognee.ai).
const PLAIN_SUBDOMAINS = new Set(['www', 'docs', 'developer', 'developers', 'api', 'app', 'blog', 'help', 'support', 'status', 'consumer', 'en', 'uk', 'events', 'go', 'get'])

export async function findPartners(ev: RawEvent, known: Known[]): Promise<ScrapedPartner[]> {
  const out: ScrapedPartner[] = []
  const domains = new Set<string>()
  const names = new Set<string>()
  const add = (p: ScrapedPartner) => {
    const key = nameKey(p.name)
    if (!key || names.has(key) || (p.domain && domains.has(p.domain))) return
    names.add(key)
    if (p.domain) domains.add(p.domain)
    out.push(p)
  }

  try {
    for (const p of ev.partners ?? []) add(p) // explicit, from the source page

    const text = flat(ev.description ?? '')
    const links = ev.links ?? []
    if (text) {
      const people = personNames(links)
      // Grok first; the heading heuristic backs it up (Grok sometimes drops items) and
      // stands in alone when there's no key or the call fails.
      const raw = [...((await fromGrok(text)) ?? []), ...fromHeadings(text)]
      for (const f of raw) {
        const name = guardName(f.name, text)
        if (!name || isNoise(name, ev, people)) continue
        add({ ...f, name, domain: resolveDomain(name, links, known, ev.url), sourceUrl: ev.url })
      }
    }

    const venue = venuePartner(ev, text, out)
    if (venue) add({ ...venue, domain: resolveDomain(venue.name, ev.links ?? [], known, ev.url), sourceUrl: ev.url })
  } catch {
    // Never throw: return whatever we have so far.
  }
  return mergeVenues(out)
}

// 'Expedite London HQ' and 'Expedite' are one venue: keep the one with a domain, else the first.
function mergeVenues(list: ScrapedPartner[]): ScrapedPartner[] {
  const beats = (o: ScrapedPartner, p: ScrapedPartner, first: boolean) => (o.domain && !p.domain) || (!!o.domain === !!p.domain && first)
  return list.filter((p, i) => p.kind !== 'venue' || !list.some((o, j) => j !== i && o.kind === 'venue' && sameOrg(o.name, p.name) && beats(o, p, j < i)))
}

// --- Grok ---

async function fromGrok(text: string): Promise<Found[] | undefined> {
  const key = process.env.XAI_API_KEY
  if (!key) return
  const model = process.env.SCRAPE_MODEL ?? 'grok-4.20-0309-non-reasoning'
  const file = join(CACHE_DIR, `grok-partners-${createHash('sha1').update(model + PROMPT + text).digest('hex')}.json`)
  try {
    const cached = JSON.parse(await readFile(file, 'utf8')) as Found[]
    if (Array.isArray(cached)) return cached
  } catch {}

  try {
    const found = await slot(() => askGrok(key, model, text))
    await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(file, JSON.stringify(found))
    return found
  } catch {
    return // fall back to the heuristic
  }
}

const PROMPT = `List EVERY organisation this event text presents as a sponsor or partner (tech, community, university, venue), "powered by", "supported by", "in collaboration with", "thanks to", a prize sponsor ("prizes from X", "credits from X"), or the venue host ("hosted at X", "venue: X").
Skip people, speakers, judges and their employers, the event platform (Luma, Meetup, Devpost, Eventbrite) and generic words. Copy each name exactly as written.
role is one of: Tech partner, Community partner, Venue partner, Sponsor, Prize sponsor. kind is "venue" only for the place the event is held, else "sponsor" (an organiser listed as "Host" is not the venue).
Reply {"partners":[{"name":"","role":"","kind":""}]}`

async function askGrok(key: string, model: string, text: string): Promise<Found[]> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(XAI_URL, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You extract event sponsors and partners. Reply with JSON only.' },
          { role: 'user', content: `${PROMPT}\n\nEvent text:\n"""\n${text.slice(0, MAX_TEXT)}\n"""` },
        ],
      }),
      signal: AbortSignal.timeout(20000),
    })
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      await new Promise(r => setTimeout(r, 3000))
      continue
    }
    if (!res.ok) throw new Error(`xAI ${res.status}`)
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return readFound(JSON.parse(data.choices?.[0]?.message?.content ?? '{}'))
  }
}

function readFound(json: unknown): Found[] {
  const list = Array.isArray(json) ? json : (json as { partners?: unknown })?.partners
  if (!Array.isArray(list)) throw new Error('no partners list')
  const found: Found[] = []
  for (const item of list) {
    const o = item as { name?: unknown; role?: unknown; kind?: unknown }
    if (typeof o?.name !== 'string' || !o.name.trim()) continue
    const role = normalRole(typeof o.role === 'string' ? o.role : '', o.kind === 'venue')
    found.push({ name: o.name.trim(), role, kind: role === 'Venue partner' ? 'venue' : 'sponsor' })
  }
  return found
}

function normalRole(role: string, venue: boolean): string {
  if (venue || /venue/i.test(role)) return 'Venue partner'
  if (/prize/i.test(role)) return 'Prize sponsor'
  if (/tech/i.test(role)) return 'Tech partner'
  if (/community|university|media/i.test(role)) return 'Community partner'
  return 'Sponsor'
}

// A few Grok calls at a time; a finished call hands its slot to the next waiter.
let running = 0
const waiting: (() => void)[] = []

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running < MAX_GROK) running++
  else await new Promise<void>(r => waiting.push(r))
  try {
    return await fn()
  } finally {
    const next = waiting.shift()
    if (next) next()
    else running--
  }
}

// --- Heuristic fallback: names under Sponsors / Partners / Powered by headings ---

const PARTNER_HEAD = /^(?:[\w-]+\s+){0,2}(?:sponsors?|partners?)(?:\s*(?:&|and)\s*(?:sponsors?|partners?))?\s*:?\s*$/i
const INLINE_HEAD = /\b(?:(?:[\w-]+\s+)?(?:sponsors?|partners?|partner companies)\s*:|powered by|supported by|sponsored by|thanks to|in collaboration with|in partnership with|hosted at)\s+(.+)/i
const CTA = /^(?:become|be|want|interested|looking|apply|email|contact|join)\b/i // 'Become a sponsor'
const SKIP_HEAD = /^(?:hosts?|hosted by|organi[sz]ed by|organi[sz]ers?)\s*:?\s*$/i
const STOP_HEAD = /^(?:judges?|speakers?|mentors?|schedule|agenda|tracks?|prizes?|faqs?|about|format|criteria|timeline|rules|tickets?|location|date|time|filming|practical|what|who|why|how|when|where)\b/i

function fromHeadings(text: string): Found[] {
  const found: Found[] = []
  let role = ''
  let left = 0 // lines left in the current section
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[^\p{L}\p{N}]+/u, '').trim()
    if (!line) continue
    const inline = line.match(INLINE_HEAD)
    if (PARTNER_HEAD.test(line) && !CTA.test(line)) {
      role = headingRole(line)
      left = 25
      continue
    }
    if (inline) {
      const label = inline[0].slice(0, inline[0].length - inline[1].length)
      let rest = inline[1].split(/[.!?;]\s|\s(?:for|who|which|to|on)\s/i)[0]
      // 'Hosted at the offices of X, this event...' names one place
      if (/hosted at/i.test(label)) rest = rest.split(',')[0].replace(/^(?:the\s+)?(?:offices?|home|hq|headquarters)\s+of\s+/i, '')
      for (const name of splitNames(rest)) found.push(asFound(name, headingRole(label)))
      continue
    }
    if (SKIP_HEAD.test(line)) {
      role = ''
      continue
    }
    if (left <= 0) continue
    left--
    if (STOP_HEAD.test(line) && line.length < 40) {
      left = 0
      continue
    }
    if (!role) continue
    // 'Supabase, connection: Jane Doe - the database' -> 'Supabase'
    const head = line.split(/\s[-–—|]\s/)[0].replace(/,[^,:]*:.*$/, '')
    if (head.length > 60) continue
    for (const name of splitNames(head)) found.push(asFound(name, role))
  }
  return found
}

function headingRole(line: string): string {
  if (/hosted at|venue/i.test(line)) return 'Venue partner'
  return normalRole(line.replace(/partners?\s*&\s*sponsors?|sponsors?\s*&\s*partners?/i, ''), false)
}

function asFound(name: string, role: string): Found {
  return { name, role, kind: role === 'Venue partner' ? 'venue' : 'sponsor' }
}

function splitNames(s: string): string[] {
  return s
    .split(/,|\s&\s|\sand\s|•|·|\s\|\s/)
    .map(p => p.replace(/\(.*?\)/g, '').replace(/^\s*and\s+/i, '').replace(/[.!:;]+$/, '').trim())
    .filter(p => p.length >= 2 && !/[:@/]|www\./i.test(p) && p.split(/\s+/).length <= 5)
    .filter(p => !/^(made possible|by|with|lead|leads|connection|thanks|courtesy|via|to be|further|more)\b/i.test(p))
}

// --- Guard and filters ---

// The name as it appears in the text, or undefined if it doesn't.
function guardName(name: string, text: string): string | undefined {
  const full = findInText(name, text) ?? findInText(stripSuffix(name), text)
  if (!full) return
  const bare = full.replace(/\s*\([^)]*\)\s*$/, '').trim() // 'Jumpstart (Sales Track)' -> 'Jumpstart'
  return bare && bare !== full ? findInText(bare, text) ?? full : full
}

function findInText(name: string, text: string): string | undefined {
  const n = name.replace(/\s+/g, ' ').trim()
  if (n.length < 2) return
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(n)}(?![\\p{L}\\p{N}])`, 'iu')
  return text.match(re)?.[0].replace(/\s+/g, ' ')
}

function isNoise(name: string, ev: RawEvent, people: Set<string>): boolean {
  const key = nameKey(name)
  const phrase = /\s/.test(name) && name === name.toLowerCase() // 'senior operators'
  return phrase || PLATFORMS.test(name) || GENERIC.test(name) || people.has(key) || key === nameKey(ev.name)
}

// Anchor text linked to a LinkedIn profile is a person, not an organisation.
function personNames(links: RawLink[]): Set<string> {
  return new Set(links.filter(l => /linkedin\.com\/in\//i.test(l.href)).map(l => nameKey(l.text)))
}

// --- Venue ---

function venuePartner(ev: RawEvent, text: string, have: ScrapedPartner[]): Found | undefined {
  const raw = ev.venue?.name?.trim()
  if (!raw || looksLikeAddress(raw, ev)) return
  const linked = (ev.links ?? []).some(l => nameKey(l.text) === nameKey(raw))
  const name = (text && guardName(raw, text)) || (linked ? raw : undefined)
  if (!name) return
  if (have.some(p => sameOrg(p.name, name))) return
  return { name, role: 'Venue partner', kind: 'venue' }
}

function looksLikeAddress(name: string, ev: RawEvent): boolean {
  if (/^\d/.test(name)) return true
  if (/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.test(name)) return true // UK postcode
  if (/\b(street|st|road|rd|lane|ln|avenue|ave|square|sq|way|row|terrace|grove|close|crescent|mews|wharf)\.?$/i.test(name)) return true
  if (/^(online|virtual|zoom|tba|tbc|tbd|london)$/i.test(name)) return true
  return !!ev.city && nameKey(name) === nameKey(ev.city)
}

// --- Domains ---

function resolveDomain(name: string, links: RawLink[], known: Known[], eventUrl: string): string {
  const key = nameKey(name)
  const own = hostOf(eventUrl)
  const usable = links.map(l => ({ text: l.text, host: hostOf(l.href) })).filter(l => l.host && l.host !== own)
  const byText = usable.find(l => nameKey(l.text) === key)
  if (byText) return byText.host
  const slug = key.replace(/[^a-z0-9]/g, '')
  if (slug.length >= 3) {
    const labels = (host: string) => host.split('.').slice(0, -1)
    const exact = usable.find(l => labels(l.host).includes(slug))
    if (exact) return exact.host
    const partial = usable.find(l => labels(l.host).some(label => label.includes(slug)))
    if (partial) return partial.host
  }
  const match = known.find(k => k.domain && nameKey(k.name) === key)
  return match ? match.domain.toLowerCase().replace(/^www\./, '') : ''
}

// Lowercase host without www, or '' for ignored hosts and non-web links.
function hostOf(href: string): string {
  let u: URL
  try {
    u = new URL(href)
  } catch {
    return ''
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return ''
  let host = u.hostname.toLowerCase().replace(/^www\./, '')
  if (!host.includes('.')) return ''
  if (IGNORED_HOSTS.some(h => host === h || host.endsWith(`.${h}`))) return ''
  if (/(^|\.)eventbrite\./.test(host)) return ''
  if (host === 'google.com' && /^\/(forms|maps)/.test(u.pathname)) return ''
  if ((host === 'notion.so' || host === 'notion.com') && u.pathname.length > 1) return ''
  const parts = host.split('.')
  if (parts.length >= 3 && PLAIN_SUBDOMAINS.has(parts[0])) {
    const rest = parts.slice(1).join('.')
    if (!/^(co|com|org|ac|gov|net)\.[a-z]{2}$/.test(rest)) host = rest
  }
  return host
}

// --- Names ---

function nameKey(name: string): string {
  return stripSuffix(name.toLowerCase().replace(/\s+/g, ' ').trim())
}

function stripSuffix(name: string): string {
  return name.replace(/(?:[\s,.]+(?:ltd|limited|inc|llc|plc|ai)\.?)+$/i, '').trim()
}

// Loose match for venues: 'Expedite' ~ 'Expedite London HQ', 'Autogen' ~ 'AutogenAI'.
function sameOrg(a: string, b: string): boolean {
  const [ka, kb] = [nameKey(a), nameKey(b)]
  if (containsWord(ka, kb) || containsWord(kb, ka)) return true
  const [sa, sb] = [ka.replace(/[^a-z0-9]/g, ''), kb.replace(/[^a-z0-9]/g, '')]
  return Math.min(sa.length, sb.length) >= 5 && (sa.startsWith(sb) || sb.startsWith(sa))
}

function containsWord(hay: string, needle: string): boolean {
  if (!needle) return false
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(needle)}(?![\\p{L}\\p{N}])`, 'u').test(hay)
}

function flat(s: string): string {
  return s.replace(/[ \t\u00a0]+/g, ' ').replace(/\n{2,}/g, '\n').trim()
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+')
}
