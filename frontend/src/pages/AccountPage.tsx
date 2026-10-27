import { Link, useNavigate } from 'react-router'
import { useAuth } from '../hooks/useAuth'

export function AccountPage() {
  const auth = useAuth(), navigate = useNavigate()
  if (!auth.user) return null
  return <section className="page-container py-10 sm:py-14"><div className="max-w-2xl rounded-2xl border border-line bg-surface p-7 sm:p-10">
    <p className="text-xs font-medium tracking-[0.18em] text-accent uppercase dark:text-blue-300">Sua sessão</p><h1 className="mt-4 text-3xl font-semibold tracking-tight">Minha conta</h1>
    <dl className="mt-7 space-y-5 text-sm"><div><dt className="text-muted">Nome</dt><dd className="mt-1 break-words font-medium">{auth.user.name}</dd></div><div><dt className="text-muted">E-mail</dt><dd className="mt-1 break-words font-medium">{auth.user.email}</dd></div><div><dt className="text-muted">Perfil</dt><dd className="mt-1 font-medium">{auth.user.role === 'AUCTIONEER' ? 'Leiloeiro' : 'Participante'}</dd></div></dl>
    {auth.message && <p role="status" className="mt-5 text-sm text-muted">{auth.message}</p>}
    {auth.user.role === 'AUCTIONEER' && <Link to="/area-leiloeiro" className="mt-6 inline-flex min-h-11 items-center rounded-md font-medium text-accent dark:text-blue-300">Área do leiloeiro</Link>}
    <div className="mt-7 flex flex-wrap gap-3"><button type="button" onClick={() => { void auth.refresh() }} className="min-h-11 rounded-lg border border-line px-4 text-sm font-medium hover:bg-accent/10">Verificar sessão</button><button type="button" onClick={() => { auth.logout(); navigate('/entrar', { replace: true }) }} className="min-h-11 rounded-lg bg-navy px-5 text-sm font-medium text-white hover:bg-accent">Sair da conta</button></div>
  </div></section>
}
