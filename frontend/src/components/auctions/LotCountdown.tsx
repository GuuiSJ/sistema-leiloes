import { Clock3 } from 'lucide-react'
import type { Auction, Lot } from '../../services/auctions'
import { deadlineState } from '../../services/auction-rules'
import { formatDate } from '../../services/formatters'

export function LotCountdown({ auction, lot }: { auction: Auction; lot: Lot }) {
  const state = deadlineState(auction, lot)
  return <section aria-label="Prazo do lote" className="rounded-xl border border-line bg-canvas p-4">
    <p className="flex items-center gap-2 text-sm font-semibold"><Clock3 size={17} aria-hidden="true" />{state === 'closed' ? 'Lote ou leilão encerrado' : state === 'not-open' ? 'Contagem não iniciada' : 'Contagem regressiva indisponível'}</p>
    <p className="mt-2 text-xs leading-5 text-muted">Prazo registrado do lote: <time dateTime={lot.endsAt}>{formatDate(lot.endsAt)}</time> (Brasília).</p>
    {state === 'unverified' && <p className="mt-2 text-xs leading-5 text-muted">Não foi possível confirmar a confiabilidade temporal deste prazo. Uma data registrada não basta para ativar a contagem.</p>}
  </section>
}
