import { useState } from 'react'
import { CalendarDays, CarFront, Layers3 } from 'lucide-react'
import type { AuctionPreview, AuctionStatus, LotStatus, Vehicle } from '../../services/auctions'
import { formatDate, formatMoney, validPhotoUrl } from '../../services/formatters'

const auctionLabels: Record<AuctionStatus, string> = {
  DRAFT: 'Rascunho', SCHEDULED: 'Agendado', OPEN: 'Aberto', CLOSED: 'Encerrado', CANCELLED: 'Cancelado',
}
const lotLabels: Record<LotStatus, string> = {
  PENDING: 'Pendente', OPEN: 'Aberto', SOLD: 'Vendido', UNSOLD: 'Não vendido', CANCELLED: 'Cancelado',
}

function VehiclePhoto({ vehicle }: { vehicle: Vehicle | null }) {
  const [index, setIndex] = useState(0)
  const photos = vehicle?.imageUrls.filter(validPhotoUrl) ?? []
  const source = photos[index]
  return (
    <div className="aspect-[16/10] overflow-hidden bg-canvas">
      {source && vehicle ? <img src={source} alt={`${vehicle.brand} ${vehicle.model}, ano ${vehicle.year}`}
        loading="lazy" decoding="async" referrerPolicy="no-referrer" onError={() => setIndex(value => value + 1)}
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.025]" /> :
        <div className="flex h-full flex-col items-center justify-center gap-3 text-muted">
          <CarFront size={46} strokeWidth={1.1} aria-hidden="true" />
          <span className="text-xs">Foto não disponível</span>
        </div>}
    </div>
  )
}

export function AuctionCard({ item }: { item: AuctionPreview }) {
  const { auction, lot, totalLots, latestBid, lotUnavailable, bidUnavailable } = item
  const vehicle = lot?.vehicle ?? null
  const upcoming = auction.status === 'DRAFT' || auction.status === 'SCHEDULED'
  const priceLabel = bidUnavailable ? 'Lance não consultado' : latestBid
    ? auction.status === 'OPEN' && lot?.status === 'OPEN' ? 'Lance atual' : 'Último lance recebido'
    : 'Lance inicial'
  const statusColor = auction.status === 'OPEN'
    ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200'
    : auction.status === 'SCHEDULED'
      ? 'bg-blue-50 text-blue-800 dark:bg-blue-950 dark:text-blue-200'
      : 'bg-canvas text-muted'
  return (
    <article className="group overflow-hidden rounded-2xl border border-line bg-surface transition-shadow hover:shadow-lg hover:shadow-navy/5">
      <VehiclePhoto key={`${vehicle?.id}:${vehicle?.imageUrls.join('|')}`} vehicle={vehicle} />
      <div className="p-5 sm:p-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <span className={`rounded-full px-3 py-1.5 text-[11px] font-semibold ${statusColor}`}>{auctionLabels[auction.status]}</span>
          {lot && <span className="text-xs text-muted">Lote {lot.number}</span>}
        </div>
        <p className="mb-2 break-words text-xs text-muted">{auction.title}</p>
        <h3 className="break-words text-xl font-semibold tracking-tight text-ink">
          {vehicle ? `${vehicle.brand} ${vehicle.model}` : lotUnavailable ? 'Dados do lote indisponíveis' : 'Leilão sem lotes'}
        </h3>
        {vehicle && <p className="mt-2 break-words text-sm text-muted">{vehicle.year}{vehicle.version ? ` · ${vehicle.version}` : ''}</p>}
        {lot && <p className="mt-2 text-xs text-muted">Status do lote: {lotLabels[lot.status]}</p>}
        <div className="mt-5 border-t border-line pt-5">
          {lot ? <>
            <p className="text-xs text-muted">{priceLabel}</p>
            <p className="mt-1 break-words text-2xl font-semibold tracking-tight text-ink">
              {bidUnavailable ? 'Indisponível' : formatMoney(latestBid?.amount ?? lot.startingPrice)}
            </p>
            {bidUnavailable && <p className="mt-1 text-xs text-muted">Lance inicial: {formatMoney(lot.startingPrice)}</p>}
            {!latestBid && !bidUnavailable && <p className="mt-1 text-xs text-muted">Nenhum lance registrado neste lote.</p>}
          </> : <p className="text-sm text-muted">{lotUnavailable ? 'Atualize a consulta para tentar carregar o lote.' : 'Valores disponíveis quando houver lotes cadastrados.'}</p>}
          <div className="mt-5 flex items-start gap-2.5 text-muted">
            <CalendarDays size={16} className="mt-0.5 shrink-0" aria-hidden="true" />
            <div className="text-xs leading-5">
              <p>{upcoming ? 'Início do leilão' : auction.status === 'OPEN' && lot?.status === 'OPEN' ? 'Prazo do lote' : 'Prazo registrado'}</p>
              <time dateTime={upcoming ? auction.startsAt : lot?.endsAt ?? auction.endsAt} className="font-medium text-ink">
                {formatDate(upcoming ? auction.startsAt : lot?.endsAt ?? auction.endsAt)}
              </time>
            </div>
          </div>
          {totalLots !== null && totalLots > 1 && <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-muted">
            <Layers3 size={15} className="mt-0.5 shrink-0" aria-hidden="true" />Prévia de 1 dos {totalLots} lotes deste leilão.
          </p>}
        </div>
      </div>
    </article>
  )
}
