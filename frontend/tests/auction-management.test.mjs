import assert from 'node:assert/strict'
import { before, after, afterEach, it } from 'node:test'
import { createServer } from 'vite'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'

let server, api, publicApi, Form, Editor, Confirmation, Page, App, Context, ThemeContext, createSession
const originalFetch = globalThis.fetch
const id = '11111111-1111-4111-8111-111111111111', otherId = '22222222-2222-4222-8222-222222222222'
const auction = { id, title: 'Leilão de teste', description: 'Descrição', status: 'DRAFT', startsAt: '2030-12-01T14:00:00-03:00', endsAt: '2030-12-01T15:00:00-03:00' }
const signal = () => new AbortController().signal
const draft = () => api.auctionDraft(auction)
function session(role = 'AUCTIONEER', status = 'authenticated') {
  const snapshot = { status, user: status === 'authenticated' ? { id: 'fixture', name: 'Ana', role } : null, message: null }
  return { getSnapshot: () => snapshot, subscribe: () => () => {}, refresh() {}, logout() {}, withSession() { throw Error('No real mutation allowed') } }
}
function render(element, path = '/area-leiloeiro/leiloes/novo', auth = session()) {
  return renderToString(h(ThemeContext.Provider, { value: { theme: 'dark', toggleTheme() {} } }, h(Context.Provider, { value: auth }, h(MemoryRouter, { initialEntries: [path] }, element))))
}
before(async () => {
  server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  api = await server.ssrLoadModule('/src/services/auction-management.ts')
  publicApi = await server.ssrLoadModule('/src/services/auctions.ts')
  Form = (await server.ssrLoadModule('/src/components/auctioneer/AuctionForm.tsx')).AuctionForm
  const page = await server.ssrLoadModule('/src/pages/AuctioneerAuctionPage.tsx')
  Editor = page.AuctionEditor; Confirmation = page.AuctionCancelConfirmation; Page = page.AuctioneerAuctionPage
  Context = (await server.ssrLoadModule('/src/components/auth/auth-context.ts')).AuthContext
  ThemeContext = (await server.ssrLoadModule('/src/components/theme/theme-context.ts')).ThemeContext
  App = (await server.ssrLoadModule('/src/App.tsx')).App
  createSession = (await server.ssrLoadModule('/src/services/auth-session.ts')).createAuthSession
})
afterEach(() => { globalThis.fetch = originalFetch })
after(async () => { await server.close() })

it('validates required fields, title and description boundaries, and NULs', () => {
  assert.deepEqual(Object.keys(api.validateAuction(api.auctionDraft())).sort(), ['endsAt', 'startsAt', 'title'])
  for (const change of [{ title: ' ' }, { title: 'a'.repeat(151) }, { title: 'a\0b' }, { description: 'a'.repeat(10001) }, { description: 'a\0b' }]) assert(Object.keys(api.validateAuction({ ...draft(), ...change })).length)
  assert.deepEqual(api.validateAuction({ ...draft(), title: 'a'.repeat(150), description: 'a'.repeat(10000) }), {})
})
it('strictly validates real calendar dates, seconds and explicit timezone', () => {
  for (const value of ['2030-02-29T12:00:00Z', '2030-04-31T12:00:00Z', '2030-01-00T12:00:00Z', '2030-13-01T12:00:00Z', '2030-12-01T24:00:00Z', '2030-12-01T12:60:00Z', '2030-12-01T12:00:60Z', '2030-12-01T12:00', '2030-12-01T12:00:00', '2030-12-01T12:00:00+24:00', '2030-12-01T12:00:00+03:60', '01/12/2030 12:00', '0999-12-01T12:00:00Z']) assert.equal(api.validAuctionDate(value), false, value)
  for (const value of ['2032-02-29T12:00:00Z', '2030-12-01T12:00:00.123-03:00', '2030-12-01T12:00:00+05:30']) assert.equal(api.validAuctionDate(value), true)
})
it('compares absolute instants across offsets without using the browser timezone', () => {
  assert(api.validateAuction({ ...draft(), startsAt: '2030-12-01T14:00:00-03:00', endsAt: '2030-12-01T16:00:00Z' }).endsAt)
  assert(api.validateAuction({ ...draft(), startsAt: '2030-12-01T14:00:00-03:00', endsAt: '2030-12-01T17:00:00Z' }).endsAt)
  assert.deepEqual(api.validateAuction({ ...draft(), startsAt: '2030-12-01T14:00:00-03:00', endsAt: '2030-12-01T17:00:01Z' }), {})
})
it('does not invent a future-date rule for creation or infer temporal authorization', () => {
  assert.deepEqual(api.validateAuction({ ...draft(), startsAt: '2000-01-01T00:00:00Z', endsAt: '2000-01-02T00:00:00Z' }), {})
  assert.deepEqual(api.auctionActions('DRAFT'), { edit: true, cancel: true })
  assert.deepEqual(api.auctionActions('SCHEDULED'), { edit: false, cancel: true })
  for (const status of ['OPEN', 'CLOSED', 'CANCELLED']) assert.deepEqual(api.auctionActions(status), { edit: false, cancel: false })
})
it('projects only accepted fields and preserves exact timestamp precision and offsets', () => {
  const result = api.auctionInput({ ...draft(), title: ' Teste ', description: ' ', startsAt: '2030-12-01T14:00:00.123-03:00', status: 'OPEN', organizerId: 'fake', temporalGeneration: 'UTC_V2' })
  assert.deepEqual(result, { title: 'Teste', description: null, startsAt: '2030-12-01T14:00:00.123-03:00', endsAt: auction.endsAt })
})
it('invalid forms cannot send a request', async () => {
  globalThis.fetch = () => { throw Error('No request allowed') }
  await assert.rejects(async () => api.createAuction({ ...draft(), title: '' }, 'fixture-token', signal()), error => error.status === 400)
  await assert.rejects(async () => api.updateAuction(id, { ...draft(), endsAt: auction.startsAt }, 'fixture-token', signal()), error => error.status === 400)
})
it('consultation uses the existing public GET and validates the auction envelope', async () => {
  globalThis.fetch = async (url, options) => { assert.equal(new URL(url).pathname, `/api/auctions/${id}`); assert.equal(options.method, 'GET'); assert.equal(options.headers.Authorization, undefined); return Response.json({ auction }) }
  assert.deepEqual(await publicApi.getAuction(id, signal()), auction)
  globalThis.fetch = async () => Response.json({ auction: { ...auction, id: otherId } })
  await assert.rejects(publicApi.getAuction(id, signal()), /formato inesperado/)
})
it('creation uses POST with Bearer and only the actual input fields (simulated)', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, '/api/auctions'); assert.equal(options.method, 'POST')
    assert.equal(options.headers.Authorization, 'Bearer fixture-token'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error')
    assert.deepEqual(JSON.parse(options.body), draft())
    return Response.json({ auction }, { status: 201 })
  }
  assert.deepEqual(await api.createAuction({ ...draft(), status: 'OPEN' }, 'fixture-token', signal()), auction)
})
it('editing uses PATCH without status or generation transitions (simulated)', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, `/api/auctions/${id}`); assert.equal(options.method, 'PATCH')
    assert.deepEqual(Object.keys(JSON.parse(options.body)).sort(), ['description', 'endsAt', 'startsAt', 'title'])
    return Response.json({ auction })
  }
  assert.equal((await api.updateAuction(id, draft(), 'fixture-token', signal())).status, 'DRAFT')
})
it('cancellation uses PATCH /cancel without a body and requires the cancelled response (simulated)', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, `/api/auctions/${id}/cancel`); assert.equal(options.method, 'PATCH')
    assert.equal(options.body, undefined); assert.equal(options.headers['Content-Type'], undefined)
    assert.equal(options.headers.Authorization, 'Bearer fixture-token')
    return Response.json({ auction: { ...auction, status: 'CANCELLED' } })
  }
  assert.equal((await api.cancelAuction(id, 'fixture-token', signal())).status, 'CANCELLED')
})
it('maps validation, permission, not-found, conflict and rate-limit failures without raw internals', async () => {
  for (const [status, message] of [[400, /campos e as datas/], [401, /sessão expirou/], [403, /responsável/], [404, /não encontrado/], [409, /Atualize os dados/], [429, /Muitas tentativas/]]) {
    globalThis.fetch = async () => Response.json({ message: 'private SQL details' }, { status })
    await assert.rejects(api.updateAuction(id, draft(), 'fixture-token', signal()), error => { assert.equal(error.status, status); assert.match(error.message, message); assert.doesNotMatch(error.message, /SQL/); assert.equal(error.uncertain, false); return true })
  }
})
it('uncertain writes and malformed success responses never trigger automatic retries', async () => {
  for (const reply of [() => { throw Error('offline') }, () => Response.json({}, { status: 503 }), () => Response.json({}), () => Response.json({ auction: { ...auction, id: 'bad' } }), () => Response.json({ auction: { ...auction, id: otherId } })]) {
    let calls = 0; globalThis.fetch = async () => { calls++; return reply() }
    await assert.rejects(api.updateAuction(id, draft(), 'fixture-token', signal()), error => error.uncertain === true)
    assert.equal(calls, 1)
  }
  globalThis.fetch = async () => Response.json({ auction })
  await assert.rejects(api.cancelAuction(id, 'fixture-token', signal()), error => error.uncertain === true)
})
it('invalid IDs, missing tokens and already cancelled requests never reach HTTP', async () => {
  globalThis.fetch = () => { throw Error('No request allowed') }
  await assert.rejects(api.cancelAuction('invalid', 'fixture-token', signal()), error => error.status === 400)
  await assert.rejects(api.cancelAuction(id, '', signal()), error => error.status === 401)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(api.cancelAuction(id, 'fixture-token', controller.signal), { name: 'AbortError' })
})
it('timeout leaves the operation uncertain without resending', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); let calls = 0
  globalThis.fetch = async (_url, options) => { calls++; return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')), { once: true })) }
  const pending = api.createAuction(draft(), 'fixture-token', signal())
  context.mock.timers.tick(12000)
  await assert.rejects(pending, error => error.uncertain === true); assert.equal(calls, 1)
})
it('401 clears the existing session and 403 preserves the authenticated profile', async () => {
  for (const status of [401, 403]) {
    const user = { id: 'user', name: 'Ana', role: 'AUCTIONEER' }
    const auth = createSession({ storage: { getItem: () => null, setItem() {}, removeItem() {} }, api: { login: async () => ({ accessToken: 'fixture-token', expiresIn: 3600, user }), me: async () => user }, schedule: () => 0, cancel() {} })
    await auth.login({}, signal()); globalThis.fetch = async () => Response.json({}, { status })
    await assert.rejects(auth.withSession((token, inner) => api.cancelAuction(id, token, inner), signal()))
    assert.equal(auth.getSnapshot().status, status === 401 ? 'anonymous' : 'authenticated'); auth.stop()
  }
})
it('form exposes the real fields, inline errors and Brasília preview without dispatching', () => {
  globalThis.fetch = () => { throw Error('Render must not send requests') }
  const html = render(h(Form, { draft: draft(), errors: { title: 'Informe o título.' }, busy: false, blocked: false, editing: false, change() {}, submit() {} }))
  for (const name of ['title', 'description', 'startsAt', 'endsAt']) assert(html.includes(`name="${name === "startsAt" || name === "endsAt" ? `${name}-date` : name}"`))
  assert.match(html, /Informe o título/); assert.match(html, /aria-invalid="true"/)
  assert.match(html, /horário de Brasília/); assert.match(html, /01\/12\/2030 às 14:00/)
  assert.match(html, /cadastrado como rascunho/); assert.doesNotMatch(html, /name="status"|name="temporalGeneration"/)
})
it('busy and blocked forms disable their inputs', () => {
  for (const props of [{ busy: true, blocked: false }, { busy: false, blocked: true }]) assert.match(render(h(Form, { draft: draft(), errors: {}, editing: true, change() {}, submit() {}, ...props })), /<fieldset disabled=""/)
})
it('editor exposes only status-compatible actions and never infers temporal permission from OPEN', () => {
  for (const status of ['DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'CANCELLED']) {
    const html = render(h(Editor, { auction: { ...auction, status } }))
    assert.equal(html.includes('aria-label="Editar leilão"'), status === 'DRAFT')
    assert.equal(html.includes('aria-label="Cancelamento do leilão"'), ['DRAFT', 'SCHEDULED'].includes(status))
    assert.match(html, /regras temporais verificadas pela plataforma/)
    assert.doesNotMatch(html, /Publicar leilão|Abrir leilão|Encerrar leilão|Gerenciar lotes/)
  }
})
it('cancellation confirmation identifies the auction and offers a safe way to dismiss', () => {
  let calls = 0
  const html = render(h(Confirmation, { auction, busy: false, confirm() { calls++ }, dismiss() {} }))
  assert.equal(calls, 0); assert.match(html, /role="alertdialog"/); assert.match(html, /Leilão de teste/)
  assert.match(html, /Manter leilão/); assert.match(html, /Confirmar cancelamento definitivo/)
  const busy = render(h(Confirmation, { auction, busy: true, confirm() {}, dismiss() {} }))
  assert.equal((busy.match(/disabled=""/g) ?? []).length, 2)
})
it('create and management routes reject BIDDER and anonymous sessions', () => {
  for (const path of ['/area-leiloeiro/leiloes/novo', `/area-leiloeiro/leiloes/${id}/editar`]) {
    assert.match(render(h(App), path, session('BIDDER')), /Acesso não permitido/)
    assert.doesNotMatch(render(h(App), path, session(undefined, 'anonymous')), /Dados do leilão/)
  }
  assert.match(render(h(Page, { create: true }), undefined, session('BIDDER')), /Acesso exclusivo/)
})
it('AUCTIONEER can open creation and consultation without automatic mutations', () => {
  globalThis.fetch = () => { throw Error('No automatic writes') }
  assert.match(render(h(App)), /aria-label="Cadastrar leilão"/)
  assert.match(render(h(App), `/area-leiloeiro/leiloes/${id}/editar`), /Consultando registros/)
  assert.match(render(h(App), '/area-leiloeiro/leiloes/invalid/editar'), /Leilão inválido/)
})
it('returning to the list displays success, reloads records and retains registration navigation', () => {
  const html = render(h(App), { pathname: '/area-leiloeiro/leiloes', state: { auctionNotice: 'Leilão cancelado com sucesso.' } })
  assert.match(html, /Leilão cancelado com sucesso/); assert.match(html, /Consultando registros/)
  assert.match(html, /href="\/area-leiloeiro\/leiloes\/novo"/)
  const lots = render(h(App), '/area-leiloeiro/lotes')
  assert.doesNotMatch(lots, /Cadastrar leilão|Cancelar leilão/)
})
