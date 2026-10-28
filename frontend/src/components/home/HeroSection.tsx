import { ArrowRight, CircleHelp } from 'lucide-react'
import { Link } from 'react-router'
import heroCar from '../../assets/hero-car.jpg'

export function HeroSection() {
  return (
    <section aria-labelledby="home-title" className="hero-section intro-panel overflow-hidden rounded-2xl bg-navy text-white">
      <div className="hero-copy">
        <p className="mb-7 flex items-center gap-3 text-[10px] font-semibold tracking-[0.24em] text-blue-200 sm:text-xs">
          <span className="h-px w-8 bg-blue-400" aria-hidden="true" /> SUA PRÓXIMA CONQUISTA
        </p>
        <h1 id="home-title" className="text-[clamp(2.25rem,4.6vw,4rem)] leading-[1.08] font-semibold tracking-[-0.055em]">
          Grandes carros.{' '}<span className="block text-blue-200">Novas oportunidades.</span>
        </h1>
        <p className="mt-6 max-w-md text-sm leading-7 text-slate-300 sm:text-base">
          Explore veículos, acompanhe leilões em tempo real e encontre sua próxima oportunidade.
        </p>
        <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <Link to="/leiloes" className="hero-button group bg-accent text-white hover:bg-blue-700">
            Explorar leilões <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" aria-hidden="true" />
          </Link>
          <Link to="/como-funciona" className="hero-button border border-white/25 bg-transparent text-white hover:border-white/60 hover:bg-white/10">
            <CircleHelp size={18} strokeWidth={1.7} aria-hidden="true" /> Como funciona
          </Link>
        </div>
      </div>
      <figure className="hero-visual">
        <img src={heroCar} alt="Vista frontal de um automóvel esportivo preto em uma rua arborizada"
          width={1280} height={1774} fetchPriority="high" className="hero-image" />
        <div className="hero-image-shade" aria-hidden="true" />
        <figcaption className="absolute right-5 bottom-5 left-5 z-10 text-right text-[10px] tracking-wide text-white/85 sm:right-7 sm:bottom-6">
          Imagem ilustrativa. Não representa um lote disponível.
        </figcaption>
      </figure>
    </section>
  )
}
