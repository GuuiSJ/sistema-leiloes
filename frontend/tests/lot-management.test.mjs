import assert from 'node:assert/strict'
import { before, after, afterEach, it } from 'node:test'
import { createServer } from 'vite'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'

let server, api, publicApi, vehicleApi, Form, Picker, Editor, Confirmation, Page, App, Context, ThemeContext, createSession
const originalFetch = globalThis.fetch
const auctionId = '11111111-1111-4111-8111-111111111111', lotId = '22222222-2222-4222-8222-222222222222', vehicleId = '33333333-3333-4333-8333-333333333333'
const otherId = '44444444-4444-4444-8444-444444444444'
const auction = { id: auctionId, title: 'Leilão de teste', description: null, status: 'DRAFT', startsAt: '2030-12-01T14:00:00-03:00', endsAt: '2030-12-01T15:00:00-03:00' }
const vehicle = { id: vehicleId, brand: 'Marca', model: 'Modelo', year: 2024, version: 'Versão', imageUrls: [] }
const lot = { id: lotId, auctionId, vehicleId, number: 7, status: 'PENDING', startingPrice: '100000.01', minimumIncrement: '0.01', endsAt: auction.endsAt, vehicle }
const envelope = (data, page = 1, total = data.length) => ({ data, pagination: { page, limit: 10, total, totalPages: Math.ceil(total / 10) } })
const signal = () => new AbortController().signal
const draft = () => api.lotDraft(lot)
function session(role = 'AUCTIONEER', status = 'authenticated') {
  const snapshot = { status, user: status === 'authenticated' ? { id: 'fixture', name: 'Ana', role } : null, message: null }
  return { getSnapshot: () => snapshot, subscribe: () => () => {}, refresh() {}, logout() {}, withSession() { throw Error('No real mutations permitted') } }
}
function render(element, path = `/area-leiloeiro/lotes/${auctionId}/novo`, auth = session()) {
  return renderToString(h(ThemeContext.Provider, { value: { theme: 'dark', toggleTheme() {} } }, h(Context.Provider, { value: auth }, h(MemoryRouter, { initialEntries: [path] }, element))))
}
before(async () => {
  server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  api = await server.ssrLoadModule('/src/services/lot-management.ts')
  publicApi = await server.ssrLoadModule('/src/services/auctions.ts')
  vehicleApi = await server.ssrLoadModule('/src/services/auctioneer.ts')
  Form = (await server.ssrLoadModule('/src/components/auctioneer/LotForm.tsx')).LotForm
  Picker = (await server.ssrLoadModule('/src/components/auctioneer/LotVehiclePicker.tsx')).LotVehiclePicker
  const page = await server.ssrLoadModule('/src/pages/AuctioneerLotPage.tsx')
  Editor = page.LotEditor; Confirmation = page.LotDeleteConfirmation; Page = page.AuctioneerLotPage
  Context = (await server.ssrLoadModule('/src/components/auth/auth-context.ts')).AuthContext
  ThemeContext = (await server.ssrLoadModule('/src/components/theme/theme-context.ts')).ThemeContext
  App = (await server.ssrLoadModule('/src/App.tsx')).App
  createSession = (await server.ssrLoadModule('/src/services/auth-session.ts')).createAuthSession
})
afterEach(() => { globalThis.fetch = originalFetch })
after(async () => { await server.close() })

it('requires a real vehicle ID, a positive lot number and positive prices', () => {
  assert.deepEqual(Object.keys(api.validateLot(api.lotDraft())).sort(), ['minimumIncrement', 'number', 'startingPrice', 'vehicleId'])
  assert.deepEqual(api.validateLot(draft()), {})
  for (const number of ['0', '-1', '2147483648', '1.5', '1e3', '', 'NaN']) assert(api.validateLot({ ...draft(), number }).number)
  assert.equal(api.validateLot({ ...draft(), number: '2147483647' }).number, undefined)
})
it('handles every cent exactly through the Decimal(18,2) maximum', () => {
  for (const [input, expected] of [['0,01', '0.01'], ['1000', '1000.00'], ['1000.1', '1000.10'], [' 1000,50 ', '1000.50'], ['9999999999999999,99', '9999999999999999.99']]) assert.equal(api.lotMoney(input), expected)
  assert.equal(api.lotInput({ ...draft(), startingPrice: '9999999999999999,99' }).startingPrice, '9999999999999999.99')
})
it('rejects zero, negative, ambiguous, scientific and overflowing monetary values', () => {
  for (const value of ['0', '0.00', '0,00', '-1', '1e3', '+1', '1.000,00', '1,000.00', '.01', '01.00', '1.001', '10000000000000000', '', 'NaN', 'Infinity']) {
    assert.equal(api.lotMoney(value), null, value)
    assert(api.validateLot({ ...draft(), startingPrice: value }).startingPrice)
    assert(api.validateLot({ ...draft(), minimumIncrement: value }).minimumIncrement)
  }
})
it('creation and editing send different exact field sets without dates or status', () => {
  const candidate = { ...draft(), status: 'OPEN', endsAt: auction.endsAt, auctionId, winnerId: 'fake' }
  assert.deepEqual(api.lotInput(candidate), { vehicleId, number: 7, startingPrice: '100000.01', minimumIncrement: '0.01' })
  assert.deepEqual(api.lotInput({ ...candidate, minimumIncrement: 'not editable' }, true), { vehicleId, number: 7, startingPrice: '100000.01' })
})
it('invalid lot forms stop before any HTTP request', async () => {
  globalThis.fetch = () => { throw Error('No request allowed') }
  await assert.rejects(async () => api.createLot(auctionId, { ...draft(), startingPrice: '0' }, 'fixture-token', signal()), error => error.status === 400)
  await assert.rejects(async () => api.updateLot(auctionId, lotId, { ...draft(), vehicleId: 'bad' }, 'fixture-token', signal()), error => error.status === 400)
})
it('status only narrows actions while temporal and ownership authorization remain server-side', () => {
  assert.deepEqual(api.lotActions('DRAFT', 'PENDING'), { create: true, edit: true, delete: true })
  for (const status of ['OPEN', 'SOLD', 'UNSOLD', 'CANCELLED']) assert.deepEqual(api.lotActions('DRAFT', status), { create: true, edit: false, delete: false })
  for (const status of ['SCHEDULED', 'OPEN', 'CLOSED', 'CANCELLED']) assert.deepEqual(api.lotActions(status, 'PENDING'), { create: false, edit: false, delete: false })
})
it('GET lists actual lots under the chosen auction with supported pagination only', async () => {
  globalThis.fetch = async (url, options) => {
    const address = new URL(url)
    assert.equal(address.pathname, `/api/auctions/${auctionId}/lots`)
    assert.deepEqual(Object.fromEntries(address.searchParams), { page: '2', limit: '10' })
    assert.equal(options.method, 'GET'); assert.equal(options.headers.Authorization, undefined)
    return Response.json(envelope([lot], 2, 11))
  }
  assert.equal((await api.getManagedLotsPage(auctionId, 2, signal())).data[0].vehicle.id, vehicleId)
})
it('list rejects cross-auction rows, wrong pages and malformed responses instead of showing unrelated data', async () => {
  for (const body of [envelope([{ ...lot, auctionId: otherId }]), envelope([lot], 2, 11), { data: null }, envelope([{ ...lot, startingPrice: 1 }])]) {
    globalThis.fetch = async () => Response.json(body)
    await assert.rejects(api.getManagedLotsPage(auctionId, 1, signal()), /formato inesperado/)
  }
})
it('GET detail verifies both lot and auction identity', async () => {
  globalThis.fetch = async (url, options) => { assert.equal(new URL(url).pathname, `/api/auctions/${auctionId}/lots/${lotId}`); assert.equal(options.method, 'GET'); return Response.json({ lot }) }
  assert.deepEqual(await publicApi.getLot(auctionId, lotId, signal()), lot)
  for (const changes of [{ id: otherId }, { auctionId: otherId }]) {
    globalThis.fetch = async () => Response.json({ lot: { ...lot, ...changes } })
    await assert.rejects(publicApi.getLot(auctionId, lotId, signal()), /formato inesperado/)
  }
})
it('POST uses the existing route and exact body with Bearer (simulated)', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, `/api/auctions/${auctionId}/lots`); assert.equal(options.method, 'POST')
    assert.equal(options.headers.Authorization, 'Bearer fixture-token'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error')
    assert.deepEqual(JSON.parse(options.body), { vehicleId, number: 7, startingPrice: '100000.01', minimumIncrement: '0.01' })
    return Response.json({ lot }, { status: 201 })
  }
  assert.deepEqual(await api.createLot(auctionId, draft(), 'fixture-token', signal()), lot)
})
it('PATCH never sends minimumIncrement, even if draft contains an attempted change (simulated)', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, `/api/auctions/${auctionId}/lots/${lotId}`); assert.equal(options.method, 'PATCH')
    assert.deepEqual(JSON.parse(options.body), { vehicleId, number: 7, startingPrice: '100000.01' })
    return Response.json({ lot })
  }
  assert.equal((await api.updateLot(auctionId, lotId, { ...draft(), minimumIncrement: '9999' }, 'fixture-token', signal())).minimumIncrement, '0.01')
})
it('DELETE sends no body and accepts only 204 (simulated)', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, `/api/auctions/${auctionId}/lots/${lotId}`); assert.equal(options.method, 'DELETE')
    assert.equal(options.headers.Authorization, 'Bearer fixture-token'); assert.equal(options.body, undefined); assert.equal(options.headers['Content-Type'], undefined)
    return new Response(null, { status: 204 })
  }
  assert.equal(await api.deleteLot(auctionId, lotId, 'fixture-token', signal()), null)
  globalThis.fetch = async () => Response.json({ lot })
  await assert.rejects(api.deleteLot(auctionId, lotId, 'fixture-token', signal()), error => error.uncertain === true)
})
it('maps validation, permission, missing record, duplicate/conflict and rate limiting errors', async () => {
  for (const [status, message] of [[400, /número e os valores/], [401, /sessão expirou/], [403, /proprietário/], [404, /não encontrado/], [409, /número ou veículo já está vinculado/], [429, /Muitas tentativas/]]) {
    globalThis.fetch = async () => Response.json({ message: 'SQL private details' }, { status })
    await assert.rejects(api.updateLot(auctionId, lotId, draft(), 'fixture-token', signal()), error => { assert.equal(error.status, status); assert.match(error.message, message); assert.doesNotMatch(error.message, /SQL/); assert.equal(error.uncertain, false); return true })
  }
})
it('network failures, unavailable service and invalid success bodies are uncertain and never resent', async () => {
  for (const reply of [() => { throw Error('offline') }, () => Response.json({}, { status: 503 }), () => Response.json({}), () => Response.json({ lot: { ...lot, id: otherId } }), () => Response.json({ lot: { ...lot, auctionId: otherId } })]) {
    let calls = 0; globalThis.fetch = async () => { calls++; return reply() }
    await assert.rejects(api.updateLot(auctionId, lotId, draft(), 'fixture-token', signal()), error => error.uncertain === true)
    assert.equal(calls, 1)
  }
})
it('invalid identifiers, missing tokens and cancelled mutations never reach HTTP', async () => {
  globalThis.fetch = () => { throw Error('No request allowed') }
  await assert.rejects(api.deleteLot('bad', lotId, 'fixture-token', signal()), error => error.status === 400)
  await assert.rejects(api.deleteLot(auctionId, 'bad', 'fixture-token', signal()), error => error.status === 400)
  await assert.rejects(api.deleteLot(auctionId, lotId, '', signal()), error => error.status === 401)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(api.deleteLot(auctionId, lotId, 'fixture-token', controller.signal), { name: 'AbortError' })
})
it('mutation timeout is uncertain without automatic retries', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] }); let calls = 0
  globalThis.fetch = async (_url, options) => { calls++; return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')), { once: true })) }
  const pending = api.createLot(auctionId, draft(), 'fixture-token', signal())
  context.mock.timers.tick(12000)
  await assert.rejects(pending, error => error.uncertain === true); assert.equal(calls, 1)
})
it('401 clears the existing session while ownership 403 preserves it', async () => {
  for (const status of [401, 403]) {
    const user = { id: 'user', name: 'Ana', role: 'AUCTIONEER' }
    const auth = createSession({ storage: { getItem: () => null, setItem() {}, removeItem() {} }, api: { login: async () => ({ accessToken: 'fixture-token', expiresIn: 3600, user }), me: async () => user }, schedule: () => 0, cancel() {} })
    await auth.login({}, signal()); globalThis.fetch = async () => Response.json({}, { status })
    await assert.rejects(auth.withSession((token, inner) => api.deleteLot(auctionId, lotId, token, inner), signal()))
    assert.equal(auth.getSnapshot().status, status === 401 ? 'anonymous' : 'authenticated'); auth.stop()
  }
})
it('vehicle selection uses real paginated GET with brand/model/year filters, without owner filters', async () => {
  globalThis.fetch = async (url, options) => {
    const address = new URL(url); assert.equal(address.pathname, '/api/vehicles')
    assert.deepEqual(Object.fromEntries(address.searchParams), { page: '2', limit: '10', brand: 'Marca', model: 'Modelo', year: '2024' })
    assert.equal(options.method, 'GET'); assert.equal(options.headers.Authorization, undefined)
    return Response.json(envelope([vehicle], 2, 11))
  }
  assert.equal((await vehicleApi.listVehicles(2, { brand: 'Marca', model: 'Modelo', year: '2024', ownerId: 'fake' }, signal())).data[0].id, vehicleId)
})
it('selected vehicle remains visible independently from pending results and disabled filters', () => {
  const html = render(h(Picker, { selected: vehicle, disabled: true, select() {} }))
  assert.match(html, /Selecionado: /); assert.match(html, /Marca/); assert.match(html, /Modelo/)
  assert.match(html, /Consultando registros/); assert.match(html, /<fieldset disabled=""/)
  for (const name of ['brand', 'model', 'year']) assert(html.includes(`name="${name}"`))
  assert.match(html, /plataforma verificará/)
})
it('form distinguishes creation from editing and formats exact monetary previews', () => {
  const props = { draft: { ...draft(), startingPrice: '9999999999999999,99' }, errors: {}, busy: false, blocked: false, change() {}, submit() {} }
  const create = render(h(Form, { ...props, editing: false })), edit = render(h(Form, { ...props, editing: true }))
  assert.match(create, /name="minimumIncrement"/); assert.doesNotMatch(edit, /name="minimumIncrement"/)
  assert.match(edit, /não pode ser alterado/); assert.match(create, /9\.999\.999\.999\.999\.999,99/)
  assert.doesNotMatch(create, /name="endsAt"|name="startsAt"|name="status"/)
})
it('form shows inline errors and disables mutations when busy or blocked', () => {
  for (const props of [{ busy: true, blocked: false }, { busy: false, blocked: true }]) {
    const html = render(h(Form, { draft: draft(), errors: { startingPrice: 'Valor inválido.' }, editing: false, change() {}, submit() {}, ...props }))
    assert.match(html, /<fieldset disabled=""/); assert.match(html, /aria-invalid="true"/); assert.match(html, /Valor inválido/)
  }
})
it('editor only exposes creation for DRAFT and edit/delete for PENDING lots in DRAFT auctions', () => {
  for (const status of ['DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'CANCELLED']) {
    const create = render(h(Editor, { auction: { ...auction, status } }))
    assert.equal(create.includes('aria-label="Cadastrar lote"'), status === 'DRAFT')
    for (const lotStatus of ['PENDING', 'OPEN', 'SOLD', 'UNSOLD', 'CANCELLED']) {
      const html = render(h(Editor, { auction: { ...auction, status }, lot: { ...lot, status: lotStatus } }))
      const allowed = status === 'DRAFT' && lotStatus === 'PENDING'
      assert.equal(html.includes('aria-label="Editar lote"'), allowed)
      assert.equal(html.includes('aria-label="Exclusão do lote"'), allowed)
      assert.match(html, /verificados pela plataforma/)
    }
  }
})
it('read-only lot summary shows vehicle, status, exact price and deadline in Brasília', () => {
  const html = render(h(Editor, { auction: { ...auction, status: 'OPEN' }, lot: { ...lot, status: 'OPEN' } }))
  assert.match(html, /Marca/); assert.match(html, /Modelo/); assert.match(html, /Aberto/)
  assert.match(html, /100\.000,01/); assert.match(html, /01\/12\/2030, 15:00/)
  assert.doesNotMatch(html, /aria-label="Editar lote"/)
})
it('exclusion requires an explicit confirmation identifying the original lot and vehicle', () => {
  let calls = 0
  const html = render(h(Confirmation, { lot, busy: false, confirm() { calls++ }, dismiss() {} }))
  assert.equal(calls, 0); assert.match(html, /role="alertdialog"/); assert.match(html, /Lote <!-- -->7/)
  assert.match(html, /Marca/); assert.match(html, /Manter lote/); assert.match(html, /Confirmar exclusão definitiva/)
  assert.match(html, /cadastro do veículo será preservado/)
  assert.equal((render(h(Confirmation, { lot, busy: true, confirm() {}, dismiss() {} })).match(/disabled=""/g) ?? []).length, 2)
})
it('create and edit routes reject BIDDER and anonymous sessions', () => {
  for (const path of [`/area-leiloeiro/lotes/${auctionId}/novo`, `/area-leiloeiro/lotes/${auctionId}/${lotId}/editar`]) {
    assert.match(render(h(App), path, session('BIDDER')), /Acesso não permitido/)
    assert.doesNotMatch(render(h(App), path, session(undefined, 'anonymous')), /Dados do lote/)
  }
  assert.match(render(h(Page, { create: true }), undefined, session('BIDDER')), /Acesso exclusivo/)
})
it('AUCTIONEER routes consult safely and reject invalid lot/auction IDs', () => {
  globalThis.fetch = () => { throw Error('No automatic mutations') }
  for (const path of [`/area-leiloeiro/lotes/${auctionId}/novo`, `/area-leiloeiro/lotes/${auctionId}/${lotId}/editar`]) assert.match(render(h(App), path), /Consultando registros/)
  assert.match(render(h(App), '/area-leiloeiro/lotes/invalid/novo'), /Leilão ou lote inválido/)
  assert.match(render(h(App), `/area-leiloeiro/lotes/${auctionId}/invalid/editar`), /Leilão ou lote inválido/)
})
it('returning after mutation reloads the selected auction list and displays success', () => {
  const html = render(h(App), { pathname: `/area-leiloeiro/lotes/${auctionId}`, state: { lotNotice: 'Lote excluído com sucesso.' } })
  assert.match(html, /Lote excluído com sucesso/); assert.match(html, /Consultando registros/)
  assert.match(html, /Selecionar outro leilão/)
})
