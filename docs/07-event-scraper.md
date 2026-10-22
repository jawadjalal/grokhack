# 07 · Event scraper: filling the map

**Owner:** Avi

`scripts/scrape-events.ts` finds real London tech events on the big listing sites, works out who backed each one, and merges events, sponsors and backings into `data/london.json` (the map `lib/seed.ts`, `scripts/seed.ts` and `scripts/seed-db.ts` read). Every backing keeps the URL of the page it was read from.

## Run it

```sh
node --env-file-if-exists=.env.local --disable-warning=MODULE_TYPELESS_PACKAGE_JSON \
  --import ./scripts/register.mjs scripts/scrape-events.ts \
  [--past 120] [--future 60] [--limit 150] [--only luma,meetup] [--dry-run]
```

- `--past` / `--future`: the window in days around today. `--limit`: max events per source.
- `--only`: a comma-separated list of sources. `--dry-run`: print the summary and write nothing.
- `XAI_API_KEY` in `.env.local` turns on the Grok partner pass. Without it the heading heuristic runs alone.
- A cold run takes a few minutes, mostly Luma at 1 request a second. Reruns within 12 hours come from the cache.

## Sources

Each file in `lib/scrape/sources/` exports `discover(opts)` and returns `RawEvent[]` (`sources/types.ts`). The script imports whichever ones exist. A missing or failing source is logged and skipped.

| Source | Where from | What it gives |
| --- | --- | --- |
| `luma` | London discover feed + 12 known London tech calendars (iCal), then `api.lu.ma/event/get` | description, every description link, hosts, categories, guests, venue, lat/lng, partners under sponsor headings |
| `meetup` | `/find` for tech, ai, developer, startup, data + past events of up to 15 groups | description, venue, lat/lng, RSVPs, topics, the group's Meetup sponsors |
| `builderbase` | public discovery API (active + past) | organiser, participants, themes; native events add description, venue and tiered sponsors |
| `mlh` | season pages on mlh.com | London hackathons, organiser, the event website's sponsor section |
| `devpost` | `/api/hackathons?search=london`, in person | organiser, registrations, themes; sponsor tiles when the page loads |
| `eventbrite`, `devevents`, `confstech`, `gdg`, `hackclub` | built separately | picked up automatically when the files exist |

## What it does

1. Runs every source side by side (`Promise.allSettled`).
2. Keeps London + tech (`lib/scrape/filter.ts`). If `lib/scrape/classify.ts` exports `classifyTech`, its verdict decides tech and `isTech` covers anything it leaves out.
3. Dedupes events: the same URL (query and trailing slash stripped, `lu.ma` = `luma.com`), or the same name within two days (Devpost dates a hackathon by its deadline, MLH by its start). It keeps the richer record and pools links and partners.
4. `findPartners` (`lib/scrape/partners.ts`, 4 at a time) adds sponsors named in the description. A name only counts if it is literally in the text. Domains come from the event's own links or a known list: a short hand-checked list in the script, the map's sponsors, and, in a second pass, names other scraped pages link (so "Encode Hub" resolves everywhere once one page links it).
5. Drops partners whose name is the organiser, platforms and socials, and the event's own site. Meetup "Group sponsor" rows are kept once per group, on its most recent event in the window.
6. A partner without a domain can't become a sponsor (sponsor id = domain). It is counted and listed as unresolved.

## Merging into data/london.json

- Nothing already in the file is lost. An event that exists (same id, same URL or same name within two days) only gets its empty fields filled: date, organiser, audienceSize, lat, lng, venue, address, country, source.
- New ids follow Jawad's scheme: `luma-<slug>`, `devpost-<subdomain>`, `meetup-<event id>`, `builderbase-<slug>`, `mlh-<slug>`, `eventbrite-<id>`, `devevents-…`, `gdg-<id>`, otherwise `<source>-<host>-<path>`.
- New event rows: `{ id, name, url, date, city: 'London', topic, audienceSize, organiser, sourceUrl, source, lat?, lng?, venue?, address?, country? }`. `topic` is the categories plus the description's first sentence (300 chars max). The optional keys are left out when unknown.
- Sponsors dedupe by domain, backings by (eventId, sponsorId).
- Tech filter on existing rows: an event with no backings that the filter rejects (for example the Operators RunClub) is removed and listed in the summary. An event with backings is never removed.
- The file is sorted so diffs stay readable: events by date then id (no date last), sponsors by id, backings by eventId then sponsorId.

## Tech filter

`isTech` follows `lib/scrape/eval/RUBRIC.md`. Devpost, MLH and Hack Club events are always in. A title that names the tech itself (AI, hack, developer, data…) is in. Otherwise an activity title or category (run club, walk, yoga, comedy, wine, film…) is out. Then a tech category, or tech words in the name, organiser, categories or first 400 characters of the description. `inLondon` needs a London city, venue, address or postcode, or lat/lng within 30 km of central London. It rejects a non-GB country and London, Ontario.

## Geo fields

`RawEvent.geo` and `country` come only from the source. Luma uses the event coordinate, except while the address is hidden until registration (the coordinate is fuzzed then). Meetup uses the venue's lat/lon. Builderbase uses its location only when it marks it precise and it isn't just the geocode of "London". MLH and Devpost give a country but no coordinates.

## Politeness and caching

All requests go through `lib/scrape/http.ts`: a browser user agent, a 15 s timeout, 1 request a second to Luma, Meetup and Eventbrite (300 ms to others), one retry on 429/5xx, and a 12 h disk cache in `$TMPDIR/backer-scrape-cache`. Grok answers are cached there too. One bad event never stops a source. A source only throws when it can't reach the site at all.

## Last run (22 Oct 2026, defaults)

| Source | Returned | London + tech | With lat/lng |
| --- | --- | --- | --- |
| luma | 150 | 138 | 61 |
| meetup | 90 | 83 | 81 |
| eventbrite | 149 | 67 | 67 |
| devevents | 28 | 23 | 5 |
| gdg | 15 | 15 | 10 |
| confstech | 15 | 14 | 0 |
| builderbase | 6 | 6 | 0 |
| devpost | 5 | 5 | 0 |
| mlh | 1 | 1 | 0 |
| hackclub | 1 | 1 | 1 |

After dedupe that's 333 events. The map went from 34 events, 408 sponsors and 426 backings to 339 events, 583 sponsors and 712 backings. That's 307 events added, 25 existing ones filled in (mostly lat/lng, venue and country), and 2 removed (the Operators RunClub and the Startup Stroll). 175 sponsors and 286 backings were added across 127 events, each with the page it came from. 290 partner names had no domain and were left out. `classify.ts` didn't exist yet, so `isTech` decided. A cold run is a few minutes. This one was cached and took 2 s.

## Known gaps

- Devpost hackathon pages sit behind a Cloudflare challenge for Node fetch, so Devpost gives no sponsors, descriptions or street addresses from here. The listing API works. Likely-London events whose listing doesn't say London are dropped.
- Meetup only server-renders the first page of each keyword search (about 25-30 events), so coverage is 5 keywords plus the past events of 15 groups.
- Luma hides the address until you register (venue and lat/lng stay empty, as on tonight's hackathon), and often hides the guest count.
- Many partners are named without a link (community partners linked only to LinkedIn). They have no domain, so they are reported as unresolved and not added.
- Meetup group sponsors back the group, not one event. They appear once per group with role "Group sponsor".
