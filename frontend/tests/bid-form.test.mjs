import assert from 'node:assert/strict'
import { after, before, it } from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { createServer } from 'vite'

let server, Form, Context, availability, rules
const auction = { id: 'auction', status: 'OPEN' }
const lot = { id: 'lot', auctionId: 'auction', status: 'OPEN', startingPrice: '100.00', minimumIncrement: '0.10' }
before(async () => {
  server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  Form = (await server.ssrLoadModule('/src/components/auctions/BidForm.tsx')).BidForm
  Context = (await server.ssrLoadModule('/src/components/auth/auth-context.ts')).AuthContext
  availability = (await server.ssrLoadModule('/src/services/bid-eligibility.ts')).bidAvailability
  rules = await server.ssrLoadModule('/src/services/auction-rules.ts')
})
after(async () => { await server?.close() })

function render(status = 'authenticated', role = 'BIDDER', a = auction, l = lot) {
  const snapshot = { status, user: status === 'authenticated' ? { id: 'fixture', role } : null }
  const forbidden = () => { throw new Error('No network or financial operation allowed') }
  const session = { getSnapshot: () => snapshot, subscribe: () => () => {}, withSession: forbidden, refresh: forbidden }
  return renderToString(createElement(Context.Provider, { value: session }, createElement(MemoryRouter, null, createElement(Form, { auction: a, lot: l }))))
}

it('OPEN is insufficient: eligibility fails closed even with extra uncontracted fields', () => {
  assert.equal(availability(auction, lot), 'unverified')
  assert.equal(availability({ ...auction, temporalGeneration: 'UTC_V2', canBid: true }, { ...lot, canBid: true }), 'unverified')
})
it('rejects all closed, cancelled and not-open combinations', () => {
  for (const status of ['SOLD', 'UNSOLD', 'CANCELLED']) assert.equal(availability(auction, { ...lot, status }), 'closed')
  for (const status of ['CLOSED', 'CANCELLED']) assert.equal(availability({ ...auction, status }, lot), 'closed')
  for (const status of ['DRAFT', 'SCHEDULED']) assert.equal(availability({ ...auction, status }, lot), 'not-open')
  assert.equal(availability(auction, { ...lot, status: 'PENDING' }), 'not-open')
})
it('BIDDER waits for authenticated eligibility before enabling controls', () => {
  const html = render()
  assert.match(html, /Consultando elegibilidade/)
  assert.match(html, /input[^>]*disabled/)
  assert.match(html, /button[^>]*disabled/)
  assert.doesNotMatch(html, /Confirmar e enviar lance/)
})
it('anonymous users get login navigation without amount controls', () => {
  const html = render('anonymous')
  assert.match(html, /href="\/entrar"/)
  assert.doesNotMatch(html, /<input/)
})
it('AUCTIONEER cannot access bidding controls', () => {
  assert.match(render('authenticated', 'AUCTIONEER'), /Somente contas de participante/)
  assert.doesNotMatch(render('authenticated', 'AUCTIONEER'), /<input/)
})
it('restoring and unavailable sessions fail closed', () => {
  assert.match(render('restoring'), /Verificando sua sessão/)
  assert.match(render('unavailable'), /Nenhum lance será enviado/)
  for (const status of ['restoring', 'unavailable']) assert.doesNotMatch(render(status), /<input/)
})
it('closed and pending lots have no bidding input even for BIDDER', () => {
  for (const status of ['SOLD', 'UNSOLD', 'CANCELLED', 'PENDING']) assert.doesNotMatch(render('authenticated', 'BIDDER', auction, { ...lot, status }), /<input/)
})
it('repeated rendering never dispatches requests or opens a confirmation', () => {
  for (let i = 0; i < 3; i++) assert.doesNotMatch(render(), /role="dialog"|type="submit"/)
})
it('existing minimum estimate preserves exact cents and refuses unavailable history', () => {
  const latest = { lotId: lot.id, sequence: 1, amount: '9999999999999998.91' }
  assert.equal(rules.referenceNextBid(lot, latest, true), '9999999999999999.01')
  assert.equal(rules.referenceNextBid(lot, latest, false), null)
})
