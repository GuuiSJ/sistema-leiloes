import { ArrowRight } from 'lucide-react'
import { Link } from 'react-router'
import { useAuctions } from '../../hooks/useAuctions'
import { AuctionResults } from '../auctions/AuctionResults'

export function FeaturedAuctions() {
  const auctions = useAuctions(true)
  return (
    <section aria-labelledby="featured-title" className="mt-14 sm:mt-18">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="mb-3 text-[10px] font-semibold tracking-[0.2em] text-accent uppercase dark:text-blue-300">Encontre sua oportunidade</p>
          <h2 id="featured-title" className="text-2xl font-semibold tracking-tight sm:text-3xl">Leilões em destaque</h2>
          <p className="mt-3 text-sm text-muted">Uma seleção de leilões com status aberto ou agendado, com prévia de um lote por leilão.</p>
        </div>
        <Link to="/leiloes" className="inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-accent transition-colors hover:text-blue-700 dark:text-blue-300">
          Ver todos os leilões <ArrowRight size={17} aria-hidden="true" />
        </Link>
      </div>
      <AuctionResults {...auctions} featured />
    </section>
  )
}
