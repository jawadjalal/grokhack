// Cognee Cloud over plain HTTP. Every function is a no-op when the keys are missing,
// so the app never errors; the UI says "Connect Cognee" instead.
const BASE = (process.env.COGNEE_BASE_URL ?? '').replace(/\/$/, '')
const KEY = process.env.COGNEE_API_KEY
const TENANT = process.env.COGNEE_TENANT_ID
export const DATASET = 'backer'

export const cogneeEnabled = () => !!(BASE && KEY)

function headers(extra?: Record<string, string>): Record<string, string> {
  const h: Record<string, string> = { 'X-Api-Key': KEY! }
  if (TENANT) h['X-Tenant-Id'] = TENANT
  return { ...h, ...extra }
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    return await fn(ctl.signal)
  } finally {
    clearTimeout(t)
  }
}

// Adds one plain-English memory to the "backer" dataset.
export async function cogneeAdd(text: string): Promise<boolean> {
  if (!cogneeEnabled()) return false
  try {
    // Cognee Cloud takes plain text as JSON on /add_text (/add expects file uploads in `data`).
    const res = await withTimeout(15000, signal =>
      fetch(`${BASE}/api/v1/add_text`, { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ textData: [text], datasetName: DATASET }), signal }),
    )
    return res.ok
  } catch {
    return false
  }
}

// Builds the knowledge graph from everything added so far.
export async function cogneeCognify(): Promise<boolean> {
  if (!cogneeEnabled()) return false
  try {
    const res = await withTimeout(15000, signal =>
      fetch(`${BASE}/api/v1/cognify`, { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ datasets: [DATASET] }), signal }),
    )
    return res.ok
  } catch {
    return false
  }
}

// Returns Cognee's answer, or null when not connected or nothing came back.
export async function cogneeSearch(query: string): Promise<string | null> {
  if (!cogneeEnabled()) return null
  try {
    const res = await withTimeout(25000, signal =>
      fetch(`${BASE}/api/v1/search`, { method: 'POST', headers: headers({ 'content-type': 'application/json' }), body: JSON.stringify({ query, search_type: 'GRAPH_COMPLETION', datasets: [DATASET] }), signal }),
    )
    if (!res.ok) return null
    return flatten(await res.json()).replace(/\*\*/g, "").trim() || null
  } catch {
    return null
  }
}

// Search results vary: strings, {search_result}, or lists of either.
function flatten(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string') return v.trim()
  if (Array.isArray(v)) return v.map(flatten).filter(Boolean).join('\n')
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    for (const k of ['search_result', 'text', 'answer', 'result']) if (o[k] != null) return flatten(o[k])
  }
  return ''
}
