import assert from 'node:assert/strict'
import { after, afterEach, before, describe, it } from 'node:test'
import { createServer } from 'vite'

let server, service, rules
const fetchOriginal = globalThis.fetch
const auction = { id: 'auction-a', title: 'Fixture de detalhes', description: 'Descrição pública', status: 'OPEN', startsAt: '2030-01-01T12:00:00Z', endsAt: '2030-01-01T16:00:00Z' }
const lot = { id: 'lot-a', auctionId: auction.id, number: 1, status: 'OPEN', startingPrice: '100.00', minimumIncrement: '0.10', endsAt: '2030-01-01T16:02:00Z', vehicle: { id: 'vehicle-a', brand: 'Marca', model: 'Modelo', year: 2020, version: null, imageUrls: [], description: null, fipeReferencePrice: null } }
const bid = { id: 'bid-a', lotId: lot.id, amount: '100.50', sequence: 1, createdAt: '2030-01-01T13:00:00Z' }
const response = (data, status = 200) => new Response(JSON.stringify(data), { status })
const signal = () => new AbortController().signal
before(async () => {
  server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  service = await server.ssrLoadModule('/src/services/auctions.ts')
  rules = await server.ssrLoadModule('/src/services/auction-rules.ts')
})
afterEach(() => { globalThis.fetch = fetchOriginal })
after(async () => { await server?.close() })

describe('Detalhes públicos: contratos e paginação sem acesso ao banco', () => {
  it('consulta detalhe real no envelope auction apenas por GET', async () => {
    globalThis.fetch = async (input, options) => {
      assert.equal(new URL(input).pathname, '/api/auctions/auction-a')
      assert.equal(options.method, 'GET')
      assert.equal(options.credentials, 'omit')
      return response({ auction })
    }
    assert.equal((await service.getAuction(auction.id, signal())).description, auction.description)
  })
  it('preserva 404 para o estado de leilão não encontrado', async () => {
    globalThis.fetch = async () => response({}, 404)
    await assert.rejects(service.getAuction(auction.id, signal()), error => error.status === 404)
  })
  it('não aceita detalhe de outro leilão', async () => {
    globalThis.fetch = async () => response({ auction: { ...auction, id: 'outro' } })
    await assert.rejects(service.getAuction(auction.id, signal()), /formato inesperado/)
  })
  it('permite alcançar lotes de outras páginas sem carregar todos de uma vez', async () => {
    globalThis.fetch = async input => {
      const url = new URL(input)
      assert.equal(url.pathname, '/api/auctions/auction-a/lots')
      assert.equal(url.searchParams.get('page'), '2')
      assert.equal(url.searchParams.get('limit'), '10')
      return response({ data: [lot], pagination: { page: 2, limit: 10, total: 11, totalPages: 2 } })
    }
    const page = await service.getLotsPage(auction.id, 2, signal())
    assert.equal(page.pagination.totalPages, 2)
    assert.equal(page.data[0].vehicle.imageUrls.length, 0)
  })
  it('rejeita lote que pertence a outro leilão ou tem ID divergente', async () => {
    for (const changes of [{ auctionId: 'outro' }, { id: 'outro' }]) {
      globalThis.fetch = async () => response({ lot: { ...lot, ...changes } })
      await assert.rejects(service.getLot(auction.id, lot.id, signal()))
    }
  })
  it('preserva o prazo individual prorrogado retornado pela API', async () => {
    globalThis.fetch = async () => response({ lot })
    assert.equal((await service.getLot(auction.id, lot.id, signal())).endsAt, lot.endsAt)
    assert.notEqual(lot.endsAt, auction.endsAt)
  })
  it('consulta histórico paginado sem expor ou exigir identidade de participantes', async () => {
    globalThis.fetch = async input => {
      const url = new URL(input)
      assert.equal(url.pathname, '/api/lots/lot-a/bids')
      assert.equal(url.searchParams.get('page'), '2')
      assert.equal(url.searchParams.get('limit'), '10')
      return response({ data: [bid], pagination: { page: 2, limit: 10, total: 11, totalPages: 2 } })
    }
    const page = await service.getBidHistory(lot.id, 2, signal())
    assert.equal(page.data[0].amount, '100.50')
    assert.equal(page.data[0].userId, undefined)
  })
})

describe('Regras de referência e confiança temporal', () => {
  it('primeiro lance usa o preço inicial sem somar incremento', () => {
    assert.equal(rules.referenceNextBid(lot, null, true), '100.00')
  })
  it('incrementa centavos exatos sem arredondamento de ponto flutuante', () => {
    assert.equal(rules.referenceNextBid(lot, bid, true), '100.60')
    assert.equal(rules.referenceNextBid({ ...lot, minimumIncrement: '0.01' }, { ...bid, amount: '9999999999999999.98' }, true), '9999999999999999.99')
  })
  it('não publica valor mínimo quando faltam dados ou há inconsistência', () => {
    for (const [candidate, latest, available] of [
      [lot, bid, false], [lot, { ...bid, lotId: 'outro' }, true], [lot, { ...bid, sequence: 0 }, true],
      [{ ...lot, minimumIncrement: '0.00' }, bid, true], [lot, { ...bid, amount: '9999999999999999.99' }, true],
      [lot, { ...bid, amount: '0.00' }, true], [{ ...lot, startingPrice: 'valor inválido' }, null, true],
    ]) assert.equal(rules.referenceNextBid(candidate, latest, available), null)
  })
  it('OPEN não comprova prazo confiável nem elegibilidade UTC_V2', () => {
    assert.equal(rules.deadlineState(auction, lot), 'unverified')
    assert.equal(rules.deadlineState(auction, { ...lot, endsAt: '2099-01-01T00:00:00Z' }), 'unverified')
  })
  it('lotes e leilões terminais nunca aparecem com contagem ativa', () => {
    for (const status of ['SOLD', 'UNSOLD', 'CANCELLED']) assert.equal(rules.deadlineState(auction, { ...lot, status }), 'closed')
    for (const status of ['CLOSED', 'CANCELLED']) assert.equal(rules.deadlineState({ ...auction, status }, lot), 'closed')
  })
  it('agendados e lotes pendentes não iniciam contagem', () => {
    assert.equal(rules.deadlineState({ ...auction, status: 'SCHEDULED' }, lot), 'not-open')
    assert.equal(rules.deadlineState(auction, { ...lot, status: 'PENDING' }), 'not-open')
  })
})
