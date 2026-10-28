import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { App } from '../../src/App'
import { AuthContext } from '../../src/components/auth/auth-context'
import { ThemeContext } from '../../src/components/theme/theme-context'
import type { AuthSession } from '../../src/services/auth-session'
import '../../src/styles/global.css'

const mode = new URLSearchParams(location.search).get('mode') ?? 'success'
const storageKey = `fixture-credit-ledger:${mode}`
const ledger: { key: string; amount: string; transaction: object }[] = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]')
const state = { mode, generation: crypto.randomUUID(), posts: [] as { key: string; amount: string }[], reads: [] as string[], ledgerCount: ledger.length }
Object.assign(window, { creditTest: state })
if (mode === 'storage-failure') {
  const original = Storage.prototype.setItem
  Storage.prototype.setItem = function (key, value) { if (key.startsWith('pending-demo-credit:')) throw Error('Storage unavailable'); return original.call(this, key, value) }
}
const asMoney = (cents: bigint) => `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`
const balance = () => { const total = 10000n + ledger.reduce((sum, item) => sum + BigInt(item.amount.replace('.', '')), 0n); return { totalBalance: asMoney(total), reservedBalance: '20.00', availableBalance: asMoney(total - 2000n) } }
window.fetch = async (input, init) => {
  const url = new URL(String(input)), method = init?.method ?? 'GET'
  if (!(init?.headers as Record<string, string> | undefined)?.Authorization) throw Error('Missing session')
  if (method === 'POST' && url.pathname === '/api/wallet/credit') {
    const key = (init?.headers as Record<string, string>)['Idempotency-Key'], amount = JSON.parse(init?.body as string).amount
    if (!key || Object.keys(JSON.parse(init?.body as string)).join(',') !== 'amount') throw Error('Invalid contract')
    state.posts.push({ key, amount })
    if (mode === 'disabled') return Response.json({ message: 'Crédito simulado desabilitado. Disponível somente no ambiente local de demonstração explicitamente habilitado.' }, { status: 403 })
    const previous = ledger.find(item => item.key === key)
    if (previous && previous.amount !== amount) throw Error('Key reused with a different amount')
    if (!previous) {
      const transaction = { id: crypto.randomUUID(), type: 'CREDIT', amount, balanceAfter: asMoney(BigInt(balance().totalBalance.replace('.', '')) + BigInt(amount.replace('.', ''))), createdAt: new Date().toISOString(), simulated: true }
      ledger.push({ key, amount, transaction }); sessionStorage.setItem(storageKey, JSON.stringify(ledger)); state.ledgerCount = ledger.length
      if (mode === 'uncertain') throw Error('Simulated lost response after commit')
    }
    await new Promise(resolve => setTimeout(resolve, 60))
    return Response.json({ wallet: balance(), transaction: (previous ?? ledger.at(-1))!.transaction, replayed: !!previous, simulated: true }, { status: previous ? 200 : 201 })
  }
  if (method !== 'GET') throw Error('Only fixture credit may write')
  state.reads.push(url.pathname + url.search)
  if (url.pathname === '/api/wallet/credit-capability') return Response.json({ enabled: mode !== 'unauthorized', cumulativeLimit: mode === 'unauthorized' ? null : '1000.00' })
  if (url.pathname === '/api/wallet') return Response.json({ wallet: balance() })
  if (url.pathname === '/api/wallet/transactions') return Response.json({ data: ledger.map(item => item.transaction).reverse(), pagination: { page: 1, limit: 10, total: ledger.length, totalPages: ledger.length ? 1 : 0 } })
  throw Error(`Unexpected request: ${url.pathname}`)
}
const snapshot = { status: 'authenticated', user: { id: '11111111-1111-4111-8111-111111111111', name: 'Teste', email: 'fixture@example.test', role: mode === 'owner' ? 'AUCTIONEER' : 'BIDDER', createdAt: new Date().toISOString() }, message: null }
const session = { getSnapshot: () => snapshot, subscribe: () => () => {}, refresh() {}, logout() {}, withSession: (read: (token: string, signal: AbortSignal) => Promise<unknown>, signal: AbortSignal) => read('fixture-token', signal) } as unknown as AuthSession
createRoot(document.getElementById('root')!).render(<ThemeContext.Provider value={{ theme: 'light', toggleTheme() {} }}><AuthContext.Provider value={session}><MemoryRouter initialEntries={['/minha-conta']}><App /></MemoryRouter></AuthContext.Provider></ThemeContext.Provider>)
