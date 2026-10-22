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

Scale by `max(0.5, audienceSize / 80)`, rounded to the nearest £50. Missing audience size uses 80 for pricing only; the email never presents that estimate as actual attendance. The scraped map's `size: 'startup'` is a placeholder, so it is treated as unknown. Supply explicit size assumptions using optional `PITCH_SPONSOR_SIZES` JSON in `.env.local`, keyed by lowercase domain, e.g. `{"example.com":"large"}`. Missing or invalid configuration defaults to unknown. No size is inferred from the match score, sponsor name or placeholder field.

### Verification and integration

- `npm run test:pitch`: five seed sponsor drafts, venues, missing/self-referential backing history, size rules, word budget, model success/failure/timeout and API validation. Also checks that backing-history reasons are withheld from the model's fit-sentence input. Automated model paths use the AI SDK's mock provider.
- `npm run typecheck` and `npm run build`.
- UI owner: the current UI eagerly calls the pitch route for every match in parallel. Each request falls back independently on provider failure; agree on lazy generation or concurrency limits if the team's model quota is low. Shared `Lead` and `EventInput` contracts are unchanged.

Live verification on 22 Oct 2026: `grok-4.20-0309-non-reasoning` returned accepted model-written fit sentences for five sponsor drafts and one venue draft, all under five seconds and 120 words. The current account's Grok 4.7 exceeded the timeout in the initial check; use the measured non-reasoning model for this demo. These checks are observations, not a service guarantee. Keep the API key only in local/deployment environment configuration.
