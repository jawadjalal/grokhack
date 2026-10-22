# 03 · Pitch drafts and pricing

**Owner:** Vidit

The "wow" moment in the demo is a pitch that reads like the organiser actually researched the sponsor.

## Paste this into your AI

> Read AGENTS.md and docs/03-pitch.md. Improve lib/pitch.ts only: replace the template email with an LLM-written one (under 120 words, names real past backings only, one clear ask). Keep the price table visible in code. Fall back to the current template if the call fails.

## Build

1. `lib/pitch/index.ts`: `pitch(event: EventInput, lead: Lead): Promise<Lead>`
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
