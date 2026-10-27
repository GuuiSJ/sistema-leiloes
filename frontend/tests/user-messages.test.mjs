import assert from 'node:assert/strict'
import { before, after, afterEach, it } from 'node:test'
import { createServer } from 'vite'

let server, messages, auth, api, bids, management
const originalFetch = globalThis.fetch
before(async () => {
  server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  messages = await server.ssrLoadModule('/src/services/user-messages.ts')
  auth = await server.ssrLoadModule('/src/services/auth.ts')
  api = await server.ssrLoadModule('/src/services/api.ts')
  bids = await server.ssrLoadModule('/src/services/bids.ts')
  management = await server.ssrLoadModule('/src/services/auction-management.ts')
})
afterEach(() => { globalThis.fetch = originalFetch })
after(async () => { await server.close() })

it('hides technical errors, stack traces, internal URLs and paths', () => {
  for (const value of ['PrismaClientKnownRequestError: P2002', 'bcrypt invalid salt', 'JWT malformed', 'SELECT password FROM users', 'SQL connection failed', 'TypeError: invalid data', 'Falha\n    at server.ts:12:5', 'ECONNREFUSED', 'Erro em C:\\private\\server.ts', 'Erro em https://internal.example/db', 'Error: private data']) {
    assert.equal(messages.userMessage(value), 'Não foi possível concluir a operação. Tente novamente.', value)
    assert.equal(new auth.AuthError(value, 403).status, 403)
    assert.doesNotMatch(new api.ApiError(value).message, /Prisma|bcrypt|JWT|SELECT|SQL|private|internal|ECONN/)
  }
})
it('translates byte limits and preserves useful safe messages and retry guidance', () => {
  assert.equal(messages.userMessage('Senha com no máximo 72 bytes.'), 'A senha informada é muito longa.')
  assert.equal(messages.userMessage('Limite de 100 bytes.'), 'O valor informado é muito longo.')
  for (const value of ['Informe um e-mail válido.', 'Saldo disponível insuficiente para este lance.', 'Sua sessão expirou. Entre novamente.', 'Resultado não confirmado. Repita a mesma tentativa.']) assert.equal(messages.userMessage(value), value)
  assert.equal(messages.userMessage('JWT invalid', 'Resultado não confirmado. Repita a mesma tentativa.'), 'Resultado não confirmado. Repita a mesma tentativa.')
  assert.equal(messages.userMessage(null), 'Não foi possível concluir a operação. Tente novamente.')
})
it('keeps the real password size limit including accents and emoji without exposing bytes', () => {
  const fields = password => auth.validateAuthFields({ email: 'teste@example.com', password }, true)
  assert.equal(fields('a'.repeat(72)).password, undefined)
  assert.equal(fields('a'.repeat(73)).password, 'A senha informada é muito longa.')
  assert.equal(fields('😀'.repeat(18)).password, undefined)
  assert.equal(fields('😀'.repeat(19)).password, 'A senha informada é muito longa.')
  assert.equal(fields('á'.repeat(37)).password, 'A senha informada é muito longa.')
  assert.equal(fields('').password, 'Preencha este campo.')
  assert.match(fields('abc').password, /pelo menos 8 caracteres/)
  assert.match(fields('abcdefgh\0').password, /caractere inválido/)
})
it('allows known server eligibility reasons and never displays unexpected server text (mock GET)', async () => {
  for (const [reason, expected] of [
    ['Saldo disponível insuficiente para o próximo lance.', /Saldo disponível insuficiente/],
    ['Não é permitido dar lance no próprio leilão ou veículo.', /próprio leilão ou veículo/],
    ['Leilão e lote devem estar abertos e dentro do período de lances.', /não está disponível/],
    ['Prisma: SELECT password FROM users', /Não é possível participar/],
    ['private debug details', /Não é possível participar/],
  ]) {
    globalThis.fetch = async (_url, options) => { assert.equal(options.method, 'GET'); return Response.json({ eligible: false, reason }) }
    const result = await bids.getBidEligibility('fixture', 'fixture-token', new AbortController().signal)
    assert.equal(result.eligible, false); assert.match(result.reason, expected)
  }
})
it('retains HTTP metadata and uncertainty flags while sanitizing messages', () => {
  const error = new management.AuctionManagementError('Prisma private details', 503, true)
  assert.equal(error.status, 503); assert.equal(error.uncertain, true)
  const bid = new bids.BidError('Repita esta tentativa.', 409, true)
  assert.equal(bid.status, 409); assert.equal(bid.retrySameKey, true)
  assert.equal(bid.message, 'Repita esta tentativa.')
})
