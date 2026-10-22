// Shared contract. Ask in the group chat before changing anything here.

export type EventInput = {
  name: string
  url?: string
  date?: string
  topic: string
  audienceSize?: number
  description?: string
}

export type Backing = { event: string; role: string; url: string }

export type Lead = {
  sponsorId: string
  name: string
  domain: string
  kind: 'sponsor' | 'venue'
  score: number // 0-100
  reasons: string[]
  fit?: { label: string; points: number; max: number; note: string }[] // how the score was built
  pastBackings: Backing[]
  distanceKm?: number // nearest backed event (or the venue itself) to the user's location
  pitch?: { subject: string; body: string }
  suggestedTier?: 'Headline' | 'Partner' | 'Supporter' | 'Venue'
  suggestedPriceGbp?: number
  notionUrl?: string
}
