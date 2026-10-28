import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import { usePublicResource } from '../hooks/usePublicResource'
import { getAuction, listAuctions, type AuctionStatus } from '../services/auctions'
import { getManagedLotsPage, lotActions } from '../services/lot-management'
import { listVehicles } from '../services/auctioneer'
import { formatDate, formatMoney } from '../services/formatters'
import { auctionStatusLabels, lotStatusLabels } from '../components/auctions/AuctionInfo'
import { AdminFeedback, AdminHeading, AdminPagination, AdminTable, StatusBadge, adminButton, adminInput } from '../components/auctioneer/AdminFeedback'
import { useEffect, useState } from 'react'
import { AuctionPublication } from '../components/auctioneer/AuctionPublication'

function useListQuery() {
  const [query, setQuery] = useSearchParams()
  const raw = query.get('page') ?? '1'
  const page = /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(Number(raw)) && Number(raw) <= 1_000_000 ? Number(raw) : 1
  const change = (page: number) => { const next = new URLSearchParams(query); next.set('page', String(page)); setQuery(next) }
  return { query, setQuery, page, change }
}

export function AuctioneerVehiclesPage() {
  const location = useLocation()
  const { query, setQuery, page, change } = useListQuery()
  const filters = { brand: query.get('brand') ?? '', model: query.get('model') ?? '', year: query.get('year') ?? '' }
  const resource = usePublicResource(`admin:vehicles:${page}:${JSON.stringify(filters)}`, signal => listVehicles(page, filters, signal))
  return <><AdminHeading title="Veículos" description="Catálogo de veículos da plataforma. Pesquise por parte da marca ou modelo e filtre pelo ano exato." retry={resource.retry} />
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3">{typeof location.state?.vehicleNotice === 'string' && <p role="status" className="text-sm">{location.state.vehicleNotice}</p>}<Link to="/area-leiloeiro/veiculos/novo" className={`${adminButton} bg-accent text-white hover:bg-blue-700`}>Cadastrar veículo</Link></div>
    <form key={query.toString()} aria-label="Filtros de veículos" className="mb-6 grid items-end gap-3 rounded-2xl border border-line bg-surface p-5 sm:grid-cols-2 xl:grid-cols-4" onSubmit={event => {
      event.preventDefault(); const form = new FormData(event.currentTarget), next = new URLSearchParams()
      for (const field of ['brand', 'model', 'year']) { const value = String(form.get(field) ?? '').trim(); if (value) next.set(field, value) }
      setQuery(next)
    }}>
      <label className="space-y-2 text-xs font-medium text-muted">Marca<input name="brand" defaultValue={filters.brand} maxLength={100} className={adminInput} placeholder="Buscar marca" /></label>
      <label className="space-y-2 text-xs font-medium text-muted">Modelo<input name="model" defaultValue={filters.model} maxLength={150} className={adminInput} placeholder="Buscar modelo" /></label>
      <label className="space-y-2 text-xs font-medium text-muted">Ano<input name="year" defaultValue={filters.year} type="number" min={1886} max={new Date().getUTCFullYear() + 1} className={adminInput} placeholder="Todos" /></label>
      <div className="flex gap-2"><button className={adminButton}>Buscar</button><button type="button" className={adminButton} onClick={() => setQuery({})}>Limpar</button></div>
    </form>
    <AdminFeedback {...resource} empty={!resource.data?.data.length}>{resource.data && <>
      <AdminTable headers={['Veículo', 'Ano', 'Versão', 'Referência FIPE', 'Gerenciamento']}>
        {resource.data.data.map(vehicle => <tr key={vehicle.id} className="hover:bg-accent/5"><td className="px-5 py-5"><p className="font-medium">{vehicle.brand} {vehicle.model}</p></td><td className="px-5 py-5">{vehicle.year}</td><td className="px-5 py-5 text-muted">{vehicle.version ?? '—'}</td><td className="whitespace-nowrap px-5 py-5">{formatMoney(vehicle.fipeReferencePrice)}{vehicle.fipeReferencePrice != null && <p className="mt-1 text-xs text-muted">Referência não verificada</p>}</td><td className="px-5 py-5"><Link to={`/area-leiloeiro/veiculos/${vehicle.id}/editar`} className="inline-flex min-h-11 items-center text-sm font-medium text-accent dark:text-blue-300">Gerenciar</Link></td></tr>)}
      </AdminTable><AdminPagination pagination={resource.data.pagination} change={change} />
    </>}</AdminFeedback>
  </>
}

export function AuctioneerAuctionsPage({ selectLot = false }: { selectLot?: boolean }) {
  const location = useLocation()
  const [publicationActive, setPublicationActive] = useState(false), [publicationNotice, setPublicationNotice] = useState('')
  const { query, setQuery, page, change } = useListQuery()
  const rawStatus = query.get('status') ?? ''
  const status = Object.hasOwn(auctionStatusLabels, rawStatus) ? rawStatus as AuctionStatus : undefined
  const resource = usePublicResource(`admin:auctions:${page}:${status ?? ''}`, signal => listAuctions(page, 10, signal, status))
  const hasScheduled = resource.data?.data.some(auction => auction.status === 'SCHEDULED') ?? false
  useEffect(() => {
    if (!hasScheduled || publicationActive) return
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') resource.retry() }, 5000)
    return () => clearInterval(timer)
  }, [hasScheduled, publicationActive])
  return <><AdminHeading title={selectLot ? 'Lotes por leilão' : 'Leilões'} description={selectLot ? 'Selecione um leilão para consultar seus lotes. A seleção inclui todas as páginas do catálogo.' : 'Consulte os leilões da plataforma por status. Datas apresentadas no horário de Brasília.'} retry={() => { if (!publicationActive) resource.retry() }} />
    {publicationNotice && <p role="status" className="mb-5 text-sm">{publicationNotice}</p>}
    {!selectLot && <div className="mb-5 flex flex-wrap items-center justify-between gap-3">{typeof location.state?.auctionNotice === 'string' && <p role="status" className="text-sm">{location.state.auctionNotice}</p>}<Link to="/area-leiloeiro/leiloes/novo" className={`${adminButton} bg-accent text-white hover:bg-blue-700`}>Cadastrar leilão</Link></div>}
    <div className="mb-6 rounded-2xl border border-line bg-surface p-5"><label className="block max-w-sm space-y-2 text-xs font-medium text-muted">Status do leilão<select disabled={publicationActive} className={adminInput} value={status ?? ''} onChange={event => setQuery(event.target.value ? { status: event.target.value } : {})}><option value="">Todos os status</option>{Object.entries(auctionStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    <AdminFeedback {...resource} empty={!resource.data?.data.length}>{resource.data && <>
      <AdminTable headers={['Leilão', 'Status', 'Início · Brasília', 'Prazo · Brasília', 'Consulta']}>
        {resource.data.data.map(auction => <tr key={auction.id} className="hover:bg-accent/5"><td className="min-w-44 px-5 py-5 font-medium">{auction.title}</td><td className="px-5 py-5"><StatusBadge>{auctionStatusLabels[auction.status]}</StatusBadge></td><td className="whitespace-nowrap px-5 py-5"><time dateTime={auction.startsAt}>{formatDate(auction.startsAt)}</time></td><td className="whitespace-nowrap px-5 py-5"><time dateTime={auction.endsAt}>{formatDate(auction.endsAt)}</time></td><td className="px-5 py-5">{!selectLot && <Link to={`/area-leiloeiro/leiloes/${auction.id}/editar`} className="inline-flex min-h-11 items-center whitespace-nowrap font-medium text-accent dark:text-blue-300">Gerenciar leilão</Link>}<Link to={`/area-leiloeiro/lotes/${auction.id}`} className="inline-flex min-h-11 items-center whitespace-nowrap font-medium text-accent dark:text-blue-300">Consultar lotes →</Link>{!selectLot && <AuctionPublication auction={auction} blocked={publicationActive} onActive={setPublicationActive} onPublished={() => { setPublicationNotice('Leilão publicado como Agendado. A abertura será automática no horário de início, com o backend em execução.'); resource.retry() }} />}</td></tr>)}
      </AdminTable><AdminPagination pagination={resource.data.pagination} change={next => { if (!publicationActive) change(next) }} />
    </>}</AdminFeedback>
  </>
}

function LotsContent({ auctionId }: { auctionId: string }) {
  const location = useLocation()
  const { page, change } = useListQuery()
  const resource = usePublicResource(`admin:lots:${auctionId}:${page}`, async signal => {
    const [auction, lots] = await Promise.all([getAuction(auctionId, signal), getManagedLotsPage(auctionId, page, signal)])
    return { auction, lots }
  })
  return <><Link to="/area-leiloeiro/lotes" className="mb-5 inline-flex min-h-11 items-center text-sm font-medium text-accent dark:text-blue-300">← Selecionar outro leilão</Link><AdminHeading title="Lotes" description={resource.data ? `${resource.data.auction.title} · ${auctionStatusLabels[resource.data.auction.status]}` : 'Consulte os lotes vinculados ao leilão.'} retry={resource.retry} />
    {typeof location.state?.lotNotice === 'string' && <p role="status" className="mb-5 text-sm">{location.state.lotNotice}</p>}
    {resource.data && <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><Link to={`/area-leiloeiro/leiloes/${auctionId}/editar`} className={adminButton}>Consultar leilão</Link>{lotActions(resource.data.auction.status).create && <Link to={`/area-leiloeiro/lotes/${auctionId}/novo`} className={`${adminButton} bg-accent text-white hover:bg-blue-700`}>Cadastrar lote</Link>}<p className="w-full text-xs leading-5 text-muted">A disponibilidade das operações depende das permissões, prazos e histórico verificados pela plataforma.</p></div>}
    <AdminFeedback {...resource} empty={!resource.data?.lots.data.length}>{resource.data && <>
      <AdminTable headers={['Lote / veículo', 'Status', 'Preço inicial', 'Incremento mínimo', 'Prazo · Brasília', 'Gerenciamento']}>
        {resource.data.lots.data.map(lot => <tr key={lot.id} className="hover:bg-accent/5"><td className="min-w-48 px-5 py-5"><p className="font-medium">Lote {lot.number}</p><p className="mt-1 text-xs text-muted">{lot.vehicle.brand} {lot.vehicle.model} · {lot.vehicle.year}</p></td><td className="px-5 py-5"><StatusBadge>{lotStatusLabels[lot.status]}</StatusBadge></td><td className="whitespace-nowrap px-5 py-5">{formatMoney(lot.startingPrice)}</td><td className="whitespace-nowrap px-5 py-5">{formatMoney(lot.minimumIncrement)}</td><td className="whitespace-nowrap px-5 py-5"><time dateTime={lot.endsAt}>{formatDate(lot.endsAt)}</time></td><td className="px-5 py-5"><Link to={`/area-leiloeiro/lotes/${auctionId}/${lot.id}/editar`} className="inline-flex min-h-11 items-center text-sm font-medium text-accent dark:text-blue-300">{lotActions(resource.data!.auction.status, lot.status).edit ? 'Gerenciar lote' : 'Consultar lote'}</Link></td></tr>)}
      </AdminTable><AdminPagination pagination={resource.data.lots.pagination} change={change} />
    </>}</AdminFeedback>
  </>
}
export function AuctioneerLotsPage() {
  const { auctionId } = useParams()
  if (!auctionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(auctionId)) return <div><h2 className="text-2xl font-semibold">Leilão inválido</h2><Link className={adminButton} to="/area-leiloeiro/lotes">Selecionar leilão</Link></div>
  return <LotsContent key={auctionId} auctionId={auctionId} />
}
