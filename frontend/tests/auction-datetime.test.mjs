import assert from 'node:assert/strict'
import { before, after, afterEach, it } from 'node:test'
import { createServer } from 'vite'
import { createElement as h } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

let server, dates, api, Field
const originalFetch = globalThis.fetch
before(async () => {
  server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  dates = await server.ssrLoadModule('/src/services/auction-datetime.ts')
  api = await server.ssrLoadModule('/src/services/auction-management.ts')
  Field = (await server.ssrLoadModule('/src/components/auctioneer/AuctionDateTimeField.tsx')).AuctionDateTimeField
})
afterEach(() => { globalThis.fetch = originalFetch })
after(async () => { await server.close() })

it('converts Brasilia minutes with IANA offsets including historical summer time', () => {
  assert.equal(dates.auctionDateInstant('2030-12-01', '14:00'), '2030-12-01T17:00:00.000Z')
  assert.equal(dates.auctionDateInstant('2018-12-01', '14:00'), '2018-12-01T16:00:00.000Z')
  assert.equal(dates.auctionDateInstant('2018-07-01', '14:00'), '2018-07-01T17:00:00.000Z')
})
it('rejects missing values, invalid dates, DST gaps and ambiguous minutes', () => {
  for (const [date, time] of [['', '14:00'], ['2030-12-01', ''], ['2030-02-29', '14:00'], ['2030-04-31', '14:00'], ['2030-12-01', '24:00'], ['0999-01-01', '14:00'], ['2018-11-04', '00:30'], ['2019-02-16', '23:30']]) {
    assert.equal(dates.auctionDateInstant(date, time), '', `${date} ${time}`)
  }
  assert.equal(dates.auctionDateInstant('2032-02-29', '00:00'), '2032-02-29T03:00:00.000Z')
})
it('fills editing controls in Brasilia while preserving the original instant and precision', () => {
  const value = '2030-12-02T01:30:42.123Z'
  assert.deepEqual(dates.auctionDateParts(value), { date: '2030-12-01', time: '22:30' })
  const draft = api.auctionDraft({ title: 'Teste', description: '', startsAt: value, endsAt: '2030-12-02T03:00:00Z' })
  assert.equal(api.auctionInput(draft).startsAt, value)
  const html = renderToStaticMarkup(h(Field, { id: 'start', name: 'startsAt', label: 'Início do leilão', value, change() { throw Error('No automatic edits') } }))
  assert.match(html, /type="date"/); assert.match(html, /type="time"/)
  assert.match(html, /value="2030-12-01"/); assert.match(html, /value="22:30"/)
  assert.match(html, /01\/12\/2030 às 22:30 — horário de Brasília/)
  assert.doesNotMatch(html, /digite|Inclua segundos/)
})
it('validates required selections and equal or reversed ends before sending', () => {
  const startsAt = dates.auctionDateInstant('2030-12-01', '14:00')
  for (const endsAt of ['', startsAt, dates.auctionDateInstant('2030-12-01', '13:59')]) {
    assert(api.validateAuction({ title: 'Teste', description: '', startsAt, endsAt }).endsAt)
  }
})
it('sends converted instants through the unchanged POST and PATCH contract (mock HTTP only)', async () => {
  const id = '11111111-1111-4111-8111-111111111111'
  const draft = { title: 'Teste', description: 'Teste', startsAt: dates.auctionDateInstant('2030-12-01', '14:00'), endsAt: dates.auctionDateInstant('2030-12-01', '15:00') }
  const methods = []
  globalThis.fetch = async (_url, options) => {
    methods.push(options.method)
    assert.deepEqual(JSON.parse(options.body), draft)
    return Response.json({ auction: { ...draft, id, status: 'DRAFT' } })
  }
  await api.createAuction(draft, 'fixture-token', new AbortController().signal)
  await api.updateAuction(id, draft, 'fixture-token', new AbortController().signal)
  assert.deepEqual(methods, ['POST', 'PATCH'])
})
