import { CircleAlert, Gavel, RefreshCw } from 'lucide-react'
import type { AuctionPreview } from '../../services/auctions'
import { AuctionCard } from './AuctionCard'

type Props = { loading: boolean; error: string | null; items: AuctionPreview[]; retry: () => void; featured?: boolean }
export function AuctionResults({ loading, error, items, retry, featured = false }: Props) {
  if (loading) return <div role="status" aria-live="polite">
    <p className="sr-only">Carregando leilões e lotes...</p>
    <div aria-hidden="true" className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 3 }, (_, index) => <div key={index} className="animate-pulse overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="aspect-[16/10] bg-line/60" /><div className="space-y-4 p-6"><div className="h-4 w-20 rounded bg-line" /><div className="h-6 w-4/5 rounded bg-line" /><div className="h-4 w-2/3 rounded bg-line" /><div className="h-8 w-1/2 rounded bg-line" /></div>
      </div>)}
    </div>
  </div>
  if (error) return <div role="alert" className="rounded-2xl border border-line bg-surface p-8 sm:p-10">
    <CircleAlert size={26} className="mb-4 text-muted" aria-hidden="true" />
    <h3 className="text-lg font-semibold">Não foi possível carregar os leilões</h3>
    <p className="mt-2 max-w-xl text-sm leading-6 text-muted">{error}</p>
    <button type="button" onClick={retry} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-lg border border-line px-4 text-sm font-medium transition-colors hover:bg-accent/10">
      <RefreshCw size={16} aria-hidden="true" />Tentar novamente
    </button>
  </div>
  if (!items.length) return <div role="status" className="rounded-2xl border border-dashed border-line bg-surface px-6 py-12 text-center">
    <Gavel size={32} strokeWidth={1.4} className="mx-auto mb-4 text-muted" aria-hidden="true" />
    <h3 className="text-lg font-semibold">{featured ? 'Nenhum leilão em destaque no momento' : 'Nenhum leilão encontrado'}</h3>
    <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">{featured ? 'Não há leilões abertos ou agendados para exibir nesta consulta.' : 'Novos leilões aparecerão aqui quando estiverem disponíveis na plataforma.'}</p>
  </div>
  return <>
    {items.some(item => item.lotUnavailable || item.bidUnavailable) && <p role="status" className="mb-5 rounded-xl border border-line bg-surface p-4 text-sm text-muted">
      Alguns dados de lotes ou lances não puderam ser consultados. <button type="button" onClick={retry} className="rounded-sm font-medium text-accent underline underline-offset-4 dark:text-blue-300">Tentar novamente</button>
    </p>}
    <div className="grid items-start gap-6 md:grid-cols-2 xl:grid-cols-3">{items.map(item => <AuctionCard key={item.auction.id} item={item} />)}</div>
    <p className="mt-5 text-xs leading-5 text-muted">Valores consultados ao carregar a página; não há atualização em tempo real. Datas no horário de Brasília, conforme registradas pela plataforma. A origem das datas históricas pode não estar validada.</p>
  </>
}
