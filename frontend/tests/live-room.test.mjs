import assert from 'node:assert/strict'
import { before, after, afterEach, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { chromiumPath, openChromium } from './helpers/chromium.mjs'

const auctionId = '11111111-1111-4111-8111-111111111111', lotId = '22222222-2222-4222-8222-222222222222', bidId = '33333333-3333-4333-8333-333333333333'
const originalFetch = globalThis.fetch, executable = await chromiumPath()
let server, browser, base, api, auctions, Timer, Position, Outcome, Card
const clock = { lotId, auctionId, lotStatus: 'OPEN', auctionStatus: 'OPEN', endsAt: '2030-01-01T12:02:00Z', checkedAt: '2030-01-01T12:00:00Z', trusted: true }
const result = { lotId, auctionId, auctionTitle: 'Meu leilão', number: 1, status: 'SOLD', vehicle: { brand: 'Fiat', model: 'Palio', year: 2014 }, finalAmount: '1000.01', winningBidId: bidId, receiptPublicId: '44444444-4444-4444-8444-444444444444' }
const page = data => ({ data, pagination: { page: 1, limit: 10, total: data.length, totalPages: data.length ? 1 : 0 } })
const signal = () => new AbortController().signal
before(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-tests/live-room', server: { host: '127.0.0.1', port: 0, strictPort: false, ws: false }, resolve: { alias: { 'socket.io-client': fileURLToPath(new URL('./helpers/live-room-socket.ts', import.meta.url)) } }, optimizeDeps: { exclude: ['socket.io-client'] }, plugins: [{
    name: 'live-room-test', configureServer(vite) { vite.middlewares.use('/__room-test', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(await vite.transformIndexHtml('/__room-test', '<!doctype html><html lang="pt-BR"><body><div id="root"></div><script type="module" src="/tests/helpers/live-room-browser.tsx"></script></body></html>'))
    }) },
  }] })
  api = await server.ssrLoadModule('/src/services/live-room.ts')
  auctions = await server.ssrLoadModule('/src/services/auctions.ts')
  Timer = (await server.ssrLoadModule('/src/components/auctions/LotCountdown.tsx')).LotCountdown
  Position = (await server.ssrLoadModule('/src/components/auctions/LotPosition.tsx')).PositionSummary
  Outcome = (await server.ssrLoadModule('/src/components/auctions/LotOutcome.tsx')).LotOutcome
  Card = (await server.ssrLoadModule('/src/pages/AuctioneerResultsPage.tsx')).AuctioneerResultCard
  if (executable) { await server.listen(); base = `http://127.0.0.1:${server.httpServer.address().port}/__room-test`; browser = await openChromium(executable) }
})
afterEach(() => { globalThis.fetch = originalFetch })
after(async () => { browser?.close(); await server?.close() })
it('clock is public, validates server trust and estimates elapsed time monotonically', async () => {
  globalThis.fetch = async (url, init) => { assert.equal(new URL(url).pathname, `/api/lots/${lotId}/clock`); assert.equal(init.method, 'GET'); assert.equal(init.headers.Authorization, undefined); return Response.json(clock) }
  const sample = await api.getRoomClock(lotId, signal()); assert.equal(sample.trusted, true)
  const fixed = { ...sample, serverAtReceipt: Date.parse(clock.checkedAt), receivedAt: 100 }
  assert.equal(api.remainingMilliseconds(fixed, 30100), 90000)
  assert.equal(api.remainingMilliseconds(fixed, 200100), 0)
  assert.equal(api.countdownText(90000), '00:01:30')
  assert.equal(api.countdownText(1), '00:00:01')
  globalThis.fetch = async () => Response.json({ ...clock, trusted: 'yes' })
  await assert.rejects(api.getRoomClock(lotId, signal()))
})
it('private position and owner results use GET with Bearer and no caller-supplied identity', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(init.method, 'GET'); assert.equal(init.headers.Authorization, 'Bearer fixture-token'); assert.equal(init.body, undefined); assert.equal(init.credentials, 'omit')
    const target = new URL(url); assert.equal(target.searchParams.has('userId'), false)
    return Response.json(target.pathname.endsWith('/position') ? { lotId, lotStatus: 'OPEN', status: 'LEADING', latestBidId: bidId, checkedAt: clock.checkedAt } : page([result]))
  }
  assert.equal((await api.getLotPosition(lotId, 'fixture-token', signal())).status, 'LEADING')
  assert.equal((await api.getLotResults(1, auctionId, 'fixture-token', signal())).data[0].finalAmount, '1000.01')
})
it('rejects unsupported positions, foreign results, wrong final amounts and malformed receipts', async () => {
  globalThis.fetch = async () => Response.json({ lotId, lotStatus: 'SOLD', status: 'LEADING', latestBidId: bidId, checkedAt: clock.checkedAt })
  await assert.rejects(api.getLotPosition(lotId, 'fixture-token', signal()))
  for (const change of [{ finalAmount: 1000.01 }, { status: 'UNSOLD' }, { receiptPublicId: 'fake' }, { auctionId: result.receiptPublicId }]) {
    globalThis.fetch = async () => Response.json(page([{ ...result, ...change }]))
    await assert.rejects(api.getLotResults(1, auctionId, 'fixture-token', signal()))
  }
  for (const status of [401, 403, 404, 503]) {
    globalThis.fetch = async () => Response.json({ message: 'private SQL error' }, { status })
    await assert.rejects(api.getLotResults(1, undefined, 'fixture-token', signal()), error => { assert.equal(error.status, status); assert.doesNotMatch(error.message, /SQL/); return true })
  }
})
it('only renders countdown for a synchronized UTC clock; never equates zero with a settled result', () => {
  const auction = { id: auctionId, status: 'OPEN' }, lot = { id: lotId, auctionId, status: 'OPEN', endsAt: clock.endsAt }
  for (const sample of [null, { ...clock, trusted: false }, { ...clock, lotId: bidId }]) {
    const html = renderToString(h(Timer, { auction, lot, clock: sample })); assert.doesNotMatch(html, /role="timer"/)
  }
  const sample = { ...clock, receivedAt: performance.now(), serverAtReceipt: Date.parse(clock.endsAt) }
  const html = renderToString(h(Timer, { auction, lot, clock: sample }))
  assert.match(html, /00:00:00/); assert.match(html, /Aguardando confirmação/); assert.doesNotMatch(html, /Lote ou leilão encerrado/)
})
it('renders personal states and only confirmed final outcomes, without winner personal data', () => {
  for (const [status, label] of [['NONE', /ainda não participou/], ['LEADING', /liderando/], ['OUTBID', /superado/], ['WON', /arrematou/]]) assert.match(renderToString(h(Position, { position: { status } })), label)
  const lot = { status: 'SOLD', result: { status: 'SOLD', finalAmount: '1000.01', winningBidId: bidId } }
  assert.match(renderToString(h(Outcome, { lot })), /1\.000,01/)
  assert.match(renderToString(h(Outcome, { lot: { status: 'SOLD', result: null } })), /ainda não pôde ser confirmado/)
  assert.match(renderToString(h(Outcome, { lot: { status: 'UNSOLD' } })), /sem vencedor/)
  const html = renderToString(h(MemoryRouter, {}, h(Card, { result })))
  assert.match(html, /1\.000,01/); assert(html.includes(`/auditoria/${lotId}`)); assert(html.includes(`/comprovantes/${result.receiptPublicId}`)); assert.doesNotMatch(html, /winnerId|email|CPF/)
  assert.equal(auctions.isLot({ id: lotId, auctionId, number: 1, status: 'SOLD', startingPrice: '1000.00', minimumIncrement: '10.00', endsAt: clock.endsAt, vehicle: { id: bidId, brand: 'Fiat', model: 'Palio', year: 2014, version: null, imageUrls: [] }, result: { ...lot.result, finalAmount: 1000 } }), false)
})

const browserOptions = { skip: !executable && 'Set CHROMIUM_PATH to run browser integration', timeout: 60000 }
it('Chromium: live bid, extension, reconnect and closure update actual room fields without financial writes', browserOptions, async () => {
  await browser.navigate(base)
  await browser.wait('document.body?.textContent?.includes("Você está liderando")')
  await browser.wait('!!document.querySelector("[role=timer]")')
  const before = await browser.evaluate('document.querySelector("[role=timer]").textContent')
  await browser.wait(`!!document.querySelector('form[aria-label="Preparar lance"] input:not([disabled])')`)
  await browser.evaluate(`(() => { const input = document.querySelector('form[aria-label="Preparar lance"] input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '1000,00'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await browser.evaluate(`document.querySelector('form[aria-label="Preparar lance"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))`)
  await browser.wait('document.body?.textContent?.includes("Informe um valor igual ou superior")')
  await browser.evaluate('window.roomTest.advance()')
  await browser.wait('document.body?.textContent?.includes("Seu lance foi superado")')
  await browser.wait('document.body?.textContent?.includes("1.050,00")')
  const after = await browser.evaluate('document.querySelector("[role=timer]").textContent')
  assert(after > before, `extension must increase countdown: ${before} -> ${after}`)
  await browser.evaluate('window.roomTest.socket.connected = false; window.roomTest.socket.receive("disconnect", "transport close")')
  await browser.wait('!document.querySelector("[role=timer]")')
  await browser.evaluate('window.roomTest.socket.connect()')
  await browser.wait('!!document.querySelector("[role=timer]")')
  await browser.evaluate('window.roomTest.close()')
  await browser.wait('document.body?.textContent?.includes("Valor final confirmado")')
  await browser.wait('document.body?.textContent?.includes("Lote encerrado com outro vencedor")')
  assert.equal(await browser.evaluate('!!document.querySelector("[role=timer]")'), false)
  assert.equal(await browser.evaluate(`!!document.querySelector('form[aria-label="Preparar lance"]')`), false)
  assert.equal(await browser.evaluate('window.roomTest.writes'), 0)
})
it('Chromium: no-participation and legacy clock are explicit; owner results show sold, unsold, empty and error', browserOptions, async () => {
  for (const [query, expected] of [['mode=none', 'Você ainda não participou'], ['mode=legacy', 'Contagem regressiva indisponível'], ['owner=1', 'Valor final confirmado'], ['owner=1&mode=empty', 'Nenhum registro'], ['owner=1&mode=error', 'A consulta não foi permitida']]) {
    await browser.navigate(`${base}?${query}`)
    await browser.wait(`document.body?.textContent?.includes(${JSON.stringify(expected)})`)
    if (query === 'owner=1') {
      assert.equal(await browser.evaluate('document.body.textContent.includes("Encerrado sem vencedor")'), true)
      assert.equal(await browser.evaluate(`!!document.querySelector('a[href="/auditoria/${lotId}"]')`), true)
    }
    if (query === 'mode=legacy') assert.equal(await browser.evaluate('!!document.querySelector("[role=timer]")'), false)
    assert.equal(await browser.evaluate('window.roomTest.writes'), 0)
  }
})
