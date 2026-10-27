import { Link } from 'react-router'
import { useAuth } from '../../hooks/useAuth'
import { DetailLoading } from '../auctions/DetailFeedback'

export function SessionFeedback() {
  const auth = useAuth()
  if (auth.status === 'restoring') return <div className="page-container py-12"><DetailLoading label="Verificando sua sessão..." /></div>
  return <div className="page-container py-12"><section role="alert" className="max-w-xl rounded-2xl border border-line bg-surface p-7">
    <h1 className="text-2xl font-semibold">Não foi possível verificar sua sessão</h1>
    <p className="mt-4 text-sm leading-6 text-muted">{auth.message}</p>
    <div className="mt-6 flex flex-wrap gap-3"><button type="button" onClick={() => { void auth.refresh() }} className="min-h-11 rounded-lg bg-accent px-4 text-sm font-medium text-white hover:bg-blue-700">Tentar novamente</button>
      <button type="button" onClick={auth.logout} className="min-h-11 rounded-lg border border-line px-4 text-sm">Limpar sessão local</button></div>
    <Link to="/" className="mt-5 inline-flex min-h-11 items-center rounded-md text-sm text-accent dark:text-blue-300">Voltar ao início</Link>
  </section></div>
}
