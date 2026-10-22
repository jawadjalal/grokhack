// Which scraped events Backer keeps: tech or startup events held in London
// (lib/scrape/eval/RUBRIC.md). Both checks read only what the source gave us.
import { looksTech } from './sources/luma'
import type { RawEvent } from './sources/types'

// Luma and Meetup category names that mean tech on their own.
const TECH_CATEGORY = /^(?:ai|tech|technology|crypto|web3|data|software|startups?|artificial intelligence)$/i

// Organiser-chosen tags ('Science & Technology', 'Ai' on a nature walk) and sales-copy
// descriptions say little here, so only the name and organiser count.
const LOOSE_TAG_SOURCES = new Set(['eventbrite'])

// Every listing on these sites is a hackathon or builder event.
const HACKATHON_SOURCES = new Set(['devpost', 'mlh', 'hackclub'])

// Not something a tech company sponsors, whatever the topic: paid courses and
// certifications, online sessions, general business networking, kids' classes, faith.
const OFF_TOPIC = /\b(?:courses?|certification|instructor-led|online|business networking|property|real estate|ages? \d+|dajjal|sermon|bible|quran|church|mosque|halaqa|seniors?|over 60s|year \d+(?:\s*-\s*\d+)?|kids|children|1-to-1|one-to-one|masterclass|book (?:talk|launch|club)|trading|beauty)\b/i

// Common English words that STRONG_TECH and looksTech also know ('how we react',
// 'data skills', 'tea & tech'). On loose-tag sources they don't count alone.
const WEAK_TITLE_WORDS = /\b(?:react|data|code|tech|techs|technology|founders?|security|cloud|analytics|digital|innovation|automation|computers?|computing|robots?|ventures?|investors?)\b/gi

// A title that names the tech itself, so an activity word can't outvote it
// ("AI Movie Club" stays in; "Startups RunClub" does not).
const STRONG_TECH = /\b(?:ai|a\.i\.|ml|llms?|gen ?ai|machine learning|agents?|agentic|hack(?:s|ing|ers?|athons?)?|buildathons?|game jams?|devs?|developers?|engineers?|engineering|software|code|coding|programming|data|crypto|web3|blockchain|robotics|cyber ?security|open[- ]source|python|javascript|typescript|react|rust)\b/i

// The activity is the point: sport, outdoors, arts, food, parties (RUBRIC "Out").
const ACTIVITY = /\b(?:run ?club|runclub|running|runners?|5k|10k|park ?run|marathon|yoga|pilates|fitness|workout|gym|bootcamp class|hike|hiking|walk|walking|stroll|ramble|picnic|cycling|cycle ride|bike ride|swim|swimming|padel|tennis|football|five-a-side|climbing|bouldering|sauna|cold plunge|wellness|meditation|breathwork|poker|karaoke|comedy|stand-?up|open mic|gig|concert|dj|rave|club night|party|gala|wine|cocktails?|brunch|supper club|dinner party|tasting|matcha|coffee rave|dating|singles|speed dating|book club|reading club|film screening|cinema|theatre|art class|painting|pottery|life drawing|crochet|knitting|language exchange|prayer|worship)\b/i
// Tech words strict enough to trust in a description (no 'data', 'code', 'security').
const BODY_TECH = /\b(?:ai|artificial intelligence|machine learning|llms?|gen ?ai|agentic|ai agents?|hackathons?|hackers?|buildathons?|developers?|software|engineers?|engineering|programming|coding|startups?|start-ups?|founders?|tech|technology|crypto|web3|blockchain|robotics|cyber ?security|open[- ]source|saas|devops)\b/i

// Platform and stack words looksTech doesn't know (Londroid, D365 user groups).
const STACK = /\b(?:android|ios|kotlin|swiftui|flutter|java|jvm|scala|golang|dotnet|sql|postgres(?:ql)?|graphql|linux|devsecops|sre|dynamics 365|d365|power platform|power apps|salesforce|mobile dev(?:elopment)?|game dev(?:elopment)?|unreal engine)\b/i
const ACTIVITY_CATEGORY = /^(?:fitness|running|sports?|wellness|health & wellness|outdoors?|arts? & culture|arts?|music|comedy|food & drink|food|drinks?|nightlife|dating|faith|spirituality|language)$/i

// London postcode areas (EC1A 1BB, SE1 8ND, W1, ...), for addresses without the word London.
const LONDON_POSTCODE = /\b(?:EC|WC|E|N|NW|SE|SW|W)\d{1,2}[A-Z]?\s*\d[A-Z]{2}\b/
const NOT_UK_LONDON = /\b(?:ontario|canada)\b|,\s*ON\b/i
const LONDON = { lat: 51.5072, lng: -0.1276 }
const LONDON_KM = 30

export function isTech(ev: RawEvent): boolean {
  if (HACKATHON_SOURCES.has(ev.source)) return true
  const categories = LOOSE_TAG_SOURCES.has(ev.source) ? [] : (ev.categories ?? []).map(c => c.trim())
  if (ev.source === 'builderbase' && categories.some(c => /hackathon/i.test(c))) return true
  if (offTopic(ev)) return false
  // Eventbrite titles must name the tech with a word that isn't everyday English.
  const name = LOOSE_TAG_SOURCES.has(ev.source) ? ev.name.replace(WEAK_TITLE_WORDS, ' ') : ev.name
  if (STRONG_TECH.test(name)) return true
  if (ACTIVITY.test(ev.name) || categories.some(c => ACTIVITY_CATEGORY.test(c))) return false
  if (categories.some(c => TECH_CATEGORY.test(c))) return true
  // Name, organiser and categories may use the broad word list; the description only the strict one.
  const organiser = LOOSE_TAG_SOURCES.has(ev.source) ? (ev.organiser ?? '').replace(WEAK_TITLE_WORDS, ' ') : ev.organiser ?? ''
  const head = [name, organiser, categories.join(' ')].join('\n')
  if (looksTech(head) || STACK.test(head)) return true
  if (LOOSE_TAG_SOURCES.has(ev.source)) return false
  const body = (ev.description ?? '').slice(0, 400)
  return BODY_TECH.test(body) || STACK.test(body)
}

// Paid courses, kids' classes, faith and the like: never sponsorable, whatever a classifier says.
export function offTopic(ev: RawEvent): boolean {
  return OFF_TOPIC.test(ev.name)
}

export function inLondon(ev: RawEvent): boolean {
  if (ev.country && !/^(?:gb|uk|united kingdom)$/i.test(ev.country)) return false
  const place = [ev.city, ev.venue?.name, ev.venue?.address].filter(Boolean).join(', ')
  if (NOT_UK_LONDON.test(place)) return false
  if (/\blondon\b/i.test(place) || LONDON_POSTCODE.test(ev.venue?.address ?? '')) return true
  if (ev.geo) return km(ev.geo, LONDON) <= LONDON_KM
  // No place given (hidden address): only the title can say London.
  return !place && /\blondon\b|\bldn\b/i.test(ev.name)
}

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180
  const dLat = (b.lat - a.lat) * rad
  const dLng = (b.lng - a.lng) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2
  return 12742 * Math.asin(Math.sqrt(h))
}
