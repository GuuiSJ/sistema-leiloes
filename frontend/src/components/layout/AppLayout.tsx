import { Outlet } from 'react-router'
import { Header } from './Header'

export function AppLayout() {
  return (
    <div className="flex min-h-dvh flex-col bg-canvas text-ink">
      <a href="#conteudo" className="skip-link">Pular para o conteúdo</a>
      <Header />
      <main id="conteudo" tabIndex={-1} className="flex-1"><Outlet /></main>
      <footer className="border-t border-line">
        <div className="page-container flex flex-wrap items-center justify-between gap-3 py-7 text-xs text-muted">
          <span className="font-semibold text-ink">Leilões de automóveis</span>
          <span>Grandes carros. Novas oportunidades.</span>
        </div>
      </footer>
    </div>
  )
}
