// Measure the tech-event classifier against hand labels.
//   node --env-file-if-exists=.env.local --import ./scripts/register.mjs scripts/eval-tech-filter.ts [--file <path>]
// Default data: lib/scrape/eval/events.json + labels.json. --file takes one
// JSON list of events with a boolean "tech" each. Split is fixed by id:
// test = ids whose sha1 starts with 0-4 (about a third), dev = the rest.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { classifyTech, techRoute, techSignals, TECH_HIGH, TECH_LOW, TECH_MID, type TechVerdict } from '../lib/scrape/classify'
import type { RawEvent } from '../lib/scrape/sources/types'

type Labelled = Pick<RawEvent, 'source' | 'url' | 'name' | 'organiser' | 'categories' | 'description'> & { id: string; tech: boolean; why?: string }

function load(): Labelled[] {
  const i = process.argv.indexOf('--file')
  if (i > 0) {
    const rows = JSON.parse(readFileSync(process.argv[i + 1], 'utf8')) as (Omit<Labelled, 'id'> & { id?: string })[]
    return rows.map(r => ({ ...r, id: r.id ?? r.url }))
  }
  const events = JSON.parse(readFileSync('lib/scrape/eval/events.json', 'utf8')) as Omit<Labelled, 'tech'>[]
  const labels = JSON.parse(readFileSync('lib/scrape/eval/labels.json', 'utf8')) as Record<string, { tech: boolean; why: string }>
  return events.filter(e => labels[e.id]).map(e => ({ ...e, tech: labels[e.id].tech, why: labels[e.id].why }))
}

const isTest = (id: string) => '01234'.includes(createHash('sha1').update(id).digest('hex')[0])

type Counts = { tp: number; fp: number; fn: number; tn: number }

function score(rows: Labelled[], says: (r: Labelled) => boolean): Counts {
  const c = { tp: 0, fp: 0, fn: 0, tn: 0 }
  for (const r of rows) {
    const p = says(r)
    if (p && r.tech) c.tp++
    else if (p) c.fp++
    else if (r.tech) c.fn++
    else c.tn++
  }
  return c
}

const f3 = (n: number) => (Number.isFinite(n) ? n.toFixed(3) : 'n/a')

function report(title: string, c: Counts) {
  const p = c.tp / (c.tp + c.fp)
  const r = c.tp / (c.tp + c.fn)
  const f1 = (2 * p * r) / (p + r)
  console.log(`  ${title.padEnd(6)} TP ${c.tp}  FP ${c.fp}  FN ${c.fn}  TN ${c.tn}   precision ${f3(p)}  recall ${f3(r)}  F1 ${f3(f1)}`)
}

async function main() {
  const rows = load()
  const dev = rows.filter(r => !isTest(r.id))
  const test = rows.filter(r => isTest(r.id))
  console.log(`events ${rows.length} (tech ${rows.filter(r => r.tech).length})  dev ${dev.length}  test ${test.length}`)
  console.log(`rules: tech at score >= ${TECH_HIGH} with no negative signal, not tech at <= ${TECH_LOW} with no tech word in the name, Grok otherwise; rules-only cut ${TECH_MID}`)

  const ruleSays = (r: Labelled) => techSignals(r).score >= TECH_MID
  console.log('\nrules only')
  report('dev', score(dev, ruleSays))
  report('test', score(test, ruleSays))

  const t0 = Date.now()
  const verdicts = await classifyTech(rows)
  const ms = Date.now() - t0
  const v = (r: Labelled): TechVerdict | undefined => verdicts.get(r.url)
  const fullSays = (r: Labelled) => v(r)?.tech ?? false

  console.log('\nrules + Grok')
  report('dev', score(dev, fullSays))
  report('test', score(test, fullSays))

  const middle = rows.filter(r => techRoute(r) === 'grok').length
  const byGrok = rows.filter(r => v(r)?.by === 'grok').length
  const pct = (n: number) => `${((100 * n) / rows.length).toFixed(1)}%`
  console.log(`\nsent to Grok ${middle}/${rows.length} (${pct(middle)}), answered by Grok ${byGrok} (${pct(byGrok)})`)
  console.log(`wall time ${(ms / 1000).toFixed(1)}s for ${rows.length} events (${((ms / rows.length) * 100 / 1000).toFixed(1)}s per 100; cached Grok verdicts make reruns faster)`)

  const showDev = process.argv.includes('--dev-errors')
  const errorsOf = (set: Labelled[]) => set.filter(r => fullSays(r) !== r.tech)
  const print = (title: string, set: Labelled[]) => {
    const errs = errorsOf(set)
    console.log(`\n${title} errors (${errs.length})`)
    for (const r of errs) {
      const x = v(r)
      console.log(`  ${r.id}  "${r.name}"  label ${r.tech ? 'tech' : 'not tech'}  verdict ${x?.tech ? 'tech' : 'not tech'} by ${x?.by ?? 'none'} (${x?.confidence ?? '-'}): ${x?.reason ?? 'no verdict'}`)
    }
  }
  if (showDev) print('dev', dev)
  else print('test', test)
}

main()
