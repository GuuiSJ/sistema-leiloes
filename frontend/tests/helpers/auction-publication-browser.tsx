import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { App } from '../../src/App'
import { AuthContext } from '../../src/components/auth/auth-context'
import { ThemeContext } from '../../src/components/theme/theme-context'
import type { AuthSession } from '../../src/services/auth-session'
import '../../src/styles/global.css'

const mode = new URLSearchParams(location.search).get('mode') ?? ''
const id = '11111111-1111-4111-8111-111111111111'
const initial = Date.now()
const state = { status: 'DRAFT', publications: 0, requests: [] as string[], advance() { state.status = 'OPEN' } }
Object.assign(window, { publicationTest: state })
const auction = () => ({ id, title: 'Leilão de publicação simulada', description: null, status: state.status, startsAt: new Date(initial + (mode === 'expired' ? -60000 : 3600000)).toISOString(), endsAt: new Date(initial + 7200000).toISOString() })
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.origin), method = init?.method ?? 'GET'
  state.requests.push(`${method} ${url.pathname}`)
  if (url.pathname === `/api/auctions/${id}/schedule` && method === 'PATCH') {
    state.publications++
    if (init?.body !== undefined || !(init?.headers as Record<string, string>)?.Authorization) throw Error('Invalid publication contract')
    const errors: Record<string, [number, string]> = {
      'no-lots': [409, 'Leilão precisa de ao menos um lote válido não cancelado.'],
      foreign: [403, 'Somente o responsável pode agendar ou abrir este leilão.'],
      legacy: [409, 'Leilão LEGACY ou sem geração temporal válida: operação bloqueada. Histórico disponível para consulta.'],
    }
    if (errors[mode]) return Response.json({ message: errors[mode][1] }, { status: errors[mode][0] })
    await new Promise(resolve => setTimeout(resolve, 80))
    state.status = 'SCHEDULED'
    return Response.json({ auction: auction(), openedLots: 0, unchanged: false })
  }
  if (method !== 'GET') throw Error('Only simulated publication is permitted')
  if (url.pathname === '/api/auctions') {
    const data = url.searchParams.has('status') && url.searchParams.get('status') !== state.status ? [] : [auction()]
    return Response.json({ data, pagination: { page: 1, limit: 10, total: data.length, totalPages: data.length ? 1 : 0 } })
  }
  throw Error(`Unexpected request: ${url.pathname}`)
}
const snapshot = { status: 'authenticated', user: { id: '22222222-2222-4222-8222-222222222222', name: 'Teste', role: mode === 'bidder' ? 'BIDDER' : 'AUCTIONEER', email: 'fixture@example.test', createdAt: new Date().toISOString() }, message: null }
const session = { getSnapshot: () => snapshot, subscribe: () => () => {}, refresh() {}, logout() {}, withSession: (read: (token: string, signal: AbortSignal) => Promise<unknown>, signal: AbortSignal) => read('fixture-token', signal) } as unknown as AuthSession
createRoot(document.getElementById('root')!).render(<ThemeContext.Provider value={{ theme: 'light', toggleTheme() {} }}><AuthContext.Provider value={session}><MemoryRouter initialEntries={['/area-leiloeiro/leiloes']}><App /></MemoryRouter></AuthContext.Provider></ThemeContext.Provider>)
