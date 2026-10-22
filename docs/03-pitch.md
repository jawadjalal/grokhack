# 03 · Pitch drafts and pricing

**Owner:** Vidit

The "wow" moment in the demo is a pitch that reads like the organiser actually researched the sponsor.

## Paste this into your AI

> Read AGENTS.md and docs/03-pitch.md. Improve lib/pitch.ts only: replace the template email with an LLM-written one (under 120 words, names real past backings only, one clear ask). Keep the price table visible in code. Fall back to the current template if the call fails.

## Build

1. `lib/pitch.ts`: `pitch(event: EventInput, lead: Lead): Promise<Lead>`
   - Subject and body under 120 words. Names 1-2 events this sponsor backed (from `lead.pastBackings`), says why this event's audience fits them, makes one clear ask.
   - No fluff openers ("I hope this finds you well"). Sounds like a 20-year-old organiser, not a marketing team.
2. Pricing: suggest a tier and a GBP price. Simple rules are fine:
   - Base on audience size and how big the sponsor is.
   - Venues get `'Venue'` tier and an in-kind ask instead of a price.
   - Write the rules as a small table in code so the judges can see it's not made up.
3. `app/api/pitch/route.ts`: `POST { event, lead }` returns the lead with `pitch`, `suggestedTier`, `suggestedPriceGbp`.

## Done when

- Five pitches for tonight's event that you'd actually send.
- Each one takes under 5 seconds.

## Watch out

- Use fake `Lead` objects until Avi's route works.
- Never invent a past sponsorship. If `pastBackings` is empty, pitch on fit alone.

## Implementation and local setup

- Requires Node.js 22 or later. Run `npm install`.
- Copy `.env.example` to `.env.local`. Set `MODEL` to the team's Grok model ID and `XAI_API_KEY` to the shared xAI key. Do not commit `.env.local`.
- A bare `MODEL` value uses direct xAI. A `provider/model` value uses AI Gateway and requires `AI_GATEWAY_API_KEY` or Vercel OIDC instead.
- No configured model/key: returns a template draft immediately. Failed, invalid or slow generation: returns the same fallback. Model calls have no retries and a 3.5-second timeout.
- The model writes only the audience-fit sentence, using the event topic and supplied fit reasons. Treat this sentence as a commercial hypothesis to review. Code adds backing references, subject and the ask so the model cannot change the price or author the backing section.
- Backing references come only from the supplied lead. The current event and duplicate entries are excluded. Long fields are shortened and a second reference is omitted if needed to stay under 120 words across subject and body. Input data still needs to be factual; this endpoint does not independently verify source pages.

### Pricing assumptions

`lib/pitch/pricing.ts` contains the rule table. These are indicative asks, not researched market rates:

| Supplied sponsor size | Tier | Base ask for 80 attendees |
|---|---|---|
| Unknown or small | Supporter | £300 |
| Medium | Partner | £750 |
| Large | Headline | £1,500 |
| Venue | Venue | In kind, £0 |

Scale by `max(0.5, audienceSize / 80)`, rounded to the nearest £50. Missing audience size uses 80 for pricing only; the email never presents that estimate as actual attendance. Reuse the team's size classifications in `lib/seed.ts`: startup → small, scaleup → medium, giant → large. These are supplied planning assumptions, not independently researched company facts. Optional `PITCH_SPONSOR_SIZES` JSON in `.env.local` overrides them by lowercase domain, e.g. `{"example.com":"large"}`. Missing or invalid overrides use the seed classification, or unknown for an unmapped sponsor. No size is inferred from the match score or sponsor name.

### Verification and integration

- `npm run test:pitch`: five seed sponsor drafts, venues, missing/self-referential backing history, size rules, word budget, model success/failure/timeout and API validation. Model paths use the AI SDK's mock provider; a real xAI smoke test requires team credentials.
- `npm run typecheck` and `npm run build`.
- UI owner: the current UI eagerly calls the pitch route for every match in parallel. Each request falls back independently on provider failure; agree on lazy generation or concurrency limits if the team's model quota is low. Shared `Lead` and `EventInput` contracts are unchanged.
