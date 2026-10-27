export function HomePage() {
  return (
    <div className="page-container py-8 sm:py-12 lg:py-16">
      <section aria-labelledby="home-title" className="intro-panel relative overflow-hidden rounded-2xl bg-navy px-7 py-16 text-white sm:px-12 sm:py-20 lg:px-16 lg:py-24">
        <div className="relative max-w-3xl">
          <div className="mb-8 flex items-center gap-3 text-[11px] font-medium tracking-[0.22em] text-blue-200">
            <span className="h-px w-9 bg-accent" aria-hidden="true" />
            LEILÕES DE AUTOMÓVEIS
          </div>
          <h1 id="home-title" className="max-w-3xl text-[clamp(2rem,6vw,4.75rem)] leading-[1.08] font-semibold tracking-[-0.055em]">
            Grandes carros.<br /><span className="text-blue-200">Novas oportunidades.</span>
          </h1>
          <p className="mt-7 max-w-md text-sm leading-7 text-slate-300 sm:text-base">Um novo caminho para encontrar seu próximo carro.</p>
        </div>
      </section>
      <div className="flex items-center gap-3 px-1 pt-6 text-xs text-muted">
        <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
        <p>Estamos preparando a experiência de leilões. Em breve, novidades por aqui.</p>
      </div>
    </div>
  )
}
