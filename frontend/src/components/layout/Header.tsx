import { useEffect, useRef, useState } from 'react'
import { CarFront, LogIn, Menu, X } from 'lucide-react'
import { Link, NavLink, useLocation } from 'react-router'
import { ThemeToggle } from '../ThemeToggle'

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuButton = useRef<HTMLButtonElement>(null)
  const location = useLocation()

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
      <div className="page-container flex min-h-22 items-center justify-between gap-2">
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
          <Link to="/entrar" onClick={() => setMenuOpen(false)} aria-label="Entrar"
            aria-current={location.pathname === '/entrar' ? 'page' : undefined}
            className="flex size-11 items-center justify-center gap-2 rounded-full bg-accent text-sm font-semibold text-white transition-colors hover:bg-blue-700 sm:w-auto sm:px-5">
            <LogIn size={17} aria-hidden="true" /><span className="hidden sm:inline">Entrar</span>
          </Link>
          <button type="button" ref={menuButton} onClick={() => setMenuOpen(open => !open)}
            aria-expanded={menuOpen} aria-controls="mobile-navigation" aria-label={menuOpen ? 'Fechar menu' : 'Abrir menu'}
            className="inline-flex size-11 items-center justify-center rounded-full text-ink transition-colors hover:bg-accent/10 md:hidden">
            {menuOpen ? <X size={22} aria-hidden="true" /> : <Menu size={22} aria-hidden="true" />}
          </button>
        </div>
      </div>
      <nav id="mobile-navigation" aria-label="Navegação para celular" hidden={!menuOpen} className="border-t border-line md:hidden">
        <div className="page-container flex flex-col gap-1 py-3">{renderNavigation(true)}</div>
      </nav>
    </header>
  )
}
