// confs.tech: the open conference dataset on GitHub, one JSON file per year
// and topic (raw.githubusercontent.com, not the rate-limited GitHub API).
// We keep in-person London conferences in the date window, merge the topics a
// conference is filed under, then read its official site (homepage plus one
// sponsors/partners page) for description, organiser and sponsor sections.
import { getJson } from '../http'
import type { Discover, RawEvent, RawLink } from './types'
import { dateRange, isUk, normalUrl, pick, readOfficialSite, short, ymd } from './devevents'

const RAW = 'https://raw.githubusercontent.com/tech-conferences/conference-data/main/conferences'
const WORKERS = 4

// Topic files that exist for 2026; other years just try the same list.
const TOPICS: Record<string, string> = {
  accessibility: 'Accessibility', android: 'Android', api: 'API', clojure: 'Clojure', cpp: 'C++', css: 'CSS',
  data: 'Data', devops: 'DevOps', dotnet: '.NET', general: 'General', graphql: 'GraphQL', groovy: 'Groovy',
  haskell: 'Haskell', ios: 'iOS', iot: 'IoT', java: 'Java', javascript: 'JavaScript', kotlin: 'Kotlin',
  leadership: 'Leadership', networking: 'Networking', opensource: 'Open source', performance: 'Performance',
  php: 'PHP', product: 'Product', python: 'Python', rust: 'Rust', security: 'Security', sre: 'SRE',
  'tech-comm': 'Tech comms', testing: 'Testing', typescript: 'TypeScript', ux: 'UX',
}

type Conf = {
  name?: string
  url?: string
  startDate?: string
  endDate?: string
  city?: string
  country?: string
  online?: boolean
  locales?: string
  cfpUrl?: string
  twitter?: string
}

type Found = { conf: Conf; url: string; name: string; date: string; topics: string[] }

export const discover: Discover = async opts => {
  const { from, to, today } = dateRange(opts)
  const found = new Map<string, Found>()

  let files = 0
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
    for (const topic of Object.keys(TOPICS)) {
      const confs = await readFile(year, topic)
      if (!confs) continue
      files++
      for (const conf of confs) add(found, conf, topic, from, to)
    }
  }
  if (!files) throw new Error('confs.tech dataset is unreachable')

  const ordered = pick([...found.values()], today).slice(0, opts.limit)
  const out: RawEvent[] = []
  for (let i = 0; i < ordered.length; i += WORKERS) {
    out.push(...(await Promise.all(ordered.slice(i, i + WORKERS).map(toEvent))))
  }
  return out
}

// One year/topic file; undefined when it doesn't exist (404) or won't load.
async function readFile(year: number, topic: string): Promise<Conf[] | undefined> {
  const url = `${RAW}/${year}/${topic}.json`
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await getJson<unknown>(url)
      return Array.isArray(data) ? (data as Conf[]) : undefined
    } catch (err) {
      if (/^404 /.test(String((err as Error).message))) return
    }
  }
  return
}

// Keep London, in person, in the window; merge topics by normalised url.
function add(found: Map<string, Found>, conf: Conf, topic: string, from: string, to: string) {
  const name = conf.name?.trim()
  const date = ymd(conf.startDate)
  if (!name || !conf.url || !date || date < from || date > to) return
  if (!/^london\b/i.test(conf.city?.trim() ?? '')) return
  if (conf.country && !isUk(conf.country)) return
  const key = normalUrl(conf.url)
  const prev = found.get(key)
  if (prev) {
    if (!prev.topics.includes(topic)) prev.topics.push(topic)
    return
  }
  found.set(key, { conf, url: conf.url, name, date, topics: [topic] })
}

async function toEvent(item: Found): Promise<RawEvent> {
  const { conf } = item
  const event: RawEvent = {
    source: 'confstech',
    url: item.url,
    name: item.name,
    date: item.date,
    city: 'London',
    country: conf.country ? 'GB' : undefined,
    categories: item.topics.map(t => TOPICS[t] ?? t),
    links: links(conf),
  }
  const site = await readOfficialSite(item.url, item.date)
  if (!site) return event
  return {
    ...event,
    url: site.url,
    description: short(site.description),
    organiser: site.organiser,
    venue: site.venue,
    geo: site.geo,
    partners: site.partners.length ? site.partners : undefined,
  }
}

function links(conf: Conf): RawLink[] | undefined {
  const out: RawLink[] = []
  if (conf.url) out.push({ text: 'Website', href: conf.url })
  if (conf.cfpUrl) out.push({ text: 'Call for papers', href: conf.cfpUrl })
  const handle = conf.twitter?.trim().replace(/^@/, '')
  if (handle && /^\w{1,15}$/.test(handle)) out.push({ text: 'Twitter', href: `https://x.com/${handle}` })
  return out.length ? out : undefined
}
