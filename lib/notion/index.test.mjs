import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { push } from './index.ts'

const databaseId = '11111111-1111-1111-1111-111111111111'
const event = { name: 'London AI Night', topic: 'AI' }
const lead = {
  sponsorId: 'acme', name: 'Acme', domain: 'acme.test', kind: 'sponsor',
  score: 81, reasons: ['backs London events'], pastBackings: [],
  pitch: { subject: 'Partner with us', body: 'Hello Acme,\n\nPlease join us.' },
  suggestedTier: 'Partner', suggestedPriceGbp: 500,
}

const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
  delete process.env.NOTION_API_KEY
  delete process.env.NOTION_DATABASE_ID
})

function configured() {
  process.env.NOTION_API_KEY = 'secret_test_value'
  process.env.NOTION_DATABASE_ID = databaseId
}

test('creates a page with pipeline properties and pitch, then reuses it for an input duplicate', async () => {
  configured()
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push({ url, options, body: JSON.parse(options.body) })
    if (url.endsWith('/query')) return Response.json({ results: [], has_more: false, next_cursor: null })
    return Response.json({ url: 'https://www.notion.so/acme-page' })
  }

  const result = await push(event, [lead, { ...lead, domain: 'HTTPS://WWW.ACME.TEST/' }])
  assert.equal(requests.length, 2)
  assert.deepEqual(result.map((item) => item.notionUrl), ['https://www.notion.so/acme-page', 'https://www.notion.so/acme-page'])
  assert.equal(requests[0].body.filter.rich_text.equals, event.name)
  assert.equal(requests[1].body.properties.Domain.url, 'https://acme.test')
  assert.equal(requests[1].body.properties.Status.select.name, 'To contact')
  assert.equal(requests[1].body.properties['Price GBP'].number, 500)
  assert.match(JSON.stringify(requests[1].body.children), /Please join us/)
  assert.equal(requests[1].options.headers['Notion-Version'], '2022-06-28')
})

test('returns an existing page without writing another', async () => {
  configured()
  const requests = []
  globalThis.fetch = async (url, options) => {
    requests.push(url)
    return Response.json({
      results: [{ url: 'https://www.notion.so/existing', properties: { Domain: { url: 'https://acme.test' } } }],
      has_more: false, next_cursor: null,
    })
  }
  const result = await push(event, [lead])
  assert.deepEqual(requests, [`https://api.notion.com/v1/databases/${databaseId}/query`])
  assert.equal(result[0].notionUrl, 'https://www.notion.so/existing')
})

test('fails before a network request when server configuration is missing', async () => {
  let called = false
  globalThis.fetch = async () => { called = true; throw new Error('unexpected request') }
  await assert.rejects(push(event, [lead]), /NOTION_API_KEY/)
  assert.equal(called, false)
})

test('explains a database access error without exposing the token', async () => {
  configured()
  globalThis.fetch = async () => Response.json({ code: 'object_not_found', message: 'Could not find database' }, { status: 404 })
  await assert.rejects(push(event, [lead]), (error) => {
    assert.match(error.message, /share that database/)
    assert.doesNotMatch(error.message, /secret_test_value/)
    return true
  })
})
