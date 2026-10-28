import { Clock3 } from 'lucide-react'
import type { Auction, Lot } from '../../services/auctions'
import { deadlineState } from '../../services/auction-rules'
import { formatDate } from '../../services/formatters'
import { useEffect, useRef, useState } from 'react'
import { countdownText, remainingMilliseconds, type RoomClock } from '../../services/live-room'

export function LotCountdown({ auction, lot, clock = null, onElapsed }: { auction: Auction; lot: Lot; clock?: RoomClock | null; onElapsed?: () => void }) {
  const state = deadlineState(auction, lot)
  const verified = state === 'unverified' && clock?.trusted && clock.lotId === lot.id && clock.auctionId === auction.id && clock.endsAt === lot.endsAt && clock.lotStatus === lot.status && clock.auctionStatus === auction.status
  const [, tick] = useState(0), elapsedDeadline = useRef('')
  const remaining = verified && clock ? remainingMilliseconds(clock) : null
  useEffect(() => {
    if (!verified) return
    const timer = setInterval(() => tick(value => value + 1), 1000)
    return () => clearInterval(timer)
  }, [verified, clock])
  useEffect(() => {
    if (remaining === 0 && elapsedDeadline.current !== lot.endsAt) { elapsedDeadline.current = lot.endsAt; onElapsed?.() }
  }, [remaining, lot.endsAt, onElapsed])
  return <section aria-label="Prazo do lote" className="rounded-xl border border-line bg-canvas p-4">
    <p className="flex items-center gap-2 text-sm font-semibold"><Clock3 size={17} aria-hidden="true" />{state === 'closed' ? 'Lote ou leilão encerrado' : state === 'not-open' ? 'Contagem não iniciada' : remaining !== null ? 'Tempo estimado até o encerramento' : 'Contagem regressiva indisponível'}</p>
    {remaining !== null && <><p role="timer" aria-label="Contagem regressiva do lote" className="mt-3 font-mono text-3xl font-semibold tabular-nums">{countdownText(remaining)}</p><p className="mt-2 text-xs leading-5 text-muted">{remaining === 0 ? 'Prazo atingido. Aguardando confirmação do encerramento pelo servidor.' : 'Estimativa sincronizada com o servidor. Lances aceitos nos últimos dois minutos podem prorrogar o prazo.'}</p></>}
    <p className="mt-2 text-xs leading-5 text-muted">Prazo registrado do lote: <time dateTime={lot.endsAt}>{formatDate(lot.endsAt)}</time> (Brasília).</p>
    {state === 'unverified' && remaining === null && <p className="mt-2 text-xs leading-5 text-muted">Não foi possível confirmar a confiabilidade temporal deste prazo. Uma data registrada não basta para ativar a contagem.</p>}
  </section>
}
