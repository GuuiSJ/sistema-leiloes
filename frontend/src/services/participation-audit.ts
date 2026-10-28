import { API_BASE_URL, ApiError } from './api'
import { AuthError } from './auth'
import type { Page, LotStatus } from './auctions'

export const publicIdValid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim()
const date = (v: unknown): v is string => text(v) && Number.isFinite(Date.parse(v))
const money = (v: unknown): v is string => text(v) && /^(0|[1-9]\d{0,15})\.\d{2}$/.test(v)
const uuid = (v: unknown): v is string => text(v) && publicIdValid(v)
const integer = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0
function invalid(): never { throw new ApiError('Os dados da consulta não puderam ser validados. Tente novamente.') }
export interface Participation {
  auction: { id: string; title: string }; lot: { id: string; number: number; status: LotStatus; endsAt: string }
  vehicle: { brand: string; model: string; year: number; version: string | null }
  myBid: { id: string; amount: string; createdAt: string }; bidCount: number
  outcome: 'WON' | 'NOT_WON' | 'IN_PROGRESS' | 'CANCELLED' | 'UNSOLD'; finalAmount: string | null; receiptPublicId: string | null
}
export interface Receipt {
  publicId: string; lotId: string; winningBidId: string; finalAmount: string; issuedAt: string; auctionTitle: string
  lotNumber: number; vehicleBrand: string; vehicleModel: string; vehicleYear: number; vehicleVersion: string | null
}
export const auditActionLabels: Record<string, string> = {
  AUCTION_OPENED: 'Leilão aberto', LOT_OPENED: 'Lote aberto', LOT_CLOSED: 'Lote encerrado',
  FUNDS_DEBITED: 'Pagamento registrado', RECEIPT_ISSUED: 'Comprovante emitido', AUCTION_CLOSED: 'Leilão encerrado',
}
export interface AuditEvent { id: string; sequence: string; action: string; entityType: 'Lot' | 'Auction'; entityId: string; occurredAt: string; previousHash: string | null; currentHash: string }
export interface PublicAudit extends Page<AuditEvent> {
  lotId: string; integrity: { status: 'VALID' | 'INVALID' | 'UNAVAILABLE'; scope: 'GLOBAL_EVENT_CHAIN'; checkedAt: string; eventsChecked: number }
}
async function read(path: string, signal: AbortSignal, token?: string): Promise<unknown> {
  if (token !== undefined && (!token || /\s/.test(token))) throw new AuthError('Entre novamente para consultar seus arremates.', 401)
  const controller = new AbortController(), abort = () => controller.abort()
  if (signal.aborted) throw new DOMException('Consulta cancelada', 'AbortError')
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 12000)
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, { method: 'GET', signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { Accept: 'application/json', ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }) } })
    if (!response.ok) {
      const message = response.status === 401 ? 'Sua sessão expirou. Entre novamente.' : response.status === 403 ? 'Seu perfil não tem permissão para esta consulta.' : response.status === 404 ? 'Lote ou comprovante não encontrado.' : 'Não foi possível consultar os dados. Tente novamente.'
      throw token === undefined ? new ApiError(message, response.status) : new AuthError(message, response.status)
    }
    return await response.json()
  } catch (error) {
    if (signal.aborted || error instanceof ApiError || error instanceof AuthError) throw error
    throw new ApiError('A consulta está indisponível. Nenhuma informação pôde ser confirmada. Tente novamente.')
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
function pageOf<T>(body: unknown, page: number, guard: (v: unknown) => v is T): Page<T> {
  if (!record(body) || !Array.isArray(body.data) || !body.data.every(guard) || !record(body.pagination)) return invalid()
  const p = body.pagination
  if (p.page !== page || p.limit !== 10 || !integer(p.total) || !integer(p.totalPages) || p.totalPages !== Math.ceil(p.total / 10) || body.data.length > 10) return invalid()
  return { data: body.data, pagination: { page, limit: 10, total: p.total, totalPages: p.totalPages } }
}
function isParticipation(v: unknown): v is Participation {
  if (!record(v) || !record(v.auction) || !uuid(v.auction.id) || !text(v.auction.title) || !record(v.lot) || !uuid(v.lot.id) || !integer(v.lot.number) || v.lot.number < 1 || !['PENDING', 'OPEN', 'SOLD', 'UNSOLD', 'CANCELLED'].includes(String(v.lot.status)) || !date(v.lot.endsAt) || !record(v.vehicle) || !text(v.vehicle.brand) || !text(v.vehicle.model) || !integer(v.vehicle.year) || !(v.vehicle.version === null || text(v.vehicle.version)) || !record(v.myBid) || !uuid(v.myBid.id) || !money(v.myBid.amount) || !date(v.myBid.createdAt) || !integer(v.bidCount) || v.bidCount < 1) return false
  if (!(v.finalAmount === null || money(v.finalAmount)) || !(v.receiptPublicId === null || uuid(v.receiptPublicId))) return false
  const allowed: Record<string, string[]> = { SOLD: ['WON', 'NOT_WON'], UNSOLD: ['UNSOLD'], CANCELLED: ['CANCELLED'], OPEN: ['IN_PROGRESS'], PENDING: ['IN_PROGRESS'] }
  return allowed[String(v.lot.status)]!.includes(String(v.outcome)) && (v.receiptPublicId === null || (v.outcome === 'WON' && v.finalAmount !== null))
}
export async function getParticipations(page: number, token: string, signal: AbortSignal): Promise<Page<Participation>> {
  if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) return invalid()
  return pageOf(await read(`/api/me/participations?page=${page}&limit=10`, signal, token), page, isParticipation)
}
export async function getPublicReceipt(id: string, signal: AbortSignal): Promise<Receipt> {
  if (!publicIdValid(id)) return invalid()
  const body = await read(`/api/receipts/${id}`, signal)
  if (!record(body) || !record(body.receipt)) return invalid()
  const r = body.receipt
  if (r.publicId !== id || !uuid(r.lotId) || !uuid(r.winningBidId) || !money(r.finalAmount) || !date(r.issuedAt) || !text(r.auctionTitle) || !integer(r.lotNumber) || r.lotNumber < 1 || !text(r.vehicleBrand) || !text(r.vehicleModel) || !integer(r.vehicleYear) || !(r.vehicleVersion === null || text(r.vehicleVersion))) return invalid()
  return r as unknown as Receipt
}
export async function getPublicAudit(lotId: string, page: number, signal: AbortSignal): Promise<PublicAudit> {
  if (!publicIdValid(lotId) || !Number.isSafeInteger(page) || page < 1 || page > 1000000) return invalid()
  const body = await read(`/api/lots/${lotId}/audit?page=${page}&limit=10`, signal)
  if (!record(body) || body.lotId !== lotId || !record(body.integrity)) return invalid()
  const integrity = body.integrity
  if (!['VALID', 'INVALID', 'UNAVAILABLE'].includes(String(integrity.status)) || integrity.scope !== 'GLOBAL_EVENT_CHAIN' || !date(integrity.checkedAt) || !integer(integrity.eventsChecked)) return invalid()
  const hash = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v)
  const result = pageOf(body, page, (v): v is AuditEvent => record(v) && uuid(v.id) && text(v.sequence) && /^[1-9]\d*$/.test(v.sequence) && Object.hasOwn(auditActionLabels, String(v.action)) && ['Lot', 'Auction'].includes(String(v.entityType)) && uuid(v.entityId) && (v.entityType !== 'Lot' || v.entityId === lotId) && date(v.occurredAt) && hash(v.currentHash) && (v.previousHash === null || hash(v.previousHash)))
  if ((integrity.status !== 'VALID' && result.data.length) || (integrity.status === 'VALID' && (result.pagination.total === 0 || integrity.eventsChecked < result.pagination.total))) return invalid()
  return { ...result, lotId, integrity: integrity as unknown as PublicAudit['integrity'] }
}
