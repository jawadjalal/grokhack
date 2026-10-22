// Memory: every touch on a lead lands in Supabase (for the graph) and in Cognee (for answers).
import { after } from 'next/server'
import { cogneeAdd, cogneeCognify } from './cognee'

export type TouchKind = 'pushed' | 'sent' | 'opened' | 'replied' | 'call' | 'signed' | 'note'
export type Touch = {
  id?: string
  created_at?: string
  event_name: string
  event_url?: string | null
  sponsor_id?: string | null
  sponsor_name?: string | null
  kind: TouchKind
  to_email?: string | null
  subject?: string | null
  body?: string | null
  note?: string | null
}

const URL = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
const KEY = process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const H = () => ({ apikey: KEY!, authorization: `Bearer ${KEY}`, 'content-type': 'application/json' })

export const KINDS: TouchKind[] = ['pushed', 'sent', 'opened', 'replied', 'call', 'signed', 'note']

function sentence(t: Touch, when: Date): string {
  const stamp = when.toISOString().slice(0, 16).replace('T', ' ')
  const who = t.sponsor_name ?? t.sponsor_id ?? 'a sponsor'
  const at = `about ${t.event_name}`
  switch (t.kind) {
    case 'pushed': return `${stamp}: added ${who} to the pipeline ${at}.`
    case 'sent': return `${stamp}: emailed ${who}${t.to_email ? ` (${t.to_email})` : ''} ${at}${t.subject ? `, subject "${t.subject}"` : ''}.`
    case 'opened': return `${stamp}: ${who} opened our email ${at}.`
    case 'replied': return `${stamp}: ${who} replied ${at}${t.note ? `: ${t.note}` : '.'}`
    case 'call': return `${stamp}: had a call with ${who} ${at}${t.note ? `. ${t.note}` : '.'}`
    case 'signed': return `${stamp}: ${who} signed as a sponsor ${at}.`
    default: return `${stamp}: note on ${who} ${at}${t.note ? `: ${t.note}` : '.'}`
  }
}

async function toCognee(text: string) {
  if (await cogneeAdd(text)) await cogneeCognify()
}

// Never throws. Supabase is awaited; Cognee runs after the response is sent.
export async function logTouch(t: Touch): Promise<Touch | null> {
  if (!KINDS.includes(t.kind) || !t.event_name) return null
  const when = new Date()
  let saved: Touch | null = null
  if (URL && KEY) {
    try {
      const row = { ...t, event_name: t.event_name.slice(0, 300), body: t.body?.slice(0, 4000), note: t.note?.slice(0, 2000) }
      const post = (r: unknown) => fetch(`${URL}/rest/v1/touches`, { method: 'POST', headers: { ...H(), prefer: 'return=representation' }, body: JSON.stringify(r), cache: 'no-store' })
      let res = await post(row)
      // sponsor_id is a foreign key; a seed-only sponsor keeps the touch without the link.
      if (!res.ok && row.sponsor_id) res = await post({ ...row, sponsor_id: null })
      if (res.ok) saved = ((await res.json()) as Touch[])[0] ?? null
    } catch {}
  }
  const text = sentence(t, when)
  try {
    after(() => toCognee(text).catch(() => {}))
  } catch {
    void toCognee(text).catch(() => {})
  }
  return saved
}

export async function listTouches(limit = 300): Promise<Touch[]> {
  if (!URL || !KEY) return []
  try {
    const res = await fetch(`${URL}/rest/v1/touches?select=*&order=created_at.desc&limit=${limit}`, { headers: H(), cache: 'no-store' })
    return res.ok ? ((await res.json()) as Touch[]) : []
  } catch {
    return []
  }
}
