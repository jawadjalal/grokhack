// Jawad: real scraping lands here (docs/01-scraper.md).
import type { EventInput } from '@/lib/types'

export async function POST(req: Request) {
  const { url, text } = (await req.json()) as { url?: string; text?: string }
  let name = text?.split('\n')[0]?.slice(0, 80) || 'Your event'
  let description = text ?? ''
  if (url) {
    try {
      const html = await (await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 Backer' } })).text()
      name = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ?? name
      description = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)?.[1] ?? description
    } catch {}
  }
  const event: EventInput = { name, url, topic: description || name, description, audienceSize: 80 }
  return Response.json(event)
}
