import { CarFront } from 'lucide-react'
import { Link, NavLink } from 'react-router'
import { ThemeToggle } from '../ThemeToggle'

export function Header() {
  return (
    <header className="border-b border-line bg-surface">
      <div className="page-container flex min-h-22 items-center justify-between gap-4">
        <Link to="/" aria-label="Leilões de automóveis — página inicial" className="flex items-center gap-3 rounded-md">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-navy text-white">
            <CarFront size={24} strokeWidth={1.6} aria-hidden="true" />
          </span>
          <span>
            <span className="block text-xl font-bold tracking-[-0.04em] text-ink">Leilões<span className="text-accent">.</span></span>
            <span className="hidden text-[10px] font-semibold tracking-[0.2em] text-muted sm:block">AUTOMÓVEIS</span>
          </span>
        </Link>
        <div className="flex items-center gap-5 sm:gap-8">
          <nav aria-label="Navegação principal">
            <NavLink to="/" end className={({ isActive }) => `rounded-sm py-2 text-sm font-medium transition-colors hover:text-accent ${isActive ? 'text-accent' : 'text-muted'}`}>Início</NavLink>
          </nav>
          <span className="h-6 w-px bg-line" aria-hidden="true" />
          <ThemeToggle />
        </div>
      </div>
    </header>
  )
}
