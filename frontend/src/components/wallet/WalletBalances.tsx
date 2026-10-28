import { LockKeyhole, Wallet, Landmark } from 'lucide-react'
import type { WalletSnapshot } from '../../services/wallet'
import type { FinancialState } from '../../hooks/useWallet'
import { formatMoney } from '../../services/formatters'
import { WalletFeedback } from './WalletFeedback'

export function WalletBalances({ state, checkSession }: { state: FinancialState<WalletSnapshot>; checkSession: () => void }) {
  if (state.loading) return <div role="status"><span className="sr-only">Consultando saldos...</span><div aria-hidden="true" className="grid gap-4 sm:grid-cols-3">{[0, 1, 2].map(index => <div key={index} className="h-40 animate-pulse rounded-2xl bg-line/60" />)}</div></div>
  if (state.error) return <WalletFeedback error={state.error} retry={state.retry} checkSession={checkSession} />
  if (!state.data) return <p role="status" className="text-sm text-muted">Saldos ainda não consultados.</p>
  const cards = [
    { title: 'Saldo disponível', amount: state.data.availableBalance, detail: 'Valor disponível informado pela carteira', Icon: Wallet, primary: true },
    { title: 'Saldo reservado', amount: state.data.reservedBalance, detail: 'Valor comprometido em reservas ativas', Icon: LockKeyhole, primary: false },
    { title: 'Saldo total', amount: state.data.totalBalance, detail: 'Saldo total informado pela carteira', Icon: Landmark, primary: false },
  ]
  return <dl className="grid gap-4 sm:grid-cols-3">{cards.map(({ title, amount, detail, Icon, primary }) => <div key={title} className={`min-w-0 rounded-2xl border p-5 ${primary ? 'border-navy bg-navy text-white' : 'border-line bg-surface'}`}>
    <Icon size={21} strokeWidth={1.5} className={primary ? 'text-blue-200' : 'text-muted'} aria-hidden="true" />
    <dt className={`mt-5 text-xs ${primary ? 'text-blue-100' : 'text-muted'}`}>{title}</dt>
    <dd className="mt-2 break-words text-xl font-semibold tracking-tight xl:text-2xl">{formatMoney(amount)}</dd>
    <p className={`mt-3 text-[11px] leading-5 ${primary ? 'text-slate-300' : 'text-muted'}`}>{detail}</p>
  </div>)}</dl>
}
