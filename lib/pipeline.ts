// Shared by the pipeline page, its API route and the home page.
// Local shape: localStorage 'backer.pipeline.v1' is an array of PipelineLead (pageId optional).

export const STATUSES = ['To contact', 'Contacted', 'Replied', 'Call', 'Signed', 'No'] as const
export type Status = (typeof STATUSES)[number]

export type PipelineLead = {
  sponsorId: string
  name: string
  domain: string
  kind: 'sponsor' | 'venue'
  score: number
  status: Status
  tier?: string
  priceGbp?: number
  event: string
  notionUrl?: string
  pageId?: string
  updatedAt: string
}

export const LOCAL_KEY = 'backer.pipeline.v1'

export function isStatus(value: unknown): value is Status {
  return typeof value === 'string' && (STATUSES as readonly string[]).includes(value)
}

export function cleanDomain(domain: string): string {
  return String(domain || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '')
}

// One lead per company per event, whichever side it came from.
export function leadKey(l: Pick<PipelineLead, 'domain' | 'event'>): string {
  return `${cleanDomain(l.domain)}|${(l.event || '').trim().toLowerCase()}`
}

export function readLocal(): PipelineLead[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOCAL_KEY) || '[]')
    if (!Array.isArray(raw)) return []
    return raw
      .filter((x) => x && typeof x.domain === 'string' && typeof x.name === 'string')
      .map((x) => ({
        sponsorId: String(x.sponsorId ?? x.domain),
        name: x.name,
        domain: x.domain,
        kind: x.kind === 'venue' ? 'venue' : 'sponsor',
        score: Number.isFinite(x.score) ? x.score : 0,
        status: isStatus(x.status) ? x.status : 'To contact',
        tier: typeof x.tier === 'string' ? x.tier : undefined,
        priceGbp: typeof x.priceGbp === 'number' ? x.priceGbp : undefined,
        event: typeof x.event === 'string' ? x.event : '',
        notionUrl: typeof x.notionUrl === 'string' ? x.notionUrl : undefined,
        pageId: typeof x.pageId === 'string' ? x.pageId : undefined,
        updatedAt: typeof x.updatedAt === 'string' ? x.updatedAt : new Date(0).toISOString(),
      }))
  } catch {
    return []
  }
}

export function writeLocal(leads: PipelineLead[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(leads))
  } catch {}
}

// Notion is the source of truth for fields; the newer status (local move vs Notion edit) wins.
export function mergeLeads(remote: PipelineLead[], local: PipelineLead[]): PipelineLead[] {
  const map = new Map<string, PipelineLead>()
  for (const r of remote) map.set(leadKey(r), r)
  for (const l of local) {
    const k = leadKey(l)
    const r = map.get(k)
    if (!r) map.set(k, l)
    else if (Date.parse(l.updatedAt) > Date.parse(r.updatedAt)) map.set(k, { ...r, status: l.status, updatedAt: l.updatedAt })
  }
  return [...map.values()]
}
