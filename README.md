# Backer

**Find who will back your event.** Paste an event, get the London sponsors and venues most likely to say yes, with a drafted pitch for each and a pipeline in Notion.

Built at the Grok Bot Community Engineering London Hackathon, 22 Oct 2026. Track 5: Front Desk & Revenue. MIT licensed.

## How it works

1. **Map:** scrape sponsor and partner lists from London event pages (Luma, hackathon sites) into Supabase, giving us who backed what.
2. **Match:** for an input event, rank sponsors and venues by fit (topic, audience, past backing) and say why.
3. **Pitch:** draft a personal email per sponsor that names the events they backed, plus a suggested tier and price.
4. **Track:** push leads to a Notion database (contacted, replied, call, signed).

## Run it

```bash
npm install && npm run dev
```

The app works end to end today on seed data in `lib/seed.ts`. Each owner swaps their baseline for the real thing.

## Team docs

Start with [docs/PLAN.md](docs/PLAN.md), then your own doc:

| Area | Owner | Doc |
|---|---|---|
| Scraper (the map) | Jawad | [docs/01-scraper.md](docs/01-scraper.md) |
| Matching and scoring | Avi | [docs/02-matching.md](docs/02-matching.md) |
| Pitch drafts and pricing | Vidit | [docs/03-pitch.md](docs/03-pitch.md) |
| Notion pipeline and Zero | Joel | [docs/04-pipeline.md](docs/04-pipeline.md) |
| UI | Dhrishiv | [docs/05-ui.md](docs/05-ui.md) |
| Glue, deploy, demo | Jawad | [docs/06-demo.md](docs/06-demo.md) |

## Memory, powered by Cognee

Every lead you push, email or hear back from becomes a memory. Open **Memory** in the header to see them as a live network graph (events, sponsors, people; past backings in grey, outreach in ink, replies in green) with a 24 hour timeline and an "Ask memory" box.

- Touches are stored in Supabase (`db/memory.sql`, table `touches`) and written as plain sentences to a [Cognee](https://cognee.ai) dataset called `backer`, then cognified so Cognee builds a knowledge graph.
- "Ask memory" runs a Cognee `GRAPH_COMPLETION` search. Without Cognee keys it answers from the touch log and says "from your log".
- Set `COGNEE_BASE_URL`, `COGNEE_API_KEY`, `COGNEE_TENANT_ID` (see `.env.example`). With them unset the Cognee calls are skipped quietly.
- In the drawer, "Log a reply" records what a sponsor said.
