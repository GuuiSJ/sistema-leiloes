import { CarFront, Gavel, LayoutDashboard, Layers, ArrowUpRight } from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router'
import { useAuth } from '../../hooks/useAuth'

const navigation = [
  { to: '/area-leiloeiro', label: 'Visão geral', icon: LayoutDashboard, end: true },
  { to: '/area-leiloeiro/veiculos', label: 'Veículos', icon: CarFront },
  { to: '/area-leiloeiro/leiloes', label: 'Leilões', icon: Gavel },
  { to: '/area-leiloeiro/lotes', label: 'Lotes', icon: Layers },
  { to: '/area-leiloeiro/resultados', label: 'Resultados', icon: Gavel },
]
export function AdminLayout() {
  const auth = useAuth()
  return <div className="admin-container py-6 sm:py-10">
    <header className="mb-7 flex flex-wrap items-center justify-between gap-5 rounded-2xl bg-navy p-6 text-white sm:p-8">
      <div><p className="text-sm font-semibold uppercase tracking-[0.18em] text-blue-200">Área do leiloeiro</p><h1 className="mt-3 text-2xl font-semibold tracking-tight sm:text-3xl">Seu catálogo, em perspectiva.</h1><p className="mt-3 text-sm text-slate-300">Olá, {auth.user?.name}. Acompanhe os registros da plataforma.</p></div>
      <Link to="/leiloes" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/20 px-4 text-sm hover:bg-white/10">Ver catálogo público<ArrowUpRight size={16} aria-hidden="true" /></Link>
    </header>
    <div className="grid items-start gap-6 lg:grid-cols-[210px_minmax(0,1fr)]">
      <aside className="rounded-2xl border border-line bg-surface p-3 lg:sticky lg:top-6">
        <nav aria-label="Painel do leiloeiro" className="grid grid-cols-2 gap-1 lg:grid-cols-1">{navigation.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} className={({ isActive }) => `flex min-h-12 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${isActive ? 'bg-accent/10 text-accent dark:text-blue-300' : 'text-muted hover:bg-accent/5 hover:text-ink'}`}><Icon size={18} aria-hidden="true" />{label}</NavLink>)}</nav>
        <p className="mt-4 hidden border-t border-line px-3 pt-4 text-xs leading-5 text-muted lg:block">Consulte o catálogo da plataforma. A seção Resultados é restrita aos seus leilões.</p>
      </aside>
      <div className="min-w-0"><Outlet /></div>
    </div>
  </div>
}
