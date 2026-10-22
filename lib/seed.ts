// Who could back a London tech event, and who already has.
// `sponsors` is the candidate pool: real companies, described by what they
// care about. `backings` are real, sourced sponsorships only. Every backing
// needs a URL you can open. The scraper adds to both.

export type Audience = 'developers' | 'founders' | 'students' | 'designers' | 'community'

export type SeedSponsor = {
  id: string
  name: string
  domain: string
  kind: 'sponsor' | 'venue'
  tags: string[] // what they care about
  audience: Audience[] // who they want in the room
  hackathons?: boolean // known to back hackathons and community events
  size: 'giant' | 'scaleup' | 'startup'
}

export type SeedBacking = {
  sponsorId: string
  event: string
  eventTopic: string
  role: string
  url: string
}

const S = (id: string, name: string, domain: string, tags: string, audience: Audience[], size: SeedSponsor['size'], hackathons = true): SeedSponsor => ({
  id,
  name,
  domain,
  kind: 'sponsor',
  tags: tags.split(' '),
  audience,
  size,
  hackathons,
})

const V = (id: string, name: string, domain: string, tags: string, audience: Audience[]): SeedSponsor => ({
  id,
  name,
  domain,
  kind: 'venue',
  tags: tags.split(' '),
  audience,
  size: 'startup',
  hackathons: true,
})

export const sponsors: SeedSponsor[] = [
  // Partners at tonight's hackathon
  S('cursor', 'Cursor', 'cursor.com', 'ai coding agents developers editor hackathon', ['developers', 'students'], 'scaleup'),
  S('supabase', 'Supabase', 'supabase.com', 'database postgres auth backend developers open-source hackathon', ['developers', 'founders'], 'scaleup'),
  S('notion', 'Notion', 'notion.com', 'productivity docs community students ai workspace', ['students', 'community', 'founders'], 'giant'),
  S('cognee', 'Cognee', 'cognee.ai', 'ai agents memory knowledge-graph open-source developers', ['developers'], 'startup'),
  S('zero', 'Zero', 'zero.inc', 'gtm sales crm outbound agents founders', ['founders'], 'startup'),

  // AI labs and model platforms
  S('anthropic', 'Anthropic', 'anthropic.com', 'ai llm agents safety developers claude', ['developers', 'founders'], 'giant'),
  S('openai', 'OpenAI', 'openai.com', 'ai llm agents developers gpt', ['developers', 'founders'], 'giant'),
  S('xai', 'xAI', 'x.ai', 'ai llm grok agents developers', ['developers'], 'giant'),
  S('mistral', 'Mistral AI', 'mistral.ai', 'ai llm open-source europe developers', ['developers'], 'scaleup'),
  S('elevenlabs', 'ElevenLabs', 'elevenlabs.io', 'ai voice audio agents london developers creators', ['developers', 'founders'], 'scaleup'),
  S('groq', 'Groq', 'groq.com', 'ai inference fast llm developers', ['developers'], 'scaleup'),
  S('huggingface', 'Hugging Face', 'huggingface.co', 'ai open-source models ml community', ['developers', 'community', 'students'], 'scaleup'),
  S('perplexity', 'Perplexity', 'perplexity.ai', 'ai search research students', ['students', 'developers'], 'scaleup'),

  // Developer platforms
  S('vercel', 'Vercel', 'vercel.com', 'frontend nextjs ai deploy developers hackathon', ['developers', 'founders'], 'scaleup'),
  S('github', 'GitHub', 'github.com', 'open-source developers students code community', ['developers', 'students', 'community'], 'giant'),
  S('cloudflare', 'Cloudflare', 'cloudflare.com', 'edge workers developers security ai', ['developers'], 'giant'),
  S('replit', 'Replit', 'replit.com', 'ai coding agents students beginners', ['students', 'developers'], 'scaleup'),
  S('lovable', 'Lovable', 'lovable.dev', 'ai app-builder europe founders no-code', ['founders', 'students'], 'scaleup'),
  S('modal', 'Modal', 'modal.com', 'ai gpu serverless python ml developers', ['developers'], 'startup'),
  S('neon', 'Neon', 'neon.tech', 'database postgres serverless developers', ['developers'], 'startup'),
  S('convex', 'Convex', 'convex.dev', 'backend realtime database developers', ['developers'], 'startup'),
  S('clerk', 'Clerk', 'clerk.com', 'auth users developers', ['developers', 'founders'], 'startup'),
  S('resend', 'Resend', 'resend.com', 'email developers api', ['developers'], 'startup'),
  S('posthog', 'PostHog', 'posthog.com', 'analytics product open-source developers founders', ['developers', 'founders'], 'scaleup'),
  S('e2b', 'E2B', 'e2b.dev', 'ai agents sandbox open-source developers', ['developers'], 'startup'),
  S('browserbase', 'Browserbase', 'browserbase.com', 'ai agents browser automation scraping developers', ['developers'], 'startup'),
  S('exa', 'Exa', 'exa.ai', 'ai search agents research scraping developers', ['developers'], 'startup'),
  S('fal', 'fal', 'fal.ai', 'ai image video generative media developers', ['developers', 'designers'], 'startup'),
  S('langchain', 'LangChain', 'langchain.com', 'ai agents llm open-source developers', ['developers'], 'scaleup'),
  S('weaviate', 'Weaviate', 'weaviate.io', 'ai vector database memory open-source developers', ['developers'], 'startup'),
  S('mongodb', 'MongoDB', 'mongodb.com', 'database ai vector developers students', ['developers', 'students'], 'giant'),

  // Business tools that back founder and community events
  S('stripe', 'Stripe', 'stripe.com', 'payments revenue founders developers fintech', ['founders', 'developers'], 'giant'),
  S('linear', 'Linear', 'linear.app', 'product engineering issues founders', ['founders', 'developers'], 'scaleup', false),
  S('figma', 'Figma', 'figma.com', 'design prototyping designers community', ['designers', 'students'], 'giant'),
  S('luma', 'Luma', 'lu.ma', 'events community organisers ticketing', ['community'], 'startup'),
  S('monzo', 'Monzo', 'monzo.com', 'fintech london banking founders', ['founders', 'community'], 'scaleup', false),
  S('revolut', 'Revolut', 'revolut.com', 'fintech london payments developers', ['developers', 'founders'], 'giant', false),

  // London venues
  V('expedite', 'Expedite', 'expedite.london', 'venue london hackathon evening tech', ['developers', 'founders']),
  V('newspeak', 'Newspeak House', 'newspeak.house', 'venue london community civic tech hackathon', ['community', 'developers']),
  V('huckletree', 'Huckletree', 'huckletree.com', 'venue london startups founders events', ['founders']),
  V('plexal', 'Plexal', 'plexal.com', 'venue london innovation startups hackathon', ['founders', 'developers']),
  V('secondhome', 'Second Home', 'secondhome.io', 'venue london creative community events', ['community', 'designers']),
]

const GROK_HACK = {
  event: 'Grok Bot Community Engineering London Hackathon',
  eventTopic: 'community tools hackathon ai agents open-source developers london',
  url: 'https://gb-community-eng-hackathon-10-2026.teamdeel.workers.dev/hackathon',
}

export const backings: SeedBacking[] = [
  { sponsorId: 'cursor', role: 'Host and tech partner', ...GROK_HACK },
  { sponsorId: 'supabase', role: 'Tech partner', ...GROK_HACK },
  { sponsorId: 'cognee', role: 'Tech partner', ...GROK_HACK },
  { sponsorId: 'zero', role: 'Tech partner', ...GROK_HACK },
  { sponsorId: 'notion', role: 'Tech partner', ...GROK_HACK },
  { sponsorId: 'xai', role: 'Tech partner (Grok Bot)', ...GROK_HACK },
  { sponsorId: 'expedite', role: 'Venue partner', ...GROK_HACK },
]
