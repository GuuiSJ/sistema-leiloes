import { ReceiptText } from 'lucide-react'
import type { WalletHistory, MovementType } from '../../services/wallet'
import type { FinancialState } from '../../hooks/useWallet'
import { formatDate, formatMoney } from '../../services/formatters'
import { DetailLoading } from '../auctions/DetailFeedback'
import { WalletFeedback } from './WalletFeedback'

const labels: Record<MovementType, string> = { CREDIT: 'Crédito', DEBIT: 'Débito', RESERVE: 'Reserva', RELEASE: 'Liberação de reserva' }
type Props = { state: FinancialState<WalletHistory>; page: number; changePage: (page: number) => void; checkSession: () => void }
export function WalletTransactions({ state, page, changePage, checkSession }: Props) {
  return <section aria-labelledby="wallet-history" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
    <h3 id="wallet-history" className="text-lg font-semibold tracking-tight">Histórico de movimentações</h3>
    <p className="mt-2 text-xs leading-5 text-muted">Mais recentes primeiro. Créditos e débitos são distintos de reservas e liberações de reserva.</p>
    <div className="mt-6">
      {state.loading ? <DetailLoading label="Consultando movimentações..." /> : state.error ? <WalletFeedback error={state.error} retry={state.retry} checkSession={checkSession} /> : !state.data ?
        <p className="text-sm text-muted">Histórico ainda não consultado.</p> : state.data.data.length === 0 ?
          <div role="status" className="rounded-xl border border-dashed border-line px-5 py-10 text-center"><ReceiptText size={30} strokeWidth={1.3} className="mx-auto mb-3 text-muted" aria-hidden="true" /><p className="text-sm font-medium">{state.data.pagination.total === 0 ? 'Nenhuma movimentação registrada' : 'Nenhuma movimentação nesta página'}</p><p className="mt-2 text-xs text-muted">{state.data.pagination.total === 0 ? 'O histórico aparecerá aqui quando houver registros na carteira.' : 'Use a paginação para consultar os outros registros.'}</p></div> :
            <div className="overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm">
              <caption className="sr-only">Tipo, valor, saldo após, data e descrição das movimentações da sua carteira</caption>
              <thead className="border-b border-line text-xs text-muted"><tr>{['Tipo', 'Valor', 'Saldo após', 'Data · Brasília', 'Descrição'].map(label => <th key={label} scope="col" className="px-3 py-3 font-medium first:pl-0 last:pr-0">{label}</th>)}</tr></thead>
              <tbody>{state.data.data.map(item => <tr key={item.id} className="border-b border-line last:border-0">
                <td className="py-4 pr-3 align-top"><span className="font-medium">{labels[item.type]}</span>{item.simulated && <span className="mt-1 block text-[11px] font-medium text-amber-800 dark:text-amber-200">Simulado · demonstração</span>}</td>
                <td className="px-3 py-4 align-top whitespace-nowrap font-medium">{formatMoney(item.amount)}</td>
                <td className="px-3 py-4 align-top whitespace-nowrap">{formatMoney(item.balanceAfter)}</td>
                <td className="px-3 py-4 align-top whitespace-nowrap text-muted"><time dateTime={item.createdAt}>{formatDate(item.createdAt)}</time></td>
                <td className="py-4 pl-3 align-top text-xs text-muted">Não informada</td>
              </tr>)}</tbody>
            </table></div>}
      {!state.loading && !state.error && state.data && state.data.pagination.totalPages > 1 && <nav aria-label="Paginação das movimentações" className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5 text-xs">
        <span className="text-muted" aria-live="polite">Página {page} de {state.data.pagination.totalPages} · {state.data.pagination.total} registros</span>
        <div className="flex gap-2"><button type="button" disabled={page === 1} onClick={() => changePage(page - 1)} className="min-h-11 rounded-lg border border-line px-3 transition-colors hover:bg-accent/10 disabled:opacity-40">Anterior</button><button type="button" disabled={page >= state.data.pagination.totalPages} onClick={() => changePage(page + 1)} className="min-h-11 rounded-lg border border-line px-3 transition-colors hover:bg-accent/10 disabled:opacity-40">Próxima</button></div>
      </nav>}
    </div>
    <p className="mt-5 text-xs leading-5 text-muted">A API não fornece descrição textual das movimentações. Valores e datas são exibidos conforme registrados, sem normalizar a origem das datas históricas.</p>
  </section>
}
