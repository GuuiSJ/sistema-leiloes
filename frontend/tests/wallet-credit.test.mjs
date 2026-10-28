import assert from 'node:assert/strict'
import { before, after, afterEach, it } from 'node:test'
import { createServer } from 'vite'
import { chromiumPath, openChromium } from './helpers/chromium.mjs'

const originalFetch = globalThis.fetch, originalWindow = globalThis.window
let server, api, browser, base
const executable = await chromiumPath(), signal = () => new AbortController().signal
const attempt = { key: 'fixture-credit-1', amount: '100.50' }
const body = { wallet: { totalBalance: '200.50', reservedBalance: '20.00', availableBalance: '180.50' }, transaction: { id: '11111111-1111-4111-8111-111111111111', type: 'CREDIT', amount: '100.50', balanceAfter: '200.50', simulated: true, createdAt: '2026-10-28T15:00:00Z' }, simulated: true, replayed: false }
before(async () => {
  server = await createServer({ cacheDir: 'node_modules/.vite-tests/wallet-credit', server: { host: '127.0.0.1', port: 0, strictPort: false, ws: false }, plugins: [{ name: 'wallet-credit-test', configureServer(vite) {
    vite.middlewares.use('/__credit-test', async (_req, res) => {
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      res.end(await vite.transformIndexHtml('/__credit-test', '<!doctype html><html lang="pt-BR"><body><div id="root"></div><script type="module" src="/tests/helpers/wallet-credit-browser.tsx"></script></body></html>'))
    })
  } }] })
  api = await server.ssrLoadModule('/src/services/wallet-credit.ts')
  if (executable) { await server.listen(); base = `http://127.0.0.1:${server.httpServer.address().port}/__credit-test`; browser = await openChromium(executable) }
})
afterEach(() => { globalThis.fetch = originalFetch; if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow })
after(async () => { browser?.close(); await server?.close() })
const allowLocal = () => { globalThis.window = { location: { hostname: 'localhost' } } }
it('availability comes from authenticated backend authorization, with no public environment flag', async () => {
  for (const enabled of [true, false]) {
    const body = { enabled, cumulativeLimit: enabled ? '1000.00' : null }
    globalThis.fetch = async (url, init) => {
      assert.equal(new URL(url).pathname, '/api/wallet/credit-capability'); assert.equal(init.headers.Authorization, 'Bearer fixture-token'); assert.equal(init.cache, 'no-store')
      return Response.json(body)
    }
    assert.deepEqual(await api.getCreditCapability('fixture-token', signal()), body)
  }
  globalThis.fetch = async () => Response.json({ enabled: 'true' })
  await assert.rejects(api.getCreditCapability('fixture-token', signal()))
})
it('parses reais exactly and rejects ambiguous, nonpositive, overflow and malformed amounts', () => {
  for (const [value, expected] of [['100,50', '100.50'], ['0,01', '0.01'], ['100', '100.00'], ['9999999999999999,99', '9999999999999999.99']]) assert.equal(api.parseCreditAmount(value), expected)
  for (const value of ['0', '-1', '1.000,00', '100.50', '1e3', '1,001', '10000000000000000', '']) assert.equal(api.parseCreditAmount(value), null)
})
it('POST uses exact amount, JWT and stable Idempotency-Key; successful replay remains the same operation', async () => {
  allowLocal(); const keys = []; let count = 0
  globalThis.fetch = async (url, init) => {
    assert.equal(new URL(url).pathname, '/api/wallet/credit'); assert.equal(init.method, 'POST'); assert.equal(init.headers.Authorization, 'Bearer fixture-token'); assert.equal(init.credentials, 'omit'); assert.equal(init.redirect, 'error'); assert.deepEqual(JSON.parse(init.body), { amount: '100.50' })
    keys.push(init.headers['Idempotency-Key']); count++
    if (count === 1) throw Error('lost response')
    return Response.json({ ...body, replayed: true }, { status: 200 })
  }
  const credit = api.createWalletCreditAttempt(attempt)
  await assert.rejects(credit('fixture-token', signal()), error => error.retrySameKey)
  assert.deepEqual(await credit('fixture-token', signal()), body.wallet)
  assert.deepEqual(keys, [attempt.key, attempt.key])
})
it('persists only operation amount/key, survives remount and isolates users', () => {
  const values = new Map(), storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) }
  api.savePendingCredit('user-a', attempt, storage); assert.deepEqual(api.readPendingCredit('user-a', storage), attempt); assert.equal(api.readPendingCredit('user-b', storage), null)
  assert.deepEqual(JSON.parse([...values.values()][0]), attempt)
  api.clearPendingCredit('user-a', storage); assert.equal(api.readPendingCredit('user-a', storage), null)
})
it('disabled environment and malformed success cannot claim credit or leak backend details', async () => {
  allowLocal()
  globalThis.fetch = async () => Response.json({ message: 'SQL secret' }, { status: 403 })
  await assert.rejects(api.createWalletCreditAttempt(attempt)('fixture-token', signal()), error => { assert.equal(error.unavailable, true); assert.equal(error.retrySameKey, true); assert.match(error.message, /demonstração indisponível/); assert.doesNotMatch(error.message, /SQL/); return true })
  for (const patch of [{ simulated: false }, { wallet: { ...body.wallet, totalBalance: '999.00' } }, { transaction: { ...body.transaction, amount: '10.00' } }, { replayed: true }]) {
    globalThis.fetch = async () => Response.json({ ...body, ...patch }, { status: 201 })
    await assert.rejects(api.createWalletCreditAttempt(attempt)('fixture-token', signal()), error => error.retrySameKey === true)
  }
})
it('production frontend can send simulated credits and rejects invalid attempts before POST', async () => {
  globalThis.window = { location: { hostname: 'public.example.com' } }
  globalThis.fetch = async () => Response.json(body, { status: 201 })
  assert.deepEqual(await api.createWalletCreditAttempt(attempt)('fixture-token', signal()), body.wallet)
  assert.throws(() => api.createWalletCreditAttempt({ amount: '0.00', key: 'key' }))
})
it('cumulative cap rejection is definitive and allows correcting the amount without replaying a rejected operation', async () => {
  globalThis.fetch = async () => Response.json({ message: 'Crédito excede o limite acumulado de demonstração desta conta.' }, { status: 409 })
  await assert.rejects(api.createWalletCreditAttempt(attempt)('fixture-token', signal()), error => error.retrySameKey === false && /limite acumulado/.test(error.message))
})
it('duplicate concurrent calls share a locked operation and do not issue a second POST', async () => {
  allowLocal(); let release, calls = 0
  globalThis.fetch = async () => { calls++; await new Promise(resolve => { release = resolve }); return Response.json(body, { status: 201 }) }
  const credit = api.createWalletCreditAttempt(attempt), first = credit('fixture-token', signal())
  await assert.rejects(credit('fixture-token', signal()), /já está sendo enviado/)
  release(); await first; assert.equal(calls, 1)
})

const options = { skip: !executable && 'Set CHROMIUM_PATH for browser integration', timeout: 60000 }
const button = label => `[...document.querySelectorAll('button')].find(b => b.textContent === ${JSON.stringify(label)})`
async function click(label) { await browser.evaluate(`${button(label)}.click()`) }
let opened = false
async function open(mode) {
  if (opened) await browser.evaluate('sessionStorage.clear()')
  await browser.navigate(`${base}?mode=${mode}`); opened = true
  await browser.wait(`window.creditTest?.mode === ${JSON.stringify(mode)} && !!document.querySelector('main')`)
}
async function prepare() {
  await browser.wait(`!!${button('Consultar carteira')}`); await click('Consultar carteira')
  await browser.wait(`${button('Adicionar saldo')} && !${button('Adicionar saldo')}.disabled`); await click('Adicionar saldo')
  await browser.evaluate(`(() => { const input = document.querySelector('form[aria-label="Informar crédito simulado"] input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '100,50'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
  await click('Revisar crédito'); await browser.wait('!!document.querySelector("[role=alertdialog]")')
}
it('Chromium: confirmation precedes POST; success refreshes total, reserved, available and history', options, async () => {
  await open('success'); await prepare()
  assert.equal(await browser.evaluate('window.creditTest.posts.length'), 0)
  await click('Voltar'); await click('Revisar crédito')
  await browser.evaluate(`${button('Confirmar crédito simulado')}.click(); ${button('Confirmar crédito simulado')}.click()`)
  await browser.wait('document.body?.textContent?.includes("Saldo de demonstração adicionado com sucesso")')
  await browser.wait('document.querySelector("tbody")?.textContent?.includes("100,50")')
  const balances = await browser.evaluate(`[...document.querySelectorAll('dl > div')].filter(d => d.querySelector('dt')?.textContent?.startsWith('Saldo ')).map(d => d.textContent)`)
  assert(balances.some(v => v.includes('Saldo total') && v.includes('200,50')))
  assert(balances.some(v => v.includes('Saldo disponível') && v.includes('180,50')))
  assert(balances.some(v => v.includes('Saldo reservado') && v.includes('20,00')))
  assert.equal(await browser.evaluate('window.creditTest.posts.length'), 1)
  assert.equal(await browser.evaluate('window.creditTest.ledgerCount'), 1)
})
it('Chromium: lost response survives reload and retries identical amount/key without a duplicate credit', options, async () => {
  await open('uncertain'); await prepare(); await click('Confirmar crédito simulado')
  await browser.wait('document.body?.textContent?.includes("Resultado não confirmado")')
  const original = await browser.evaluate('window.creditTest.posts[0]'), generation = await browser.evaluate('window.creditTest.generation')
  await browser.evaluate('location.reload()')
  await browser.wait(`window.creditTest?.generation && window.creditTest.generation !== ${JSON.stringify(generation)}`)
  await browser.wait(`!!${button('Consultar carteira')}`); await click('Consultar carteira')
  await browser.wait(`${button('Repetir mesma tentativa')} && !${button('Repetir mesma tentativa')}.disabled`)
  assert.equal(await browser.evaluate('window.creditTest.posts.length'), 0)
  await click('Repetir mesma tentativa')
  await browser.wait('document.body?.textContent?.includes("Saldo de demonstração adicionado com sucesso")')
  assert.deepEqual(await browser.evaluate('window.creditTest.posts[0]'), original)
  assert.equal(await browser.evaluate('window.creditTest.ledgerCount'), 1)
})
it('Chromium: disabled backend, unavailable storage and AUCTIONEER never produce credit success', options, async () => {
  await open('disabled'); await prepare(); await click('Confirmar crédito simulado')
  await browser.wait('document.body?.textContent?.includes("Crédito de demonstração indisponível")')
  assert.equal(await browser.evaluate('window.creditTest.ledgerCount'), 0)
  assert.equal(await browser.evaluate('document.body.textContent.includes("adicionado com sucesso")'), false)
  await open('storage-failure'); await prepare(); await click('Confirmar crédito simulado')
  await browser.wait('document.body?.textContent?.includes("Nenhum crédito foi enviado")')
  assert.equal(await browser.evaluate('window.creditTest.posts.length'), 0)
  await open('owner'); await browser.wait('document.body?.textContent?.includes("apenas para o perfil de participante")')
  assert.equal(await browser.evaluate(`${button('Adicionar saldo')} === undefined`), true)
})
it('Chromium: unauthorized account cannot see the credit form and makes no POST', options, async () => {
  await open('unauthorized'); await browser.wait(`!!${button('Consultar carteira')}`); await click('Consultar carteira')
  await browser.wait('document.body?.textContent?.includes("Crédito de demonstração indisponível para esta conta")')
  assert.equal(await browser.evaluate(`${button('Adicionar saldo')} === undefined`), true)
  assert.equal(await browser.evaluate('window.creditTest.posts.length'), 0)
})
