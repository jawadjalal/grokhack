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

That is the whole setup. Leads come from the committed London map in `data/london.json` (loaded by `lib/seed.ts`), so ranking works with no Supabase key and no API token. Paste an event URL on http://localhost:3000.

![Ranked backers for the Company Brain Buildathon](docs/backer-demo.png)

The pitch for one of those rows is in [DEMO.md](DEMO.md). A real Notion push needs a private server token and the Backer data source ID.

## Notion pipeline

Create the **Backer pipeline** database and the properties listed in [the setup guide](docs/04-pipeline-setup.md). Share only that database with a dedicated Notion connection. Put the credentials in `.env.local` (which Git ignores):

```dotenv
NOTION_TOKEN=your_notion_connection_token
NOTION_DATA_SOURCE_ID=your_backer_data_source_id
```

`POST /api/push` accepts `{ event, leads }` and returns the same leads with `notionUrl`. It reuses an existing page for the same event and domain, so repeated pushes preserve a human-updated pipeline status. The setup guide includes a 20-lead smoke check. Zero enrichment is optional and does not block the Notion pipeline.

Joel's private [Pipeline board](https://app.notion.com/p/40190f1b6491806f9a71ccb5bd1bcb38?v=40190f1b6491814cb40a000cb3b358a8) is configured and connected. The 22 Oct 2026 synthetic smoke event contains 20 fictional records for testing, clearly labelled in each card. One 20-lead push returned distinct page URLs; a repeat push kept one manually changed `Contacted` status and did not create a duplicate.

## Hackathon checkpoints

Run `bash scripts/checkpoint.sh` to typecheck, test the Notion adapter, and commit only Joel's pipeline files when they have changed. During the build, a Codex scheduled task runs this every five minutes on the `joel/pipeline-integration` branch, until the 21:50 London code freeze. Review and push the branch before merging. The helper never stages `.env.local` or other teammates' files.

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
