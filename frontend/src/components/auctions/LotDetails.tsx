import type { Auction } from '../../services/auctions'
import { useLiveLot } from '../../hooks/useLiveLot'
import { VehicleGallery } from './VehicleGallery'
import { VehicleSpecs } from './VehicleSpecs'
import { LotBidSummary } from './LotBidSummary'
import { BidHistory } from './BidHistory'
import { BidForm } from './BidForm'
import { lotStatusLabels } from './AuctionInfo'
import { DetailError, DetailLoading } from './DetailFeedback'
import { LiveConnection } from './LiveConnection'
import { Link } from 'react-router'
import { LotPosition } from './LotPosition'
import { LotOutcome } from './LotOutcome'

export function LotDetails({ auction, lotId }: { auction: Auction; lotId: string }) {
  const live = useLiveLot(auction.id, lotId)
  if (!live.data) return live.error ? <DetailError message="Não foi possível carregar os detalhes do lote." retry={live.retry} /> : <DetailLoading label="Carregando veículo e prazo do lote..." />
  const { lot, auction: currentAuction, history } = live.data, vehicle = lot.vehicle
  return <section aria-labelledby="selected-lot-title" className="mt-7">
    <LiveConnection connection={live.connection} updating={live.loading} failed={!!live.error} retry={live.retry} />
    <div className="mb-6"><p className="mb-2 text-xs font-medium text-muted">Lote {lot.number} · {lotStatusLabels[lot.status]}</p><h2 id="selected-lot-title" className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{vehicle.brand} {vehicle.model} <span className="font-normal text-muted">· {vehicle.year}</span></h2></div>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6"><VehicleGallery key={vehicle.id + vehicle.imageUrls.join('|')} images={vehicle.imageUrls} label={`${vehicle.brand} ${vehicle.model}`} /><VehicleSpecs vehicle={vehicle} /></div>
      <div className="min-w-0 space-y-6">
        <LotOutcome lot={lot} />
        <LotBidSummary auction={currentAuction} lot={lot} latest={history.data[0] ?? null} available={!live.error && !live.loading} clock={live.syncReady ? live.data.clock : null} onElapsed={live.retry} />
        <LotPosition lot={lot} latestBidId={history.data[0]?.id ?? null} revision={live.revision} synced={live.syncReady} />
        <BidForm auction={currentAuction} lot={lot} revision={live.revision} syncReady={live.syncReady} onSuccess={live.retry} />
        <BidHistory key={`${lotId}:${live.revision}`} lotId={lotId} firstPage={history} loading={live.loading} error={live.error} retry={live.retry} />
        <Link to={`/auditoria/${lotId}`} className="inline-flex min-h-11 items-center text-sm font-medium text-accent dark:text-blue-300">Consultar auditoria pública deste lote</Link>
      </div>
    </div>
  </section>
}
