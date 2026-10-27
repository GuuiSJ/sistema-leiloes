import assert from 'node:assert/strict'
import { after, afterEach, before, it } from 'node:test'
import { createServer } from 'vite'
import { createElement as h } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'

let server, vehicles, fipe, Form, Confirmation, Page, App, Context, ThemeContext, createSession
const originalFetch = globalThis.fetch
const id = '11111111-1111-4111-8111-111111111111'
const otherId = '22222222-2222-4222-8222-222222222222'
const vehicle = { id, brand: 'Marca', model: 'Modelo', year: 2024, version: 'Versão', imageUrls: ['https://example.test/car.jpg'], description: null, fipeCode: '000001-1', fipeBrandCode: '1', fipeModelCode: '2', fipeYearCode: '2024-1', fipeReferenceMonth: 'outubro de 2026', fipeReferencePrice: '100000.01', fipeReferencePriceVerified: false }
const detail = { marca: 'Marca', modelo: 'Modelo', anoModelo: 2024, valor: 'R$ 100.000,01', codigoFipe: '000001-1', mesReferencia: 'outubro de 2026', tipoVeiculo: 1, combustivel: 'Gasolina', siglaCombustivel: 'G', dataConsulta: '2026-10-27' }
const signal = () => new AbortController().signal
const draft = () => vehicles.vehicleDraft(vehicle)
function session(role = 'AUCTIONEER', status = 'authenticated') {
  const snapshot = { status, user: status === 'authenticated' ? { id: 'user', name: 'Ana', role } : null, message: null }
  return { getSnapshot: () => snapshot, subscribe: () => () => {}, refresh() {}, logout() {}, withSession() { throw Error('No real writes permitted') } }
}
function render(element, path = '/area-leiloeiro/veiculos/novo', auth = session()) {
  return renderToString(h(ThemeContext.Provider, { value: { theme: 'light', toggleTheme() {} } }, h(Context.Provider, { value: auth }, h(MemoryRouter, { initialEntries: [path] }, element))))
}
before(async () => {
  server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  vehicles = await server.ssrLoadModule('/src/services/vehicles.ts')
  fipe = await server.ssrLoadModule('/src/services/fipe.ts')
  Form = (await server.ssrLoadModule('/src/components/auctioneer/VehicleForm.tsx')).VehicleForm
  const pages = await server.ssrLoadModule('/src/pages/AuctioneerVehiclePage.tsx')
  Page = pages.AuctioneerVehiclePage; Confirmation = pages.VehicleDeleteConfirmation
  Context = (await server.ssrLoadModule('/src/components/auth/auth-context.ts')).AuthContext
  ThemeContext = (await server.ssrLoadModule('/src/components/theme/theme-context.ts')).ThemeContext
  App = (await server.ssrLoadModule('/src/App.tsx')).App
  createSession = (await server.ssrLoadModule('/src/services/auth-session.ts')).createAuthSession
})
afterEach(() => { globalThis.fetch = originalFetch })
after(async () => { await server.close() })

it('requires brand, model and a valid year, matching backend limits', () => {
  const errors = vehicles.validateVehicle(vehicles.vehicleDraft())
  assert.deepEqual(Object.keys(errors).sort(), ['brand', 'model', 'year'])
  for (const year of ['1885', String(new Date().getUTCFullYear() + 2), '2024.5', '2e3', '']) assert(vehicles.validateVehicle({ ...draft(), year }).year)
  assert.deepEqual(vehicles.validateVehicle(draft()), {})
})
it('validates every text boundary and rejects NUL characters', () => {
  for (const [field, max] of Object.entries(vehicles.vehicleTextLimits)) {
    assert(vehicles.validateVehicle({ ...draft(), [field]: 'a'.repeat(max + 1) })[field])
    assert(vehicles.validateVehicle({ ...draft(), [field]: 'a\0b' })[field])
    assert.equal(vehicles.validateVehicle({ ...draft(), [field]: 'a'.repeat(max) })[field], undefined)
  }
})
it('validates image count, length, protocols and embedded credentials', () => {
  for (const imageUrls of ['javascript:alert(1)', 'https://user:pass@example.test/car.jpg', 'file:///car.jpg', 'https://example.test/' + 'a'.repeat(2048), Array(21).fill('https://example.test/car').join('\n')]) assert(vehicles.validateVehicle({ ...draft(), imageUrls }).imageUrls)
  assert.equal(vehicles.validateVehicle({ ...draft(), imageUrls: Array(20).fill('https://example.test/car').join('\n') }).imageUrls, undefined)
})
it('serializes optional blanks as null, image lines as array and prices exactly without float conversion', () => {
  const input = vehicles.vehicleInput({ ...draft(), brand: ' Marca ', description: '', version: ' ', imageUrls: ' https://example.test/a\r\n\nhttps://example.test/b ', fipeReferencePrice: '9999999999999999,99' })
  assert.equal(input.brand, 'Marca'); assert.equal(input.description, null); assert.equal(input.version, null)
  assert.deepEqual(input.imageUrls, ['https://example.test/a', 'https://example.test/b'])
  assert.equal(input.fipeReferencePrice, '9999999999999999.99'); assert.equal(input.year, 2024)
})
it('rejects ambiguous, negative and oversized monetary inputs but accepts zero and missing reference', () => {
  for (const fipeReferencePrice of ['1.000,00', '-1', '1e3', '1,001', '10000000000000000', 'NaN']) assert(vehicles.validateVehicle({ ...draft(), fipeReferencePrice }).fipeReferencePrice)
  assert.equal(vehicles.vehicleInput({ ...draft(), fipeReferencePrice: '0,00' }).fipeReferencePrice, '0.00')
  assert.equal(vehicles.vehicleInput({ ...draft(), fipeReferencePrice: '' }).fipeReferencePrice, null)
})
it('invalid fields prevent requests entirely', async () => {
  globalThis.fetch = () => { throw Error('Request must not happen') }
  await assert.rejects(async () => vehicles.createVehicle({ ...draft(), brand: '' }, 'fixture-token', signal()), error => error.status === 400)
})
it('GET reads the actual vehicle envelope and preserves FIPE codes for editing', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, `/api/vehicles/${id}`); assert.equal(options.method, 'GET'); assert.equal(options.body, undefined)
    return Response.json({ vehicle })
  }
  assert.deepEqual(vehicles.vehicleDraft(await vehicles.getVehicle(id, signal())), draft())
})
it('rejects invalid identifiers, mismatched vehicle responses and malformed data', async () => {
  globalThis.fetch = () => { throw Error('No network for invalid IDs') }
  await assert.rejects(vehicles.getVehicle('invalid', signal()), error => error.status === 400)
  for (const result of [{ vehicle: { ...vehicle, id: otherId } }, { vehicle: { ...vehicle, fipeBrandCode: 1 } }, {}]) {
    globalThis.fetch = async () => Response.json(result)
    await assert.rejects(vehicles.getVehicle(id, signal()), /formato inesperado/)
  }
})
it('POST sends only accepted fields with Bearer and returns the created vehicle (simulated)', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, '/api/vehicles'); assert.equal(options.method, 'POST')
    assert.equal(options.headers.Authorization, 'Bearer fixture-token'); assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error')
    const body = JSON.parse(options.body)
    assert.equal(body.year, 2024); assert.equal(body.fipeReferencePrice, '100000.01')
    for (const key of ['id', 'ownerId', 'role', 'fipeReferencePriceVerified', 'fipeConsultedAt']) assert.equal(body[key], undefined)
    return Response.json({ vehicle }, { status: 201 })
  }
  assert.equal((await vehicles.createVehicle({ ...draft(), ownerId: 'fake', fipeReferencePriceVerified: true }, 'fixture-token', signal())).id, id)
})
it('PATCH uses the existing route and preserves optional FIPE fields (simulated)', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, `/api/vehicles/${id}`); assert.equal(options.method, 'PATCH')
    assert.equal(options.headers.Authorization, 'Bearer fixture-token')
    assert.equal(JSON.parse(options.body).fipeYearCode, '2024-1')
    return Response.json({ vehicle })
  }
  assert.equal((await vehicles.updateVehicle(id, draft(), 'fixture-token', signal())).id, id)
})
it('DELETE sends no body or Content-Type and accepts the existing 204 response (simulated)', async () => {
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).pathname, `/api/vehicles/${id}`); assert.equal(options.method, 'DELETE')
    assert.equal(options.body, undefined); assert.equal(options.headers['Content-Type'], undefined)
    assert.equal(options.headers.Authorization, 'Bearer fixture-token')
    return new Response(null, { status: 204 })
  }
  assert.equal(await vehicles.deleteVehicle(id, 'fixture-token', signal()), null)
})
it('maps 400/401/403/404/409/429 errors without exposing backend internals', async () => {
  for (const [status, message] of [[400, /campos inválidos/], [401, /sessão expirou/], [403, /proprietário/], [404, /não encontrado/], [409, /vínculos/], [429, /Muitas tentativas/]]) {
    globalThis.fetch = async () => Response.json({ message: 'SQL private details' }, { status })
    await assert.rejects(vehicles.updateVehicle(id, draft(), 'fixture-token', signal()), error => {
      assert.equal(error.status, status); assert.match(error.message, message); assert.doesNotMatch(error.message, /SQL/); assert.equal(error.uncertain, false); return true
    })
  }
})
it('network errors, 5xx and invalid success responses are uncertain and never automatically retried', async () => {
  for (const reply of [() => { throw Error('offline') }, () => Response.json({}, { status: 500 }), () => Response.json({}), () => Response.json({ vehicle: { ...vehicle, id: 'bad' } })]) {
    let calls = 0; globalThis.fetch = async () => { calls++; return reply() }
    await assert.rejects(vehicles.createVehicle(draft(), 'fixture-token', signal()), error => error.uncertain === true)
    assert.equal(calls, 1)
  }
  globalThis.fetch = async () => Response.json({ vehicle })
  await assert.rejects(vehicles.deleteVehicle(id, 'fixture-token', signal()), error => error.uncertain === true)
})
it('missing tokens and already cancelled mutations do not reach the network', async () => {
  globalThis.fetch = () => { throw Error('No request allowed') }
  await assert.rejects(vehicles.deleteVehicle(id, '', signal()), error => error.status === 401)
  const controller = new AbortController(); controller.abort()
  await assert.rejects(vehicles.deleteVehicle(id, 'fixture-token', controller.signal), { name: 'AbortError' })
})
it('a timed-out mutation is uncertain and does not resend automatically', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let calls = 0
  globalThis.fetch = async (_url, options) => {
    calls++
    return new Promise((_resolve, reject) => options.signal.addEventListener('abort', () => reject(new DOMException('Timeout', 'AbortError')), { once: true }))
  }
  const pending = vehicles.createVehicle(draft(), 'fixture-token', signal())
  context.mock.timers.tick(12000)
  await assert.rejects(pending, error => error.uncertain === true)
  assert.equal(calls, 1)
})
it('mutation 401 clears the existing session while ownership 403 preserves it', async () => {
  for (const status of [401, 403]) {
    const user = { id: 'user', name: 'Ana', role: 'AUCTIONEER' }, storage = { getItem: () => null, setItem() {}, removeItem() {} }
    const auth = createSession({ storage, api: { login: async () => ({ accessToken: 'fixture-token', expiresIn: 3600, user }), me: async () => user }, schedule: () => 0, cancel() {} })
    await auth.login({}, signal())
    globalThis.fetch = async () => Response.json({}, { status })
    await assert.rejects(auth.withSession((token, inner) => vehicles.deleteVehicle(id, token, inner), signal()))
    assert.equal(auth.getSnapshot().status, status === 401 ? 'anonymous' : 'authenticated'); auth.stop()
  }
})
it('FIPE cascading choices use only the existing car endpoints and actual array shapes', async () => {
  const replies = new Map([
    ['/api/fipe/marcas/carros', [{ nome: 'Marca', valor: '1' }]],
    ['/api/fipe/modelos/carros/1', [{ modelo: 'Modelo', valor: '2' }]],
    ['/api/fipe/anos/carros/1/2', [{ nome: '2024 Gasolina', valor: '2024-1' }]],
  ])
  globalThis.fetch = async (url, options) => { assert.equal(options.method, 'GET'); assert.equal(options.headers.Authorization, undefined); const result = replies.get(new URL(url).pathname); assert(result); return Response.json(result) }
  assert.deepEqual(await fipe.getFipeBrands(signal()), [{ label: 'Marca', code: '1' }])
  assert.deepEqual(await fipe.getFipeModels('1', signal()), [{ label: 'Modelo', code: '2' }])
  assert.deepEqual(await fipe.getFipeYears('1', '2', signal()), [{ label: '2024 Gasolina', code: '2024-1' }])
})
it('FIPE details parse Brazilian prices exactly and never attest verified pricing', async () => {
  globalThis.fetch = async url => { assert.equal(new URL(url).pathname, '/api/fipe/detalhes/carros/1/2/2024-1'); return Response.json(detail) }
  assert.deepEqual(await fipe.getFipeDetails('1', '2', '2024-1', signal()), { brand: 'Marca', model: 'Modelo', year: 2024, price: '100000.01', fipeCode: '000001-1', month: 'outubro de 2026' })
  assert.equal(fipe.fipeMoney('R$ 9.999.999.999.999.999,99'), '9999999999999999.99')
  assert.throws(() => fipe.fipeMoney('R$ 1.00,00'))
})
it('FIPE rejects invalid codes before requesting and malformed or mismatched responses', async () => {
  globalThis.fetch = () => { throw Error('No request allowed') }
  await assert.rejects(fipe.getFipeModels('../bad', signal()))
  await assert.rejects(fipe.getFipeDetails('1', '2', 'invalid', signal()))
  for (const changes of [{ anoModelo: 2023 }, { tipoVeiculo: 2 }, { valor: 'bad' }, { codigoFipe: 'bad' }]) {
    globalThis.fetch = async () => Response.json({ ...detail, ...changes })
    await assert.rejects(fipe.getFipeDetails('1', '2', '2024-1', signal()), /inválidos/)
  }
  globalThis.fetch = async () => Response.json({ data: [] })
  await assert.rejects(fipe.getFipeBrands(signal()), /inválidos/)
})
it('special FIPE zero-km year codes are not silently converted into a valid vehicle year', async () => {
  globalThis.fetch = async () => Response.json({ ...detail, anoModelo: 32000 })
  const result = await fipe.getFipeDetails('1', '2', '32000-1', signal())
  assert(vehicles.validateVehicle({ ...draft(), year: String(result.year) }).year)
})
it('form renders required labels, optional metadata, inline errors and no request during render', () => {
  globalThis.fetch = () => { throw Error('Render must not write') }
  const html = render(h(Form, { draft: draft(), errors: { brand: 'Informe a marca.' }, busy: false, blocked: false, editing: false, change() {}, submit() {} }))
  assert.match(html, /aria-label="Cadastrar veículo"/); assert.match(html, /Informe a marca/); assert.match(html, /aria-invalid="true"/)
  for (const name of Object.keys(draft())) assert(html.includes(`name="${name}"`))
  assert.match(html, /referência não verificada/); assert.match(html, /<fieldset/)
})
it('busy and uncertain form states disable all mutation inputs', () => {
  for (const props of [{ busy: true, blocked: false }, { busy: false, blocked: true }]) {
    const html = render(h(Form, { draft: draft(), errors: {}, editing: true, change() {}, submit() {}, ...props }))
    assert.match(html, /<fieldset disabled=""/)
  }
})
it('exclusion requires an explicit confirmation naming the vehicle and offers cancellation', () => {
  let calls = 0
  const html = render(h(Confirmation, { vehicle, busy: false, confirm() { calls++ }, cancel() {} }))
  assert.equal(calls, 0); assert.match(html, /role="alertdialog"/); assert.match(html, /Marca<!-- --> <!-- -->Modelo/)
  assert.match(html, /Confirmar exclusão definitiva/); assert.match(html, /Manter veículo/)
})
it('create and edit routes are guarded for BIDDER and anonymous sessions', () => {
  for (const path of ['/area-leiloeiro/veiculos/novo', `/area-leiloeiro/veiculos/${id}/editar`]) {
    assert.match(render(h(App), path, session('BIDDER')), /Acesso não permitido/)
    assert.doesNotMatch(render(h(App), path, session('BIDDER')), /aria-label="Cadastrar veículo"/)
    assert.doesNotMatch(render(h(App), path, session(undefined, 'anonymous')), /Dados do veículo/)
  }
  assert.match(render(h(Page, { create: true }), undefined, session('BIDDER')), /Acesso exclusivo/)
})
it('AUCTIONEER can open create form without fetching FIPE or submitting a vehicle', () => {
  globalThis.fetch = () => { throw Error('No automatic writes or FIPE query') }
  const html = render(h(App))
  assert.match(html, /aria-label="Cadastrar veículo"/); assert.match(html, /Consultar FIPE/)
  assert.doesNotMatch(html, /Confirmar exclusão definitiva/)
})
it('AUCTIONEER edit routes load safely and reject invalid vehicle IDs', () => {
  assert.match(render(h(App), `/area-leiloeiro/veiculos/${id}/editar`), /Consultando registros/)
  assert.match(render(h(App), '/area-leiloeiro/veiculos/invalid/editar'), /Veículo inválido/)
})
it('returning to the list displays operation success and starts with fresh loading state', () => {
  const html = render(h(App), { pathname: '/area-leiloeiro/veiculos', state: { vehicleNotice: 'Veículo atualizado com sucesso.' } })
  assert.match(html, /Veículo atualizado com sucesso/)
  assert.match(html, /Consultando registros/)
  assert.match(html, /href="\/area-leiloeiro\/veiculos\/novo"/)
})
