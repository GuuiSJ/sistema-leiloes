import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router'
import { AuthContext } from '../../src/components/auth/auth-context'
import { AuctioneerVehiclePage } from '../../src/pages/AuctioneerVehiclePage'
import type { AuthSession } from '../../src/services/auth-session'
import detail from '../fixtures/fipe-palio-2014.json'

const id = '11111111-1111-4111-8111-111111111111'
const params = new URLSearchParams(location.search)
const editing = params.has('edit')
const vehicle = {
  id, brand: 'Marca original', model: 'Modelo original', year: 2020, version: 'Versão manual',
  description: 'Descrição manual', imageUrls: ['https://example.test/manual.jpg'],
  fipeCode: null, fipeBrandCode: null, fipeModelCode: null, fipeYearCode: null,
  fipeReferenceMonth: null, fipeReferencePrice: null, fipeReferencePriceVerified: false,
}

// Fixtures by default. Opt-in live mode only allows the public FIPE GET routes.
const nativeFetch = window.fetch.bind(window)
const state = { mode: 'success', requests: [] as string[], writes: 0, release: null as (() => void) | null, liveDetails: null as Record<string, unknown> | null }
Object.assign(window, { fipeTest: state })
window.fetch = async (input, init) => {
  const path = new URL(String(input), location.origin).pathname
  state.requests.push(path)
  if (init?.method && init.method !== 'GET') { state.writes++; throw new Error('Real writes are forbidden') }
  if (params.has('live') && path.startsWith('/api/fipe/')) {
    const response = await nativeFetch(path, init)
    if (path.startsWith('/api/fipe/detalhes/') && response.ok) state.liveDetails = await response.clone().json()
    return response
  }
  if (path === `/api/vehicles/${id}`) return Response.json({ vehicle })
  if (path === '/api/fipe/marcas/carros') return Response.json([{ nome: 'Fiat', valor: '21' }, { nome: 'VW', valor: '59' }])
  if (path.startsWith('/api/fipe/modelos/carros/')) return Response.json([{ modelo: detail.modelo, valor: '4828' }, { modelo: 'Outro modelo', valor: '4829' }])
  if (path.startsWith('/api/fipe/anos/carros/')) return Response.json([{ nome: '2014 Flex', valor: '2014-5' }, { nome: '2013 Flex', valor: '2013-5' }, { nome: 'Zero km', valor: '32000-5' }])
  if (path.startsWith('/api/fipe/detalhes/carros/')) {
    const mode = state.mode
    if (mode === 'delayed') await new Promise<void>(resolve => { state.release = resolve })
    if (mode === 'offline') throw new TypeError('Failed to fetch')
    if (mode === '502' || mode === '503') return Response.json({ message: mode === '502' ? 'A BrasilAPI retornou dados FIPE em formato inválido.' : 'BrasilAPI temporariamente indisponível. Tente novamente.' }, { status: Number(mode) })
    return Response.json({ ...detail, anoModelo: Number(path.split('/').at(-1)!.split('-')[0]), ...(mode === 'incomplete' ? { codigoFipe: undefined } : {}) })
  }
  throw new Error(`Unexpected request: ${path}`)
}
const snapshot = { status: 'authenticated' as const, user: { id: 'test', name: 'Teste', role: 'AUCTIONEER' as const }, message: null }
const session = {
  getSnapshot: () => snapshot, subscribe: () => () => {}, refresh() {}, logout() {},
  withSession() { throw new Error('Submitting is forbidden in these tests') },
} as unknown as AuthSession
createRoot(document.getElementById('root')!).render(
  <AuthContext.Provider value={session}>
    <MemoryRouter initialEntries={[editing ? `/area-leiloeiro/veiculos/${id}/editar` : '/area-leiloeiro/veiculos/novo']}>
      <Routes>
        <Route path="/area-leiloeiro/veiculos/novo" element={<AuctioneerVehiclePage create />} />
        <Route path="/area-leiloeiro/veiculos/:vehicleId/editar" element={<AuctioneerVehiclePage />} />
      </Routes>
    </MemoryRouter>
  </AuthContext.Provider>,
)
