// Scrapes London tech events from every source in lib/scrape/sources, finds who
// backed each one, and merges events, sponsors and backings into data/london.json
// without losing any row already there. docs/07-event-scraper.md explains it.
//
// node --env-file-if-exists=.env.local --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
//   --import ./scripts/register.mjs scripts/scrape-events.ts \
//   [--past 120] [--future 60] [--limit 150] [--only luma,meetup] [--dry-run] [--base file]
// --base: Jawad's hand-made map (git show 8897738:data/london.json). Its rows are
// put back if missing and marked hand-made again (no `source`).
import { readFile, writeFile } from 'node:fs/promises'
import type { ScrapedPartner } from '../lib/scrape/event'
import { inLondon, isTech, offTopic } from '../lib/scrape/filter'
import { getText } from '../lib/scrape/http'
import { findPartners, mainLabel, notBackerInText } from '../lib/scrape/partners'
import type { Discover, DiscoverOptions, RawEvent, RawLink, Source } from '../lib/scrape/sources/types'

const MAP_FILE = new URL('../data/london.json', import.meta.url)
const SOURCES: Source[] = ['luma', 'devpost', 'meetup', 'builderbase', 'mlh', 'eventbrite', 'devevents', 'confstech', 'gdg', 'hackclub']
const PARTNER_CONCURRENCY = 4
const CLASSIFY = '../lib/scrape/classify' // optional; built separately, loaded only if present

// Checked by hand (facts, not guesses). Listed before the map's sponsors so they win a name match.
const VERIFIED: { name: string; domain: string }[] = [
  ...['Cursor:cursor.com', 'Supabase:supabase.com', 'Notion:notion.com', 'Cognee:cognee.ai', 'Zero:zero.inc'],
  ...['xAI:x.ai', 'SpaceXAI:x.ai', 'Grok:x.ai', 'Grok Bot:x.ai', 'Expedite:expedite.london', 'Expedite London HQ:expedite.london'],
  ...['OpenAI:openai.com', 'Anthropic:anthropic.com', 'Google:google.com', 'Google Cloud:cloud.google.com', 'Microsoft:microsoft.com'],
  ...['AWS:aws.amazon.com', 'Amazon Web Services:aws.amazon.com', 'Vercel:vercel.com', 'GitHub:github.com', 'Stripe:stripe.com'],
  ...['ElevenLabs:elevenlabs.io', 'Mistral AI:mistral.ai', 'Hugging Face:huggingface.co', 'Lovable:lovable.dev', 'Replit:replit.com'],
  ...['Modal:modal.com', 'NVIDIA:nvidia.com', 'CoreWeave:coreweave.com', 'Weights & Biases:wandb.ai', 'Nebius:nebius.com'],
  ...['Encode Club:encode.club', 'Imperial College London:imperial.ac.uk', 'UCL:ucl.ac.uk', "King's College London:kcl.ac.uk", 'LSE:lse.ac.uk'],
].map(pair => {
  const [name, domain] = pair.split(':')
  return { name, domain }
})

// Platforms and socials are never a backer, whatever a page links.
const NOT_SPONSOR = /(?:^|\.)(?:luma\.com|lu\.ma|meetup\.com|devpost\.com|eventbrite\.[a-z.]+|builderbase\.com|mlh\.(?:io|com)|linkedin\.com|lnkd\.in|x\.com|twitter\.com|instagram\.com|facebook\.com|youtube\.com|youtu\.be|tiktok\.com|t\.me|discord\.gg|discord\.com|linktr\.ee|forms\.gle|bit\.ly|wa\.me|calendly\.com|typeform\.com|tally\.so|notion\.site|beehiiv\.com|substack\.com|mailchi\.mp|list-manage\.com|medium\.com|ghost\.io|buttondown\.email|eepurl\.com)$/

// Link labels and promos that a page lists next to real partners.
const GENERIC_NAME = /^(?:newsletter|website|blog|subscribe|follow us|contact(?: us)?|linkedin|twitter|instagram|home|here|link|free\b.*|.*\b(?:training|course|webinar|e-?book)\b.*)$/i

// Conference sites (confs.tech, dev.events) list media partners, directories and
// other conferences beside sponsors, and an old or other edition's sponsors.
const CONF_SOURCES = new Set(['confstech', 'devevents'])
const DIRECTORY_LABEL = /conf|summit|events?|alert|jobs|magazine|news|press|times|media|expo|awards/
const DOMAIN_NAME = /^[\w-]+(?:\.[\w-]+)+$/ // 'posthog.com' from a cookie banner, not a logo
const LUMA_HOST = /(?:^|\.)(?:luma\.com|lu\.ma)$/
const PLATFORM_PAGE = /(?:^|\.)(?:luma\.com|lu\.ma|meetup\.com|eventbrite\.[a-z.]+|devpost\.com)$/
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']

// 'London, United Kingdom' says nothing a pin or address can use.
const CITY_ONLY = /^(?:(?:greater )?london|united kingdom|uk|england|gb)(?:\s*,\s*(?:(?:greater )?london|united kingdom|uk|england|gb))*$/i
const editions = new Map<string, Promise<boolean>>() // page|date -> same London edition

// Words that don't tell one organiser from another ('enki events' is enki).
const ORG_FILLER = /\b(?:the|events?|community|network|group|user|users|meetups?|london|uk|club|hq|team|official|ltd|limited|inc|llc|plc)\b/g

type MapEvent = {
  id: string
  name: string
  url: string
  date: string | null
  city: string
  topic: string
  audienceSize: number | null
  organiser: string | null
  sourceUrl?: string
  source?: string
  lat?: number
  lng?: number
  venue?: string
  address?: string
  country?: string
}
type MapSponsor = { id: string; name: string; domain: string; kind: 'sponsor' | 'venue'; sourceUrl?: string }
type MapBacking = { eventId: string; sponsorId: string; role: string; sourceUrl: string }
type MapFile = { events: MapEvent[]; sponsors: MapSponsor[]; backings: MapBacking[] }

type Verdict = { tech: boolean; confidence?: number; reason?: string }
type Classify = (events: RawEvent[]) => Promise<Map<string, Verdict>>

// One event after cross-source dedupe; urls keeps every URL it was seen under.
type Item = { ev: RawEvent; urls: Set<string>; partners: ScrapedPartner[] }
type Pruned = { backing: MapBacking; why: string }

const started = Date.now()
const opts: DiscoverOptions = { pastDays: num('past', 120), futureDays: num('future', 60), limit: num('limit', 150) }
const only = arg('only')?.split(',').map(s => s.trim()).filter(Boolean)
const dryRun = process.argv.includes('--dry-run')

const map = JSON.parse(await readFile(MAP_FILE, 'utf8')) as MapFile
const today = londonDate(new Date())
const base = await readBase()
const restored = restoreBase()
const repaired = repairRows()

// 1. Every available source, side by side. A missing or failing one is skipped.
const perSource = new Map<string, { raw: number; kept: number; geo: number; partners: number; ms: number; error?: string }>()
const skipped: string[] = []
const discovered = await runSources()
const raw = discovered.flat()

// 2. London + tech. classify.ts (if present) decides tech; isTech otherwise.
const london = raw.filter(ev => safe(() => inLondon(ev), false))
const fileBackings = countBy(map.backings, b => b.eventId)
const rawByUrl = new Map(raw.map(ev => [normUrl(ev.url), ev]))
// Only scraped rows seen again this run are re-judged, on what the source says now.
// Hand-made rows (no source) and rows a source didn't return are never judged.
const unbacked = map.events.filter(e => e.source && !base.events.has(e.id) && !fileBackings.get(e.id))
const existingAsRaw = new Map(unbacked.flatMap(e => {
  const seen = rawByUrl.get(normUrl(e.url)) ?? (e.sourceUrl ? rawByUrl.get(normUrl(e.sourceUrl)) : undefined)
  return seen ? [[e.id, seen] as const] : []
}))
const tech = await techCheck([...london, ...existingAsRaw.values()])
const kept = london.filter(tech.test)
for (const ev of kept) {
  const s = perSource.get(ev.source)
  if (!s) continue
  s.kept++
  if (ev.geo) s.geo++
  if (ev.partners?.length) s.partners++
}

// 3. Dedupe across sources, then find partners (concurrency 4).
const items = dedupe(kept)
const groupHome = groupSponsorHomes(items)
const known = [...VERIFIED, ...map.sponsors.map(s => ({ name: s.name, domain: s.domain }))]
await resolvePartners(known)
// Second pass: a name one page links (Encode Hub) resolves the same name on another page. Grok is cached.
await resolvePartners([...known, ...items.flatMap(it => it.partners.filter(p => p.domain).map(p => ({ name: p.name, domain: p.domain })))])

// 4. Merge into the map without overwriting anything already there.
const stats = merge(items)
const pruned = [...stats.pruned, ...(await pruneBackings())]
const sponsorsRemoved = dropOrphanSponsors(pruned)
repaired.push(...dropFuzzedPins())
const removed = removeNonTech()
const report = summary()

if (dryRun) console.log('\n--dry-run: data/london.json not written')
else {
  sortMap()
  await writeFile(MAP_FILE, `${JSON.stringify(map, null, 2)}\n`)
  console.log(`\nWrote data/london.json: ${map.events.length} events, ${map.sponsors.length} sponsors, ${map.backings.length} backings`)
}
console.log(report)

// --- Sources ---

async function runSources(): Promise<RawEvent[][]> {
  const wanted = only?.length ? SOURCES.filter(s => only.includes(s)) : SOURCES
  for (const name of only ?? []) if (!SOURCES.includes(name as Source)) log(`unknown source '${name}', ignored`)
  const loaded: [Source, Discover][] = []
  for (const name of wanted) {
    const discover = await load(name)
    if (discover) loaded.push([name, discover])
  }
  log(`running ${loaded.map(l => l[0]).join(', ')} with past ${opts.pastDays}d, future ${opts.futureDays}d, limit ${opts.limit}`)
  const settled = await Promise.allSettled(
    loaded.map(async ([name, discover]) => {
      const t = Date.now()
      try {
        const list = await discover(opts)
        const events = (Array.isArray(list) ? list : []).filter(ev => ev?.url && ev.name).map(ev => noLumaPlace({ ...ev, source: ev.source ?? name }))
        perSource.set(name, { raw: events.length, kept: 0, geo: 0, partners: 0, ms: Date.now() - t })
        log(`${name}: ${events.length} events in ${secs(Date.now() - t)}`)
        return events
      } catch (err) {
        perSource.set(name, { raw: 0, kept: 0, geo: 0, partners: 0, ms: Date.now() - t, error: message(err) })
        log(`${name}: failed (${message(err)}), skipped`)
        throw err
      }
    }),
  )
  return settled.map(r => (r.status === 'fulfilled' ? r.value : []))
}

// Another source reading a Luma page gets Luma's fuzzed pin and placeholder venue
// for unregistered visitors; only the luma source knows when they're real.
function noLumaPlace(ev: RawEvent): RawEvent {
  if (ev.source === 'luma' || !LUMA_HOST.test(hostOf(ev.url))) return ev
  return { ...ev, geo: undefined, venue: undefined }
}

async function load(name: Source): Promise<Discover | undefined> {
  try {
    const mod = (await import(`../lib/scrape/sources/${name}`)) as { discover?: unknown }
    if (typeof mod.discover === 'function') return mod.discover as Discover
    log(`${name}: no discover export, skipped`)
  } catch (err) {
    log(`${name}: not available (${message(err).split('\n')[0]}), skipped`)
  }
  skipped.push(name)
}

// --- Tech filter ---

async function techCheck(events: RawEvent[]): Promise<{ test: (ev: RawEvent) => boolean; by: string }> {
  let verdicts: Map<string, Verdict> | undefined
  try {
    const mod = (await import(CLASSIFY)) as { classifyTech?: unknown }
    if (typeof mod.classifyTech === 'function') {
      const unique = [...new Map(events.map(ev => [ev.url, ev])).values()]
      const result = await (mod.classifyTech as Classify)(unique)
      if (result instanceof Map) verdicts = result
    }
  } catch (err) {
    if (!/Cannot find module|ERR_MODULE_NOT_FOUND/.test(message(err))) log(`classify.ts failed (${message(err)}), using isTech`)
  }
  const by = verdicts ? `classifyTech (${verdicts.size} verdicts, isTech for the rest)` : 'isTech'
  log(`tech filter: ${by}`)
  // Off-topic titles are out whatever the classifier says; Eventbrite also needs isTech.
  const rule = (ev: RawEvent) => safe(() => isTech(ev), false)
  const test = (ev: RawEvent) => {
    if (safe(() => offTopic(ev), false)) return false
    const verdict = verdicts?.get(ev.url)?.tech
    if (verdict === undefined) return rule(ev)
    return verdict && (ev.source !== 'eventbrite' || rule(ev))
  }
  return { by, test }
}

// --- Dedupe ---

function dedupe(events: RawEvent[]): Item[] {
  const items: Item[] = []
  const byUrl = new Map<string, Item>()
  const byName = new Map<string, Item[]>()
  for (const ev of events) {
    const url = normUrl(ev.url)
    const found = byUrl.get(url) ?? sameNameNear(byName.get(normName(ev.name)) ?? [], ev.date, it => it.ev.date)
    if (found) {
      found.ev = combine(found.ev, ev)
      found.urls.add(url)
      byUrl.set(url, found)
    } else {
      const item: Item = { ev, urls: new Set([url]), partners: [] }
      items.push(item)
      byUrl.set(url, item)
      byName.set(normName(ev.name), [...(byName.get(normName(ev.name)) ?? []), item])
    }
  }
  return items.sort((a, b) => (a.ev.date ?? '9999').localeCompare(b.ev.date ?? '9999') || a.ev.url.localeCompare(b.ev.url))
}

// Same name within two days: Devpost dates a hackathon by its deadline, MLH by its start.
function sameNameNear<T>(list: T[], date: string | undefined | null, dateOf: (x: T) => string | undefined | null): T | undefined {
  if (!date) return
  return list.find(x => {
    const other = dateOf(x)
    return !!other && Math.abs(Date.parse(other) - Date.parse(date)) <= 2 * 24 * 60 * 60 * 1000
  })
}

// Keep the record with more data; fill its gaps from the other and pool links and partners.
function combine(a: RawEvent, b: RawEvent): RawEvent {
  const [base, other] = richness(b) > richness(a) ? [b, a] : [a, b]
  const out: RawEvent = { ...other, ...stripUndefined(base) }
  out.links = unionBy([...(base.links ?? []), ...(other.links ?? [])], (l: RawLink) => l.href)
  out.partners = unionBy([...(base.partners ?? []), ...(other.partners ?? [])], p => p.domain || normName(p.name))
  if (!out.links.length) out.links = undefined
  if (!out.partners.length) out.partners = undefined
  return out
}

function richness(ev: RawEvent): number {
  const fields = [ev.date, ev.city, ev.country, ev.venue?.name, ev.venue?.address, ev.geo, ev.organiser, ev.audienceSize, ev.categories?.length, ev.description]
  return fields.filter(Boolean).length + (ev.links?.length ?? 0) / 10 + (ev.partners?.length ?? 0)
}

// --- Partners ---

async function resolvePartners(known: { name: string; domain: string }[]) {
  await pool(items, PARTNER_CONCURRENCY, async item => {
    const group = (item.ev.partners ?? []).filter(p => p.role === 'Group sponsor')
    const home = groupHome.get(groupKey(item.ev)) === item
    const ev = { ...item.ev, partners: item.ev.partners?.filter(p => p.role !== 'Group sponsor' || home) }
    // The group's own sponsor list still names their domains when the description mentions them.
    const named = [...group.map(p => ({ name: p.name, domain: p.domain })), ...known]
    const cleaned = cleanPartners(await safeAsync(() => findPartners(ev, named), ev.partners ?? []), ev)
    item.partners = await safeAsync(() => sameEdition(cleaned, ev.date), [])
  })
}

// Conference partners count only when their page is this London edition.
async function sameEdition(list: ScrapedPartner[], date: string | null | undefined): Promise<ScrapedPartner[]> {
  const out: ScrapedPartner[] = []
  for (const p of list) if (await editionOk(p.sourceUrl, date)) out.push(p)
  return out
}

// The page names London and the event's month, or its path carries the year or 'london'.
// aicodingsummit.com now shows the NYC edition (November): its sponsors aren't London's.
function editionOk(url: string, date: string | null | undefined): Promise<boolean> {
  const key = `${url}|${date ?? ''}`
  if (!editions.has(key)) editions.set(key, checkEdition(url, date))
  return editions.get(key)!
}

async function checkEdition(url: string, date: string | null | undefined): Promise<boolean> {
  if (!url || PLATFORM_PAGE.test(hostOf(url))) return true
  let text: string
  try {
    text = (await getText(url)).replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
  } catch {
    return false // can't check, so don't credit
  }
  if (!/\blondon\b/i.test(text)) return false
  if (!date) return true
  const month = MONTHS[Number(date.slice(5, 7)) - 1] ?? ''
  if (month && new RegExp(`\\b(?:${month}|${month.slice(0, 3)})\\b`, 'i').test(text)) return true
  return safe(() => new URL(url).pathname.includes(date.slice(0, 4)), false) || /london/i.test(url)
}

// Meetup group sponsors back the group, not one event: keep them once per
// group, on its most recent event in the window (or its next one if none has happened).
function groupSponsorHomes(list: Item[]): Map<string, Item> {
  const homes = new Map<string, Item>()
  const rank = (it: Item) => {
    const d = it.ev.date ?? ''
    return d <= today ? `0${invert(d)}` : `1${d}`
  }
  for (const it of list) {
    if (!it.ev.partners?.some(p => p.role === 'Group sponsor')) continue
    const key = groupKey(it.ev)
    const home = homes.get(key)
    if (!home || rank(it) < rank(home)) homes.set(key, it)
  }
  return homes
}

function groupKey(ev: RawEvent): string {
  return `${ev.source}|${normName(ev.organiser ?? ev.url)}`
}

// Organisers, Luma hosts and co-hosts aren't backers; platforms, newsletters and the
// event's own site aren't either. Conference pages also drop directories and media.
function cleanPartners(list: ScrapedPartner[], ev: RawEvent): ScrapedPartner[] {
  // Only the organiser: a co-host company that the page also lists as a partner
  // (Google DeepMind, Nebius) is a backer; 'hosted by X' text is caught below.
  const owners = ev.organiser ? [ev.organiser] : []
  const ownSites = new Set([hostOf(ev.url), ...(ev.hosts ?? []).map(h => hostOf(h.website ?? ''))].filter(Boolean))
  const text = ev.description ?? ''
  const out: ScrapedPartner[] = []
  for (const p of list) {
    const name = p.name?.trim()
    if (!name || GENERIC_NAME.test(name)) continue
    const domain = (p.domain ?? '').trim().toLowerCase().replace(/^www\./, '')
    if (domain && (ownSites.has(domain) || NOT_SPONSOR.test(domain) || !domain.includes('.'))) continue
    if (selfBacker(name, domain, owners)) continue
    if (text && safe(() => notBackerInText(name, p.kind, text, ev.source === 'meetup'), false)) continue
    if (CONF_SOURCES.has(ev.source) && confNoise(name, domain)) continue
    out.push({ ...p, name, domain, sourceUrl: p.sourceUrl || ev.url })
  }
  return out
}

// enki (enki.work) backing 'enki events', Ren (syrena.co.uk) for Syrena Network,
// bcs.org for 'BCS, The Chartered Institute for IT', a Luma host named as a sponsor.
function selfBacker(name: string, domain: string, owners: string[]): boolean {
  const label = domain ? mainLabel(domain) : ''
  return owners.some(o => {
    const core = orgCore(o)
    if (orgKey(name) === orgKey(o) || (core.length >= 3 && core === orgCore(name))) return true
    return label.length >= 3 && core === label
  })
}

function orgCore(s: string): string {
  return normName(s.split(/,|\s[-|–—]\s|\(/)[0].toLowerCase().replace(ORG_FILLER, ' '))
}

function confNoise(name: string, domain: string): boolean {
  return DOMAIN_NAME.test(name) || (!!domain && DIRECTORY_LABEL.test(mainLabel(domain)))
}

// --- Merge ---

function merge(list: Item[]) {
  const byId = new Map(map.events.map(e => [e.id, e]))
  const byUrl = new Map<string, MapEvent>()
  const byName = new Map<string, MapEvent[]>()
  for (const e of map.events) {
    for (const u of [e.url, e.sourceUrl]) if (u) byUrl.set(normUrl(u), e)
    byName.set(normName(e.name), [...(byName.get(normName(e.name)) ?? []), e])
  }
  const sponsorIds = new Set(map.sponsors.map(s => s.id))
  const backingKeys = new Set(map.backings.map(b => `${b.eventId}|${b.sponsorId}`))
  const sponsorById = new Map(map.sponsors.map(s => [s.id, s]))
  const fresh = new Map<string, Set<string>>() // row id -> partner domains found this run
  const out = { added: [] as MapEvent[], updated: [] as string[], sponsorsAdded: 0, backingsAdded: [] as MapBacking[], unresolved: [] as string[], unresolvedCount: 0, pruned: [] as Pruned[] }

  for (const item of list) {
    const ev = item.ev
    const id = eventId(ev)
    const existing =
      byId.get(id) ?? [...item.urls].map(u => byUrl.get(u)).find(Boolean) ?? sameNameNear(byName.get(normName(ev.name)) ?? [], ev.date, e => e.date)
    let row: MapEvent
    if (existing) {
      row = existing
      if (fillEmpty(row, ev)) out.updated.push(row.id)
    } else {
      row = newRow(id, ev)
      map.events.push(row)
      byId.set(row.id, row)
      for (const u of item.urls) byUrl.set(u, row)
      byName.set(normName(row.name), [...(byName.get(normName(row.name)) ?? []), row])
      out.added.push(row)
    }

    const found = fresh.get(row.id) ?? new Set<string>()
    fresh.set(row.id, found)
    for (const p of item.partners) {
      // amazon.com from a book link is not the existing 'Amazon Web Services' row.
      const existingSponsor = p.domain ? sponsorById.get(p.domain) : undefined
      if (existingSponsor && !nameFits(p.name, existingSponsor.name, p.domain)) p.domain = ''
      if (!p.domain) {
        out.unresolvedCount++
        if (out.unresolved.length < 25) out.unresolved.push(`${p.name} (${ev.name.slice(0, 50)})`)
        continue
      }
      found.add(p.domain)
      if (!sponsorIds.has(p.domain)) {
        const sponsor: MapSponsor = { id: p.domain, name: VERIFIED.find(v => v.domain === p.domain)?.name ?? p.name, domain: p.domain, kind: p.kind === 'venue' ? 'venue' : 'sponsor', sourceUrl: p.sourceUrl }
        map.sponsors.push(sponsor)
        sponsorById.set(sponsor.id, sponsor)
        sponsorIds.add(p.domain)
        out.sponsorsAdded++
      }
      const key = `${row.id}|${p.domain}`
      if (backingKeys.has(key)) continue
      const backing = { eventId: row.id, sponsorId: p.domain, role: p.role || (p.kind === 'venue' ? 'Venue' : 'Sponsor'), sourceUrl: p.sourceUrl || ev.url }
      map.backings.push(backing)
      backingKeys.add(key)
      out.backingsAdded.push(backing)
    }
  }
  // A scraped event seen again: its scraped backings are what its page says now.
  // Hand-made backings (and, without --base, every backing on a hand-made row) stay.
  const rows = new Map(map.events.map(e => [e.id, e]))
  map.backings = map.backings.filter(b => {
    const now = fresh.get(b.eventId)
    const row = rows.get(b.eventId)
    if (!now || !row || now.has(b.sponsorId) || base.backings.has(`${b.eventId}|${b.sponsorId}`)) return true
    if (!row.source && !base.loaded) return true
    out.pruned.push({ backing: b, why: 'no longer found on its page' })
    return false
  })
  return out
}

// The scraped name names the same company as the sponsor row it would join.
function nameFits(scraped: string, existing: string, domain: string): boolean {
  const [a, b] = [orgKey(scraped), orgKey(existing)]
  if (!a || !b || a === b || a.includes(b) || b.includes(a)) return true
  const label = mainLabel(domain)
  if (label.length >= 3 && (a.includes(label) || label.includes(a))) return true
  const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter(w => w.length >= 3))
  const wb = words(existing)
  return [...words(scraped)].some(w => wb.has(w))
}

// Backings no source re-checked this run, judged by the same rules on the map's own
// fields: generic names, newsletters, the organiser itself, and conference noise.
async function pruneBackings(): Promise<Pruned[]> {
  const rows = new Map(map.events.map(e => [e.id, e]))
  const sponsors = new Map(map.sponsors.map(s => [s.id, s]))
  const out: Pruned[] = []
  const keep: MapBacking[] = []
  for (const b of map.backings) {
    const why = base.backings.has(`${b.eventId}|${b.sponsorId}`) ? '' : await badBacking(b, rows.get(b.eventId), sponsors.get(b.sponsorId))
    if (why) out.push({ backing: b, why })
    else keep.push(b)
  }
  map.backings = keep
  return out
}

async function badBacking(b: MapBacking, row: MapEvent | undefined, sponsor: MapSponsor | undefined): Promise<string> {
  if (!row || !sponsor) return ''
  if (GENERIC_NAME.test(sponsor.name)) return 'generic link label'
  if (NOT_SPONSOR.test(sponsor.domain)) return 'platform or newsletter host'
  if (saasTenant(sponsor.name, sponsor.domain)) return 'tenant subdomain of a SaaS host'
  if (row.organiser && selfBacker(sponsor.name, sponsor.domain, [row.organiser])) return 'the organiser itself'
  const conf = CONF_SOURCES.has(row.source ?? '') || /^(?:confstech|devevents)-/.test(row.id)
  if (conf && confNoise(sponsor.name, sponsor.domain)) return 'conference directory, media or cookie link'
  if (conf && !(await editionOk(b.sourceUrl, row.date))) return 'another edition of the conference'
  return ''
}

// 'UKTV' at uktv.workvivo.com: the name is only the tenant label of someone else's host.
function saasTenant(name: string, domain: string): boolean {
  const labels = domain.split('.')
  const key = orgKey(name)
  if (VERIFIED.some(v => v.domain === domain)) return false // AWS at aws.amazon.com
  return labels.length > 2 && key === normName(labels[0]) && !key.includes(mainLabel(domain))
}

// A Luma event's pin is real only if the luma source gave one this run; Luma fuzzes
// it for unregistered visitors, and other sources reading the page copied it.
function dropFuzzedPins(): string[] {
  const out: string[] = []
  for (const e of map.events) {
    const seen = rawByUrl.get(normUrl(e.url))
    if (e.lat === undefined || !LUMA_HOST.test(hostOf(e.url)) || seen?.source !== 'luma' || seen.geo) continue
    delete e.lat
    delete e.lng
    out.push(`${e.id}: Luma pin is fuzzed`)
  }
  return out
}

// Sponsors left with no backing after this run's pruning, unless hand-made.
function dropOrphanSponsors(list: Pruned[]): string[] {
  const touched = new Set(list.map(p => p.backing.sponsorId))
  const used = new Set(map.backings.map(b => b.sponsorId))
  const gone = map.sponsors.filter(s => touched.has(s.id) && !used.has(s.id) && !base.sponsors.has(s.id)).map(s => s.id)
  const ids = new Set(gone)
  map.sponsors = map.sponsors.filter(s => !ids.has(s.id))
  return gone
}

function newRow(id: string, ev: RawEvent): MapEvent {
  const row: MapEvent = {
    id,
    name: ev.name.trim(),
    url: ev.url,
    date: ev.date ?? null,
    city: 'London',
    topic: topicOf(ev),
    audienceSize: ev.audienceSize ?? null,
    organiser: ev.organiser ?? null,
    sourceUrl: ev.url,
    source: ev.source,
  }
  fillEmpty(row, ev)
  return row
}

// Only fills fields that are empty in the map; never overwrites a value.
function fillEmpty(row: MapEvent, ev: RawEvent): boolean {
  // `source` is set only on rows we create: a row without one is hand-made.
  const values: Partial<MapEvent> = {
    date: ev.date,
    organiser: ev.organiser,
    audienceSize: ev.audienceSize,
    lat: ev.geo ? round(ev.geo.lat) : undefined,
    lng: ev.geo ? round(ev.geo.lng) : undefined,
    venue: placeOnly(ev.venue?.name),
    address: placeOnly(ev.venue?.address),
    country: ev.country?.trim() || undefined,
  }
  let changed = false
  for (const [key, value] of Object.entries(values) as [keyof MapEvent, unknown][]) {
    const current = row[key]
    if (value === undefined || value === null || value === '') continue
    if (current !== undefined && current !== null && current !== '') continue
    ;(row as Record<string, unknown>)[key] = value
    changed = true
  }
  return changed
}

// A venue or address that says more than the city.
function placeOnly(s: string | undefined): string | undefined {
  const v = s?.trim()
  return v && !CITY_ONLY.test(v) ? v : undefined
}


// Scraped events seen again this run, with no backings, that the tech filter now
// rejects on their full source data. Never a hand-made row, never one with backings.
function removeNonTech(): MapEvent[] {
  const backed = countBy(map.backings, b => b.eventId)
  const gone = map.events.filter(e => e.source && existingAsRaw.has(e.id) && !backed.get(e.id) && !tech.test(existingAsRaw.get(e.id)!))
  const ids = new Set(gone.map(e => e.id))
  map.events = map.events.filter(e => !ids.has(e.id))
  return gone
}

// --- Hand-made rows ---

async function readBase(): Promise<{ loaded: boolean; file?: MapFile; events: Set<string>; sponsors: Set<string>; backings: Set<string> }> {
  const path = arg('base')
  if (!path) return { loaded: false, events: new Set(), sponsors: new Set(), backings: new Set() }
  const file = JSON.parse(await readFile(path, 'utf8')) as MapFile
  return {
    loaded: true,
    file,
    events: new Set(file.events.map(e => e.id)),
    sponsors: new Set(file.sponsors.map(s => s.id)),
    backings: new Set(file.backings.map(b => `${b.eventId}|${b.sponsorId}`)),
  }
}

// Puts back any hand-made row an earlier run lost, and clears the `source` an
// earlier run wrote onto hand-made events so they read as hand-made again.
function restoreBase(): string[] {
  const out: string[] = []
  if (!base.file) return out
  const events = new Map(map.events.map(e => [e.id, e]))
  for (const e of base.file.events) {
    const row = events.get(e.id)
    if (!row) {
      map.events.push({ ...e })
      out.push(`event ${e.id}`)
    } else if (row.source && !e.source) delete row.source
  }
  const sponsors = new Set(map.sponsors.map(s => s.id))
  for (const s of base.file.sponsors) {
    if (sponsors.has(s.id)) continue
    map.sponsors.push({ ...s })
    out.push(`sponsor ${s.id}`)
  }
  const backings = new Set(map.backings.map(b => `${b.eventId}|${b.sponsorId}`))
  for (const b of base.file.backings) {
    if (backings.has(`${b.eventId}|${b.sponsorId}`)) continue
    map.backings.push({ ...b })
    out.push(`backing ${b.eventId}|${b.sponsorId}`)
  }
  return out
}

// Undo place data that earlier runs filled wrongly: a Luma event's pin taken by
// another source (Luma fuzzes it), and venues that only repeat the city.
function repairRows(): string[] {
  const out: string[] = []
  for (const e of map.events) {
    if (LUMA_HOST.test(hostOf(e.url)) && e.lat !== undefined && e.source && e.source !== 'luma') {
      delete e.lat
      delete e.lng
      out.push(`${e.id}: pin from ${e.source}`)
    }
    for (const key of ['venue', 'address'] as const) {
      if (e[key] && !placeOnly(e[key])) {
        delete e[key]
        out.push(`${e.id}: ${key} only names the city`)
      }
    }
  }
  return out
}

// --- Ids ---

// Same scheme as the hand-made rows (luma-<slug>), so they dedupe with ours.
function eventId(ev: RawEvent): string {
  let u: URL
  try {
    u = new URL(ev.url)
  } catch {
    return `${ev.source}-${slug(ev.url)}`
  }
  const host = u.hostname.toLowerCase().replace(/^www\./, '')
  const parts = u.pathname.split('/').filter(Boolean)
  const last = parts[parts.length - 1] ?? ''
  if (host === 'luma.com' || host === 'lu.ma') return `luma-${slug(parts[0] ?? '')}`
  if (host.endsWith('.devpost.com')) return `devpost-${slug(host.split('.')[0])}`
  if (host === 'meetup.com') return `meetup-${slug(parts[parts.indexOf('events') + 1] ?? last)}`
  if (host === 'builderbase.com') return `builderbase-${slug(last)}`
  if (host === 'mlh.com' || host === 'mlh.io') return `mlh-${slug(last)}`
  if (/(^|\.)eventbrite\./.test(host)) return `eventbrite-${u.pathname.match(/(\d{6,})\/?$/)?.[1] ?? slug(last)}`
  if (host === 'dev.events') return `devevents-${slug(last)}`
  if (/(^|\.)gdg\.community\.dev$/.test(host)) return `gdg-${u.pathname.match(/(\d+)\/?$/)?.[1] ?? slug(last)}`
  if (ev.source === 'confstech') return `confstech-${slug(host)}`
  return `${ev.source}-${slug(last ? `${host}-${last}` : host)}`
}

// --- Output ---

function sortMap() {
  map.events.sort((a, b) => cmpNullLast(a.date, b.date) || a.id.localeCompare(b.id))
  map.sponsors.sort((a, b) => a.id.localeCompare(b.id))
  map.backings.sort((a, b) => a.eventId.localeCompare(b.eventId) || a.sponsorId.localeCompare(b.sponsorId))
}

function summary(): string {
  const lines = ['', '=== scrape-events summary ===']
  lines.push(`window: ${opts.pastDays} days back, ${opts.futureDays} ahead, limit ${opts.limit} per source; tech filter: ${tech.by}`)
  lines.push('per source (returned -> London + tech; of those with lat/lng, with listed partners):')
  for (const [name, s] of perSource) {
    const counts = `${String(s.raw).padStart(4)} -> ${String(s.kept).padStart(4)}  geo ${s.geo}, partners ${s.partners}`
    lines.push(`  ${name.padEnd(12)} ${counts}  ${secs(s.ms)}${s.error ? `  FAILED: ${s.error}` : ''}`)
  }
  if (skipped.length) lines.push(`  not available: ${skipped.join(', ')}`)
  lines.push(`after dedupe: ${items.length} events (${raw.length - london.length} dropped as not London, ${london.length - kept.length} as not tech)`)
  const notTech = london.filter(ev => !tech.test(ev)).map(ev => ev.name.slice(0, 60))
  if (notTech.length) lines.push(`  not tech: ${notTech.slice(0, 40).join('; ')}`)
  if (restored.length) lines.push(`restored from --base: ${restored.join(', ')}`)
  if (repaired.length) lines.push(`repaired: ${repaired.join('; ')}`)
  lines.push(`events: ${stats.added.length} added, ${stats.updated.length} updated, ${removed.length} removed`)
  for (const e of removed) lines.push(`  removed ${e.id}: ${e.name}`)
  lines.push(`backings pruned: ${pruned.length}; sponsors left with none, removed: ${sponsorsRemoved.length}`)
  for (const p of pruned) lines.push(`  pruned ${p.backing.eventId} -> ${p.backing.sponsorId} (${p.why})`)
  lines.push(`sponsors added: ${stats.sponsorsAdded}`)
  lines.push(`backings added: ${stats.backingsAdded.length} (on ${new Set(stats.backingsAdded.map(b => b.eventId)).size} events)`)
  lines.push(`unresolved partners (no domain, not added): ${stats.unresolvedCount}`)
  if (stats.unresolved.length) lines.push(`  ${stats.unresolved.join('; ')}`)
  const names = new Map(map.sponsors.map(s => [s.id, s.name]))
  const top = [...countBy(stats.backingsAdded, b => b.sponsorId)].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 15)
  lines.push('top sponsors by new backings:')
  for (const [id, n] of top) lines.push(`  ${String(n).padStart(3)}  ${names.get(id) ?? id} (${id})`)
  lines.push(`totals: ${map.events.length} events, ${map.sponsors.length} sponsors, ${map.backings.length} backings`)
  lines.push(`runtime: ${secs(Date.now() - started)}`)
  return lines.join('\n')
}

// --- Helpers ---

function topicOf(ev: RawEvent): string {
  const lines = (ev.description ?? '').replace(/<[^>]+>/g, ' ').split(/\n+/).map(l => l.replace(/^[-*•]\s*/, '').trim()).filter(Boolean)
  let lead = ''
  for (const line of lines) {
    lead = lead ? `${lead} ${line}` : line
    if (lead.length >= 40) break
  }
  const sentence = lead.match(/^.{20,}?[.!?](?=\s|$)/)?.[0] ?? lead
  const text = [(ev.categories ?? []).join(', '), sentence].filter(Boolean).join('. ')
  return text.length > 300 ? `${text.slice(0, 299).replace(/\s+\S*$/, '')}…` : text
}

function normUrl(raw: string): string {
  try {
    const u = new URL(raw.trim())
    let host = u.hostname.toLowerCase().replace(/^www\./, '')
    if (host === 'lu.ma') host = 'luma.com'
    return `${host}${u.pathname.replace(/\/+$/, '')}`.toLowerCase()
  } catch {
    return raw.trim().toLowerCase()
  }
}

function normName(s: string): string {
  return s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function orgKey(s: string): string {
  return normName(s.replace(/(?:[\s,.]+(?:ltd|limited|inc|llc|plc))+\.?$/i, ''))
}

function hostOf(href: string): string {
  try {
    return new URL(href).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'event'
}

function unionBy<T>(list: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>()
  return list.filter(x => {
    const k = key(x)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>
}

function countBy<T>(list: T[], key: (x: T) => string): Map<string, number> {
  const out = new Map<string, number>()
  for (const x of list) out.set(key(x), (out.get(key(x)) ?? 0) + 1)
  return out
}

function cmpNullLast(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (!a) return 1
  if (!b) return -1
  return a.localeCompare(b)
}

// '2026-10-01' sorts after '2026-10-20' once inverted, so newest past date ranks first.
function invert(date: string): string {
  return date.replace(/\d/g, d => String(9 - Number(d)))
}

async function pool<T>(list: T[], size: number, fn: (x: T) => Promise<void>) {
  let next = 0
  const worker = async () => {
    while (next < list.length) await fn(list[next++])
  }
  await Promise.all(Array.from({ length: Math.min(size, list.length) }, worker))
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn()
  } catch {
    return fallback
  }
}

async function safeAsync<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch {
    return fallback
  }
}

function round(n: number): number {
  return Math.round(n * 1e6) / 1e6
}

function londonDate(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

function num(name: string, fallback: number): number {
  const n = Number(arg(name))
  return Number.isFinite(n) && n >= 0 && arg(name) !== undefined ? n : fallback
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : undefined
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`
}

function log(msg: string) {
  console.log(`[scrape] ${msg}`)
}
