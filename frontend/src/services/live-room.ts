import { API_BASE_URL, ApiError, getJson } from './api'
import { AuthError } from './auth'
import type { AuctionStatus, LotStatus, Page } from './auctions'

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const date = (v: unknown): v is string => typeof v === 'string' && Number.isFinite(Date.parse(v))
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
const money = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9]\d{0,15})\.\d{2}$/.test(v)
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim()
const lotStatuses = ['PENDING', 'OPEN', 'SOLD', 'UNSOLD', 'CANCELLED']
function invalid(): never { throw new ApiError('Os dados do lote não puderam ser validados. Atualize a consulta.') }
export interface RoomClock {
  lotId: string; auctionId: string; lotStatus: LotStatus; auctionStatus: AuctionStatus; endsAt: string; checkedAt: string; trusted: boolean
  receivedAt: number; serverAtReceipt: number
}
export interface Position { lotId: string; lotStatus: LotStatus; status: 'NONE' | 'LEADING' | 'OUTBID' | 'WON' | 'NOT_WON' | 'CLOSED' | 'RECORDED'; latestBidId: string | null; checkedAt: string }
export interface LotResult {
  lotId: string; auctionId: string; auctionTitle: string; number: number; status: 'SOLD' | 'UNSOLD'
  vehicle: { brand: string; model: string; year: number }; finalAmount: string | null; winningBidId: string | null; receiptPublicId: string | null
}
export async function getRoomClock(lotId: string, signal: AbortSignal): Promise<RoomClock> {
  if (!uuid(lotId)) return invalid()
  const sentAt = performance.now(), v = await getJson(`/api/lots/${lotId}/clock`, signal), receivedAt = performance.now()
  if (!object(v) || v.lotId !== lotId || !uuid(v.auctionId) || !lotStatuses.includes(String(v.lotStatus)) || !['DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'CANCELLED'].includes(String(v.auctionStatus)) || !date(v.endsAt) || !date(v.checkedAt) || typeof v.trusted !== 'boolean') return invalid()
  return { ...v, trusted: v.trusted && receivedAt - sentAt < 10000, receivedAt, serverAtReceipt: Date.parse(v.checkedAt) + (receivedAt - sentAt) / 2 } as RoomClock
}
// Use monotonic elapsed time, never the participant's wall clock, for the estimate.
export function remainingMilliseconds(clock: RoomClock, monotonicNow = performance.now()) {
  return Math.max(0, Date.parse(clock.endsAt) - clock.serverAtReceipt - Math.max(0, monotonicNow - clock.receivedAt))
}
export function countdownText(milliseconds: number) {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000)
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor(seconds / 60) % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}
async function readPrivate(path: string, token: string, signal: AbortSignal): Promise<unknown> {
  if (!token || /\s/.test(token)) throw new AuthError('Entre novamente para consultar estes dados.', 401)
  if (signal.aborted) throw new DOMException('Consulta cancelada', 'AbortError')
  const controller = new AbortController(), abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true }); const timer = setTimeout(abort, 12000)
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { method: 'GET', signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error', headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } })
    if (!response.ok) throw new AuthError(response.status === 401 ? 'Sua sessão expirou. Entre novamente.' : response.status === 403 ? 'Você não tem permissão para consultar estes dados.' : response.status === 404 ? 'Leilão ou lote não encontrado.' : 'A consulta está indisponível. Tente novamente.', response.status)
    return await response.json()
  } catch (error) {
    if (signal.aborted || error instanceof AuthError) throw error
    throw new ApiError('Não foi possível atualizar os dados. Tente novamente.')
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
export async function getLotPosition(lotId: string, token: string, signal: AbortSignal): Promise<Position> {
  if (!uuid(lotId)) return invalid()
  const v = await readPrivate(`/api/lots/${lotId}/position`, token, signal)
  if (!object(v) || v.lotId !== lotId || !lotStatuses.includes(String(v.lotStatus)) || !['NONE', 'LEADING', 'OUTBID', 'WON', 'NOT_WON', 'CLOSED', 'RECORDED'].includes(String(v.status)) || !(v.latestBidId === null || uuid(v.latestBidId)) || !date(v.checkedAt)) return invalid()
  if ((v.status === 'LEADING' || v.status === 'OUTBID') && (v.lotStatus !== 'OPEN' || v.latestBidId === null)) return invalid()
  if (['WON', 'NOT_WON'].includes(String(v.status)) && v.lotStatus !== 'SOLD') return invalid()
  return v as unknown as Position
}
export async function getLotResults(page: number, auctionId: string | undefined, token: string, signal: AbortSignal): Promise<Page<LotResult>> {
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000 || (auctionId !== undefined && !uuid(auctionId))) return invalid()
  const query = new URLSearchParams({ page: String(page), limit: '10', ...(auctionId ? { auctionId } : {}) })
  const v = await readPrivate(`/api/me/lot-results?${query}`, token, signal)
  if (!object(v) || !Array.isArray(v.data) || !object(v.pagination)) return invalid()
  for (const item of v.data) {
    if (!object(item) || !uuid(item.lotId) || !uuid(item.auctionId) || (auctionId && item.auctionId !== auctionId) || !text(item.auctionTitle) || !integer(item.number) || item.number < 1 || !['SOLD', 'UNSOLD'].includes(String(item.status)) || !object(item.vehicle) || !text(item.vehicle.brand) || !text(item.vehicle.model) || !integer(item.vehicle.year)) return invalid()
    const empty = item.finalAmount === null && item.winningBidId === null && item.receiptPublicId === null
    if (item.status === 'UNSOLD' ? !empty : !(empty || (money(item.finalAmount) && uuid(item.winningBidId) && uuid(item.receiptPublicId)))) return invalid()
  }
  const p = v.pagination
  if (p.page !== page || p.limit !== 10 || !integer(p.total) || !integer(p.totalPages) || p.totalPages !== Math.ceil(p.total / 10) || v.data.length > 10) return invalid()
  return { data: v.data as LotResult[], pagination: { page, limit: 10, total: p.total, totalPages: p.totalPages } }
}
