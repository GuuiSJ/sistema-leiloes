import { ApiError, getJson } from './api'

export type AuctionStatus = 'DRAFT' | 'SCHEDULED' | 'OPEN' | 'CLOSED' | 'CANCELLED'
export type LotStatus = 'PENDING' | 'OPEN' | 'SOLD' | 'UNSOLD' | 'CANCELLED'
export interface Auction {
  id: string; title: string; status: AuctionStatus; startsAt: string; endsAt: string; description?: string | null
}
export interface Vehicle {
  id: string; brand: string; model: string; year: number; version: string | null; imageUrls: string[]
  description?: string | null; fipeCode?: string | null; fipeReferenceMonth?: string | null
  fipeReferencePrice?: string | null; fipeReferencePriceVerified?: boolean
  fipeBrandCode?: string | null; fipeModelCode?: string | null; fipeYearCode?: string | null
}
export interface Lot {
  id: string; auctionId: string; number: number; startingPrice: string; minimumIncrement: string
  status: LotStatus; endsAt: string; vehicle: Vehicle
  result?: { status: 'SOLD'; winningBidId: string; finalAmount: string } | { status: 'UNSOLD'; winningBidId: null; finalAmount: null } | null
}
export interface Bid { id: string; lotId: string; amount: string; sequence: number; createdAt: string }
export interface Pagination { page: number; limit: number; total: number; totalPages: number }
export interface Page<T> { data: T[]; pagination: Pagination }
export interface AuctionPreview {
  auction: Auction; lot: Lot | null; totalLots: number | null; latestBid: Bid | null
  lotUnavailable: boolean; bidUnavailable: boolean
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const text = (value: unknown): value is string => typeof value === 'string'
const date = (value: unknown): value is string => text(value) && Number.isFinite(Date.parse(value))
const money = (value: unknown): value is string => text(value) && /^\d+\.\d{2}$/.test(value)
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
export const isAuction = (v: unknown): v is Auction => record(v) && text(v.id) && text(v.title) &&
  (v.description === undefined || v.description === null || text(v.description)) &&
  ['DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'CANCELLED'].includes(String(v.status)) && date(v.startsAt) && date(v.endsAt)
export const isVehicle = (v: unknown): v is Vehicle => record(v) && text(v.id) && text(v.brand) && text(v.model) && integer(v.year) &&
  [v.description, v.fipeCode, v.fipeReferenceMonth, v.fipeBrandCode, v.fipeModelCode, v.fipeYearCode].every(value => value === undefined || value === null || text(value)) &&
  (v.fipeReferencePrice === undefined || v.fipeReferencePrice === null || money(v.fipeReferencePrice)) &&
  (v.fipeReferencePriceVerified === undefined || typeof v.fipeReferencePriceVerified === 'boolean') &&
  (v.version === null || text(v.version)) && Array.isArray(v.imageUrls) && v.imageUrls.every(text)
export const isLot = (v: unknown): v is Lot => record(v) && text(v.id) && text(v.auctionId) && integer(v.number) &&
  money(v.startingPrice) && money(v.minimumIncrement) && ['PENDING', 'OPEN', 'SOLD', 'UNSOLD', 'CANCELLED'].includes(String(v.status)) && date(v.endsAt) && isVehicle(v.vehicle) &&
  (v.result === undefined || v.result === null || (record(v.result) && v.result.status === v.status &&
    ((v.status === 'SOLD' && text(v.result.winningBidId) && money(v.result.finalAmount)) || (v.status === 'UNSOLD' && v.result.winningBidId === null && v.result.finalAmount === null))))
const isBid = (v: unknown): v is Bid => record(v) && text(v.id) && text(v.lotId) && money(v.amount) && integer(v.sequence) && date(v.createdAt)

export async function getPage<T>(path: string, guard: (value: unknown) => value is T, signal: AbortSignal): Promise<Page<T>> {
  const body = await getJson(path, signal)
  if (!record(body) || !Array.isArray(body.data) || !body.data.every(guard) || !record(body.pagination) ||
      !integer(body.pagination.page) || body.pagination.page < 1 || !integer(body.pagination.limit) || body.pagination.limit < 1 ||
      !integer(body.pagination.total) || !integer(body.pagination.totalPages)) {
    throw new ApiError('A API retornou dados em um formato inesperado. Tente novamente mais tarde.')
  }
  return { data: body.data, pagination: body.pagination as unknown as Pagination }
}

export function listAuctions(page: number, limit: number, signal: AbortSignal, status?: AuctionStatus) {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) })
  if (status) query.set('status', status)
  return getPage(`/api/auctions?${query}`, isAuction, signal)
}
export function listAuctionLots(auctionId: string, signal: AbortSignal) {
  return getPage(`/api/auctions/${encodeURIComponent(auctionId)}/lots?page=1&limit=1`, isLot, signal)
}
export function latestLotBid(lotId: string, signal: AbortSignal) {
  return getPage(`/api/lots/${encodeURIComponent(lotId)}/bids?page=1&limit=1`, isBid, signal)
}

export async function getAuction(id: string, signal: AbortSignal): Promise<Auction> {
  const body = await getJson(`/api/auctions/${encodeURIComponent(id)}`, signal)
  if (!record(body) || !isAuction(body.auction) || body.auction.id !== id) throw new ApiError('Dados do leilão em formato inesperado.')
  return body.auction
}
export function getLotsPage(auctionId: string, page: number, signal: AbortSignal) {
  return getPage(`/api/auctions/${encodeURIComponent(auctionId)}/lots?page=${page}&limit=10`, isLot, signal)
}
export async function getLot(auctionId: string, lotId: string, signal: AbortSignal): Promise<Lot> {
  const body = await getJson(`/api/auctions/${encodeURIComponent(auctionId)}/lots/${encodeURIComponent(lotId)}`, signal)
  if (!record(body) || !isLot(body.lot) || body.lot.id !== lotId || body.lot.auctionId !== auctionId) throw new ApiError('Dados do lote em formato inesperado.')
  return body.lot
}
export function getBidHistory(lotId: string, page: number, signal: AbortSignal) {
  return getPage(`/api/lots/${encodeURIComponent(lotId)}/bids?page=${page}&limit=10`, isBid, signal)
}

export async function previewAuction(auction: Auction, signal: AbortSignal): Promise<AuctionPreview> {
  const preview: AuctionPreview = { auction, lot: null, totalLots: null, latestBid: null, lotUnavailable: false, bidUnavailable: false }
  try {
    const lots = await listAuctionLots(auction.id, signal)
    preview.totalLots = lots.pagination.total
    preview.lot = lots.data[0] ?? null
  } catch (error) {
    if (signal.aborted) throw error
    preview.lotUnavailable = true
  }
  if (preview.lot) {
    try {
      const bids = await latestLotBid(preview.lot.id, signal)
      preview.latestBid = bids.data[0] ?? null
    } catch (error) {
      if (signal.aborted) throw error
      preview.bidUnavailable = true
    }
  }
  return preview
}

// Selection policy, not a backend "featured" flag: OPEN first, then SCHEDULED.
export async function loadFeatured(signal: AbortSignal) {
  const pages = await Promise.all([listAuctions(1, 3, signal, 'OPEN'), listAuctions(1, 3, signal, 'SCHEDULED')])
  const auctions = [...pages[0].data, ...pages[1].data].filter((auction, index, all) => all.findIndex(item => item.id === auction.id) === index).slice(0, 3)
  return { items: await Promise.all(auctions.map(auction => previewAuction(auction, signal))), pagination: null }
}
export async function loadAuctionPage(page: number, signal: AbortSignal) {
  const auctions = await listAuctions(page, 6, signal)
  return { items: await Promise.all(auctions.data.map(auction => previewAuction(auction, signal))), pagination: auctions.pagination }
}
