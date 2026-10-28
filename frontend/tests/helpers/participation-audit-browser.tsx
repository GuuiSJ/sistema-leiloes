import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { App } from '../../src/App'
import { AuthContext } from '../../src/components/auth/auth-context'
import { ThemeContext } from '../../src/components/theme/theme-context'
import type { AuthSession, SessionState } from '../../src/services/auth-session'
import fixtures from '../fixtures/participation-audit.json'
import '../../src/styles/global.css'

const params = new URLSearchParams(location.search)
const scenario = params.get('scenario') ?? ''
const state = { requests: [] as { path: string; method: string; authenticated: boolean }[], writes: 0 }
Object.assign(window, { participationTest: state })
const page = (data: unknown[]) => ({ data, pagination: { page: 1, limit: 10, total: data.length, totalPages: data.length ? 1 : 0 } })
window.fetch = async (input, init) => {
  const path = new URL(String(input), location.origin).pathname
  const method = init?.method ?? 'GET', authenticated = !!(init?.headers as Record<string, string> | undefined)?.Authorization
  state.requests.push({ path, method, authenticated })
  if (method !== 'GET') { state.writes++; throw new Error('Writes forbidden') }
  if (path === '/api/me/participations') {
    if (!authenticated) throw new Error('Missing session')
    if (scenario === 'error') return Response.json({}, { status: 503 })
    return Response.json(page(scenario === 'empty' ? [] : [fixtures.participation]))
  }
  if (authenticated) throw new Error('Token sent to public resource')
  if (path.startsWith('/api/receipts/')) return Response.json({ receipt: fixtures.receipt })
  if (path.endsWith('/audit')) {
    if (scenario === 'audit-error') return Response.json({}, { status: 503 })
    return Response.json(scenario === 'invalid' ? { ...fixtures.audit, integrity: { ...fixtures.audit.integrity, status: 'INVALID' }, ...page([]) } : fixtures.audit)
  }
  if (path.endsWith('/bids')) return Response.json(page([{ ...fixtures.participation.myBid, lotId: fixtures.participation.lot.id, sequence: 2 }]))
  throw new Error(`Unexpected request: ${path}`)
}
let snapshot: SessionState = scenario === 'anonymous' ? { status: 'anonymous', user: null, message: null } : {
  status: 'authenticated', user: { id: '66666666-6666-4666-8666-666666666666', name: 'Teste', email: 'fixture@example.test', createdAt: '2026-10-28T12:00:00Z', role: scenario === 'auctioneer' ? 'AUCTIONEER' : 'BIDDER' }, message: null,
}
const listeners = new Set<() => void>()
const session = {
  getSnapshot: () => snapshot, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }, refresh() {},
  logout() { snapshot = { status: 'anonymous', user: null, message: null }; listeners.forEach(fn => fn()) },
  withSession: (read: (token: string, signal: AbortSignal) => Promise<unknown>, signal: AbortSignal) => read('fixture-token', signal),
} as unknown as AuthSession
createRoot(document.getElementById('root')!).render(<ThemeContext.Provider value={{ theme: 'light', toggleTheme() {} }}><AuthContext.Provider value={session}><MemoryRouter initialEntries={[params.get('path') ?? '/minha-conta/arremates']}><App /></MemoryRouter></AuthContext.Provider></ThemeContext.Provider>)
