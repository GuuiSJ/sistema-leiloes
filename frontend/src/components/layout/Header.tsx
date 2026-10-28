import { useEffect, useRef, useState } from 'react'
import { CarFront, LoaderCircle, LogIn, LogOut, Menu, UserRound, X } from 'lucide-react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router'
import { ThemeToggle } from '../ThemeToggle'
import { useAuth } from '../../hooks/useAuth'

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const location = useLocation()
  const admin = location.pathname.startsWith('/area-leiloeiro')
  const navigate = useNavigate(), auth = useAuth()
  const hasSession = auth.status === 'authenticated' || auth.status === 'unavailable'
  const accountPath = hasSession ? '/minha-conta' : '/entrar'
  const accountLabel = auth.status === 'unavailable' ? 'Verificar sessão' : hasSession ? 'Minha conta' : 'Entrar'
  function logout() { auth.logout(); setMenuOpen(false); navigate('/', { replace: true }) }

  useEffect(() => {
    if (!menuOpen) return
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
        menuButton.current?.focus()
      }
    }
    window.addEventListener('keydown', onEscape)
    return () => window.removeEventListener('keydown', onEscape)
  }, [menuOpen])

  function renderNavigation(mobile = false) {
    return [
      { to: '/', label: 'Início' },
      { to: '/leiloes', label: 'Leilões' },
      { to: '/auditoria', label: 'Auditoria pública' },
      { to: '/como-funciona', label: 'Como funciona' },
    ].map(({ to, label }) => (
      <NavLink key={to} to={to} end={to === '/'} onClick={() => setMenuOpen(false)}
        className={({ isActive }) => `${mobile ? 'rounded-lg px-4 py-3 hover:bg-accent/5' : 'rounded-sm py-3'} text-sm font-medium transition-colors hover:text-accent dark:hover:text-blue-300 ${isActive ? 'text-accent dark:text-blue-300' : 'text-muted'}`}>
        {label}
      </NavLink>
    ))
  }

  return (
    <header className="border-b border-line bg-surface">
      <div className={`${admin ? 'admin-container' : 'page-container'} flex min-h-22 items-center justify-between gap-2`}>
        <Link to="/" onClick={() => setMenuOpen(false)} aria-label="Leilões de automóveis — página inicial" className="flex shrink-0 items-center gap-2.5 rounded-md sm:gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-navy text-white sm:size-11">
            <CarFront size={24} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <span>
            <span className="block text-lg font-bold tracking-[-0.04em] text-ink sm:text-xl">Leilões<span className="text-accent dark:text-blue-300">.</span></span>
            <span className="hidden text-[10px] font-semibold tracking-[0.2em] text-muted sm:block">AUTOMÓVEIS</span>
          </span>
        </Link>
        <nav aria-label="Navegação principal" className="hidden items-center gap-6 md:flex lg:gap-8">
          {renderNavigation()}
        </nav>
        <div className="flex items-center gap-1.5 sm:gap-3">
          <ThemeToggle />
          {auth.status === 'restoring' ? <span role="status" aria-label="Verificando sessão" className="flex size-11 items-center justify-center text-muted"><LoaderCircle size={18} className="animate-spin" aria-hidden="true" /></span> : <Link to={accountPath} onClick={() => setMenuOpen(false)} aria-label={accountLabel}
            aria-current={location.pathname === accountPath ? 'page' : undefined}
            className="flex size-11 items-center justify-center gap-2 rounded-full bg-accent text-sm font-semibold text-white transition-colors hover:bg-blue-700 sm:w-auto sm:px-5">
            {hasSession ? <UserRound size={17} aria-hidden="true" /> : <LogIn size={17} aria-hidden="true" />}<span className="hidden sm:inline">{accountLabel}</span>
          </Link>}
          {hasSession && <button type="button" onClick={logout} aria-label="Sair da conta" title="Sair da conta" className="hidden size-11 items-center justify-center rounded-full text-muted transition-colors hover:bg-accent/10 hover:text-ink md:inline-flex"><LogOut size={18} aria-hidden="true" /></button>}
          <button type="button" ref={menuButton} onClick={() => setMenuOpen(open => !open)}
            aria-expanded={menuOpen} aria-controls="mobile-navigation" aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
            className="inline-flex size-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-accent/10 md:hidden">
            {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
          </button>
        </div>
      </div>
      <nav id="mobile-navigation" aria-label="Navegação para celular" hidden={!menuOpen} className="border-t border-line md:hidden">
        <div className="page-container flex flex-col gap-1 py-3">{renderNavigation(true)}
          {hasSession && <>
            <Link to="/minha-conta" onClick={() => setMenuOpen(false)} className="rounded-lg px-4 py-3 text-sm font-medium text-accent dark:text-blue-300">Minha conta</Link>
            {auth.user?.role === 'AUCTIONEER' && <Link to="/area-leiloeiro" onClick={() => setMenuOpen(false)} className="rounded-lg px-4 py-3 text-sm font-medium text-muted">Área do leiloeiro</Link>}
            <button type="button" onClick={logout} className="rounded-lg px-4 py-3 text-left text-sm font-medium text-muted hover:bg-accent/5">Sair da conta</button>
          </>}
        </div>
      </nav>
    </header>
  )
}
