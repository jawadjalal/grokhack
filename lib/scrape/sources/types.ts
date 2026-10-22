// Shared shape every event source returns. The scrape script turns these into
// events, sponsors and backings (docs/PLAN.md tables). Never invent a field:
// leave it undefined if the source doesn't say.
import type { ScrapedPartner } from '../event'

export type Source = 'luma' | 'devpost' | 'meetup' | 'builderbase' | 'mlh' | 'eventbrite' | 'devevents' | 'confstech' | 'gdg' | 'hackclub'

export type RawLink = { text: string; href: string }

export type RawHost = { name: string; website?: string; twitter?: string; linkedin?: string }

export type RawEvent = {
  source: Source
  url: string // public page; becomes source_url for every backing found on it
  name: string
  date?: string // YYYY-MM-DD, London time
  city?: string
  country?: string
  venue?: { name?: string; address?: string }
  geo?: { lat: number; lng: number } // venue coordinates when the source gives them (Luma, Eventbrite, Meetup, GDG do)
  organiser?: string // Luma calendar, Meetup group or Devpost organisation
  audienceSize?: number // guests, RSVPs or registrations
  categories?: string[]
  description?: string // plain text
  links?: RawLink[] // links in the description or sponsor section
  hosts?: RawHost[]
  partners?: ScrapedPartner[] // only when the page lists sponsors/partners explicitly
}

export type DiscoverOptions = {
  pastDays: number // include events that started up to this many days ago
  futureDays: number // and up to this many days ahead
  limit: number // max events this source returns
}

export type Discover = (opts: DiscoverOptions) => Promise<RawEvent[]>
