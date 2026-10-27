import { useState } from 'react'
import type { Auction, Lot } from '../../services/auctions'
import { getBidHistory, getLot } from '../../services/auctions'
import { usePublicResource } from '../../hooks/usePublicResource'
import { VehicleGallery } from './VehicleGallery'
import { VehicleSpecs } from './VehicleSpecs'
import { LotBidSummary } from './LotBidSummary'
import { BidHistory } from './BidHistory'
import { BidForm } from './BidForm'
import { lotStatusLabels } from './AuctionInfo'
import { DetailError, DetailLoading } from './DetailFeedback'

export function LotDetails({ auction, lotId }: { auction: Auction; lotId: string }) {
  const [updatedLot, setUpdatedLot] = useState<Lot | null>(null)
  const [refreshError, setRefreshError] = useState(false)
  const detail = usePublicResource(`lot:${auction.id}:${lotId}`, signal => getLot(auction.id, lotId, signal))
  const history = usePublicResource(`first-history:${lotId}`, signal => getBidHistory(lotId, 1, signal))
  if (detail.loading) return <DetailLoading label="Carregando veículo e prazo do lote..." />
  if (detail.error || !detail.data) return <DetailError message={detail.error?.status === 404 ? 'Este lote não está disponível neste leilão.' : 'Não foi possível carregar os detalhes do lote.'} retry={detail.retry} />
  const lot = updatedLot ?? detail.data, vehicle = lot.vehicle
  const historyAvailable = !!history.data && !history.loading && !history.error
  return <section aria-labelledby="selected-lot-title" className="mt-7">
    {refreshError && <p role="alert" className="mb-4 text-sm">Lance confirmado, mas não foi possível atualizar os dados do lote. Recarregue a consulta antes de participar novamente.</p>}
    <div className="mb-6"><p className="mb-2 text-xs font-medium text-muted">Lote {lot.number} · {lotStatusLabels[lot.status]}</p><h2 id="selected-lot-title" className="break-words text-2xl font-semibold tracking-tight sm:text-3xl">{vehicle.brand} {vehicle.model} <span className="font-normal text-muted">· {vehicle.year}</span></h2></div>
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
      <div className="min-w-0 space-y-6"><VehicleGallery key={vehicle.id + vehicle.imageUrls.join('|')} images={vehicle.imageUrls} label={`${vehicle.brand} ${vehicle.model}`} /><VehicleSpecs vehicle={vehicle} /></div>
      <div className="min-w-0 space-y-6"><LotBidSummary auction={auction} lot={lot} latest={history.data?.data[0] ?? null} available={historyAvailable} /><BidForm auction={auction} lot={lot} onSuccess={() => {
        history.retry(); setRefreshError(false)
        void getLot(auction.id, lotId, new AbortController().signal).then(setUpdatedLot).catch(() => setRefreshError(true))
      }} /><BidHistory lotId={lotId} firstPage={history.data} loading={history.loading} error={history.error} retry={history.retry} /></div>
    </div>
  </section>
}
