// Jawad: scrape a Luma or event page into EventInput (docs/01-scraper.md).
import { eventFromText, scrapeEvent } from '@/lib/scrape/event'

export async function POST(req: Request) {
  let body: { url?: string; text?: string }
  try {
    body = (await req.json()) as { url?: string; text?: string }
  } catch {
    return Response.json({ error: 'Expected JSON { url }' }, { status: 400 })
  }

  const url = body.url?.trim()
  if (url) {
    try {
      const { event } = await scrapeEvent(url)
      return Response.json(event)
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not read that page'
      return Response.json({ error: message }, { status: 422 })
    }
  }

  const text = body.text?.trim()
  if (text) return Response.json(eventFromText(text))
  return Response.json({ error: 'Provide a url' }, { status: 400 })
}
