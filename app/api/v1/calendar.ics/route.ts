// Subscribable calendar of upcoming London tech events (RFC 5545).
// GET /api/v1/calendar.ics?lat=&lng=&radiusKm=&q=
// All-day events: we only store dates. Subscribe with webcal://.
import type { NextRequest } from 'next/server'
import { loadEvents, londonDay, londonToday } from '@/lib/events'
import { haversineKm, roundCoord } from '@/lib/geo'

const CRLF = '\r\n'
const enc = new TextEncoder()

// Escape TEXT values: backslash, semicolon, comma, newline.
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
}

// Fold to 75 octets per line (continuation lines start with one space), never splitting a character.
function fold(line: string): string {
  if (enc.encode(line).length <= 75) return line
  const out: string[] = []
  let cur = ''
  let size = 0
  for (const ch of line) {
    const n = enc.encode(ch).length
    const limit = out.length ? 74 : 75 // the leading space counts toward 75
    if (size + n > limit) {
      out.push(cur)
      cur = ''
      size = 0
    }
    cur += ch
    size += n
  }
  out.push(cur)
  return out.join(CRLF + ' ')
}

const compact = (day: string) => day.replace(/-/g, '')
const nextDay = (day: string) => new Date(Date.parse(`${day}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10)

function num(p: URLSearchParams, name: string): number | undefined {
  const raw = p.get(name)
  if (raw === null || raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) ? n : undefined
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const lat = num(p, 'lat')
  const lng = num(p, 'lng')
  const radius = num(p, 'radiusKm')
  const q = (p.get('q') ?? '').trim().toLowerCase().slice(0, 100)
  const near =
    lat !== undefined && lng !== undefined && Math.abs(lat) <= 90 && Math.abs(lng) <= 180
      ? { lat: roundCoord(lat), lng: roundCoord(lng), radiusKm: radius !== undefined && radius >= 0.5 && radius <= 500 ? radius : 10 }
      : null

  const today = londonToday()
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '')
  const all = await loadEvents()
  const events = all
    .map(e => ({ e, day: londonDay(e.date) }))
    .filter((x): x is { e: (typeof all)[number]; day: string } => !!x.day && x.day >= today)
    .filter(({ e }) => !near || haversineKm(near, e) <= near.radiusKm)
    .filter(({ e }) => !q || [e.name, e.organiser, e.topic, e.venue, e.city].some(v => v?.toLowerCase().includes(q)))
    .sort((a, b) => a.day.localeCompare(b.day) || a.e.name.localeCompare(b.e.name))

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Backer//London tech events//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Backer: London tech events',
    'X-WR-TIMEZONE:Europe/London',
    'X-WR-CALDESC:Upcoming London tech events and who backs them',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ]
  for (const { e, day } of events) {
    const desc = [
      e.organiser ? `Organiser: ${e.organiser}` : null,
      e.topic ? `Topic: ${e.topic}` : null,
      `Backers: ${e.backers}`,
      'Find backers: https://grokhack.vercel.app',
    ]
      .filter(Boolean)
      .join('\n')
    lines.push(
      'BEGIN:VEVENT',
      `UID:${e.id}@backer`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(day)}`,
      `DTEND;VALUE=DATE:${compact(nextDay(day))}`,
      `SUMMARY:${esc(e.name)}`,
      `URL:${e.url}`,
      `LOCATION:${esc(e.venue || 'London')}`,
      `DESCRIPTION:${esc(desc)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')

  return new Response(lines.map(fold).join(CRLF) + CRLF, {
    headers: {
      'content-type': 'text/calendar; charset=utf-8',
      'content-disposition': 'inline; filename=backer-london-tech.ics',
      'cache-control': 'public, max-age=3600, s-maxage=3600',
    },
  })
}
