import assert from 'node:assert/strict'
import { after, afterEach, before, describe, it } from 'node:test'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { createServer } from 'vite'

let server, wallet, auth, sessions, Balances, History, Section, AuthContext, Account
const realFetch = globalThis.fetch, stores = []
const token = 'synthetic.wallet.token'
const user = { id: 'synthetic-user', name: 'Pessoa de teste', email: 'pessoa@example.invalid', role: 'BIDDER', createdAt: '2026-10-27T12:00:00Z' }
const snapshot = { totalBalance: '500.50', reservedBalance: '120.10', availableBalance: '380.40' }
const movement = { id: 'movement-fixture', type: 'CREDIT', amount: '500.50', balanceAfter: '500.50', createdAt: '2030-01-01T15:00:00Z', simulated: true }
const pagination = { page: 1, limit: 10, total: 1, totalPages: 1 }
const reply = (body, status = 200) => new Response(JSON.stringify(body), { status })
const signal = () => new AbortController().signal
const state = (data = null, extra = {}) => ({ loading: false, data, error: null, retry: () => {}, ...extra })

function sessionFixture() {
  const values = new Map()
  const store = sessions.createAuthSession({ api: { login: async () => ({ user, accessToken: token, tokenType: 'Bearer', expiresIn: 60 }), me: async () => user },
    storage: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) } })
  stores.push(store)
  return { store, values }
}

before(async () => {
  server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  wallet = await server.ssrLoadModule('/src/services/wallet.ts')
  auth = await server.ssrLoadModule('/src/services/auth.ts')
  sessions = await server.ssrLoadModule('/src/services/auth-session.ts')
  Balances = (await server.ssrLoadModule('/src/components/wallet/WalletBalances.tsx')).WalletBalances
  History = (await server.ssrLoadModule('/src/components/wallet/WalletTransactions.tsx')).WalletTransactions
  Section = (await server.ssrLoadModule('/src/components/wallet/WalletSection.tsx')).WalletSection
  AuthContext = (await server.ssrLoadModule('/src/components/auth/auth-context.ts')).AuthContext
  Account = (await server.ssrLoadModule('/src/pages/AccountPage.tsx')).AccountPage
})
afterEach(() => { globalThis.fetch = realFetch; stores.splice(0).forEach(store => store.stop()) })
after(async () => { await server?.close() })

describe('Carteira: contrato real com HTTP simulado, sem chamadas financeiras reais', () => {
  it('consulta saldo por GET Bearer sem corpo, cookies ou token na URL', async () => {
    globalThis.fetch = async (input, options) => {
      const url = new URL(input)
      assert.equal(url.pathname, '/api/wallet'); assert.equal(url.search, '')
      assert.equal(options.method, 'GET'); assert.equal(options.headers.Authorization, `Bearer ${token}`)
      assert.equal(options.body, undefined); assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store')
      assert(!input.includes(token)); return reply({ wallet: { ...snapshot, privateField: 'não reter' } })
    }
    assert.deepEqual(await wallet.getWallet(token, signal()), snapshot)
  })
  it('preserva zeros recebidos da API, sem usá-los como fallback', async () => {
    const zeros = { totalBalance: '0.00', reservedBalance: '0.00', availableBalance: '0.00' }
    globalThis.fetch = async () => reply({ wallet: zeros })
    assert.deepEqual(await wallet.getWallet(token, signal()), zeros)
  })
  it('rejeita saldo ausente, negativo, contraditório ou com tipo indevido', async () => {
    for (const body of [
      { totalBalance: '500.50', reservedBalance: '120.10' }, { ...snapshot, availableBalance: '500.50' },
      { ...snapshot, totalBalance: -1 }, { ...snapshot, reservedBalance: '-1.00' },
    ]) {
      globalThis.fetch = async () => reply({ wallet: body })
      await assert.rejects(wallet.getWallet(token, signal()), /não puderam ser validados/)
    }
  })
  it('lê histórico paginado e mantém somente os campos públicos reais', async () => {
    globalThis.fetch = async (input, options) => {
      const url = new URL(input)
      assert.equal(url.pathname, '/api/wallet/transactions'); assert.equal(url.searchParams.get('page'), '2'); assert.equal(url.searchParams.get('limit'), '10')
      assert.equal(options.method, 'GET'); assert.equal(options.body, undefined)
      return reply({ data: [{ ...movement, idempotencyKey: 'não expor', userId: 'não expor', description: 'campo que não existe no contrato' }], pagination: { page: 2, limit: 10, total: 11, totalPages: 2 } })
    }
    const result = await wallet.getWalletHistory(2, token, signal())
    assert.deepEqual(result.data[0], movement)
    assert.equal(result.data[0].description, undefined); assert.equal(result.data[0].userId, undefined)
    assert.equal(result.pagination.totalPages, 2)
  })
  it('aceita histórico vazio e os quatro tipos reais de movimentação', async () => {
    globalThis.fetch = async () => reply({ data: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } })
    assert.equal((await wallet.getWalletHistory(1, token, signal())).data.length, 0)
    for (const type of ['CREDIT', 'DEBIT', 'RESERVE', 'RELEASE']) {
      globalThis.fetch = async () => reply({ data: [{ ...movement, type, simulated: false }], pagination })
      assert.equal((await wallet.getWalletHistory(1, token, signal())).data[0].type, type)
    }
  })
  it('401 e 403 são distintos e nunca exibem a mensagem privada do servidor', async () => {
    for (const status of [401, 403]) {
      globalThis.fetch = async () => reply({ message: 'segredo de servidor' }, status)
      await assert.rejects(wallet.getWallet(token, signal()), error => error.status === status && error instanceof auth.AuthError && !error.message.includes('segredo'))
    }
  })
  it('erro de rede e cancelamento não viram saldos zerados', async () => {
    globalThis.fetch = async () => { throw Error('conexão com detalhe privado') }
    await assert.rejects(wallet.getWallet(token, signal()), error => error.message.includes('conexão') && !error.message.includes('privado'))
    const controller = new AbortController(); controller.abort()
    globalThis.fetch = async (_input, options) => { assert(options.signal.aborted); throw new DOMException('Cancelado', 'AbortError') }
    await assert.rejects(wallet.getWallet(token, controller.signal), error => error.name === 'AbortError')
  })
  it('rejeita paginação, tipo e formato monetário incorretos', async () => {
    await assert.rejects(wallet.getWalletHistory(0, token, signal()))
    for (const data of [{ ...movement, type: 'TRANSFER' }, { ...movement, amount: 50 }, { ...movement, type: 'DEBIT', simulated: true }]) {
      globalThis.fetch = async () => reply({ data: [data], pagination })
      await assert.rejects(wallet.getWalletHistory(1, token, signal()))
    }
    globalThis.fetch = async () => reply({ data: [movement], pagination: { ...pagination, totalPages: 2 } })
    await assert.rejects(wallet.getWalletHistory(1, token, signal()))
  })
})

describe('Autorização das consultas financeiras e isolamento da sessão', () => {
  it('não executa uma consulta sem sessão autenticada', async () => {
    const { store } = sessionFixture(); let called = false
    await store.refresh()
    await assert.rejects(store.withSession(async () => { called = true }, signal()), error => error.status === 401)
    assert.equal(called, false)
  })
  it('mantém token encapsulado e o envia somente à função autenticada', async () => {
    const { store } = sessionFixture(); await store.login({}, signal())
    const result = await store.withSession(async (received, requestSignal) => { assert.equal(received, token); assert(!requestSignal.aborted); return snapshot }, signal())
    assert.deepEqual(result, snapshot)
    assert(!JSON.stringify(store.getSnapshot()).includes(token))
  })
  it('401 remove a sessão; 403 mantém perfil mas não libera os dados', async () => {
    for (const status of [401, 403]) {
      const { store, values } = sessionFixture(); await store.login({}, signal())
      await assert.rejects(store.withSession(async () => { throw new wallet.WalletError('Recusado', status) }, signal()))
      assert.equal(store.getSnapshot().status, status === 401 ? 'anonymous' : 'authenticated')
      if (status === 401) assert.equal(values.size, 0)
    }
  })
  it('logout cancela consulta e descarta resposta tardia com valores', async () => {
    const { store } = sessionFixture(); await store.login({}, signal())
    let resolveRead, requestSignal
    const pending = store.withSession(async (_token, s) => { requestSignal = s; return new Promise(resolve => { resolveRead = resolve }) }, signal())
    store.logout(); assert(requestSignal.aborted); resolveRead(snapshot)
    await assert.rejects(pending, error => error.name === 'AbortError')
    assert.equal(store.getSnapshot().status, 'anonymous')
  })
  it('consulta cancelada pelo componente não encerra sessão válida', async () => {
    const { store } = sessionFixture(); await store.login({}, signal())
    const controller = new AbortController()
    const pending = store.withSession(async (_token, s) => { controller.abort(); assert(s.aborted); return snapshot }, controller.signal)
    await assert.rejects(pending, error => error.name === 'AbortError')
    assert.equal(store.getSnapshot().status, 'authenticated')
  })
})

function renderSession(element, role = 'BIDDER', status = 'authenticated') {
  const snapshot = { status, user: status === 'authenticated' ? { ...user, role } : null, message: null }
  const store = { getSnapshot: () => snapshot, subscribe: () => () => {}, refresh: async () => {}, logout: () => {},
    withSession: () => { throw Error('Renderização não deve consultar carteira') } }
  return renderToString(createElement(AuthContext.Provider, { value: store }, createElement(MemoryRouter, null, element)))
}
describe('Painel financeiro: valores, estados e perfil sem rede', () => {
  it('saldo só aparece após resposta, formatado em reais sem arredondar centavos', () => {
    const html = renderToString(createElement(Balances, { state: state(snapshot), checkSession: () => {} }))
    assert.match(html, /380,40/); assert.match(html, /120,10/); assert.match(html, /500,50/)
    const huge = { totalBalance: '9999999999999999.99', availableBalance: '9999999999999999.99', reservedBalance: '0.00' }
    assert(renderToString(createElement(Balances, { state: state(huge), checkSession: () => {} })).includes('9.999.999.999.999.999,99'))
  })
  it('carregamento, indisponibilidade e permissão não exibem zero como fallback', () => {
    for (const s of [state(), state(null, { loading: true }), state(null, { error: new wallet.WalletError('Perfil sem acesso', 403) }), state(null, { error: new wallet.WalletError('Sessão inválida', 401) })]) {
      const html = renderToString(createElement(Balances, { state: s, checkSession: () => {} }))
      assert(!html.includes('0,00'))
      if (s.loading) assert(html.includes('Consultando saldos'))
      if (s.error?.status === 403) assert(html.includes('Consulta não permitida'))
      if (s.error?.status === 401) assert(html.includes('Sessão não confirmada'))
    }
  })
  it('histórico vazio é explícito e não inventa movimentações', () => {
    const html = renderToString(createElement(History, { state: state({ data: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } }), page: 1, changePage: () => {}, checkSession: () => {} }))
    assert(html.includes('Nenhuma movimentação registrada')); assert(!html.includes('<tbody>'))
  })
  it('histórico usa indicador simulado, datas reais e ausência de descrição', () => {
    const html = renderToString(createElement(History, { state: state({ data: [movement], pagination }), page: 1, changePage: () => {}, checkSession: () => {} }))
    assert(html.includes('Simulado')); assert(html.includes('Não informada')); assert.match(html, /01\/01\/2030.*12:00/)
    assert(!html.includes('userId')); assert(!html.includes('idempotencyKey'))
  })
  it('BIDDER consulta por ação explícita; AUCTIONEER não dispara carteira', () => {
    assert.equal(wallet.canViewWallet('BIDDER'), true); assert.equal(wallet.canViewWallet('AUCTIONEER'), false)
    const bidder = renderSession(createElement(Section))
    assert(bidder.includes('Consultar carteira')); assert(bidder.includes('primeira consulta pode criar'))
    assert(!bidder.includes('R$'))
    const auctioneer = renderSession(createElement(Section), 'AUCTIONEER')
    assert(auctioneer.includes('apenas para o perfil de participante')); assert(!auctioneer.includes('Consultar carteira'))
    assert.equal(renderSession(createElement(Section), 'BIDDER', 'anonymous'), '')
  })
  it('painel mantém perfil, logout e link de leiloeiro sem opções financeiras de escrita', () => {
    const html = renderSession(createElement(Account), 'AUCTIONEER')
    assert(html.includes('Meu perfil')); assert(html.includes('Sair da conta')); assert(html.includes('/area-leiloeiro'))
    assert(!html.includes('/credit')); assert(!html.includes('Adicionar saldo')); assert(!html.includes(token))
  })
})
