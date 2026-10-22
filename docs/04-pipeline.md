# 04 · Notion pipeline and Zero

**Owner:** Joel

Organisers already live in Notion. Backer should drop leads straight into a board they can work from.

## Build

1. Create a Notion integration and a database "Backer pipeline" with properties: Name (title), Domain (url), Kind (select), Score (number), Status (select: To contact, Contacted, Replied, Call, Signed, No), Tier (select), Price GBP (number), Event (text), Reasons (text). Page body holds the pitch.
2. `lib/notion/index.ts`: `push(event, leads): Promise<Lead[]>` creates one page per lead, returns leads with `notionUrl`. Don't create duplicates if the same domain and event are pushed twice.
3. `app/api/push/route.ts`.
4. **Zero:** find Mariia Nedelkina (Zero) early and ask for hackathon credits. If yes, add `lib/zero/` to enrich the top leads with a named contact (`contact_name`, `contact_url`). If no, skip it; don't pay.

## Done when

- One click in the UI fills the Notion board with 20 leads and pitches.
- Board view grouped by Status looks good on the projector.

## Watch out

- Share the Notion database with the integration, or every call 404s.
- Notion rate limit is about 3 requests a second. Push in small batches.
