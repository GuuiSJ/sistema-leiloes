import { Link, useNavigate } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { WalletSection } from '../components/wallet/WalletSection'
import { formatDate } from '../services/formatters'

export function AccountPage() {
  const auth = useAuth(), navigate = useNavigate()
  if (!auth.user) return null
  return <div className="page-container py-8 sm:py-12">
    <header className="mb-8 rounded-2xl bg-navy p-7 text-white sm:p-10"><p className="text-xs font-medium tracking-[0.2em] text-blue-200 uppercase">Seu espaço na plataforma</p><h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">Minha conta</h1><p className="mt-4 max-w-xl text-sm leading-7 text-slate-300">Consulte seu perfil e as informações disponíveis para sua conta.</p></header>
    <div className="grid items-start gap-7 xl:grid-cols-[minmax(0,1fr)_20rem]">
    <div className="min-w-0 space-y-7">{auth.user.role === 'BIDDER' && <section className="rounded-2xl border border-line bg-surface p-7"><h2 className="text-2xl font-semibold">Meus arremates</h2><p className="mt-3 text-sm leading-7 text-muted">Acompanhe suas participações, lotes arrematados e comprovantes.</p><Link to="/minha-conta/arremates" className="mt-5 inline-flex min-h-12 items-center rounded-lg bg-accent px-5 text-sm font-semibold text-white hover:bg-blue-700">Consultar meus arremates</Link></section>}<WalletSection /></div>
    <aside aria-labelledby="account-profile" className="min-w-0 rounded-2xl border border-line bg-surface p-6">
    <p className="text-xs font-medium tracking-[0.18em] text-accent uppercase dark:text-blue-300">Sua sessão</p><h2 id="account-profile" className="mt-3 text-xl font-semibold tracking-tight">Meu perfil</h2>
    <dl className="mt-7 space-y-5 text-sm"><div><dt className="text-muted">Nome</dt><dd className="mt-1 break-words font-medium">{auth.user.name}</dd></div><div><dt className="text-muted">E-mail</dt><dd className="mt-1 break-words font-medium">{auth.user.email}</dd></div><div><dt className="text-muted">Perfil</dt><dd className="mt-1 font-medium">{auth.user.role === 'AUCTIONEER' ? 'Leiloeiro' : 'Participante'}</dd></div></dl>
    {auth.message && <p role="status" className="mt-5 text-sm text-muted">{auth.message}</p>}
    <p className="mt-5 text-xs leading-5 text-muted">Cadastro em <time dateTime={auth.user.createdAt}>{formatDate(auth.user.createdAt)}</time> (Brasília).</p>
    {auth.user.role === 'AUCTIONEER' && <Link to="/area-leiloeiro" className="mt-6 inline-flex min-h-11 items-center rounded-md font-medium text-accent dark:text-blue-300">Área do leiloeiro</Link>}
    <div className="mt-7 flex flex-wrap gap-3"><button type="button" onClick={() => { void auth.refresh() }} className="min-h-11 rounded-lg border border-line px-4 text-sm font-medium hover:bg-accent/10">Verificar sessão</button><button type="button" onClick={() => { auth.logout(); navigate('/entrar', { replace: true }) }} className="min-h-11 rounded-lg bg-navy px-5 text-sm font-medium text-white hover:bg-accent">Sair da conta</button></div>
    </aside></div>
  </div>
}
