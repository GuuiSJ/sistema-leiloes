import type { Auction, Bid, Lot } from '../../services/auctions'
import { formatMoney } from '../../services/formatters'
import { referenceNextBid } from '../../services/auction-rules'
import { LotCountdown } from './LotCountdown'

export function LotBidSummary({ auction, lot, latest, available }: { auction: Auction; lot: Lot; latest: Bid | null; available: boolean }) {
  const open = auction.status === 'OPEN' && lot.status === 'OPEN'
  const minimum = open ? referenceNextBid(lot, latest, available) : null
  return <section aria-label="Valores e prazo do lote" className="space-y-5 rounded-2xl border border-line bg-surface p-6">
    <div><p className="text-sm text-muted">{latest ? open ? 'Lance atual consultado' : 'Último lance recebido' : available ? 'Lance inicial' : 'Lance atual indisponível'}</p>
      <p className="mt-2 break-words text-3xl font-semibold tracking-tight">{available ? formatMoney(latest?.amount ?? lot.startingPrice) : 'Não consultado'}</p>
      {available && !latest && <p className="mt-2 text-xs text-muted">Nenhum lance registrado neste lote.</p>}
    </div>
    <dl className="space-y-3 border-t border-line pt-5 text-sm">
      <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted">Valor inicial</dt><dd className="font-medium">{formatMoney(lot.startingPrice)}</dd></div>
      <div className="flex flex-wrap justify-between gap-2"><dt className="text-muted">Incremento mínimo</dt><dd className="font-medium">{formatMoney(lot.minimumIncrement)}</dd></div>
      {minimum && <div><dt className="text-muted">Mínimo pela regra de incremento</dt><dd className="mt-1 text-lg font-semibold">{formatMoney(minimum)}</dd></div>}
    </dl>
    {minimum && <p className="text-xs leading-5 text-muted">Referência calculada com os dados consultados, não uma garantia de aceitação. A disponibilidade operacional deste leilão não é informada pela consulta pública.</p>}
    <LotCountdown auction={auction} lot={lot} />
    <p className="text-sm leading-5 text-muted">Os dados são atualizados durante o leilão. Entre na sua conta para verificar se você pode participar.</p>
  </section>
}
