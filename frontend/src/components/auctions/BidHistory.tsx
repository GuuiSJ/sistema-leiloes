import { useState } from 'react'
import type { Bid, Page } from '../../services/auctions'
import { getBidHistory } from '../../services/auctions'
import { usePublicResource } from '../../hooks/usePublicResource'
import { formatDate, formatMoney } from '../../services/formatters'
import type { ApiError } from '../../services/api'
import { DetailError, DetailLoading } from './DetailFeedback'

type Props = { lotId: string; firstPage: Page<Bid> | null; loading: boolean; error: ApiError | null; retry: () => void }
export function BidHistory({ lotId, firstPage, loading, error, retry }: Props) {
  const [page, setPage] = useState(1)
  const laterPage = usePublicResource(`history:${lotId}:${page}`, signal => getBidHistory(lotId, page, signal), page > 1)
  const state = page === 1 ? { data: firstPage, loading, error, retry } : laterPage
  return <section aria-labelledby="bid-history" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
    <h3 id="bid-history" className="text-lg font-semibold">Histórico de lances</h3>
    <p className="mt-2 text-xs leading-5 text-muted">Mais recentes primeiro. Identidades dos participantes não são divulgadas.</p>
    <div className="mt-5">
      {state.loading ? <DetailLoading label="Consultando histórico..." /> : state.error ? <DetailError message="Não foi possível consultar o histórico de lances." retry={state.retry} /> :
        !state.data?.data.length ? <p role="status" className="py-6 text-sm text-muted">{state.data?.pagination.total === 0 ? 'Nenhum lance registrado neste lote.' : 'Nenhum lance nesta página.'}</p> :
          <div className="overflow-x-auto"><table className="w-full text-left text-sm">
            <caption className="sr-only">Sequência, valor e data dos lances deste lote</caption>
            <thead className="border-b border-line text-xs text-muted"><tr><th scope="col" className="py-3 pr-4 font-medium">Sequência</th><th scope="col" className="px-3 py-3 font-medium">Valor</th><th scope="col" className="py-3 pl-3 font-medium">Data · Brasília</th></tr></thead>
            <tbody>{state.data.data.map(bid => <tr key={bid.id} className="border-b border-line last:border-0"><td className="py-4 pr-4">#{bid.sequence}</td><td className="px-3 py-4 whitespace-nowrap font-medium">{formatMoney(bid.amount)}</td><td className="py-4 pl-3 whitespace-nowrap text-muted"><time dateTime={bid.createdAt}>{formatDate(bid.createdAt)}</time></td></tr>)}</tbody>
          </table></div>}
      {!state.loading && !state.error && state.data && state.data.pagination.totalPages > 1 && <nav aria-label="Paginação do histórico de lances" className="mt-5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <span className="text-muted">Página {page} de {state.data.pagination.totalPages} · {state.data.pagination.total} lances</span>
        <div className="flex gap-2">
          <button type="button" disabled={page === 1} onClick={() => setPage(value => value - 1)} className="min-h-11 rounded-lg border border-line px-3 hover:bg-accent/10 disabled:opacity-40">Anterior</button>
          <button type="button" disabled={page >= state.data.pagination.totalPages} onClick={() => setPage(value => value + 1)} className="min-h-11 rounded-lg border border-line px-3 hover:bg-accent/10 disabled:opacity-40">Próxima</button>
        </div>
      </nav>}
    </div>
  </section>
}
