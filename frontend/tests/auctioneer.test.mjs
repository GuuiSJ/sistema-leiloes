import assert from 'node:assert/strict'
import { after, afterEach, before, it } from 'node:test'
import { createServer } from 'vite'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'

let server, service, auctions, feedback, ApiError, App, Context, ThemeContext
const originalFetch = globalThis.fetch
const auctionId = '11111111-1111-4111-8111-111111111111'
const vehicle = { id: 'vehicle', brand: 'Marca', model: 'Modelo', year: 2024, version: null, imageUrls: [], fipeReferencePrice: '100000.01', fipeReferencePriceVerified: false }
const auction = { id: auctionId, title: 'Leilão de teste', status: 'OPEN', startsAt: '2030-01-01T12:00:00Z', endsAt: '2030-01-01T16:00:00Z' }
const lot = { id: 'lot', auctionId, number: 1, status: 'OPEN', startingPrice: '1000.00', minimumIncrement: '100.00', endsAt: auction.endsAt, vehicle }
const envelope = (data, page = 1, total = data.length, limit = 10) => ({ data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } })
const signal = () => new AbortController().signal
function session(role = 'AUCTIONEER', status = 'authenticated') {
  const snapshot = { status, user: status === 'authenticated' ? { id: 'fixture', name: 'Ana', role } : null, message: null }
  return { getSnapshot: () => snapshot, subscribe: () => () => {}, refresh() {}, logout() {}, withSession() { throw Error('No private operations expected') } }
}
function render(element, path = '/area-leiloeiro', auth = session()) {
  return renderToString(h(ThemeContext.Provider, { value: { theme: 'dark', toggleTheme() {} } }, h(Context.Provider, { value: auth }, h(MemoryRouter, { initialEntries: [path] }, element))))
}
before(async () => {
  server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  service = await server.ssrLoadModule('/src/services/auctioneer.ts')
  auctions = await server.ssrLoadModule('/src/services/auctions.ts')
  feedback = await server.ssrLoadModule('/src/components/auctioneer/AdminFeedback.tsx')
  ApiError = (await server.ssrLoadModule('/src/services/api.ts')).ApiError
  Context = (await server.ssrLoadModule('/src/components/auth/auth-context.ts')).AuthContext
  ThemeContext = (await server.ssrLoadModule('/src/components/theme/theme-context.ts')).ThemeContext
  App = (await server.ssrLoadModule('/src/App.tsx')).App
})
afterEach(() => { globalThis.fetch = originalFetch })
after(async () => { await server.close() })

it('vehicles send only supported filters with encoded values, pagination and public GET', async () => {
  globalThis.fetch = async (input, options) => {
    const url = new URL(input)
    assert.equal(url.pathname, '/api/vehicles')
    assert.deepEqual(Object.fromEntries(url.searchParams), { page: '2', limit: '10', brand: 'Marca & Cia', model: 'Modelo', year: '2024' })
    assert.equal(options.method, 'GET'); assert.equal(options.body, undefined)
    assert.equal(options.credentials, 'omit'); assert.equal(options.headers.Authorization, undefined)
    return Response.json(envelope([vehicle], 2, 11))
  }
  const result = await service.listVehicles(2, { brand: ' Marca & Cia ', model: 'Modelo', year: '2024', status: 'OPEN', ownerId: 'fake' }, signal())
  assert.equal(result.data[0].fipeReferencePrice, '100000.01')
  assert.equal(result.pagination.total, 11)
})
it('empty filters are omitted and an empty catalog remains empty', async () => {
  globalThis.fetch = async input => {
    assert.deepEqual(Object.fromEntries(new URL(input).searchParams), { page: '1', limit: '10' })
    return Response.json(envelope([]))
  }
  assert.deepEqual((await service.listVehicles(1, { brand: '  ' }, signal())).data, [])
})
it('overview uses server totals, including zero, without loading all pages or inventing a lot count', async () => {
  const requests = []
  globalThis.fetch = async (input, options) => {
    const url = new URL(input); requests.push(url)
    assert.equal(options.method, 'GET'); assert.equal(url.searchParams.get('limit'), '1')
    const isVehicle = url.pathname === '/api/vehicles'
    const total = isVehicle ? 137 : url.searchParams.get('status') === 'OPEN' ? 0 : url.searchParams.get('status') === 'SCHEDULED' ? 4 : 42
    return Response.json(envelope(total ? [isVehicle ? vehicle : auction] : [], 1, total, 1))
  }
  assert.deepEqual(await service.getOverview(signal()), { vehicles: 137, auctions: 42, open: 0, scheduled: 4 })
  assert.equal(requests.length, 4)
  assert(!requests.some(url => url.pathname.includes('lots')))
})
it('overview fails rather than displaying fabricated zero totals on network failure', async () => {
  globalThis.fetch = async () => { throw Error('private network details') }
  await assert.rejects(service.getOverview(signal()), /Verifique sua conexão/)
})
it('malformed vehicle rows and pagination are rejected', async () => {
  for (const body of [envelope([{ ...vehicle, year: '2024' }]), envelope([{ ...vehicle, fipeReferencePrice: 1 }]), { data: [], pagination: null }]) {
    globalThis.fetch = async () => Response.json(body)
    await assert.rejects(service.listVehicles(1, {}, signal()), /formato inesperado/)
  }
})
it('auction status filtering uses the existing GET contract', async () => {
  globalThis.fetch = async (input, options) => {
    const url = new URL(input)
    assert.equal(url.pathname, '/api/auctions')
    assert.deepEqual(Object.fromEntries(url.searchParams), { page: '3', limit: '10', status: 'CLOSED' })
    assert.equal(options.method, 'GET')
    return Response.json(envelope([{ ...auction, status: 'CLOSED' }], 3, 21))
  }
  assert.equal((await auctions.listAuctions(3, 10, signal(), 'CLOSED')).data[0].status, 'CLOSED')
})
it('lots are scoped to the selected auction with pagination and no unsupported filters', async () => {
  globalThis.fetch = async (input, options) => {
    const url = new URL(input)
    assert.equal(url.pathname, `/api/auctions/${auctionId}/lots`)
    assert.deepEqual(Object.fromEntries(url.searchParams), { page: '2', limit: '10' })
    assert.equal(options.method, 'GET')
    return Response.json(envelope([lot], 2, 11))
  }
  assert.equal((await auctions.getLotsPage(auctionId, 2, signal())).data[0].minimumIncrement, '100.00')
})
it('401 and 403 remain distinct without exposing server error bodies', async () => {
  for (const status of [401, 403]) {
    globalThis.fetch = async () => Response.json({ message: 'private database details' }, { status })
    await assert.rejects(service.listVehicles(1, {}, signal()), error => {
      assert.equal(error.status, status)
      assert.doesNotMatch(service.consultationError(error), /database/)
      assert.match(service.consultationError(error), status === 401 ? /sessão/ : /não foi permitida/)
      return true
    })
  }
})
it('cancelled reads propagate cancellation', async () => {
  const controller = new AbortController(); controller.abort()
  globalThis.fetch = async (_input, options) => {
    assert(options.signal.aborted); throw new DOMException('Cancelled', 'AbortError')
  }
  await assert.rejects(service.listVehicles(1, {}, controller.signal), { name: 'AbortError' })
})
it('every admin route is denied to BIDDER and never renders administrative content', () => {
  for (const path of ['/area-leiloeiro', '/area-leiloeiro/veiculos', '/area-leiloeiro/leiloes', '/area-leiloeiro/lotes', `/area-leiloeiro/lotes/${auctionId}`]) {
    const html = render(h(App), path, session('BIDDER'))
    assert.match(html, /Acesso não permitido/)
    assert.doesNotMatch(html, /Seu catálogo, em perspectiva/)
  }
})
it('AUCTIONEER sees navigation, the active route and loading states without write actions', () => {
  for (const [path, label] of [['/area-leiloeiro', 'Visão geral'], ['/area-leiloeiro/veiculos', 'Veículos'], ['/area-leiloeiro/leiloes', 'Leilões'], ['/area-leiloeiro/lotes', 'Lotes por leilão'], [`/area-leiloeiro/lotes/${auctionId}`, 'Lotes']]) {
    const html = render(h(App), path)
    assert.match(html, /Painel do leiloeiro/); assert.match(html, /Olá, <!-- -->Ana/)
    assert(html.includes(label)); assert.match(html, /Consultando registros/)
    assert.match(html, /aria-current="page"/)
    assert.doesNotMatch(html, />Criar|>Editar|>Cancelar|>Excluir/)
  }
})
it('anonymous and restoring sessions never render the admin layout', () => {
  for (const status of ['anonymous', 'restoring', 'unavailable']) {
    assert.doesNotMatch(render(h(App), '/area-leiloeiro/veiculos', session(undefined, status)), /Seu catálogo, em perspectiva/)
  }
})
it('invalid auction URLs are handled without a lot query', () => {
  globalThis.fetch = () => { throw Error('No request allowed') }
  assert.match(render(h(App), '/area-leiloeiro/lotes/invalid'), /Leilão inválido/)
})
it('empty, loading and failed states never render stale records', () => {
  for (const props of [{ loading: true, error: null, empty: false }, { loading: false, error: null, empty: true }, { loading: false, error: new ApiError('Falha de rede'), empty: false }]) {
    const html = render(h(feedback.AdminFeedback, { ...props, retry() {} }, 'STALE_RECORD'))
    assert.doesNotMatch(html, /STALE_RECORD/)
    assert.match(html, /Consultando|Nenhum registro|Falha de rede/)
  }
})
it('401 offers session verification and login while 403 explains denied access', () => {
  for (const status of [401, 403]) {
    const html = render(h(feedback.AdminFeedback, { loading: false, error: new ApiError('Unexpected', status), empty: false, retry() {} }))
    if (status === 401) { assert.match(html, /Verificar sessão/); assert.match(html, /href="\/entrar"/) }
    else { assert.match(html, /não foi permitida/); assert.doesNotMatch(html, /Verificar sessão/) }
  }
})
it('pagination disables both directions for a single page and reports real totals', () => {
  const html = render(h(feedback.AdminPagination, { pagination: envelope([vehicle]).pagination, change() {} }))
  assert.equal((html.match(/disabled=""/g) ?? []).length, 2)
  assert.match(html, /1<!-- --> registros/)
})
