import { CircleAlert } from 'lucide-react'
import type { WalletError } from '../../services/wallet'

export function WalletFeedback({ error, retry, checkSession }: { error: WalletError; retry: () => void; checkSession?: () => void }) {
  const unauthorized = error.status === 401, forbidden = error.status === 403
  return <div role="alert" className="rounded-xl border border-line bg-surface p-6">
    <CircleAlert size={24} className="mb-3 text-muted" aria-hidden="true" />
    <h3 className="font-semibold">{unauthorized ? 'Sessão não confirmada' : forbidden ? 'Consulta não permitida' : 'Dados financeiros indisponíveis'}</h3>
    <p className="mt-2 text-sm leading-6 text-muted">{error.message}</p>
    {!unauthorized && (!forbidden || checkSession) && <button type="button" onClick={forbidden ? checkSession : retry} className="mt-4 min-h-11 rounded-lg border border-line px-4 text-sm font-medium transition-colors hover:bg-accent/10">{forbidden ? 'Verificar sessão e perfil' : 'Tentar novamente'}</button>}
  </div>
}
