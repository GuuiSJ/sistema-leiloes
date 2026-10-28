import assert from 'node:assert/strict'
import { before, after, afterEach, it } from 'node:test'
import { createServer } from 'vite'
let server, bids, Confirmation
const original = globalThis.fetch, signal = () => new AbortController().signal
before(async () => { server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' }); bids = await server.ssrLoadModule('/src/services/bids.ts'); Confirmation = (await server.ssrLoadModule('/src/components/auctions/BidConfirmation.tsx')).BidConfirmation })
afterEach(() => { globalThis.fetch = original })
after(async () => { await server.close() })
it('converts reais exactly, including Decimal maximum, and rejects ambiguous formats', () => {
  assert.equal(bids.parseBidAmount('9999999999999999,99'), '9999999999999999.99')
  assert.equal(bids.parseBidAmount('0,01'), '0.01'); assert.equal(bids.parseBidAmount('123,4'), '123.40')
  for (const value of ['0', '-1', '1.000,00', '1.10', '1e3', '1,001', '10000000000000000', '01']) assert.equal(bids.parseBidAmount(value), null)
})
it('reads eligibility with Bearer only and no financial operation', async () => {
  globalThis.fetch = async (url, options) => { assert.match(url, /\/bids\/eligibility$/); assert.equal(options.method, 'GET'); assert.equal(options.body, undefined); assert.equal(options.headers.Authorization, 'Bearer synthetic'); return Response.json({ eligible: false, reason: 'LEGACY' }) }
  assert.equal((await bids.getBidEligibility('lot', 'synthetic', signal())).eligible, false)
})
it('positive eligibility requires validated monetary and date fields', async () => {
  globalThis.fetch = async () => Response.json({ eligible: true })
  await assert.rejects(bids.getBidEligibility('lot', 'synthetic', signal()))
})
it('never posts until the attempt is explicitly invoked, preserves key on uncertain retry', async () => {
  let calls = 0
  globalThis.fetch = async (url, options) => {
    calls++; assert.match(url, /\/bids$/); assert.equal(options.headers['Idempotency-Key'], 'fixed-key'); assert.equal(options.body, '{"amount":"100.01"}')
    assert.equal(options.method, 'POST'); assert(!url.includes('synthetic'))
    if (calls === 1) throw new Error('network')
    return Response.json({ bid: { id: 'bid', lotId: 'lot', amount: '100.01' }, replayed: true })
  }
  const attempt = bids.createBidAttempt('lot', '100.01', 'fixed-key'); assert.equal(calls, 0)
  await assert.rejects(attempt('synthetic', signal())); assert.equal((await attempt('synthetic', signal())).replayed, true)
})
it('duplicate concurrent clicks cause only one POST', async () => {
  let resolve, calls = 0
  globalThis.fetch = async () => { calls++; return new Promise(done => { resolve = done }) }
  const attempt = bids.createBidAttempt('lot', '100.00', 'key'), first = attempt('synthetic', signal())
  await assert.rejects(attempt('synthetic', signal()), /já está/); assert.equal(calls, 1)
  resolve(Response.json({ bid: { id: 'bid', lotId: 'lot', amount: '100.00' }, replayed: false })); await first
})
it('handles expired session, permission, changed minimum/balance/deadline and unavailable service without raw errors', async () => {
  for (const status of [400, 401, 403, 409, 500]) {
    globalThis.fetch = async () => Response.json({ message: 'private detail' }, { status })
    await assert.rejects(bids.createBidAttempt('lot', '100.00', 'key')('synthetic', signal()), error => error.status === status && !error.message.includes('private'))
  }
})
it('pending intent retains amount/key across reload and is isolated by user and lot, without JWT', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  bids.savePendingBid('user', 'lot', { amount: '100.01', key: 'same-key' }, storage)
  assert.deepEqual(bids.readPendingBid('user', 'lot', storage), { amount: '100.01', key: 'same-key' })
  assert.equal(bids.readPendingBid('other', 'lot', storage), null); assert.equal(bids.readPendingBid('user', 'other', storage), null)
  bids.clearPendingBid('user', 'lot', storage); assert.equal(values.size, 0)
})
it('serialization conflict explicitly retains the same attempt and key for retry', async () => {
  globalThis.fetch = async () => Response.json({ message: 'Conflito entre lances. Reenvie com a mesma chave de idempotência.' }, { status: 409 })
  await assert.rejects(bids.createBidAttempt('lot', '100.00', 'key')('synthetic', signal()), error => error.status === 409 && error.retrySameKey)
})
it('confirmation includes exact amount, vehicle, lot and reservation warning without dispatching', async () => {
  const { createElement } = await import('react'), { renderToString } = await import('react-dom/server')
  let calls = 0
  const props = { lot: { number: 7, vehicle: { brand: 'Marca', model: 'Modelo' } }, amount: '1500.01', busy: false, uncertain: false, onConfirm: () => calls++, onCancel: () => {} }
  const html = renderToString(createElement(Confirmation, props))
  assert.match(html, /Marca/); assert.match(html, /Lote <!-- -->7/); assert.match(html, /1\.500,01/); assert.match(html, /reservar créditos/); assert.equal(calls, 0)
  const uncertain = renderToString(createElement(Confirmation, { ...props, uncertain: true, busy: true }))
  assert.match(uncertain, /button[^>]*disabled/); assert.doesNotMatch(uncertain, />Voltar</)
})
