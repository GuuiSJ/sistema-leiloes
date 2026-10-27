import type { Auction, AuctionStatus, LotStatus } from '../../services/auctions'
import { formatDate } from '../../services/formatters'

export const auctionStatusLabels: Record<AuctionStatus, string> = { DRAFT: 'Rascunho', SCHEDULED: 'Agendado', OPEN: 'Aberto', CLOSED: 'Encerrado', CANCELLED: 'Cancelado' }
export const lotStatusLabels: Record<LotStatus, string> = { PENDING: 'Pendente', OPEN: 'Aberto', SOLD: 'Vendido', UNSOLD: 'Não vendido', CANCELLED: 'Cancelado' }

export function AuctionInfo({ auction }: { auction: Auction }) {
  return <section aria-labelledby="auction-title" className="rounded-2xl bg-navy p-6 text-white sm:p-9">
    <p className="mb-4 text-xs font-semibold tracking-[0.16em] text-blue-200 uppercase">Detalhes do leilão · {auctionStatusLabels[auction.status]}</p>
    <h1 id="auction-title" className="break-words text-3xl font-semibold tracking-tight sm:text-4xl">{auction.title}</h1>
    {auction.description && <p className="mt-4 max-w-3xl whitespace-pre-line break-words text-sm leading-7 text-slate-300">{auction.description}</p>}
    <dl className="mt-7 flex flex-wrap gap-x-10 gap-y-4 text-sm">
      <div><dt className="text-slate-300">Início registrado</dt><dd className="mt-1 font-medium"><time dateTime={auction.startsAt}>{formatDate(auction.startsAt)}</time></dd></div>
      <div><dt className="text-slate-300">Prazo do leilão</dt><dd className="mt-1 font-medium"><time dateTime={auction.endsAt}>{formatDate(auction.endsAt)}</time></dd></div>
    </dl>
    <p className="mt-5 text-xs leading-5 text-slate-300">Datas no horário de Brasília, conforme registradas. O status cadastrado não garante disponibilidade para novos lances.</p>
  </section>
}
