import { useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react'
import { useAuctions } from '../hooks/useAuctions'
import { AuctionResults } from '../components/auctions/AuctionResults'

export function AuctionsPage() {
  const [page, setPage] = useState(1)
  const auctions = useAuctions(false, page)
  return (
    <div className="page-container py-10 sm:py-14">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="mb-3 text-xs font-semibold tracking-[0.2em] text-accent uppercase dark:text-blue-300">Leilões de automóveis</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Explore os leilões</h1>
          <p className="mt-4 max-w-xl text-sm leading-6 text-muted">Consulte os leilões e seus registros históricos. Cada card apresenta a prévia de um lote; um leilão pode conter outros veículos.</p>
        </div>
        <button type="button" disabled={auctions.loading} onClick={auctions.retry} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium transition-colors hover:bg-accent/10 disabled:cursor-wait disabled:opacity-50">
          <RefreshCw size={16} aria-hidden="true" />Atualizar
        </button>
      </div>
      <section aria-labelledby="auction-list-title">
        <h2 id="auction-list-title" className="sr-only">Lista de leilões</h2>
        <AuctionResults {...auctions} />
      </section>
      {!auctions.loading && !auctions.error && auctions.pagination && auctions.pagination.totalPages > 1 && <nav aria-label="Paginação dos leilões" className="mt-8 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
        <span className="text-sm text-muted" aria-live="polite">Página {page} de {auctions.pagination.totalPages} · {auctions.pagination.total} leilões</span>
        <div className="flex gap-3">
          <button type="button" disabled={page <= 1} onClick={() => setPage(value => value - 1)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-line bg-surface px-3 text-sm hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft size={17} aria-hidden="true" />Anterior</button>
          <button type="button" disabled={page >= auctions.pagination.totalPages} onClick={() => setPage(value => value + 1)} className="inline-flex min-h-11 items-center gap-1 rounded-lg border border-line bg-surface px-3 text-sm hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40">Próxima<ChevronRight size={17} aria-hidden="true" /></button>
        </div>
      </nav>}
    </div>
  )
}
