import type { Lot } from '../../services/auctions'
import { formatMoney } from '../../services/formatters'

export function BidConfirmation({ lot, amount, busy, uncertain, onConfirm, onCancel }: {
  lot: Lot; amount: string; busy: boolean; uncertain: boolean; onConfirm: () => void; onCancel: () => void
}) {
  return <section aria-label="Confirmação do lance" className="space-y-3 rounded-xl border border-line p-4">
    <h4 className="font-semibold" tabIndex={-1} ref={node => node?.focus()}>Confirme seu lance</h4>
    <p>{lot.vehicle.brand} {lot.vehicle.model} · Lote {lot.number}</p><p className="text-xl font-semibold">{formatMoney(amount)}</p>
    <p className="text-sm text-muted">A aceitação pode reservar créditos da sua carteira. O servidor verificará novamente saldo, mínimo e prazo.</p>
    {uncertain && <p className="text-sm text-muted">Resultado ainda não confirmado. Repita esta tentativa com a mesma chave, sem alterar o valor. Evite sair desta página.</p>}
    <button type="button" disabled={busy} onClick={onConfirm} className="rounded-xl bg-accent px-4 py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Enviando...' : uncertain ? 'Repetir mesma tentativa' : 'Confirmar e enviar lance'}</button>
    {!uncertain && <button type="button" disabled={busy} onClick={onCancel} className="ml-3 px-3 py-2">Voltar</button>}
  </section>
}
