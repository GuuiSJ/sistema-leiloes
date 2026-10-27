import assert from 'node:assert/strict'
import { before, after, afterEach, it } from 'node:test'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'

let server, realtime, api, Indicator, Form, Context
const originalFetch = globalThis.fetch, watches = []
const lotId = '11111111-1111-4111-8111-111111111111', auctionId = '22222222-2222-4222-8222-222222222222'
const bidId = '33333333-3333-4333-8333-333333333333'
const payload = { lotId, bidId, sequence: 1, amount: '100.01', createdAt: '2030-01-01T12:00:00Z' }
class FakeSocket {
  connected = false; handlers = new Map(); sent = []; connects = 0; disconnects = 0
  on(name, fn) { const set = this.handlers.get(name) ?? new Set(); set.add(fn); this.handlers.set(name, set) }
  off(name, fn) { this.handlers.get(name)?.delete(fn) }
  emit(...args) { this.sent.push(args) }
  connect() { this.connects++; this.connected = true; this.receive('connect') }
  disconnect() { this.disconnects++; this.connected = false }
  receive(name, ...args) { for (const fn of this.handlers.get(name) ?? []) fn(...args) }
  ack(value = { ok: true, lotId }) { this.sent.filter(([name]) => name === 'lot:join').at(-1)[2](value) }
  drop() { this.connected = false; this.receive('disconnect', 'transport close') }
}
function start(changed) {
  const socket = new FakeSocket(), changes = [], states = []
  const watch = realtime.watchLot(socket, lotId, auctionId, () => { changes.push(true); changed?.() }, state => states.push(state))
  watches.push(watch)
  return { socket, watch, changes, states }
}
before(async () => {
  server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  realtime = await server.ssrLoadModule('/src/services/lot-realtime.ts')
  api = await server.ssrLoadModule('/src/services/auctions.ts')
  Indicator = (await server.ssrLoadModule('/src/components/auctions/LiveConnection.tsx')).LiveConnection
  Form = (await server.ssrLoadModule('/src/components/auctions/BidForm.tsx')).BidForm
  Context = (await server.ssrLoadModule('/src/components/auth/auth-context.ts')).AuthContext
})
afterEach(() => { watches.splice(0).forEach(watch => watch.stop()); globalThis.fetch = originalFetch })
after(async () => { await server.close() })

it('joins exactly the displayed lot with the actual public contract and waits for acknowledgement', () => {
  const { socket, changes, states } = start()
  assert.equal(socket.connects, 1); assert.deepEqual(socket.sent[0].slice(0, 2), ['lot:join', { lotId }])
  socket.receive('bid:created', payload); assert.equal(changes.length, 0)
  socket.ack(); assert.equal(changes.length, 1); assert.equal(states.at(-1), 'connected')
  assert(!JSON.stringify(socket.sent).includes('Bearer'))
})
it('valid bids refresh once; duplicate bids and wrong lots are ignored', () => {
  const { socket, changes } = start(); socket.ack()
  socket.receive('bid:created', payload); socket.receive('bid:created', payload)
  socket.receive('bid:created', { ...payload, lotId: auctionId })
  assert.equal(changes.length, 2)
})
it('invalid monetary values, sequences, identifiers and dates never invalidate or enter UI', () => {
  const { socket, changes } = start(); socket.ack()
  for (const invalid of [null, [], {}, { ...payload, amount: 100.01 }, { ...payload, amount: '1e3' }, { ...payload, amount: '0.00' }, { ...payload, sequence: -1 }, { ...payload, sequence: 1.5 }, { ...payload, bidId: 'bad' }, { ...payload, createdAt: 'bad' }]) socket.receive('bid:created', invalid)
  assert.equal(changes.length, 1)
})
it('out-of-order bids only request authoritative GET data instead of applying stale values', () => {
  const { socket, changes } = start(); socket.ack()
  socket.receive('bid:created', { ...payload, sequence: 5 })
  socket.receive('bid:created', { ...payload, bidId: auctionId, sequence: 3 })
  assert.equal(changes.length, 3)
})
it('handles extensions and lot/auction closing using only existing message shapes', () => {
  const { socket, changes } = start(); socket.ack()
  const extension = { lotId, previousEndsAt: '2030-01-01T12:00:00Z', endsAt: '2030-01-01T12:02:00Z', triggerBidId: bidId }
  socket.receive('lot:extended', extension); socket.receive('lot:extended', extension)
  socket.receive('lot:extended', { ...extension, endsAt: '2029-01-01T12:00:00Z' })
  socket.receive('lot:closed', { lotId, auctionId, status: 'SOLD', closedAt: payload.createdAt })
  socket.receive('auction:closed', { auctionId, status: 'CLOSED', closedAt: payload.createdAt })
  socket.receive('auction:closed', { auctionId: lotId, status: 'CLOSED', closedAt: payload.createdAt })
  assert.equal(changes.length, 4)
})
it('rejoins and requests recovery after every reconnect even if there were no new events', () => {
  const { socket, changes, states } = start(); socket.ack(); socket.drop()
  assert.equal(states.at(-1), 'reconnecting')
  socket.connect(); socket.ack(); assert.equal(changes.length, 2)
  assert.equal(socket.sent.filter(([name]) => name === 'lot:join').length, 2)
})
it('consumes each room acknowledgement once without repeating recovery GETs', () => {
  const { socket, changes, states } = start()
  socket.ack(); socket.ack()
  assert.equal(changes.length, 1)
  socket.ack({ ok: false, error: { code: 'NOT_FOUND' } })
  assert.equal(states.at(-1), 'connected')
})
it('ignores expired acknowledgements and recovers only after a fresh join', context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const { socket, watch, changes, states } = start()
  const expiredAck = socket.sent[0][2]
  context.mock.timers.tick(8000)
  assert.equal(states.at(-1), 'unavailable')
  expiredAck({ ok: true, lotId })
  socket.receive('bid:created', payload)
  assert.equal(changes.length, 0)
  watch.retry(); socket.ack()
  assert.equal(states.at(-1), 'connected')
  assert.equal(changes.length, 1)
})
it('discards prior connection acknowledgements after reconnecting', () => {
  const { socket, changes, states } = start()
  const oldAck = socket.sent[0][2]
  socket.drop(); socket.connect()
  oldAck({ ok: true, lotId })
  assert.equal(changes.length, 0)
  assert.equal(states.at(-1), 'connecting')
  socket.ack()
  assert.equal(changes.length, 1)
})
it('rejected subscriptions and connection failures stay unavailable and allow explicit retry', () => {
  const { socket, watch, states } = start()
  socket.ack({ ok: false, error: { code: 'NOT_FOUND', message: 'private details' } }); assert.equal(states.at(-1), 'unavailable')
  watch.retry(); socket.ack(); assert.equal(states.at(-1), 'connected')
  socket.receive('connect_error', new Error('private details')); assert.equal(states.at(-1), 'reconnecting')
})
it('cleanup leaves the room, removes every owned listener and discards delayed callbacks', () => {
  const { socket, watch, changes } = start(), ack = socket.sent[0][2]
  watch.stop(); const count = changes.length
  ack({ ok: true, lotId }); socket.receive('bid:created', payload); watch.retry()
  assert.equal(changes.length, count); assert.equal(socket.disconnects, 1)
  assert.equal([...socket.handlers.values()].reduce((sum, set) => sum + set.size, 0), 0)
  assert(socket.sent.some(([name, data]) => name === 'lot:leave' && data.lotId === lotId))
  watch.stop(); assert.equal(socket.disconnects, 1)
})
it('switching lots or StrictMode remount cleans the prior connection before starting another', () => {
  const first = start(); first.watch.stop(); const second = start(); second.socket.ack()
  first.socket.receive('bid:created', payload); assert.equal(first.changes.length, 0)
  assert.equal(second.socket.connects, 1)
})
it('recovery uses GET to retrieve bids missed while disconnected, without posting', async () => {
  let amount = '100.00', sequence = 1
  const requests = [], snapshots = []
  globalThis.fetch = async (url, options) => {
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined)
    return Response.json({ data: [{ id: bidId, lotId, amount, sequence, createdAt: payload.createdAt }], pagination: { page: 1, limit: 10, total: 1, totalPages: 1 } })
  }
  const { socket } = start(() => requests.push(api.getBidHistory(lotId, 1, new AbortController().signal).then(result => snapshots.push(result))))
  socket.ack(); await requests.at(-1); socket.drop(); amount = '150.01'; sequence = 4
  socket.connect(); socket.ack(); await requests.at(-1)
  assert.equal(snapshots.at(-1).data[0].amount, '150.01'); assert.equal(snapshots.at(-1).data[0].sequence, 4)
})
it('connection indicator never claims live updates when disconnected, failed or syncing', () => {
  for (const props of [{ connection: 'reconnecting', updating: false, failed: false }, { connection: 'connected', updating: true, failed: false }, { connection: 'connected', updating: false, failed: true }]) {
    const html = renderToString(createElement(Indicator, { ...props, retry() {} }))
    assert.doesNotMatch(html, /Acompanhamento em tempo real conectado/); assert.match(html, /podem estar desatualizados/)
  }
})
it('BIDDER form cannot enable a new bid while live data is unsynchronized', () => {
  const snapshot = { status: 'authenticated', user: { id: 'fixture', role: 'BIDDER' } }
  const session = { getSnapshot: () => snapshot, subscribe: () => () => {}, withSession: () => { throw Error('no financial requests') } }
  const html = renderToString(createElement(Context.Provider, { value: session }, createElement(MemoryRouter, null, createElement(Form, { auction: { status: 'OPEN' }, lot: { id: lotId, status: 'OPEN' }, syncReady: false, revision: 1 }))))
  assert.match(html, /Aguardando sincronização/); assert.match(html, /input[^>]*disabled/)
})
