# Plan

Code freeze is **21:50**. Top 5 demo live at 22:20, 3 minutes each. Everything below is sized to fit.

## Timeline

| Time | Goal |
|---|---|
| 18:30 | Everyone has read their doc and the contracts below. Jawad pushes the Next.js skeleton and the Supabase schema. |
| 19:30 | Each piece works on its own with fake data. |
| 20:30 | End to end works once: paste an event, see ranked sponsors, push to Notion. |
| 21:15 | Feature freeze. Only fixes and demo polish after this. |
| 21:40 | Deployed, demo rehearsed twice, README has a screenshot. |
| 21:50 | Submit. |

## Stack

- Next.js (App Router, TypeScript) on Vercel
- Supabase Postgres for the event and sponsor map
- LLM calls through the AI SDK; model name lives in the `MODEL` env var (Grok if we get access, so the sponsor tie-in is obvious)
- Notion API for the pipeline
- Zero for lead search and enrichment, **only if** Mariia (Zero) gives us credits. Don't pay.

## Rules so we don't collide

- Each person owns their folder. Don't edit someone else's files; message them.
- Branch per person (`niketh/scraper`, etc.), PR into `main`, merge your own once it builds. Pull `main` often.
- Secrets go in `.env.local`, never in git. Jawad shares the values in the group chat.
- Fake it before you make it: build against the sample data in the contracts first, swap in real data later.

## Shared contracts

Agree on these and don't change them without telling everyone.

### Supabase tables

```sql
create table events (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text unique,
  date date,
  city text default 'London',
  topic text,              -- e.g. "AI agents hackathon"
  audience_size int,
  organiser text
);

create table sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  domain text unique,      -- "cursor.com"
  kind text default 'sponsor', -- 'sponsor' | 'venue'
  description text,
  contact_name text,
  contact_url text
);

create table backings (
  event_id uuid references events(id) on delete cascade,
  sponsor_id uuid references sponsors(id) on delete cascade,
  role text,               -- "Tech partner", "Venue partner", "Community partner"
  source_url text,
  primary key (event_id, sponsor_id)
);
```

### Shared types (`lib/types.ts`)

```ts
export type EventInput = {
  name: string
  url?: string
  date?: string
  topic: string
  audienceSize?: number
  description?: string
}

export type Lead = {
  sponsorId: string
  name: string
  domain: string
  kind: 'sponsor' | 'venue'
  score: number                 // 0-100
  reasons: string[]             // short, shown in the UI
  pastBackings: { event: string; role: string; url: string }[]
  pitch?: { subject: string; body: string }
  suggestedTier?: 'Headline' | 'Partner' | 'Supporter' | 'Venue'
  suggestedPriceGbp?: number
  notionUrl?: string
}
```

### API routes

| Route | Owner | In | Out |
|---|---|---|---|
| `POST /api/event` | Niketh | `{ url }` | `EventInput` scraped from a Luma or event page |
| `POST /api/match` | Avi | `EventInput` | `Lead[]` sorted by score, no pitch yet |
| `POST /api/pitch` | Vidit | `{ event: EventInput, lead: Lead }` | `Lead` with `pitch`, `suggestedTier`, `suggestedPriceGbp` |
| `POST /api/push` | Joel | `{ event: EventInput, leads: Lead[] }` | `Lead[]` with `notionUrl` |

### Folders

```
app/            Dhrishiv (pages), each owner's app/api/<route>
lib/scrape/     Niketh
lib/match/      Avi
lib/pitch/      Vidit
lib/notion/     Joel
lib/types.ts    shared, ask before changing
scripts/seed.ts Niketh
```

## Demo story (3 minutes)

1. "Every lead here chases sponsors by hand, in spreadsheets and cold DMs." (15s)
2. Paste a real upcoming London event's Luma link. (15s)
3. Backer shows 20 ranked sponsors and venues, each with why: "backed 4 London AI hackathons this year". (60s)
4. Open one: the pitch names the events they backed and suggests a tier and price. (45s)
5. Push to Notion, show the pipeline board. (30s)
6. "Open source, any community can run it next week." (15s)
