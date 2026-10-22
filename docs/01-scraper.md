# 01 · Scraper: the map

**Owner:** Niketh

The whole product depends on this data. Without "who backed which London event", Backer is just another CRM.

## Build

1. `lib/scrape/event.ts`: given a Luma or event page URL, fetch the HTML and pull out name, date, description and the sponsor/partner section. Use an LLM to turn messy HTML into JSON if selectors are painful.
2. `scripts/seed.ts`: run that over a list of **30+ London tech/community events** and write `events`, `sponsors` and `backings` to Supabase. Start with:
   - Tonight's page: https://gb-community-eng-hackathon-10-2026.teamdeel.workers.dev/hackathon (Supabase, Cognee, Zero, Notion, Cursor, Expedite as venue)
   - Luma London tech calendar pages, past hackathons, AI meetups
   - Mark venues with `kind = 'venue'`.
3. `app/api/event/route.ts`: `POST { url }` returns an `EventInput` for the input event.

## Done when

- Supabase has 30+ events, 50+ sponsors, real backings with `source_url`.
- `POST /api/event` with tonight's URL returns a sensible `EventInput`.

## Watch out

- No LinkedIn scraping. It blocks fast and breaks live demos.
- Dedupe sponsors by domain.
- **19:30 checkpoint:** push whatever rows you have so Avi can test against real data.
