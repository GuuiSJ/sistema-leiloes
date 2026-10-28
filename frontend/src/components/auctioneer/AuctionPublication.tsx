import { useEffect, useId, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import type { Auction } from '../../services/auctions'
import { scheduleAuction, AuctionManagementError } from '../../services/auction-management'
import { formatDate } from '../../services/formatters'
import { adminButton } from './AdminFeedback'

export function publicationDateEligible(auction: Auction, now = Date.now()) {
  return auction.status === 'DRAFT' && Number.isFinite(Date.parse(auction.startsAt)) && Date.parse(auction.startsAt) > now && Date.parse(auction.endsAt) > Date.parse(auction.startsAt)
}
export function AuctionPublication({ auction, blocked, onActive, onPublished }: { auction: Auction; blocked: boolean; onActive: (active: boolean) => void; onPublished: () => void }) {
  const auth = useAuth(), titleId = useId()
  const [confirm, setConfirm] = useState(false), [busy, setBusy] = useState(false), [failure, setFailure] = useState<AuctionManagementError | null>(null), [now, setNow] = useState(Date.now)
  const active = useRef(true), sending = useRef(false), request = useRef<AbortController | null>(null), cancel = useRef<HTMLButtonElement>(null)
  useEffect(() => { active.current = true; return () => { active.current = false; request.current?.abort() } }, [])
  useEffect(() => { onActive(confirm || busy); return () => onActive(false) }, [confirm, busy, onActive])
  useEffect(() => { if (confirm) cancel.current?.focus() }, [confirm])
  useEffect(() => {
    const remaining = Date.parse(auction.startsAt) - Date.now()
    if (auction.status !== 'DRAFT' || !Number.isFinite(remaining) || remaining <= 0) return
    const timer = setTimeout(() => setNow(Date.now()), Math.min(remaining + 10, 2147483647))
    return () => clearTimeout(timer)
  }, [auction.startsAt, auction.status, now])
  if (auth.status !== 'authenticated' || auth.user?.role !== 'AUCTIONEER' || auction.status !== 'DRAFT') return null
  const eligible = publicationDateEligible(auction, now)
  async function publish() {
    if (sending.current || !publicationDateEligible(auction) || failure?.uncertain) return
    sending.current = true; setBusy(true); setFailure(null)
    const controller = new AbortController(); request.current = controller
    try {
      await auth.withSession((token, signal) => scheduleAuction(auction.id, token, signal), controller.signal)
      if (active.current) { setConfirm(false); onPublished() }
    } catch (error) {
      if (active.current) setFailure(error instanceof AuctionManagementError ? error : new AuctionManagementError('Não foi possível publicar. Atualize a listagem e confira sua sessão.'))
    } finally { sending.current = false; if (active.current) setBusy(false) }
  }
  return <div className="mt-3 min-w-56 max-w-sm">
    {!confirm ? <button type="button" className={`${adminButton} text-accent dark:text-blue-300`} disabled={blocked || !eligible || !!failure?.uncertain} onClick={() => { setFailure(null); setConfirm(true) }}>Publicar leilão</button> : <div role="alertdialog" aria-labelledby={titleId} className="rounded-xl border border-line bg-canvas p-4" onKeyDown={event => { if (event.key === 'Escape' && !busy) setConfirm(false) }}>
      <h3 id={titleId} className="font-semibold">Publicar {auction.title}?</h3><p className="mt-3 text-sm leading-6 text-muted">O leilão ficará Agendado e abrirá automaticamente a partir de {formatDate(auction.startsAt)} (Brasília), enquanto o backend estiver em execução.</p><p className="mt-3 text-xs leading-6 text-muted">Conclua os lotes antes de confirmar. A publicação exige ao menos um lote válido e impede novas alterações nos lotes pelas regras atuais.</p>
      <div className="mt-4 flex flex-wrap gap-2"><button ref={cancel} type="button" className={adminButton} disabled={busy} onClick={() => setConfirm(false)}>Voltar</button><button type="button" className={`${adminButton} bg-accent text-white`} disabled={busy || !eligible || !!failure?.uncertain} onClick={() => void publish()}>{busy ? 'Publicando...' : 'Confirmar publicação'}</button></div>
    </div>}
    {!eligible && <p className="mt-2 text-xs leading-5 text-muted">Publicação indisponível: o início precisa estar no futuro e o período deve ser válido.</p>}
    {failure && <p role="alert" className="mt-3 text-sm leading-6">{failure.message}{failure.uncertain && ' Não confirme novamente sem reconsultar a listagem.'}</p>}
  </div>
}
