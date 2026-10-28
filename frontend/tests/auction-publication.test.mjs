import assert from 'node:assert/strict'
import { after, afterEach, before, it } from 'node:test'
import { createServer } from 'vite'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { chromiumPath, openChromium } from './helpers/chromium.mjs'

const id = '11111111-1111-4111-8111-111111111111'
const auction = { id, title: 'Publicação simulada', status: 'DRAFT', startsAt: '2030-01-01T12:00:00Z', endsAt: '2030-01-01T13:00:00Z' }
let server, api, eligible, Publication, Context, labels, browser, base
const originalFetch = globalThis.fetch, executable = await chromiumPath(), signal = () => new AbortController().signal
before(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-tests/auction-publication', server: { host: '127.0.0.1', port: 0, strictPort: false, ws: false }, plugins: [{ name: 'publication-test', configureServer(vite) {
    vite.middlewares.use('/__publication-test', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(await vite.transformIndexHtml('/__publication-test', '<!doctype html><html lang="pt-BR"><body><div id="root"></div><script type="module" src="/tests/helpers/auction-publication-browser.tsx"></script></body></html>'))
    })
  } }] })
  api = await server.ssrLoadModule('/src/services/auction-management.ts')
  const component = await server.ssrLoadModule('/src/components/auctioneer/AuctionPublication.tsx')
  eligible = component.publicationDateEligible; Publication = component.AuctionPublication
  Context = (await server.ssrLoadModule('/src/components/auth/auth-context.ts')).AuthContext
  labels = (await server.ssrLoadModule('/src/components/auctions/AuctionInfo.tsx')).auctionStatusLabels
  if (executable) { await server.listen(); base = `http://127.0.0.1:${server.httpServer.address().port}/__publication-test`; browser = await openChromium(executable) }
})
afterEach(() => { globalThis.fetch = originalFetch })
after(async () => { browser?.close(); await server?.close() })
it('publication uses existing PATCH /schedule, Bearer, no body, no forged status and validates SCHEDULED response', async () => {
  let calls = 0
  globalThis.fetch = async (url, init) => {
    calls++; assert.equal(new URL(url).pathname, `/api/auctions/${id}/schedule`); assert.equal(init.method, 'PATCH'); assert.equal(init.headers.Authorization, 'Bearer fixture-token'); assert.equal(init.body, undefined); assert.equal(init.headers['Content-Type'], undefined); assert.equal(init.credentials, 'omit')
    return Response.json({ auction: { ...auction, status: 'SCHEDULED' }, openedLots: 0, unchanged: false })
  }
  assert.equal((await api.scheduleAuction(id, 'fixture-token', signal())).status, 'SCHEDULED'); assert.equal(calls, 1)
})
it('maps only recognized publication restrictions and never exposes arbitrary server errors', async () => {
  for (const [status, message, expected] of [
    [409, 'Leilão precisa de ao menos um lote válido não cancelado.', /Cadastre ao menos um lote/],
    [409, 'Agendamento exige início e término futuros e período válido.', /início e o término precisam estar no futuro/],
    [403, 'Somente o responsável pode agendar ou abrir este leilão.', /Somente o leiloeiro responsável/],
    [409, 'Leilão LEGACY ou sem geração temporal válida: operação bloqueada. Histórico disponível para consulta.', /consulta histórica/],
    [409, 'SQL private details', /Atualize os dados/],
  ]) {
    globalThis.fetch = async () => Response.json({ message }, { status })
    await assert.rejects(api.scheduleAuction(id, 'fixture-token', signal()), error => { assert.equal(error.status, status); assert.equal(error.uncertain, false); assert.match(error.message, expected); assert.doesNotMatch(error.message, /SQL/); return true })
  }
})
it('uncertain network and malformed success never retry or claim publication', async () => {
  for (const reply of [() => { throw Error('offline') }, () => Response.json({}), () => Response.json({ auction: { ...auction, status: 'OPEN' }, openedLots: 1, unchanged: false }), () => Response.json({}, { status: 503 })]) {
    let calls = 0; globalThis.fetch = async () => { calls++; return reply() }
    await assert.rejects(api.scheduleAuction(id, 'fixture-token', signal()), error => error.uncertain === true)
    assert.equal(calls, 1)
  }
})
it('expired or invalid dates and non-DRAFT states are not publication candidates', () => {
  const now = Date.parse('2030-01-01T11:00:00Z')
  assert.equal(eligible(auction, now), true)
  assert.equal(eligible(auction, Date.parse(auction.startsAt)), false)
  for (const patch of [{ startsAt: 'invalid' }, { endsAt: auction.startsAt }, { status: 'OPEN' }, { status: 'SCHEDULED' }, { status: 'CANCELLED' }]) assert.equal(eligible({ ...auction, ...patch }, now), false)
  assert.deepEqual(Object.values(labels), ['Rascunho', 'Agendado', 'Ao vivo', 'Encerrado', 'Cancelado'])
})
it('BIDDER cannot see the action and merely rendering never publishes', () => {
  globalThis.fetch = () => { throw Error('No writes during render') }
  for (const role of ['BIDDER', 'AUCTIONEER']) {
    const snapshot = { status: 'authenticated', user: { id: 'fixture', role }, message: null }
    const auth = { getSnapshot: () => snapshot, subscribe: () => () => {}, withSession() { throw Error('Not authorized in SSR') } }
    const html = renderToString(h(Context.Provider, { value: auth }, h(Publication, { auction, blocked: false, onActive() {}, onPublished() {} })))
    assert.equal(html.includes('Publicar leilão'), role === 'AUCTIONEER'); assert.doesNotMatch(html, /alertdialog/)
  }
})

const browserOptions = { skip: !executable && 'Set CHROMIUM_PATH to test the browser', timeout: 60000 }
const button = label => `[...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(label)})`
async function click(label) { await browser.evaluate(`${button(label)}.click()`) }
it('Chromium: confirmation, cancel, one publication, refreshed SCHEDULED and automatic OPEN status refresh', browserOptions, async () => {
  await browser.navigate(base)
  await browser.wait(`${button('Publicar leilão')} && !${button('Publicar leilão')}.disabled`)
  await click('Publicar leilão'); await browser.wait('!!document.querySelector("[role=alertdialog]")')
  assert.equal(await browser.evaluate('window.publicationTest.publications'), 0)
  await click('Voltar'); assert.equal(await browser.evaluate('window.publicationTest.publications'), 0)
  await click('Publicar leilão')
  await browser.evaluate(`${button('Confirmar publicação')}.click(); ${button('Confirmar publicação')}.click()`)
  await browser.wait('document.querySelector("tbody tr td:nth-child(2)")?.textContent?.includes("Agendado")')
  assert.equal(await browser.evaluate('window.publicationTest.publications'), 1)
  assert.equal(await browser.evaluate('document.body.textContent.includes("Leilão publicado como Agendado")'), true)
  await browser.evaluate('window.publicationTest.advance()')
  await browser.wait('document.querySelector("tbody")?.textContent?.includes("Ao vivo")')
  assert.equal(await browser.evaluate(`${button('Publicar leilão')} === undefined`), true)
})
it('Chromium: missing lot, foreign owner, legacy, expired date and BIDDER are blocked with clear feedback', browserOptions, async () => {
  for (const [mode, expected] of [['no-lots', 'Cadastre ao menos um lote'], ['foreign', 'Somente o leiloeiro responsável'], ['legacy', 'consulta histórica']]) {
    await browser.navigate(`${base}?mode=${mode}`)
    await browser.wait(`!!${button('Publicar leilão')}`); await click('Publicar leilão'); await click('Confirmar publicação')
    await browser.wait(`document.body?.textContent?.includes(${JSON.stringify(expected)})`)
    assert.equal(await browser.evaluate('window.publicationTest.status'), 'DRAFT')
    assert.equal(await browser.evaluate('document.body.textContent.includes("Leilão publicado como Agendado")'), false)
  }
  await browser.navigate(`${base}?mode=expired`); await browser.wait(`!!${button('Publicar leilão')}`)
  assert.equal(await browser.evaluate(`${button('Publicar leilão')}.disabled`), true)
  assert.equal(await browser.evaluate('window.publicationTest.publications'), 0)
  await browser.navigate(`${base}?mode=bidder`); await browser.wait('document.body?.textContent?.includes("Acesso não permitido")')
  assert.equal(await browser.evaluate('window.publicationTest.publications'), 0)
})
