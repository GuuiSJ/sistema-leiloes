import type { Lot } from '../../services/auctions'
import { formatMoney } from '../../services/formatters'

export function LotOutcome({ lot }: { lot: Lot }) {
  if (!['SOLD', 'UNSOLD'].includes(lot.status)) return null
  return <section aria-label="Resultado final do lote" className="rounded-2xl border border-accent/30 bg-surface p-6"><h3 className="text-lg font-semibold">{lot.status === 'SOLD' ? 'Lote arrematado' : 'Lote encerrado sem vencedor'}</h3>
    {lot.status === 'SOLD' && (lot.result?.status === 'SOLD' ? <><p className="mt-3 text-sm text-muted">Valor final confirmado</p><p className="mt-2 text-3xl font-semibold">{formatMoney(lot.result.finalAmount)}</p><details className="mt-4 text-xs text-muted"><summary className="min-h-8 cursor-pointer">Identificador público do lance vencedor</summary><p className="break-all font-mono">{lot.result.winningBidId}</p></details></> : <p role="status" className="mt-3 text-sm text-muted">O valor final ainda não pôde ser confirmado. Atualize os dados.</p>)}
  </section>
}
