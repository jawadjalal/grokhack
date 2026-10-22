# Backer pipeline: setup and demo check

This is the operator checklist for Joel's Notion push. The current `main` route (`app/api/push/route.ts`) only echoes leads; completing these steps does not by itself enable Notion writes. The contract is `POST /api/push` with `{ event: EventInput, leads: Lead[] }`, returning the leads with `notionUrl` after a successful push. See [04-pipeline.md](04-pipeline.md) for the implementation owner and acceptance goal.

## Create the Notion pipeline

1. Create one full-page database called **Backer pipeline** with one data source. Create an internal Notion connection for this workspace with **Read content**, **Insert content**, and **Update content** capabilities. Keep its token private.
2. In the original database page, open `•••` → **Connections** → **Add connections**, then choose the connection. A database query that returns 404 commonly means the connection lacks access to that database. Give the human demo operator access to the page separately.
3. Add these properties with the exact spelling and type below. Use **Select** for `Status`, matching the existing project contract. `Price GBP` uses the number format **British pound** if available; store whole GBP amounts as numbers, not currency strings.

| Property | Type | Values / mapping |
|---|---|---|
| Name | Title | `lead.name` |
| Domain | URL | `https://` + normalized `lead.domain` |
| Kind | Select | `sponsor`, `venue` |
| Score | Number | `lead.score`, 0–100 |
| Status | Select | `To contact`, `Contacted`, `Replied`, `Call`, `Signed`, `No`; new leads start at `To contact` |
| Tier | Select | `Headline`, `Partner`, `Supporter`, `Venue`; empty when absent |
| Price GBP | Number | `lead.suggestedPriceGbp`; empty when absent |
| Event | Text | `event.name` |
| Reasons | Text | Join `lead.reasons` with newlines |

Put the pitch subject and body in the page body, with labels, and include source links from `pastBackings` when present. Do not put email addresses or contact names into these fields unless the shared `Lead` contract is updated with the team. Keep exact option spelling: Notion select options can be created implicitly on write, and spelling drift creates extra columns/options.

4. Add a **Board** view named `Pipeline`, then set **Group** → `Status`. Show `Score`, `Kind`, `Tier`, `Price GBP`, and `Event` on each card; sort by `Score` descending. Put the six groups in the order above and keep `To contact` visible. For the demo, filter `Event` to the specific event used in the app so older tests do not crowd the screen.
5. Copy the **data source ID** from the database's data source settings or retrieve the database through the API and read its `data_sources[0].id`. Current Notion API versions create and query pages under a data source ID. A database ID and data source ID are different values.

Official references: [internal connections](https://developers.notion.com/guides/get-started/internal-connections), [working with databases](https://developers.notion.com/guides/data-apis/working-with-databases), [share a connection with a page](https://www.notion.com/help/add-and-manage-connections-with-the-api), [board views](https://www.notion.com/help/boards).

## Configuration handoff

The Notion implementation should read the following server-side variables. Use the names below when wiring Joel's code, or update this checklist and the deployment settings together if code uses different names:

```dotenv
NOTION_TOKEN=secret_from_the_internal_connection
NOTION_DATA_SOURCE_ID=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

Put them in `.env.local` for local work and the deployment's server environment. Never add real values to Git, browser code, logs, screenshots, or a PR. A `NOTION_DATABASE_ID` is only needed if code explicitly retrieves the database to discover its data source. The shared `MODEL` and Supabase variables belong to other parts of the app, not to the Notion push. No Zero credential is required for the base pipeline.

## Push behavior to verify

- Normalize a lead's domain by removing scheme, path, `www.`, and trailing dot, then lowercase it. Treat `(event.name normalized, domain normalized)` as the duplicate key. If two same-domain leads occur in one request, send one page and return the same `notionUrl` for both or reject the duplicate with a clear error.
- Query for the same `Event` and `Domain` before creating a page. Re-pushing the same event and 20 domains must leave the board at 20 pages, preserving a human-changed `Status` such as `Contacted`. Returning an existing page's URL is enough; overwriting the pitch is optional, but must not reset pipeline progress.
- Process the batch through a bounded queue. Notion currently documents 180 requests per minute for most plans, 600 for Business/Enterprise, plus a separate data source query limit of about three per second. Do not issue 20 query/create pairs in parallel. On 429 or 529, honor `Retry-After`, then use bounded backoff and surface a final error. After a timeout or uncertain write result, query the duplicate key before retrying create.
- Return a `notionUrl` only when a Notion page exists. If one lead fails, report which lead failed; do not claim the whole batch succeeded. A missing token, wrong data source ID, or unshared connection should fail visibly rather than silently echoing input.

Notion's [request limits](https://developers.notion.com/reference/request-limits) and [data source query endpoint](https://developers.notion.com/reference/query-a-data-source) are the source for these checks. Confirm the selected `Notion-Version` against Joel's actual client; API versions from 2025-09-03 onward split databases from data sources.

## Reproducible 20-lead smoke check

Run only against a test or demo pipeline whose operator expects synthetic records. The `*.invalid` domains and names below are fictional; they are **not** evidence of past sponsorship. The script produces a request in the shared `Lead` shape, with 20 unique domains and complete pitches.

```bash
node - <<'NODE' > /tmp/backer-pipeline-smoke.json
const event = { name: 'Backer pipeline smoke 2026-10-22', topic: 'pipeline test' }
const leads = Array.from({ length: 20 }, (_, i) => ({
  sponsorId: `smoke-${String(i + 1).padStart(2, '0')}`,
  name: `Synthetic Lead ${String(i + 1).padStart(2, '0')}`,
  domain: `lead-${String(i + 1).padStart(2, '0')}.invalid`,
  kind: i % 5 === 0 ? 'venue' : 'sponsor',
  score: 90 - i,
  reasons: ['Synthetic pipeline fixture; not a verified sponsor'],
  pastBackings: [],
  pitch: {
    subject: `Test pitch for Synthetic Lead ${i + 1}`,
    body: 'Synthetic test pitch. Do not send.'
  },
  suggestedTier: i % 5 === 0 ? 'Venue' : 'Supporter',
  suggestedPriceGbp: i % 5 === 0 ? 0 : 500
}))
process.stdout.write(JSON.stringify({ event, leads }))
NODE
curl -fsS -X POST http://localhost:3000/api/push \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/backer-pipeline-smoke.json
```

Inspect the response: exactly 20 leads, each with a distinct Notion page URL. In the board filtered to `Backer pipeline smoke 2026-10-22`, count 20 cards in `To contact`; open a card and verify its pitch. Move one card to `Contacted`, run the same `curl` again, then confirm there are still 20 cards and the moved card remains `Contacted`. This check currently **fails** on `main` because the route echoes without writing to Notion.

For the live demo, replace the smoke input with the app's actual `EventInput` and 20 ranked, sourced `Lead` records after matching and pitch generation are ready. The current seed contains six sourced leads; do not present the synthetic smoke records as real prospects.

## Zero enrichment: optional preparation

Zero is outside the required path. Its public documentation describes an API and MCP integration, and its pricing page currently advertises trial credits; credit availability and API access for this team have **not** been confirmed. Enrichment and some agent actions can consume credits, so do not execute Zero calls, buy credits, or create an account/workspace for this demo. If the team later has approved access and credits, first map a named contact and source URL into an agreed extension of the shared `Lead` type, then enrich only top leads behind a feature flag and a small quota. A failed or unavailable Zero lookup must leave the base Notion push working.

References: [Zero developer docs](https://docs.zero.inc/), [Zero pricing](https://zero.inc/pricing), [Zero subscription terms](https://zero.inc/subscription-terms).
