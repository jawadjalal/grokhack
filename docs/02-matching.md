# 02 · Matching and scoring

**Owner:** Avi

Turn the map into a ranked list for one event. This is what the judges look at first.

## Paste this into your AI

> Read AGENTS.md and docs/02-matching.md. Improve lib/match.ts only: keep the four-part fit score and its drawer breakdown, tune the weights, and add an optional LLM pass that rewrites reasons for the top 15 using only the backings in the data. Fall back to the current scoring if the LLM call fails.

## Build

1. `lib/match/index.ts`: `match(event: EventInput): Promise<Lead[]>`
   - Pull candidate sponsors and their past backings from Supabase.
   - Cheap first pass: score on topic overlap with events they backed, how often and how recently they back London events, audience size fit.
   - Then an LLM pass on the top ~30 to set the final `score` (0-100) and write 1-3 short `reasons` a human would believe.
   - Include venues too (`kind = 'venue'`), ranked separately or flagged.
2. `app/api/match/route.ts`: `POST EventInput` returns `Lead[]` sorted by score.

## Done when

- Tonight's event as input gives Cursor, Supabase, Notion etc. near the top with reasons like "backed 3 London AI hackathons".
- Responds in under 10 seconds.

## Watch out

- `lib/seed.ts` already has real rows. Until Jawad's scraper adds more, test against those.
- Reasons must cite real backings, not invented ones. Pass the backings into the prompt and tell the model to only use those.
