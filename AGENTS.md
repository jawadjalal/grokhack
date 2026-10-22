# Instructions for AI agents working on Backer

You are helping one person on a 5-person hackathon team. Code freeze is 21:50 on 22 Oct 2026. Live at https://grokhack.vercel.app, every push to `main` deploys.

## Before you write code

1. Read `README.md`, `docs/PLAN.md`, and the doc for your person in `docs/`.
2. Run it: `npm install && rm -rf .next && npm run dev` (Next.js 16; if you see "Failed to read source code" from node_modules/next, you skipped the npm install), open http://localhost:3000, paste https://gb-community-eng-hackathon-10-2026.teamdeel.workers.dev/hackathon and press enter. Everything already works end to end on seed data. Your job is to make your one part real, not to rebuild the app.

## Rules

- **Only edit the files your person owns** (table in `docs/PLAN.md`). Four other people and their AIs are editing the rest at the same time. If you need a change elsewhere, tell your person to ask the owner.
- **Don't change `lib/types.ts` or the API route shapes.** Optional fields may be added if you tell the team. Removing or renaming fields breaks everyone.
- **Keep the baseline working.** If your new version needs a key or a network call, fall back to the current behaviour when it fails. The demo must never show an error.
- **Small commits on your own branch** (`<name>/<area>`), PR into `main`, run `npx tsc --noEmit` before every push.
- **No invented data.** A sponsor's past backing needs a real source URL. Pitches must only mention backings that are in the data.
- **No new dependencies** unless your person agrees. Use `fetch` for APIs.
- Secrets go in `.env.local` (and Vercel), never in git. See `.env.example`.

## Design rules (if you touch UI)

The look comes from the Ignaru kit, tokens in `app/globals.css`. Keep it:
- Geist; Geist Mono only for numbers, money, domains.
- Square corners: tag 4, button 7, card 10, panel 12. No pills.
- One black primary button per area; everything else is a ghost button. No rows of bordered buttons.
- Hairline dividers, not boxes inside boxes. No uniform grids of stat cards.
- No cream, peach or orange washes. No small uppercase labels above headings. No coloured left border on selected rows.
- Real company logos (`components/Mark.tsx`), never monograms.
- Dither bars (`components/DitherBar.tsx`) for any score or progress.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
