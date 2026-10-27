import { useId } from 'react'
import { Link } from 'react-router'
import { LockKeyhole } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import type { Auction, Lot } from '../../services/auctions'
import { bidAvailability } from '../../services/bid-eligibility'

export function BidForm({ auction, lot }: { auction: Auction; lot: Lot }) {
  const auth = useAuth()
  const headingId = useId(), reasonId = useId(), amountId = useId()
  const availability = bidAvailability(auction, lot)
  const bidder = auth.status === 'authenticated' && auth.user?.role === 'BIDDER'

  return <section aria-labelledby={headingId} className="rounded-2xl border border-line bg-surface p-6">
    <div className="flex items-center gap-3"><LockKeyhole aria-hidden="true" className="size-5 text-accent" /><h3 id={headingId} className="text-lg font-semibold">Participar do leilão</h3></div>
    {availability === 'closed' ? <p className="mt-4 text-sm text-muted">Este lote está encerrado ou cancelado e não recebe novos lances.</p>
      : availability === 'not-open' ? <p className="mt-4 text-sm text-muted">O leilão e o lote precisam estar abertos para receber lances.</p>
      : auth.status === 'restoring' ? <p className="mt-4 text-sm text-muted" role="status">Verificando sua sessão...</p>
      : auth.status === 'unavailable' ? <div className="mt-4 text-sm"><p className="text-muted">Não foi possível verificar sua sessão. Nenhum lance será enviado.</p><button type="button" onClick={() => void auth.refresh()} className="mt-3 font-medium text-accent">Verificar sessão</button></div>
      : auth.status !== 'authenticated' ? <p className="mt-4 text-sm text-muted"><Link to="/entrar" className="font-medium text-accent">Entre na sua conta</Link> de participante para acompanhar sua participação. O envio depende da confirmação de elegibilidade do lote.</p>
      : !bidder ? <p className="mt-4 text-sm text-muted">Somente contas de participante (BIDDER) podem enviar lances.</p>
      : <div className="mt-4 space-y-4">
        <p id={reasonId} className="text-sm leading-6 text-muted">Envio indisponível: a API pública não informa se este leilão pertence à geração UTC_V2 nem confirma sua elegibilidade para participar. O status aberto e o prazo exibido não são suficientes para habilitar lances com segurança.</p>
        <div><label htmlFor={amountId} className="mb-2 block text-sm font-medium">Valor do lance (R$)</label><input id={amountId} type="text" inputMode="decimal" disabled aria-describedby={reasonId} placeholder="Indisponível" className="w-full rounded-xl border border-line bg-canvas px-4 py-3 text-muted disabled:cursor-not-allowed disabled:opacity-70" /></div>
        <button type="button" disabled aria-describedby={reasonId} className="w-full cursor-not-allowed rounded-xl bg-accent px-4 py-3 font-semibold text-white opacity-50">Envio bloqueado</button>
        <p className="text-xs leading-5 text-muted">Um lance aceito pode reservar créditos da carteira. Nenhum valor será enviado ou reservado por esta interface. A liberação dependerá de informações suficientes da API e exigirá confirmação explícita.</p>
      </div>}
  </section>
}
