// Polite fetch for the scrapers: browser user agent, timeout, a minimum gap
// between requests to the same host, one retry on 429/5xx, and a disk cache
// so reruns don't hit the sites again. Script-only (uses node:fs).
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'
export const CACHE_DIR = join(tmpdir(), 'backer-scrape-cache')
const TTL_MS = 12 * 60 * 60 * 1000

// Luma's API is undocumented and the big listing sites rate-limit, so keep
// those to one request a second.
const GAP_MS: Record<string, number> = {
  'api.lu.ma': 1000,
  'luma.com': 1000,
  'lu.ma': 1000,
  'www.eventbrite.co.uk': 1000,
  'www.eventbrite.com': 1000,
  'www.meetup.com': 1000,
}
const DEFAULT_GAP_MS = 300

const nextSlot = new Map<string, number>()

async function throttle(host: string) {
  const gap = GAP_MS[host] ?? DEFAULT_GAP_MS
  const now = Date.now()
  const at = Math.max(now, nextSlot.get(host) ?? 0)
  nextSlot.set(host, at + gap) // reserve before awaiting, so concurrent callers queue up
  if (at > now) await new Promise(r => setTimeout(r, at - now))
}

export type GetOptions = { headers?: Record<string, string>; ttlMs?: number }

export async function getText(url: string, opts: GetOptions = {}): Promise<string> {
  const file = join(CACHE_DIR, createHash('sha1').update(url).digest('hex'))
  try {
    const s = await stat(file)
    if (Date.now() - s.mtimeMs < (opts.ttlMs ?? TTL_MS)) return await readFile(file, 'utf8')
  } catch {}

  const host = new URL(url).hostname
  for (let attempt = 0; ; attempt++) {
    await throttle(host)
    const res = await fetch(url, {
      redirect: 'follow',
      headers: { 'user-agent': UA, accept: 'application/json,text/html;q=0.9,*/*;q=0.8', ...opts.headers },
      signal: AbortSignal.timeout(15000),
    })
    if ((res.status === 429 || res.status >= 500) && attempt === 0) {
      await new Promise(r => setTimeout(r, 5000))
      continue
    }
    if (!res.ok) throw new Error(`${res.status} ${url}`)
    const text = await res.text()
    await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(file, text)
    return text
  }
}

export async function getJson<T = unknown>(url: string, opts?: GetOptions): Promise<T> {
  return JSON.parse(await getText(url, opts)) as T
}
