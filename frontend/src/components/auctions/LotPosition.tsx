import { useAuth } from '../../hooks/useAuth'
import { usePublicResource } from '../../hooks/usePublicResource'
import { getLotPosition, type Position } from '../../services/live-room'
import type { Lot } from '../../services/auctions'

const labels: Record<Position['status'], string> = { NONE: 'Você ainda não participou deste lote.', LEADING: 'Você está liderando este lote.', OUTBID: 'Seu lance foi superado.', WON: 'Você arrematou este lote.', NOT_WON: 'Lote encerrado com outro vencedor.', CLOSED: 'Sua participação foi encerrada.', RECORDED: 'Sua participação está registrada.' }
export function PositionSummary({ position }: { position: Position }) {
  return <p role="status" className="mt-3 text-sm font-medium">{labels[position.status]}</p>
}
export function LotPosition({ lot, latestBidId, revision, synced }: { lot: Lot; latestBidId: string | null; revision: number; synced: boolean }) {
  const auth = useAuth(), enabled = auth.status === 'authenticated' && auth.user?.role === 'BIDDER'
  const resource = usePublicResource(`position:${lot.id}:${auth.user?.id}:${auth.status}:${revision}:${latestBidId}:${synced}`,
    signal => auth.withSession((token, inner) => getLotPosition(lot.id, token, inner), signal), enabled && synced)
  if (!enabled) return null
  const current = synced && resource.data?.latestBidId === latestBidId && resource.data.lotStatus === lot.status
  return <section aria-label="Sua situação neste lote" className="rounded-2xl border border-line bg-surface p-6"><h3 className="text-lg font-semibold">Sua situação neste lote</h3>
    {!synced || resource.loading ? <p role="status" className="mt-3 text-sm text-muted">Atualizando sua participação...</p> : resource.error || !current ? <div role="alert" className="mt-3 text-sm"><p>Não foi possível confirmar sua situação atual.</p><button type="button" onClick={resource.retry} className="mt-3 min-h-11 font-medium text-accent">Consultar novamente</button></div> : resource.data && <PositionSummary position={resource.data} />}
  </section>
}
