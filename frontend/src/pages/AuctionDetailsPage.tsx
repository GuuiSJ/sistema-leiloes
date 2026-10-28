import { useEffect, useState } from 'react'
import { ArrowLeft, RefreshCw } from 'lucide-react'
import { Link, useParams } from 'react-router'
import { usePublicResource } from '../hooks/usePublicResource'
import { getAuction, getLotsPage } from '../services/auctions'
import { AuctionInfo } from '../components/auctions/AuctionInfo'
import { LotDetails } from '../components/auctions/LotDetails'
import { DetailError, DetailLoading } from '../components/auctions/DetailFeedback'

function DetailContent({ id }: { id: string }) {
  const [page, setPage] = useState(1)
  const [lotId, setLotId] = useState('')
  const resource = usePublicResource(`auction:${id}:${page}`, async signal => {
    const [auction, lots] = await Promise.all([getAuction(id, signal), getLotsPage(id, page, signal)])
    return { auction, lots }
  })
  useEffect(() => {
    if (resource.data?.auction.status !== 'SCHEDULED') return
    const timer = setInterval(() => { if (document.visibilityState !== 'hidden') resource.retry() }, 5000)
    return () => clearInterval(timer)
  }, [resource.data?.auction.status])
  const selected = resource.data?.lots.data.find(lot => lot.id === lotId) ?? resource.data?.lots.data[0]
  return <div className="page-container py-8 sm:py-12">
    <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
      <Link to="/leiloes" className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-accent dark:text-blue-300"><ArrowLeft size={17} aria-hidden="true" />Voltar aos leilões</Link>
      <button type="button" disabled={resource.loading} onClick={resource.retry} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium hover:bg-accent/10 disabled:opacity-40"><RefreshCw size={16} aria-hidden="true" />Atualizar dados</button>
    </div>
    {resource.loading ? <DetailLoading /> : resource.error || !resource.data ? <>
      <h1 className="mb-5 text-3xl font-semibold tracking-tight">{resource.error?.status === 404 ? 'Leilão não encontrado' : 'Detalhes indisponíveis'}</h1>
      <DetailError message={resource.error?.status === 404 ? 'O leilão pode não existir ou não estar disponível para consulta.' : 'Não foi possível consultar este leilão e seus lotes.'} retry={resource.retry} />
    </> : <>
      <AuctionInfo auction={resource.data.auction} />
      <section aria-label="Seleção de lote" className="mt-7 rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><h2 className="text-lg font-semibold">Veículos deste leilão</h2><p className="mt-1 text-sm text-muted">{resource.data.lots.pagination.total} {resource.data.lots.pagination.total === 1 ? 'lote cadastrado' : 'lotes cadastrados'}</p></div>
          {selected && <div className="w-full sm:w-auto sm:max-w-md"><label htmlFor="lot-selector" className="mb-2 block text-xs font-medium text-muted">Selecionar lote nesta página</label>
            <select id="lot-selector" value={selected.id} onChange={event => setLotId(event.target.value)} className="min-h-11 w-full rounded-lg border border-line bg-canvas px-3 text-sm text-ink">
              {resource.data.lots.data.map(lot => <option key={lot.id} value={lot.id}>Lote {lot.number} · {lot.vehicle.brand} {lot.vehicle.model} · {lot.vehicle.year}</option>)}
            </select>
          </div>}
        </div>
        {resource.data.lots.pagination.totalPages > 1 && <nav aria-label="Paginação dos lotes" className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4 text-sm">
          <span className="text-muted">Página {page} de {resource.data.lots.pagination.totalPages}</span><div className="flex gap-2">
            <button type="button" disabled={page === 1} onClick={() => { setLotId(''); setPage(value => value - 1) }} className="min-h-11 rounded-lg border border-line px-3 hover:bg-accent/10 disabled:opacity-40">Anterior</button>
            <button type="button" disabled={page >= resource.data.lots.pagination.totalPages} onClick={() => { setLotId(''); setPage(value => value + 1) }} className="min-h-11 rounded-lg border border-line px-3 hover:bg-accent/10 disabled:opacity-40">Próxima</button>
          </div>
        </nav>}
        {!selected && <p role="status" className="mt-5 text-sm text-muted">Nenhum lote disponível nesta página.</p>}
      </section>
      {selected && <LotDetails key={selected.id} auction={resource.data.auction} lotId={selected.id} />}
    </>}
  </div>
}

export function AuctionDetailsPage() {
  const { id } = useParams()
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return <div className="page-container py-16"><h1 className="text-3xl font-semibold">Endereço de leilão inválido</h1><Link to="/leiloes" className="mt-6 inline-flex min-h-11 items-center rounded-md text-accent dark:text-blue-300">Voltar aos leilões</Link></div>
  return <DetailContent key={id} id={id} />
}
