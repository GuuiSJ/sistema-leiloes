import { useState } from 'react'
import { RefreshCw, Wallet } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import { useWallet } from '../../hooks/useWallet'
import { canViewWallet } from '../../services/wallet'
import { WalletBalances } from './WalletBalances'
import { WalletTransactions } from './WalletTransactions'
import { WalletCredit } from './WalletCredit'

function WalletContent() {
  const auth = useAuth()
  const [requested, setRequested] = useState(false), [page, setPage] = useState(1)
  const { wallet, history } = useWallet(requested, page)
  const loading = wallet.loading || history.loading
  const verify = () => { void auth.refresh() }
  return <section aria-labelledby="wallet-title" className="min-w-0 space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><h2 id="wallet-title" className="text-2xl font-semibold tracking-tight">Minha carteira</h2><p className="mt-2 text-sm text-muted">Seus saldos e registros, em uma visão organizada.</p></div>
      {requested && <button type="button" disabled={loading} onClick={() => { wallet.retry(); history.retry() }} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-line bg-surface px-4 text-sm font-medium transition-colors hover:bg-accent/10 disabled:opacity-40"><RefreshCw size={16} aria-hidden="true" />Atualizar</button>}
    </div>
    {!requested ? <div className="rounded-2xl border border-line bg-surface p-7 sm:p-9"><Wallet size={31} strokeWidth={1.4} className="mb-5 text-accent dark:text-blue-300" aria-hidden="true" /><h3 className="text-lg font-semibold">Consulte seus dados financeiros</h3><p className="mt-3 max-w-xl text-sm leading-7 text-muted">A primeira consulta pode criar automaticamente sua carteira com saldo zero. Consultar não adiciona saldo nem envia lances. Créditos de demonstração, quando autorizados, exigem confirmação separada.</p><button type="button" onClick={() => setRequested(true)} className="mt-6 min-h-12 rounded-lg bg-accent px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700">Consultar carteira</button></div> : <>
      <WalletBalances state={wallet} checkSession={verify} />
      <WalletCredit disabled={loading || !!wallet.error} onSuccess={() => { setPage(1); wallet.retry(); history.retry() }} />
      <WalletTransactions state={history} page={page} changePage={setPage} checkSession={verify} />
      <p className="text-xs leading-5 text-muted">Os dados não são atualizados em tempo real; use Atualizar para uma nova consulta. Créditos de demonstração exigem confirmação e autorização do ambiente.</p>
    </>}
  </section>
}

export function WalletSection() {
  const auth = useAuth()
  if (auth.status !== 'authenticated' || !auth.user) return null
  if (!canViewWallet(auth.user.role)) return <section aria-labelledby="wallet-title" className="rounded-2xl border border-line bg-surface p-7"><h2 id="wallet-title" className="text-2xl font-semibold tracking-tight">Carteira</h2><p className="mt-4 text-sm leading-7 text-muted">A consulta de carteira está disponível apenas para o perfil de participante. Seu perfil de leiloeiro não tem acesso a esses endpoints.</p></section>
  return <WalletContent key={auth.user.id} />
}
