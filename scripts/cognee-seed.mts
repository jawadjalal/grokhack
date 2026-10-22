// Loads the London sponsor map into Cognee as plain sentences, then builds the graph.
// Run: npx tsx --env-file=.env.local scripts/cognee-seed.mts
import { backings, sponsors } from '../lib/seed'

const BASE = process.env.COGNEE_BASE_URL
const KEY = process.env.COGNEE_API_KEY
const TENANT = process.env.COGNEE_TENANT_ID
if (!BASE || !KEY || !TENANT) throw new Error('Set COGNEE_BASE_URL, COGNEE_API_KEY and COGNEE_TENANT_ID')
const H = { 'X-Api-Key': KEY, 'X-Tenant-Id': TENANT }

const name = new Map(sponsors.map(s => [s.id, s]))
const byEvent = new Map<string, string[]>()
for (const b of backings) {
  const s = name.get(b.sponsorId)
  if (!s) continue
  const list = byEvent.get(b.event) ?? []
  list.push(`${s.name} (${s.domain}) as ${b.role}`)
  byEvent.set(b.event, list)
}
const docs = [...byEvent].map(([event, list]) => `London event "${event}" was backed by: ${list.join('; ')}. Source pages were scraped by Backer on 2026-10-22.`)

const add = await fetch(`${BASE}/api/v1/add_text`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ textData: docs, datasetName: 'backer' }) })
console.log('add_text', add.status, docs.length, 'documents', (await add.text()).slice(0, 200))
const res = await fetch(`${BASE}/api/v1/cognify`, { method: 'POST', headers: { ...H, 'content-type': 'application/json' }, body: JSON.stringify({ datasets: ['backer'] }) })
console.log('cognify', res.status)
