// Decide whether a scraped event is a tech event (lib/scrape/eval/RUBRIC.md).
// Fast keyword rules settle the clear cases; only the uncertain middle goes to
// Grok, batched and cached on disk. Without a key, or if Grok fails, the rules
// decide alone. Script-only (uses node:fs). Never throws.
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CACHE_DIR } from './http'
import type { RawEvent } from './sources/types'

export type TechVerdict = { tech: boolean; confidence: number; reason: string; by: 'rules' | 'grok' }

export type TechInput = Pick<RawEvent, 'source' | 'name' | 'organiser' | 'categories' | 'description'>

// Rules decide at or above HIGH and at or below LOW; Grok takes the rest.
// MID is the cut when the rules have to decide alone.
export const TECH_HIGH = 7
export const TECH_LOW = -2
export const TECH_MID = (TECH_HIGH + TECH_LOW) / 2

// Hackathon and developer-conference sources only list tech events.
const TECH_SOURCES = new Set(['devpost', 'mlh', 'hackclub', 'gdg', 'confstech', 'devevents'])

type Group = { label: string; weight: number; re: RegExp }

const words = (list: string[]) => new RegExp(`(?:^|[^a-z0-9])(?:${list.join('|')})(?![a-z0-9])`, 'i')

const POSITIVE: Group[] = [
  { label: 'builder', weight: 7, re: words(['hackathons?', 'hack ?night', 'hackers?', 'hacker ?house', 'buildathon', 'game ?jam', 'hack days?', 'devpost', 'hackception']) },
  { label: 'ai', weight: 4, re: words(['ai', 'a\\.i\\.', 'artificial intelligence', 'machine learning', 'ml', 'llms?', 'genai', 'gen ai', 'generative ai', 'ai agents?', 'agentic', 'gpt', 'chatgpt', 'gemini', 'openai', 'anthropic', 'deepmind', 'deep learning', 'neural', 'nlp', 'computer vision', 'mlops', 'grok']) },
  { label: 'dev', weight: 4, re: words(['developers?', 'devs', 'software', 'coding', 'coders?', 'programming', 'programmers?', 'python', 'pydata', 'javascript', 'typescript', 'react native', 'reactjs', 'rust', 'golang', 'c\\+\\+', 'java', 'kotlin', 'swift', 'android', 'ios', 'apis?', 'open[ -]source', 'github', 'devrel', 'web dev', 'frontend', 'front-end', 'backend', 'full[ -]stack', 'app development', 'mobile apps?', 'no[ -]code', 'low[ -]code', 'vibe ?coding', 'engineers?', 'engineering']) },
  { label: 'data', weight: 3, re: words(['data science', 'data scientists?', 'data engineering', 'data sprint', 'datascience', 'dataanalytics', 'data analytics', 'analytics engineering', 'power bi', 'databases?', 'sql', 'big data', 'knime', 'fabric']) },
  { label: 'infra', weight: 4, re: words(['cloud native', 'cloud', 'devops', 'kubernetes', 'k8s', 'aws', 'azure', 'gcp', 'serverless', 'sre', 'platform engineering', 'cybersecurity', 'cyber ?security', 'infosec', 'appsec', 'pentest(?:ing)?', 'security engineers?', 'quantum comput(?:er|ers|ing)', 'computing', 'robotics', 'raspberry pi', 'hardware']) },
  { label: 'startup', weight: 3, re: words(['startups?', 'start-ups?', 'founders?', 'vcs?', 'venture capital', 'ventures', 'angel invest(?:or|ors|ment)', 'angels', 'pitch(?:es|ing)?', 'demo ?day', 'accelerators?', 'incubators?', 'scale-?ups?', 'pre-seed', 'seed stage', 'series a', 'fundraising', 'atomico', 'y combinator', 'entrepreneur first']) },
  { label: 'product', weight: 3, re: words(['product management', 'product managers?', 'product design', 'ux', 'ui/ux', 'user experience', 'design systems?', 'prototyp(?:e|es|ing)']) },
  { label: 'web3', weight: 3, re: words(['web3', 'solana', 'ethereum', 'blockchain', 'defi', 'smart contracts?', 'protocols?', 'onchain', 'on-chain']) },
  { label: 'sector', weight: 4, re: words(['fintech', 'healthtech', 'medtech', 'legaltech', 'edtech', 'insurtech', 'regtech', 'climate ?tech', 'cleantech', 'deep ?tech', 'agritech', 'hr ?tech', 'recruitment technology', 'tech stack']) },
  { label: 'tech', weight: 3, re: words(['tech', 'technology', 'technologies', 'technical', 'techies', 'digital', 'internet', 'saas', 'women ?in ?tech', 'womenintech', 'tech community']) },
]

const NEGATIVE: Group[] = [
  { label: 'fitness', weight: 6, re: words(['run club', 'runclub', 'running club', 'running', '5 ?km?', '10 ?km?', 'yoga', 'pilates', 'fitness', 'gym', 'goodgym', 'basketball', 'football', 'tennis', 'padel', 'cycling', 'hike', 'hiking', 'walk', 'sports?', 'swim(?:ming)?', 'climbing', 'bouldering', 'strolls?', 'meditation', 'wellness', 'breathwork']) },
  { label: 'food', weight: 5, re: words(['wine', 'wine tasting', 'supper club', 'dinner party', 'cocktails?', 'brunch', 'coffee', 'tasting', 'six courses', 'beer', 'cookery', 'cooking class']) },
  { label: 'arts', weight: 5, re: words(['comedy', 'stand-up', 'theatre', 'concert', 'gig', 'dj', 'music', 'musicians?', 'film', 'screening', 'cinema', 'exhibitions?', 'gallery', 'artists?', 'painting', 'ceramics', 'poetry', 'book club', 'bookshop', 'novel', 'book launch(?:es)?', 'book signings?', 'author talks?', 'fashion', 'beauty', 'jeans', 'denim', 'dance', 'podcast filming', 'opera', 'museum', 'craft']) },
  { label: 'social', weight: 5, re: words(['dating', 'singles', 'speed dating', 'meet new people', 'make new friends', 'new friends', 'social circle', 'halloween', 'party', 'afterparty', 'pub quiz', 'scavenger hunt', 'poker', 'language exchange', 'socials']) },
  { label: 'finance', weight: 4, re: words(['property', 'properties', 'real estate', 'realestate', 'golden visas?', 'forex', 'trading', 'stocks?', 'stock market', 'etfs?', 'wealth', 'pensions?', 'retirement', 'family office', 'private equity', 'mortgages?', 'banking', 'private investors?']) },
  { label: 'faith', weight: 6, re: words(['church', 'worship', 'faith', 'christian', 'christianity', 'prayer', 'bible', 'mosque', 'spirituality']) },
  { label: 'academic', weight: 4, re: words(['ecology', 'ecological', 'biology', 'botany', 'botanical', 'orchids?', 'astronomy', 'astronomical', 'chemistry', 'molecules?', 'neuroscience', 'medicine', 'medical', 'surgery', 'surgeons?', 'drug repurposing', 'history', 'historical', 'geography', 'geopolitics', 'politics', 'philosophy', 'biography', 'architecture', 'pilots?', 'aviation']) },
  { label: 'business', weight: 3, re: words(['business networking', 'business owners?', 'small business', 'smes?', 'hr', 'human resources', 'inclusion summit', 'logistics', 'supply chain', 'hospitality', 'travel', 'careers fair', 'careers? fair', 'cv reviews?', 'marketing', 'brand', 'sales']) },
]

// Luma tags its discover categories; these are the ones that matter here.
const CATEGORY_POSITIVE: Record<string, number> = { tech: 5, ai: 5, crypto: 3, 'high tech': 3, startups: 3, hackathon: 6, coding: 4, technology: 2 }
const CATEGORY_NEGATIVE: Record<string, number> = {
  'arts & culture': 4, 'food & drink': 5, fitness: 6, running: 6, books: 5, 'religion & spirituality': 6,
  'fashion & beauty': 5, 'party or social gathering': 5, 'concert or performance': 5, 'real estate': 4,
  'seasonal & holiday': 4, 'halloween/haunt': 4, 'performing & visual arts': 5, medicine: 3, science: 2,
  'appearance or signing': 4,
}

// Categories scored above aren't fed to the word groups too, so one tag counts once.
const scoredCategory = (c: string) => Object.hasOwn(CATEGORY_POSITIVE, c.toLowerCase()) || Object.hasOwn(CATEGORY_NEGATIVE, c.toLowerCase())

// Where a word appears matters: the name says what the event is.
const FIELD_WEIGHT = { name: 1, organiser: 0.8, categories: 0.5, description: 0.35 }

type Field = keyof typeof FIELD_WEIGHT

function fieldTexts(ev: TechInput): Record<Field, string> {
  return {
    name: ev.name ?? '',
    organiser: ev.organiser ?? '',
    categories: (ev.categories ?? []).filter(c => !scoredCategory(c)).join(' , ').replace(/_/g, ' '),
    description: (ev.description ?? '').slice(0, 1200),
  }
}

// Phrases that contain tech words but aren't about tech.
const FALSE_FRIENDS = /\b(?:dress code|code of conduct|qr code|promo code|discount code|(?:estate|travel|talent|letting|secret) agents?|data protection|personal data|security (?:checks?|guards?|staff)|digital tickets?|meetup qr code)\b/gi

function sumGroups(groups: Group[], texts: Record<Field, string>, hits: string[], sign: string) {
  let score = 0
  const strongest = new Map<string, number>() // each group counts once, at its best field
  for (const field of Object.keys(FIELD_WEIGHT) as Field[]) {
    for (const g of groups) {
      if (!g.re.test(texts[field])) continue
      const w = g.weight * FIELD_WEIGHT[field]
      if (w > (strongest.get(g.label) ?? 0)) strongest.set(g.label, w)
    }
  }
  for (const [label, w] of strongest) {
    score += w
    hits.push(`${sign}${label}`)
  }
  return { score, strongest }
}

export type TechSignals = { score: number; hits: string[]; builderInName: boolean }

export function techSignals(ev: TechInput): TechSignals {
  const hits: string[] = []
  const texts = fieldTexts(ev)
  for (const f of Object.keys(texts) as Field[]) texts[f] = texts[f].replace(FALSE_FRIENDS, ' ')

  let pos = 0
  if (TECH_SOURCES.has(ev.source)) {
    pos += 8
    hits.push(`+source:${ev.source}`)
  }
  const p = sumGroups(POSITIVE, texts, hits, '+')
  pos += p.score

  let neg = sumGroups(NEGATIVE, texts, hits, '-').score

  for (const c of ev.categories ?? []) {
    const key = c.toLowerCase()
    if (Object.hasOwn(CATEGORY_POSITIVE, key)) {
      pos += CATEGORY_POSITIVE[key]
      hits.push(`+cat:${c}`)
    }
    if (Object.hasOwn(CATEGORY_NEGATIVE, key)) {
      neg += CATEGORY_NEGATIVE[key]
      hits.push(`-cat:${c}`)
    }
  }

  // Clear tech in the name or a tech source keeps an event in even when it
  // mentions a party or drinks ("Hackathon after-party").
  const builderInName = (p.strongest.get('builder') ?? 0) >= POSITIVE[0].weight * FIELD_WEIGHT.organiser
  if (builderInName) neg = 0
  else if (TECH_SOURCES.has(ev.source)) neg *= 0.3

  return { score: Math.round((pos - neg) * 10) / 10, hits, builderInName }
}

export type TechRoute = 'tech' | 'not tech' | 'grok'

// Where an event goes: settled by the rules or sent to Grok. The rules accept
// only clean cases (no negative signal, a description to back it up) and
// reject only when the name has no tech or startup word at all.
export function techRoute(ev: TechInput): TechRoute {
  const { score, hits, builderInName } = techSignals(ev)
  const trusted = builderInName || TECH_SOURCES.has(ev.source)
  const negHit = hits.some(h => h.startsWith('-'))
  const hasText = Boolean(ev.description?.trim())
  if (score >= TECH_HIGH && (trusted || (!negHit && hasText))) return 'tech'
  const namePos = POSITIVE.some(g => g.re.test(ev.name ?? ''))
  if (score <= TECH_LOW && !namePos) return 'not tech'
  return 'grok'
}

function rulesVerdict(ev: TechInput, cut: number): TechVerdict {
  const { score, hits } = techSignals(ev)
  const tech = score >= cut
  const dist = Math.abs(score - cut)
  const confidence = Math.round(Math.min(0.99, 0.5 + dist / 16) * 100) / 100
  return { tech, confidence, reason: `rules score ${score} (${hits.join(' ') || 'no signals'})`, by: 'rules' }
}

// lib/scrape/eval/RUBRIC.md, copied here so nothing reads files at runtime.
// Keep the two in sync.
const RUBRIC = `# What counts as a tech event

Backer finds sponsors for London events. Keep an event when its main audience
builds, works in, or invests in technology or startups, so a tech company
would plausibly sponsor it. Judge by what happens at the event and who it is
for, not by who might turn up.

## In

- Hackathons, buildathons, game jams, hacker houses.
- Developer, engineering, data, AI/ML, cloud, DevOps, security, open-source
  meetups, talks, workshops and conferences.
- Product and design events about digital products (UX, product management,
  no-code/app building).
- Startup, founder and investor events: pitch nights, demo days, founder
  meetups, accelerator events, startup socials where the point is startups.
- Applied tech for a sector, aimed at practitioners: AI in finance, fintech,
  healthtech, legaltech, climate tech, edtech or school data systems.
  Judge the sector from the agenda and description, not from tags.
- Crypto/web3 events with a builder or industry angle (developer meetups,
  protocol conferences, hacker houses).
- University tech societies and tech community events (DoCSoc, KCL Tech,
  AI societies), robotics, hardware and maker events.
- Tech careers and networking aimed at tech roles specifically.

## Out

- Science or academic lectures that are not about building technology
  (biology, ecology, history, astronomy talks), unless the topic is computing,
  AI or engineering practice.
- AI talks, debates or book launches whose angle is ethics, society, equity,
  creativity or art. They are in only when the talk is about how the
  technology works or is built.
- Clinical or professional conferences for doctors, nurses or lawyers, even
  when tagged healthtech or innovation.
- Arts, theatre, music, comedy, film, book clubs, exhibitions.
- Fitness, wellness, run clubs, walks and strolls, sports and outdoor
  activities, even when the attendees work in tech ("Operators Runclub" is out: the activity is running).
- Food and drink (brunches, supper clubs), parties, dating, language exchange, faith, general
  community socials.
- General business, sales, marketing, property or finance networking with no
  tech or startup focus. Generic careers fairs.
- Crypto trading and price-speculation events with no builder angle.

## When unsure

- A tech company named as sponsor, host or venue, or a tech community as
  organiser, leans in.
- A talk at a tech company about a non-tech topic leans out.
- Label from the name, organiser, categories and description only. Don't
  guess from the venue alone.`

const SYSTEM = `You label London events for Backer, which finds tech sponsors for events.
Apply this rubric exactly.

${RUBRIC}

Be strict. A non-tech event shown to users hurts far more than a missed one,
so answer tech true only when building, working in or investing in technology
or startups is the main point of the event. Notes:
- The activity decides: a run, walk or stroll, film screening, poker night, party, brunch or supper club is out even when tech people attend or a tech company hosts.
- Board games or chess nights whose stated point is the startup community are startup socials, so in.
- A public lecture or talk whose topic is computing, AI, quantum computers, robotics or engineering is in, even for a general audience. Philosophy, ethics, policy or futurism about technology is out, and so are other sciences (biology, chemistry, physics, medicine).
- AI talks, debates or book launches whose angle is ethics, society, equity, creativity or art are out; they are in only when the talk is about how the technology works or is built.
- Networking and business shows: in when tech, AI or startups (founders, startup investors, pitching) are the stated focus, for example named in the title, even if the format is a casual social. Out when tech is one industry among many, a passing mention, or the audience is "business owners", "entrepreneurs" and SMEs in general.
- Entrepreneurship through acquisition, franchising, small-business, sector trade networking (logistics, finance, HR, travel) are out unless technology is the theme.
- Sector events are in when they are about technology in that sector (fintech, AI in insurance, HR tech, edtech or school data systems for practitioners). Judge the sector from the agenda and description, not from tags: a clinical or professional conference for doctors, nurses or lawyers is out even when tagged healthtech or innovation.

You get a JSON list of events, each with an "id". Reply with JSON only:
{"verdicts":[{"id":"<id>","tech":true|false,"confidence":0.0-1.0,"reason":"<one short sentence>"}]}
Return exactly one verdict for every id.`

// Part of the cache key, so editing the prompt doesn't reuse old answers.
const PROMPT_ID = createHash('sha1').update(SYSTEM).digest('hex').slice(0, 8)
const MODEL = () => process.env.SCRAPE_MODEL ?? 'grok-4.20-0309-non-reasoning'
const BATCH = 4
const PARALLEL = 4
const CALL_MS = 20000
// The whole Grok phase stops after this; the rules decide what's left.
const BUDGET_MS = 60000
// Stop calling after this many failures in a row.
const MAX_FAILS = 3

// Shared by every call in one classifyTech run. Aborting it stops the calls in flight too.
type Run = { key: string; stop: AbortController; fails: number }
const stopped = (run: Run) => run.stop.signal.aborted

function failed(run: Run) {
  if (++run.fails >= MAX_FAILS) run.stop.abort()
}

type Item = { url: string; text: string; key: string }
type GrokVerdict = { tech: boolean; confidence: number; reason: string }

function eventText(ev: TechInput): string {
  return JSON.stringify({
    name: ev.name,
    organiser: ev.organiser || undefined,
    categories: ev.categories?.length ? ev.categories.slice(0, 12) : undefined,
    description: ev.description ? ev.description.replace(/\s+/g, ' ').slice(0, 900) : undefined,
  })
}

const cacheFile = (key: string) => join(CACHE_DIR, `tech-${key}.json`)

async function readCached(key: string): Promise<GrokVerdict | undefined> {
  try {
    return JSON.parse(await readFile(cacheFile(key), 'utf8')) as GrokVerdict
  } catch {
    return undefined
  }
}

async function writeCached(key: string, v: GrokVerdict) {
  try {
    await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(cacheFile(key), JSON.stringify(v))
  } catch {}
}

function asVerdict(x: unknown): GrokVerdict | undefined {
  if (!x || typeof x !== 'object') return undefined
  const o = x as Record<string, unknown>
  if (typeof o.tech !== 'boolean') return undefined
  const c = typeof o.confidence === 'number' ? Math.max(0, Math.min(1, o.confidence)) : 0.7
  return { tech: o.tech, confidence: c, reason: typeof o.reason === 'string' ? o.reason.slice(0, 300) : '' }
}

// One chat call for up to BATCH events. Returns verdicts by url.
async function askGrok(items: Item[], run: Run): Promise<Map<string, GrokVerdict>> {
  const out = new Map<string, GrokVerdict>()
  if (stopped(run)) return out
  const events = items.map((it, i) => ({ id: `e${i}`, ...JSON.parse(it.text) }))
  try {
    const res = await fetch('https://api.x.ai/v1/chat/completions', {
      method: 'POST',
      headers: { authorization: `Bearer ${run.key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL(),
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: JSON.stringify(events) },
        ],
      }),
      signal: AbortSignal.any([run.stop.signal, AbortSignal.timeout(CALL_MS)]),
    })
    if (!res.ok) {
      failed(run)
      return out
    }
    const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const parsed = JSON.parse(body.choices?.[0]?.message?.content ?? '{}') as { verdicts?: unknown[] }
    for (const raw of parsed.verdicts ?? []) {
      const id = (raw as { id?: unknown })?.id
      const v = asVerdict(raw)
      const i = typeof id === 'string' ? Number(id.replace(/^e/, '')) : NaN
      if (v && Number.isInteger(i) && items[i]) out.set(items[i].url, v)
    }
  } catch {}
  if (out.size) run.fails = 0
  else failed(run)
  return out
}

async function pool<T>(tasks: (() => Promise<T>)[], size: number): Promise<T[]> {
  const results: T[] = []
  let next = 0
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++
      results[i] = await tasks[i]()
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, tasks.length) }, worker))
  return results
}

function chunks<T>(list: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += n) out.push(list.slice(i, i + n))
  return out
}

// Ask Grok about every item, retrying the ones that didn't come back once.
// Gives up early when Grok is down or the time budget runs out.
async function grokAll(items: Item[], key: string): Promise<Map<string, GrokVerdict>> {
  const got = new Map<string, GrokVerdict>()
  const run: Run = { key, stop: new AbortController(), fails: 0 }
  const timer = setTimeout(() => run.stop.abort(), BUDGET_MS)
  try {
    let todo = items
    for (let round = 0; round < 2 && todo.length && !stopped(run); round++) {
      const before = got.size
      const maps = await pool(chunks(todo, BATCH).map(batch => () => askGrok(batch, run)), PARALLEL)
      for (const m of maps) for (const [url, v] of m) got.set(url, v)
      if (got.size === before) break // nothing came back: don't repeat it
      todo = todo.filter(it => !got.has(it.url))
    }
  } finally {
    clearTimeout(timer)
  }
  return got
}

export async function classifyTech(events: (TechInput & { url: string })[]): Promise<Map<string, TechVerdict>> {
  const verdicts = new Map<string, TechVerdict>()
  const unsure: Item[] = []
  const inputs = new Map<string, TechInput>()

  for (const ev of events) {
    try {
      inputs.set(ev.url, ev)
      if (techRoute(ev) !== 'grok') {
        verdicts.set(ev.url, rulesVerdict(ev, TECH_MID))
        continue
      }
      const text = eventText(ev)
      const key = createHash('sha1').update(MODEL() + '\n' + PROMPT_ID + '\n' + text).digest('hex')
      unsure.push({ url: ev.url, text, key })
    } catch {}
  }

  const apiKey = process.env.XAI_API_KEY
  const fromGrok = new Map<string, GrokVerdict>()
  if (apiKey && unsure.length) {
    try {
      const fresh: Item[] = []
      for (const it of unsure) {
        const hit = await readCached(it.key)
        if (hit) fromGrok.set(it.url, hit)
        else fresh.push(it)
      }
      const got = await grokAll(fresh, apiKey)
      for (const it of fresh) {
        const v = got.get(it.url)
        if (!v) continue
        fromGrok.set(it.url, v)
        await writeCached(it.key, v)
      }
    } catch {}
  }

  for (const it of unsure) {
    const v = fromGrok.get(it.url)
    const ev = inputs.get(it.url)
    if (v) verdicts.set(it.url, { ...v, reason: v.reason || 'grok', by: 'grok' })
    else if (ev) verdicts.set(it.url, rulesVerdict(ev, TECH_MID))
  }
  return verdicts
}
