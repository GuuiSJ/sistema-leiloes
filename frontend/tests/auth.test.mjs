import assert from 'node:assert/strict'
import { after, afterEach, before, describe, it } from 'node:test'
import { createServer } from 'vite'
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter, Routes, Route } from 'react-router'

let server, auth, sessions, context, Form, Guard
const originalFetch = globalThis.fetch
const activeSessions = []
const user = { id: '00000000-0000-4000-8000-000000000001', name: 'Pessoa de teste', email: 'pessoa@example.invalid', role: 'BIDDER', createdAt: '2026-10-27T12:00:00Z' }
const token = 'synthetic.fixture.token'
const credentials = { email: ' PESSOA@example.invalid ', password: 'senha-fixture-123' }
const loginResult = () => ({ user, accessToken: token, tokenType: 'Bearer', expiresIn: 60 })
const json = (body, status = 200) => new Response(JSON.stringify(body), { status })
const signal = () => new AbortController().signal

function fixture(options = {}) {
  const values = new Map(), timers = []
  let time = 1000
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  const api = { login: async () => loginResult(), me: async () => ({ ...user }) }
  const store = sessions.createAuthSession({ api, storage, now: () => time,
    schedule: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer }, cancel: () => {}, ...options })
  activeSessions.push(store)
  return { store, api, values, timers, setTime: value => { time = value } }
}
before(async () => {
  server = await createServer({ server: { middlewareMode: true, ws: false }, appType: 'custom' })
  auth = await server.ssrLoadModule('/src/services/auth.ts')
  sessions = await server.ssrLoadModule('/src/services/auth-session.ts')
  context = (await server.ssrLoadModule('/src/components/auth/auth-context.ts')).AuthContext
  Form = (await server.ssrLoadModule('/src/components/auth/AuthForm.tsx')).AuthForm
  Guard = (await server.ssrLoadModule('/src/components/auth/ProtectedRoute.tsx')).ProtectedRoute
})
afterEach(() => { globalThis.fetch = originalFetch; activeSessions.splice(0).forEach(store => store.stop()) })
after(async () => { await server?.close() })

describe('Contratos de autenticação com HTTP isolado; nenhuma conta real criada', () => {
  it('cadastro envia somente campos aceitos e força BIDDER; não presume token', async () => {
    globalThis.fetch = async (input, options) => {
      assert.equal(new URL(input).pathname, '/api/auth/register')
      assert.equal(options.method, 'POST'); assert.equal(options.credentials, 'omit'); assert.equal(options.cache, 'no-store')
      assert.equal(options.headers.Authorization, undefined)
      assert.deepEqual(JSON.parse(options.body), { name: 'Pessoa de teste', email: 'pessoa@example.invalid', password: credentials.password, role: 'BIDDER' })
      return json({ user, temporal: { representation: 'STORED_UTC_INSTANT' } }, 201)
    }
    const result = await auth.authApi.register({ ...credentials, name: ' Pessoa de teste ', role: 'AUCTIONEER', confirmation: 'não enviar' }, signal())
    assert.equal(result.role, 'BIDDER'); assert.equal(result.accessToken, undefined)
  })
  it('login usa apenas email/senha e lê Bearer/expiresIn reais do contrato', async () => {
    globalThis.fetch = async (input, options) => {
      assert.equal(new URL(input).pathname, '/api/auth/login')
      assert.deepEqual(JSON.parse(options.body), { email: 'pessoa@example.invalid', password: credentials.password })
      return json({ ...loginResult(), user: { ...user, passwordHash: 'não reter' } })
    }
    const result = await auth.authApi.login(credentials, signal())
    assert.equal(result.accessToken, token); assert.equal(result.expiresIn, 60)
    assert.equal(result.user.passwordHash, undefined)
  })
  it('/me envia o JWT somente no header, nunca na URL ou em cookies', async () => {
    globalThis.fetch = async (input, options) => {
      assert.equal(new URL(input).pathname, '/api/auth/me'); assert.equal(new URL(input).search, '')
      assert.equal(options.method, 'GET'); assert.equal(options.headers.Authorization, `Bearer ${token}`)
      assert.equal(options.credentials, 'omit'); assert.equal(options.body, undefined)
      assert(!input.includes(token)); return json({ user })
    }
    assert.deepEqual(await auth.authApi.me(token, signal()), user)
  })
  it('credenciais inválidas retornam mensagem genérica sem conteúdo do servidor', async () => {
    globalThis.fetch = async () => json({ message: 'detalhe-interno-privado' }, 401)
    await assert.rejects(auth.authApi.login(credentials, signal()), error => error.status === 401 && error.message === 'E-mail ou senha inválidos.' && !error.message.includes('privado'))
  })
  it('conflito de cadastro e erro de rede são controlados', async () => {
    globalThis.fetch = async () => json({}, 409)
    await assert.rejects(auth.authApi.register({ ...credentials, name: user.name }, signal()), error => error.status === 409)
    globalThis.fetch = async () => { throw new Error('URL ou segredo privado') }
    await assert.rejects(auth.authApi.login(credentials, signal()), error => !error.message.includes('segredo') && error.message.includes('conexão'))
  })
  it('não aceita tipo de token, validade ou perfil desconhecidos', async () => {
    for (const changes of [{ tokenType: 'Cookie' }, { expiresIn: 0 }, { accessToken: 'token com espaços' }, { user: { ...user, role: 'ADMIN' } }]) {
      globalThis.fetch = async () => json({ ...loginResult(), ...changes })
      await assert.rejects(auth.authApi.login(credentials, signal()))
    }
  })
  it('valida nome, email, confirmação e limite UTF-8 sem aparar a senha', () => {
    assert.deepEqual(auth.validateAuthFields({ ...credentials, name: user.name, confirmation: credentials.password }, true), {})
    assert(auth.validateAuthFields({ email: 'inválido', password: 'curta', name: 'A', confirmation: 'diferente' }, true).confirmation)
    assert(auth.validateAuthFields({ ...credentials, password: 'á'.repeat(37), name: user.name }, true).password)
    assert(auth.validateAuthFields({ ...credentials, password: 'abc\0defghi', name: user.name }, true).password)
    assert.equal(auth.validateAuthFields({ ...credentials, password: 'a' }).password, undefined)
    assert(auth.validateAuthFields({ ...credentials, password: 'a', name: user.name }, true).password)
  })
})

describe('Ciclo de sessão sem JWT real, cookies ou banco', () => {
  it('sem sessão salva não chama /me', async () => {
    const f = fixture(); f.api.me = async () => { throw Error('não deveria consultar') }
    await f.store.refresh(); assert.equal(f.store.getSnapshot().status, 'anonymous')
  })
  it('login confirma /me e armazena somente token e expiração', async () => {
    const f = fixture(); let verified = false
    f.api.me = async received => { assert.equal(received, token); verified = true; return { ...user, role: 'AUCTIONEER' } }
    await f.store.login(credentials, signal())
    assert(verified); assert.equal(f.store.getSnapshot().user.role, 'AUCTIONEER')
    const saved = JSON.parse(f.values.get(sessions.sessionKey))
    assert.deepEqual(Object.keys(saved).sort(), ['accessToken', 'expiresAt'])
    assert.equal(saved.expiresAt, 61000); assert(!JSON.stringify(saved).includes(credentials.password))
  })
  it('restauração usa perfil atual de /me e ignora perfil forjado no storage', async () => {
    const f = fixture()
    f.values.set(sessions.sessionKey, JSON.stringify({ accessToken: token, expiresAt: 61000, user: { ...user, role: 'AUCTIONEER' } }))
    await f.store.refresh(); assert.equal(f.store.getSnapshot().user.role, 'BIDDER')
  })
  it('401 na restauração remove o token e bloqueia áreas privadas', async () => {
    const f = fixture(); f.values.set(sessions.sessionKey, JSON.stringify({ accessToken: token, expiresAt: 61000 }))
    f.api.me = async () => { throw new auth.AuthError('Expirado', 401) }
    await f.store.refresh(); assert.equal(f.store.getSnapshot().status, 'anonymous'); assert.equal(f.values.size, 0)
  })
  it('falha de rede mantém possibilidade de tentar novamente sem liberar a sessão', async () => {
    const f = fixture(); f.values.set(sessions.sessionKey, JSON.stringify({ accessToken: token, expiresAt: 61000 }))
    f.api.me = async () => { throw new auth.AuthError('Rede indisponível') }
    await f.store.refresh(); assert.equal(f.store.getSnapshot().status, 'unavailable')
    assert.equal(sessions.sessionAccess(f.store.getSnapshot()), 'retry')
    f.api.me = async () => user
    await f.store.refresh(); assert.equal(f.store.getSnapshot().status, 'authenticated')
  })
  it('sessão vencida ou storage inválido nunca autentica', async () => {
    for (const saved of ['não é JSON', JSON.stringify({ accessToken: token, expiresAt: 0 }), JSON.stringify({ accessToken: 3, expiresAt: 61000 })]) {
      const f = fixture(); f.values.set(sessions.sessionKey, saved)
      await f.store.refresh(); assert.equal(f.store.getSnapshot().status, 'anonymous'); assert.equal(f.values.size, 0)
    }
  })
  it('expiração automática limpa sessão e token', async () => {
    const f = fixture(); await f.store.login(credentials, signal()); f.setTime(62000); f.timers.at(-1).fn()
    assert.equal(f.store.getSnapshot().status, 'anonymous'); assert.equal(f.values.size, 0)
  })
  it('logout é local, remove dados e não inventa endpoint de revogação', async () => {
    const f = fixture(); await f.store.login(credentials, signal()); f.store.logout()
    assert.equal(f.store.getSnapshot().user, null); assert.equal(f.store.getSnapshot().status, 'anonymous'); assert.equal(f.values.size, 0)
  })
  it('resposta tardia de login não restaura sessão depois de logout', async () => {
    const f = fixture(); let resolveMe
    f.api.me = () => new Promise(resolve => { resolveMe = resolve })
    const pending = f.store.login(credentials, signal()); await Promise.resolve()
    f.store.logout(); resolveMe(user)
    await assert.rejects(pending, error => error.name === 'AbortError')
    assert.equal(f.store.getSnapshot().status, 'anonymous'); assert.equal(f.values.size, 0)
  })
  it('login recusado não persiste sessão', async () => {
    const f = fixture(); await f.store.refresh()
    f.api.login = async () => { throw new auth.AuthError('E-mail ou senha inválidos.', 401) }
    await assert.rejects(f.store.login(credentials, signal()))
    assert.equal(f.store.getSnapshot().status, 'anonymous'); assert.equal(f.values.size, 0)
  })
  it('storage bloqueado permite somente sessão em memória com aviso', async () => {
    const f = fixture({ storage: { getItem: () => null, setItem: () => { throw Error('bloqueado') }, removeItem: () => {} } })
    await f.store.login(credentials, signal())
    assert.equal(f.store.getSnapshot().status, 'authenticated'); assert.match(f.store.getSnapshot().message, /não permitiu/)
  })
})

function renderWithSession(element, state) {
  const store = { getSnapshot: () => state, subscribe: () => () => {}, login: async () => {}, logout: () => {}, refresh: async () => {} }
  return renderToString(createElement(context.Provider, { value: store }, createElement(MemoryRouter, null, element)))
}
describe('Formulários e proteção de rotas', () => {
  it('decide acesso por sessão verificada e papel, sem confiar no token decodificado', () => {
    const state = { status: 'authenticated', user, message: null }
    assert.equal(sessions.sessionAccess(state), 'allow')
    assert.equal(sessions.sessionAccess(state, ['AUCTIONEER']), 'denied')
    assert.equal(sessions.sessionAccess({ ...state, user: { ...user, role: 'AUCTIONEER' } }, ['AUCTIONEER']), 'allow')
    assert.equal(sessions.sessionAccess({ ...state, status: 'anonymous' }), 'login')
    assert.equal(sessions.sessionAccess({ ...state, status: 'restoring' }), 'wait')
  })
  it('proteção efetiva não renderiza conteúdo privado para BIDDER na área AUCTIONEER', () => {
    const tree = createElement(Routes, null, createElement(Route, { element: createElement(Guard, { roles: ['AUCTIONEER'] }) }, createElement(Route, { index: true, element: createElement('p', null, 'CONTEUDO_PRIVADO') })))
    const html = renderWithSession(tree, { status: 'authenticated', user, message: null })
    assert(html.includes('Acesso não permitido')); assert(!html.includes('CONTEUDO_PRIVADO'))
    const allowed = renderWithSession(tree, { status: 'authenticated', user: { ...user, role: 'AUCTIONEER' }, message: null })
    assert(allowed.includes('CONTEUDO_PRIVADO'))
  })
  it('rota privada não revela conteúdo enquanto restaura ou não há sessão', () => {
    const tree = createElement(Routes, null, createElement(Route, { element: createElement(Guard) }, createElement(Route, { index: true, element: createElement('p', null, 'CONTEUDO_PRIVADO') })))
    for (const status of ['anonymous', 'restoring', 'unavailable']) {
      const html = renderWithSession(tree, { status, user: null, message: 'Verificação indisponível' })
      assert(!html.includes('CONTEUDO_PRIVADO'))
      if (status === 'restoring') assert(html.includes('Verificando sua sessão'))
      if (status === 'unavailable') assert(html.includes('Tentar novamente'))
    }
  })
  it('formulários têm labels, autocomplete e campos de senha sem seleção de papel', () => {
    const state = { status: 'anonymous', user: null, message: null }
    const html = renderWithSession(createElement(Form, { register: true }), state)
    assert(html.includes('for="email"')); assert(html.includes('for="password"')); assert(html.includes('type="password"'))
    assert(html.includes('autoComplete="new-password"')); assert(html.includes('for="confirmation"'))
    assert(!html.includes('name="role"')); assert(!html.includes('type="checkbox"'))
  })
  it('retorno pós-login aceita somente destinos privados conhecidos, sem redirecionamento externo', () => {
    assert.equal(sessions.safeReturnPath('/area-leiloeiro'), '/area-leiloeiro')
    for (const input of ['https://malicioso.invalid', '//malicioso.invalid', '/entrar', '/minha-conta?token=segredo', null, { from: '/' }]) {
      assert.equal(sessions.safeReturnPath(input), '/minha-conta')
    }
  })
})
