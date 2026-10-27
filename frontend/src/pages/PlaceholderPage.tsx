import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router'

type PlaceholderPageProps = { title: string; description: string }

export function PlaceholderPage({ title, description }: PlaceholderPageProps) {
  return (
    <section className="page-container py-16 sm:py-24">
      <div className="max-w-xl rounded-2xl border border-line bg-surface p-7 sm:p-10">
        <p className="text-xs font-semibold tracking-[0.18em] text-accent uppercase dark:text-blue-300">Em breve</p>
        <h1 className="mt-5 text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-5 text-sm leading-7 text-muted sm:text-base">{description}</p>
        <Link to="/" className="mt-8 inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-accent transition-colors hover:text-blue-700 dark:text-blue-300 dark:hover:text-blue-200">
          <ArrowLeft size={17} aria-hidden="true" /> Voltar ao início
        </Link>
      </div>
    </section>
  )
}
