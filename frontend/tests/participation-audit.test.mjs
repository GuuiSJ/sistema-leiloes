import assert from 'node:assert/strict'
import { after, afterEach, before, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { createServer } from 'vite'
import { chromiumPath, openChromium } from './helpers/chromium.mjs'

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/participation-audit.json', import.meta.url), 'utf8'))
const { participation: p, receipt, audit } = fixtures
const envelope = data => ({ data, pagination: { page: 1, limit: 10, total: data.length, totalPages: data.length ? 1 : 0 } })
const signal = () => new AbortController().signal
const originalFetch = globalThis.fetch
let server, api, Card, Receipt, Integrity, App, Context, ThemeContext, browser, base
const executable = await chromiumPath()
before(async () => {
  server = await createServer({ server: { host: '127.0.0.1', port: 0, strictPort: false, ws: false }, plugins: [{
    name: 'participation-browser-test', configureServer(vite) {
      vite.middlewares.use('/__participation-test', async (_req, res) => {
        res.setHeader('Content-Type', 'text/html; charset=utf-8')
        res.end(await vite.transformIndexHtml('/__participation-test', '<!doctype html><html lang="pt-BR"><body><div id="root"></div><script type="module" src="/tests/helpers/participation-audit-browser.tsx"></script></body></html>'))
      })
    },
  }] })
  api = await server.ssrLoadModule('/src/services/participation-audit.ts')
  Card = (await server.ssrLoadModule('/src/pages/MyAcquisitionsPage.tsx')).ParticipationCard
  Receipt = (await server.ssrLoadModule('/src/pages/PublicReceiptPage.tsx')).ReceiptContent
  Integrity = (await server.ssrLoadModule('/src/pages/PublicAuditPage.tsx')).IntegrityResult
  App = (await server.ssrLoadModule('/src/App.tsx')).App
  Context = (await server.ssrLoadModule('/src/components/auth/auth-context.ts')).AuthContext
  ThemeContext = (await server.ssrLoadModule('/src/components/theme/theme-context.ts')).ThemeContext
  if (executable) { await server.listen(); base = `http://127.0.0.1:${server.httpServer.address().port}/__participation-test`; browser = await openChromium(executable) }
})
afterEach(() => { globalThis.fetch = originalFetch })
after(async () => { browser?.close(); await server?.close() })
function render(element, path = '/minha-conta/arremates', role = 'BIDDER', status = 'authenticated') {
  const snapshot = { status, user: status === 'authenticated' ? { id: 'fixture', name: 'Teste', role } : null, message: null }
  const auth = { getSnapshot: () => snapshot, subscribe: () => () => {}, refresh() {}, logout() {}, withSession() { throw Error('No real requests') } }
  return renderToString(h(ThemeContext.Provider, { value: { theme: 'light', toggleTheme() {} } }, h(Context.Provider, { value: auth }, h(MemoryRouter, { initialEntries: [path] }, element))))
}
it('loads only the authenticated participation endpoint using GET and no client-supplied user identifier', async () => {
  globalThis.fetch = async (url, init) => {
    const target = new URL(url); assert.equal(target.pathname, '/api/me/participations'); assert.deepEqual(Object.fromEntries(target.searchParams), { page: '1', limit: '10' })
    assert.equal(init.method, 'GET'); assert.equal(init.headers.Authorization, 'Bearer fixture-token'); assert.equal(init.credentials, 'omit'); assert.equal(init.body, undefined)
    return Response.json(envelope([p]))
  }
  assert.deepEqual(await api.getParticipations(1, 'fixture-token', signal()), envelope([p]))
})
it('validates results, exact amounts and pagination and never turns invalid data into a win', async () => {
  for (const changes of [{ outcome: 'WON', lot: { ...p.lot, status: 'OPEN' } }, { finalAmount: 1000.01 }, { myBid: { ...p.myBid, amount: '1.000,01' } }, { outcome: 'NOT_WON', receiptPublicId: receipt.publicId }]) {
    globalThis.fetch = async () => Response.json(envelope([{ ...p, ...changes }]))
    await assert.rejects(api.getParticipations(1, 'fixture-token', signal()), /não puderam ser validados/)
  }
  globalThis.fetch = async () => Response.json({ ...envelope([p]), pagination: { page: 2, limit: 10, total: 1, totalPages: 1 } })
  await assert.rejects(api.getParticipations(1, 'fixture-token', signal()))
})
it('public receipt and audit reads never send credentials and validate the requested identifiers', async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(init.method, 'GET'); assert.equal(init.headers.Authorization, undefined); assert.equal(init.credentials, 'omit')
    return Response.json(new URL(url).pathname.startsWith('/api/receipts/') ? { receipt } : audit)
  }
  assert.deepEqual(await api.getPublicReceipt(receipt.publicId, signal()), receipt)
  assert.deepEqual(await api.getPublicAudit(p.lot.id, 1, signal()), audit)
  globalThis.fetch = async () => Response.json({ receipt: { ...receipt, publicId: p.lot.id } })
  await assert.rejects(api.getPublicReceipt(receipt.publicId, signal()))
  globalThis.fetch = () => { throw Error('Invalid UUID must not reach the network') }
  await assert.rejects(api.getPublicReceipt('bad', signal())); await assert.rejects(api.getPublicAudit('bad', 1, signal()))
})
it('rejects unsupported integrity claims and data from a different lot', async () => {
  for (const change of [{ lotId: receipt.publicId }, { integrity: { ...audit.integrity, scope: 'ALL_BIDS_SIGNED' } }, { integrity: { ...audit.integrity, status: 'VALID', eventsChecked: 0 } }, { data: [{ ...audit.data[0], entityId: receipt.publicId }] }, { integrity: { ...audit.integrity, status: 'INVALID' } }]) {
    globalThis.fetch = async () => Response.json({ ...audit, ...change })
    await assert.rejects(api.getPublicAudit(p.lot.id, 1, signal()))
  }
})
it('reports missing receipts, permissions and unavailable reads without exposing server details', async () => {
  for (const status of [401, 403, 404, 503]) {
    globalThis.fetch = async () => Response.json({ message: 'private SQL secret' }, { status })
    await assert.rejects(api.getParticipations(1, 'fixture-token', signal()), error => { assert.equal(error.status, status); assert.doesNotMatch(error.message, /SQL|secret/); return true })
  }
  globalThis.fetch = async () => { throw Error('offline') }
  await assert.rejects(api.getPublicAudit(p.lot.id, 1, signal()), /Nenhuma informação pôde ser confirmada/)
})
it('renders actual participation, public receipt links and explicit integrity limitations', () => {
  let html = render(h(Card, { participation: p }))
  assert.match(html, /Arrematado por você/); assert.match(html, /1\.000,01/); assert.match(html, /Fiat/); assert.match(html, /Palio/)
  assert(html.includes(`/comprovantes/${receipt.publicId}`)); assert(html.includes(`/auditoria/${p.lot.id}`))
  html = render(h(Card, { participation: { ...p, receiptPublicId: null } })); assert.match(html, /ainda não está disponível/); assert.doesNotMatch(html, /href="\/comprovantes/)
  html = render(h(Receipt, { receipt })); assert.match(html, /Link compartilhável/); assert.match(html, /Informações pessoais do vencedor não são divulgadas/)
  for (const status of ['INVALID', 'UNAVAILABLE']) {
    html = render(h(Integrity, { integrity: { ...audit.integrity, status } })); assert.match(html, /role="alert"/); assert.match(html, /Integridade não confirmada/); assert.doesNotMatch(html, /Integridade da cadeia confirmada/)
  }
  assert.match(render(h(Integrity, { integrity: audit.integrity })), /não é assinado por esta verificação/)
})
it('guards Meus arremates while keeping auditoria and comprovantes public', () => {
  globalThis.fetch = () => { throw Error('Rendering must not send a bid or read private data') }
  assert.match(render(h(App), '/minha-conta/arremates', 'AUCTIONEER'), /Acesso não permitido/)
  assert.doesNotMatch(render(h(App), '/minha-conta/arremates', 'BIDDER', 'anonymous'), /Consultando suas participações/)
  assert.match(render(h(App), '/auditoria', 'BIDDER', 'anonymous'), /Auditoria pública/)
  assert.match(render(h(App), `/comprovantes/${receipt.publicId}`, 'BIDDER', 'anonymous'), /Consultando comprovante/)
})

const browserOptions = { skip: !executable && 'Set CHROMIUM_PATH to run Chromium integration', timeout: 60000 }
async function open(scenario = '', path = '/minha-conta/arremates') {
  await browser.navigate(`${base}?${new URLSearchParams({ scenario, path })}`)
}
it('Chromium: account navigation → participation → public receipt → public audit; no writes', browserOptions, async () => {
  await open('', '/minha-conta')
  await browser.wait(`!!document.querySelector('a[href="/minha-conta/arremates"]')`)
  await browser.evaluate(`document.querySelector('a[href="/minha-conta/arremates"]').click()`)
  await browser.wait('document.body?.textContent?.includes("Arrematado por você")')
  assert.equal(await browser.evaluate('document.body.innerText.includes("1.000,01")'), true)
  await browser.evaluate(`document.querySelector('a[href="/comprovantes/${receipt.publicId}"]').click()`)
  await browser.wait('document.body?.textContent?.includes("Comprovante público de arremate")')
  assert.equal(await browser.evaluate(`document.querySelector('input[readonly]').value.endsWith('/comprovantes/${receipt.publicId}')`), true)
  await browser.evaluate(`document.querySelector('a[href="/auditoria/${p.lot.id}"]').click()`)
  await browser.wait('document.body?.textContent?.includes("Integridade da cadeia confirmada")')
  await browser.wait('document.body?.textContent?.includes("Comprovante emitido")')
  await browser.wait('document.querySelectorAll("tbody tr").length === 1')
  const state = await browser.evaluate('window.participationTest')
  assert.equal(state.writes, 0)
  assert.equal(state.requests.length, 4)
  assert(state.requests.every(r => r.method === 'GET' && (r.path === '/api/me/participations' ? r.authenticated : !r.authenticated)))
})
it('Chromium: empty, failure, unavailable integrity and anonymous public access are explicit', browserOptions, async () => {
  for (const [scenario, path, expected] of [
    ['empty', '/minha-conta/arremates', 'Você ainda não participou'],
    ['error', '/minha-conta/arremates', 'Não foi possível consultar os dados'],
    ['invalid', `/auditoria/${p.lot.id}`, 'Integridade não confirmada: cadeia inválida'],
    ['audit-error', `/auditoria/${p.lot.id}`, 'Não foi possível verificar a integridade'],
    ['anonymous', `/auditoria/${p.lot.id}`, 'Integridade da cadeia confirmada'],
    ['anonymous', `/comprovantes/${receipt.publicId}`, 'Comprovante público de arremate'],
    ['auctioneer', '/minha-conta/arremates', 'Acesso não permitido'],
  ]) {
    await open(scenario, path); await browser.wait(`document.body?.textContent?.includes(${JSON.stringify(expected)})`)
    if (['invalid', 'audit-error'].includes(scenario)) assert.equal(await browser.evaluate('document.body.innerText.includes("Integridade da cadeia confirmada")'), false)
    assert.equal(await browser.evaluate('window.participationTest.writes'), 0)
  }
})
