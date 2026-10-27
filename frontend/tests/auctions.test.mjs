import assert from 'node:assert/strict'
import { after, afterEach, before, describe, it } from 'node:test'
import { createServer } from 'vite'

let server, service, format, api
const originalFetch = globalThis.fetch
const auction = { id: 'auction-fixture', title: 'Fixture isolada', status: 'OPEN', startsAt: '2030-01-01T12:00:00Z', endsAt: '2030-01-01T15:00:00Z' }
const lot = { id: 'lot-fixture', auctionId: auction.id, number: 1, startingPrice: '100.00', minimumIncrement: '10.00', status: 'OPEN', endsAt: auction.endsAt,
  vehicle: { id: 'vehicle-fixture', brand: 'Marca de teste', model: 'Modelo de teste', year: 2020, version: null, imageUrls: [] } }
const bid = { id: 'bid-fixture', lotId: lot.id, amount: '120.00', sequence: 2, createdAt: '2030-01-01T12:30:00Z' }
const page = (data, total = data.length) => ({ data, pagination: { page: 1, limit: Math.max(data.length, 1), total, totalPages: Math.ceil(total / Math.max(data.length, 1)) } })
const signal = () => new AbortController().signal
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

before(async () => {
  // Vite loads TypeScript/import.meta.env; all HTTP requests are replaced below.
  server = await createServer({ server: { middlewareMode: true }, appType: 'custom' })
  service = await server.ssrLoadModule('/src/services/auctions.ts')
  format = await server.ssrLoadModule('/src/services/formatters.ts')
  api = await server.ssrLoadModule('/src/services/api.ts')
})
afterEach(() => { globalThis.fetch = originalFetch })
after(async () => { await server?.close() })

describe('Consultas públicas com respostas isoladas; sem acesso ao backend', () => {
  it('combina OPEN/SCHEDULED, veículo embutido e último lance com operações apenas GET', async () => {
    const calls = []
    globalThis.fetch = async (input, options) => {
      const url = new URL(input)
      calls.push(url.pathname)
      assert.equal(options.method, 'GET')
      assert.equal(options.credentials, 'omit')
      if (url.pathname === '/api/auctions') return response(page([{ ...auction, id: url.searchParams.get('status'), status: url.searchParams.get('status') }]))
      assert.equal(url.searchParams.get('limit'), '1')
      if (url.pathname.endsWith('/lots')) return response(page([lot], 3))
      if (url.pathname.endsWith('/bids')) return response(page([bid]))
      throw new Error('Endpoint inesperado')
    }
    const result = await service.loadFeatured(signal())
    assert.deepEqual(result.items.map(item => item.auction.status), ['OPEN', 'SCHEDULED'])
    assert.equal(result.items[0].lot.vehicle.year, 2020)
    assert.equal(result.items[0].latestBid.amount, '120.00')
    assert.equal(result.items[0].totalLots, 3)
    assert.equal(calls.length, 6)
    assert(!calls.some(path => path.includes('/vehicles')))
  })
  it('mantém ausência de lances distinta do valor inicial', async () => {
    globalThis.fetch = async input => response(page(new URL(input).pathname.endsWith('/lots') ? [lot] : []))
    const item = await service.previewAuction(auction, signal())
    assert.equal(item.latestBid, null)
    assert.equal(item.bidUnavailable, false)
    assert.equal(item.lot.startingPrice, '100.00')
  })
  it('falha de lances não é representada como nenhum lance', async () => {
    globalThis.fetch = async input => new URL(input).pathname.endsWith('/lots') ? response(page([lot])) : response({}, 500)
    const item = await service.previewAuction(auction, signal())
    assert.equal(item.bidUnavailable, true)
    assert.equal(item.latestBid, null)
    assert.equal(item.lot.id, lot.id)
  })
  it('falha de lotes não produz um veículo fictício', async () => {
    globalThis.fetch = async () => response({}, 503)
    const item = await service.previewAuction(auction, signal())
    assert.equal(item.lotUnavailable, true)
    assert.equal(item.lot, null)
    assert.equal(item.totalLots, null)
  })
  it('estado vazio não dispara consultas de lotes ou lances', async () => {
    let count = 0
    globalThis.fetch = async input => {
      assert.equal(new URL(input).pathname, '/api/auctions')
      count++
      return response(page([]))
    }
    assert.equal((await service.loadFeatured(signal())).items.length, 0)
    assert.equal(count, 2)
  })
  it('preserva a paginação real da lista inicial', async () => {
    globalThis.fetch = async input => {
      const url = new URL(input)
      assert.equal(url.searchParams.get('page'), '2')
      assert.equal(url.searchParams.get('limit'), '6')
      return response({ data: [], pagination: { page: 2, limit: 6, total: 9, totalPages: 2 } })
    }
    const result = await service.loadAuctionPage(2, signal())
    assert.equal(result.pagination.total, 9)
    assert.equal(result.pagination.page, 2)
  })
  it('rejeita formato inválido da API', async () => {
    globalThis.fetch = async () => response({ data: [{ title: 'Incompleto' }], pagination: page([]).pagination })
    await assert.rejects(service.listAuctions(1, 6, signal()), /formato inesperado/)
  })
  it('não publica mensagens internas de erro do backend', async () => {
    globalThis.fetch = async () => response({ message: 'segredo-interno-fixture' }, 500)
    await assert.rejects(service.listAuctions(1, 6, signal()), error => !error.message.includes('segredo-interno-fixture'))
  })
  it('propaga cancelamento sem transformar em lista vazia', async () => {
    const controller = new AbortController()
    controller.abort()
    globalThis.fetch = async (_input, options) => {
      assert(options.signal.aborted)
      throw new DOMException('Cancelado', 'AbortError')
    }
    await assert.rejects(api.getJson('/api/auctions', controller.signal), error => error.name === 'AbortError')
  })
})

describe('Valores, datas e fotografias', () => {
  it('mantém centavos exatos até o limite Decimal(18,2)', () => {
    assert.equal(format.formatMoney('9999999999999999.99').replace(/\s/g, ' '), 'R$ 9.999.999.999.999.999,99')
    assert.equal(format.formatMoney('100.50').replace(/\s/g, ' '), 'R$ 100,50')
    assert.equal(format.formatMoney(null), '—')
  })
  it('formata datas no horário de Brasília e lida com valores inválidos', () => {
    assert.match(format.formatDate('2030-01-01T15:00:00Z'), /01\/01\/2030.*12:00/)
    assert.equal(format.formatDate('inválido'), 'Data não informada')
  })
  it('permite somente URLs HTTP(S) sem credenciais', () => {
    assert.equal(format.validPhotoUrl('https://example.invalid/car.jpg'), true)
    for (const url of ['javascript:alert(1)', 'data:image/svg+xml,test', '/foto.jpg', 'https://user:pass@example.invalid/car.jpg', 'inválido']) {
      assert.equal(format.validPhotoUrl(url), false)
    }
  })
})
