# Backer

**Find who will back your event.** Paste an event, get the London sponsors and venues most likely to say yes, with a drafted pitch for each and a pipeline in Notion.

Built at the Grok Bot Community Engineering London Hackathon, 22 Oct 2026. Track 5: Front Desk & Revenue. MIT licensed.

## How it works

1. **Map:** scrape sponsor and partner lists from London event pages (Luma, hackathon sites) into Supabase, giving us who backed what.
2. **Match:** for an input event, rank sponsors and venues by fit (topic, audience, past backing) and say why.
3. **Pitch:** draft a personal email per sponsor that names the events they backed, plus a suggested tier and price.
4. **Track:** push leads to a Notion database (contacted, replied, call, signed).

## Team docs

Start with [docs/PLAN.md](docs/PLAN.md), then your own doc:

| Area | Owner | Doc |
|---|---|---|
| Scraper (the map) | Niketh | [docs/01-scraper.md](docs/01-scraper.md) |
| Matching and scoring | Avi | [docs/02-matching.md](docs/02-matching.md) |
| Pitch drafts and pricing | Vidit | [docs/03-pitch.md](docs/03-pitch.md) |
| Notion pipeline and Zero | Joel | [docs/04-pipeline.md](docs/04-pipeline.md) |
| UI | Dhrishiv | [docs/05-ui.md](docs/05-ui.md) |
| Glue, deploy, demo | Jawad | [docs/06-demo.md](docs/06-demo.md) |
