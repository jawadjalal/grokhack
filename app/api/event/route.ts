// Jawad: real scraping lands here (docs/01-scraper.md).
import type { EventInput } from '@/lib/types'

export async function POST(req: Request) {
  const { url, text } = (await req.json()) as { url?: string; text?: string }
  let name = text?.split('\n')[0]?.slice(0, 80) || 'Your event'
  let description = text ?? ''
  let topic = text?.slice(0, 200) ?? ''
  if (url) {
    try {
      const html = await (await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 Backer' } })).text()
      name = html.match(/<title>([^<]+)<\/title>/i)?.[1]?.trim() ?? name
      const meta = html.match(/<meta[^>]+(?:name|property)="(?:og:)?description"[^>]+content="([^"]+)"/i)?.[1] ?? ''
      const body = html
        .replace(/<(script|style|svg)[\s\S]*?<\/\1>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&[a-z#0-9]+;/gi, ' ')
        .replace(/\s+/g, ' ')
        .slice(0, 4000)
      topic = meta
      description = `${meta} ${body}`.trim() || description
    } catch {}
  }
  const event: EventInput = { name, url, topic: topic || name, description, audienceSize: 80 }
  return Response.json(event)
}
