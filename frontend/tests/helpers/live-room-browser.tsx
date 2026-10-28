import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import { App } from '../../src/App'
import { AuthContext } from '../../src/components/auth/auth-context'
import { ThemeContext } from '../../src/components/theme/theme-context'
import type { AuthSession } from '../../src/services/auth-session'
import '../../src/styles/global.css'

const auctionId = '11111111-1111-4111-8111-111111111111', lotId = '22222222-2222-4222-8222-222222222222', bidId = '33333333-3333-4333-8333-333333333333', newBidId = '44444444-4444-4444-8444-444444444444'
const params = new URLSearchParams(location.search), owner = params.has('owner'), mode = params.get('mode')
const end = Date.now() + 90000
const vehicle = { id: '55555555-5555-4555-8555-555555555555', brand: 'Fiat', model: 'Palio', year: 2014, version: null, imageUrls: [], description: 'Veículo de demonstração simulada' }
const page = (data: unknown[]) => ({ data, pagination: { page: 1, limit: 10, total: data.length, totalPages: data.length ? 1 : 0 } })
const state = { stage: 0, requests: [] as string[], writes: 0, socket: null as any,
  advance() {
    state.stage = 1
    state.socket.receive('bid:created', { lotId, bidId: newBidId, amount: '1050.00', sequence: 2, createdAt: new Date().toISOString() })
    state.socket.receive('lot:extended', { lotId, triggerBidId: newBidId, previousEndsAt: new Date(end).toISOString(), endsAt: new Date(end + 120000).toISOString() })
  },
  close() { state.stage = 2; state.socket.receive('lot:closed', { lotId, auctionId, status: 'SOLD', closedAt: new Date().toISOString() }) },
}
Object.assign(window, { roomTest: state })
window.fetch = async (input, init) => {
  const path = new URL(String(input), location.origin).pathname
  state.requests.push(path)
  if (init?.method && init.method !== 'GET') { state.writes++; throw Error('Financial writes forbidden') }
  const authenticated = !!(init?.headers as Record<string, string> | undefined)?.Authorization
  if ((path.endsWith('/position') || path.endsWith('/eligibility') || path === '/api/me/lot-results') && !authenticated) throw Error('Missing session')
  const endsAt = new Date(end + (state.stage ? 120000 : 0)).toISOString()
  const auction = { id: auctionId, title: 'Sala de demonstração', status: state.stage === 2 ? 'CLOSED' : 'OPEN', startsAt: new Date(end - 3600000).toISOString(), endsAt }
  const lot = { id: lotId, auctionId, number: 1, status: state.stage === 2 ? 'SOLD' : 'OPEN', startingPrice: '1000.00', minimumIncrement: '10.00', endsAt, vehicle, result: state.stage === 2 ? { status: 'SOLD', winningBidId: newBidId, finalAmount: '1050.00' } : null }
  const latest = { id: state.stage ? newBidId : bidId, lotId, amount: state.stage ? '1050.00' : '1000.00', sequence: state.stage ? 2 : 1, createdAt: new Date().toISOString() }
  if (path === '/api/me/lot-results') {
    if (mode === 'error') return Response.json({}, { status: 403 })
    return Response.json(page(mode === 'empty' ? [] : [
      { lotId, auctionId, auctionTitle: auction.title, number: 1, status: 'SOLD', vehicle: { brand: 'Fiat', model: 'Palio', year: 2014 }, finalAmount: '1050.00', winningBidId: newBidId, receiptPublicId: '66666666-6666-4666-8666-666666666666' },
      { lotId: '77777777-7777-4777-8777-777777777777', auctionId, auctionTitle: auction.title, number: 2, status: 'UNSOLD', vehicle: { brand: 'Fiat', model: 'Uno', year: 2015 }, finalAmount: null, winningBidId: null, receiptPublicId: null },
    ]))
  }
  if (path === `/api/auctions/${auctionId}`) return Response.json({ auction })
  if (path === `/api/auctions/${auctionId}/lots`) return Response.json(page([lot]))
  if (path === `/api/auctions/${auctionId}/lots/${lotId}`) return Response.json({ lot })
  if (path.endsWith('/bids')) return Response.json(page([latest]))
  if (path.endsWith('/clock')) return Response.json({ lotId, auctionId, lotStatus: lot.status, auctionStatus: auction.status, endsAt, checkedAt: new Date().toISOString(), trusted: mode !== 'legacy' })
  if (path.endsWith('/position')) return Response.json({ lotId, lotStatus: lot.status, latestBidId: latest.id, status: state.stage === 2 ? 'NOT_WON' : state.stage ? 'OUTBID' : mode === 'none' ? 'NONE' : 'LEADING', checkedAt: new Date().toISOString() })
  if (path.endsWith('/eligibility')) return Response.json({ eligible: true, minimumAmount: state.stage ? '1060.00' : '1010.00', currentAmount: latest.amount, endsAt, checkedAt: new Date().toISOString() })
  throw Error(`Unexpected request: ${path}`)
}
const snapshot = { status: 'authenticated', user: { id: '88888888-8888-4888-8888-888888888888', role: owner ? 'AUCTIONEER' : 'BIDDER', name: 'Teste', email: 'fixture@example.test', createdAt: new Date().toISOString() }, message: null }
const session = { getSnapshot: () => snapshot, subscribe: () => () => {}, refresh() {}, logout() {}, withSession: (read: (token: string, signal: AbortSignal) => Promise<unknown>, signal: AbortSignal) => read('fixture-token', signal) } as unknown as AuthSession
createRoot(document.getElementById('root')!).render(<ThemeContext.Provider value={{ theme: 'light', toggleTheme() {} }}><AuthContext.Provider value={session}><MemoryRouter initialEntries={[owner ? '/area-leiloeiro/resultados' : `/leiloes/${auctionId}`]}><App /></MemoryRouter></AuthContext.Provider></ThemeContext.Provider>)
