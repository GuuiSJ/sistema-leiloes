import { Link } from 'react-router'

export function NotFoundPage() {
  return (
    <section className="page-container py-24">
      <p className="mb-4 text-sm font-semibold text-accent">404</p>
      <h1 className="text-3xl font-semibold tracking-tight">Página não encontrada</h1>
      <p className="mt-4 text-muted">O endereço que você procura não está disponível.</p>
      <Link className="mt-8 inline-flex rounded-lg bg-accent px-5 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-700" to="/">Voltar ao início</Link>
    </section>
  )
}
