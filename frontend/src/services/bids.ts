import { API_BASE_URL } from './api'
import { AuthError } from './auth'
import { eligibilityMessage } from './user-messages'
export class BidError extends AuthError {
  constructor(message: string, status?: number, readonly retrySameKey = false) { super(message, status) }
}
export type Eligibility = { eligible: false; reason: string } | { eligible: true; minimumAmount: string; currentAmount: string | null; checkedAt: string; endsAt: string }
const money = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9]\d{0,15})\.\d{2}$/.test(v)
export function parseBidAmount(input: string): string | null {
  const text = input.trim()
  if (!/^(?:0|[1-9]\d{0,15})(?:,\d{1,2})?$/.test(text)) return null
  const [whole, fraction = ''] = text.split(',')
  const value = `${whole}.${fraction.padEnd(2, '0')}`
  return BigInt(value.replace('.', '')) > 0n ? value : null
}
export const belowMinimum = (amount: string, minimum: string) => BigInt(amount.replace('.', '')) < BigInt(minimum.replace('.', ''))
export interface PendingBid { amount: string; key: string }
const pendingKey = (userId: string, lotId: string) => `pending-bid:${userId}:${lotId}`
export function readPendingBid(userId: string, lotId: string, storage: Pick<Storage, 'getItem'> = sessionStorage): PendingBid | null {
  const raw = storage.getItem(pendingKey(userId, lotId))
  if (!raw) return null
  const value = JSON.parse(raw) as PendingBid
  if (!money(value.amount) || BigInt(value.amount.replace('.', '')) <= 0n || typeof value.key !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(value.key)) throw new BidError('Tentativa salva inválida. Verifique seu histórico antes de continuar.')
  return { amount: value.amount, key: value.key }
}
export function savePendingBid(userId: string, lotId: string, value: PendingBid, storage: Pick<Storage, 'setItem'> = sessionStorage) {
  storage.setItem(pendingKey(userId, lotId), JSON.stringify(value))
}
export function clearPendingBid(userId: string, lotId: string, storage: Pick<Storage, 'removeItem'> = sessionStorage) { storage.removeItem(pendingKey(userId, lotId)) }
async function request(lotId: string, token: string, signal: AbortSignal, attempt?: { amount: string; key: string }): Promise<unknown> {
  const controller = new AbortController(), abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort()
  const timer = setTimeout(abort, 12000)
  try {
    const response = await fetch(`${API_BASE_URL}/api/lots/${encodeURIComponent(lotId)}/bids${attempt ? '' : '/eligibility'}`, {
      method: attempt ? 'POST' : 'GET', signal: controller.signal, credentials: 'omit', cache: 'no-store', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(attempt ? { 'Content-Type': 'application/json', 'Idempotency-Key': attempt.key } : {}) },
      ...(attempt ? { body: JSON.stringify({ amount: attempt.amount }) } : {}),
    })
    if (!response.ok) {
      const errorBody = await response.json().catch(() => null) as { message?: unknown } | null
      const serverMessage = typeof errorBody?.message === 'string' ? errorBody.message : ''
      const retrySameKey = response.status === 409 && serverMessage === 'Conflito entre lances. Reenvie com a mesma chave de idempotência.'
      const conflictMessage = retrySameKey ? 'Houve concorrência entre lances. Repita esta tentativa com a mesma chave.'
        : serverMessage.startsWith('Saldo disponível insuficiente') ? 'Saldo disponível insuficiente para este lance.'
          : serverMessage === 'Lance abaixo do valor inicial ou do incremento mínimo.' ? 'O lance está abaixo do mínimo atual. Atualize e revise o valor.'
            : serverMessage === 'Leilão e lote devem estar abertos e dentro do período de lances.' ? 'O lote não está aberto no período de lances.'
              : 'Lance não aceito: saldo, mínimo, prazo ou estado do lote mudou. Atualize a consulta.'
      throw new BidError(response.status === 401 ? 'Sua sessão expirou. Entre novamente.' : response.status === 403 ? 'Você não tem permissão para participar deste lote.' : response.status === 409 ? conflictMessage : response.status === 400 ? 'Valor ou solicitação inválidos.' : response.status === 404 ? 'Lote não encontrado.' : 'Serviço indisponível. O resultado pode ser incerto; repita a mesma tentativa.', response.status, retrySameKey)
    }
    return await response.json()
  } catch (error) {
    if (error instanceof BidError) throw error
    throw new BidError('Não foi possível confirmar o resultado. Tente novamente com a mesma tentativa.')
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
export async function getBidEligibility(lotId: string, token: string, signal: AbortSignal): Promise<Eligibility> {
  const body = await request(lotId, token, signal) as Partial<Eligibility>
  if (body?.eligible === false && typeof body.reason === 'string') return { eligible: false, reason: eligibilityMessage(body.reason) }
  if (body?.eligible === true && money(body.minimumAmount) && BigInt(body.minimumAmount.replace('.', '')) > 0n && (body.currentAmount === null || money(body.currentAmount)) && typeof body.endsAt === 'string' && Number.isFinite(Date.parse(body.endsAt)) && typeof body.checkedAt === 'string' && Number.isFinite(Date.parse(body.checkedAt)) && Date.parse(body.endsAt) > Date.parse(body.checkedAt)) {
    return { eligible: true, minimumAmount: body.minimumAmount, currentAmount: body.currentAmount, checkedAt: body.checkedAt, endsAt: body.endsAt }
  }
  throw new BidError('Não foi possível validar a elegibilidade.')
}
export function createBidAttempt(lotId: string, amount: string, key: string = crypto.randomUUID()) {
  if (!money(amount) || BigInt(amount.replace('.', '')) <= 0n || !/^[A-Za-z0-9._:-]{1,64}$/.test(key)) throw new BidError('Tentativa inválida.')
  let running = false
  return async (token: string, signal: AbortSignal) => {
    if (running) throw new BidError('Um lance já está sendo enviado.')
    running = true
    try {
      const body = await request(lotId, token, signal, { amount, key }) as { bid?: { lotId?: string; amount?: string; id?: string }; replayed?: boolean }
      if (body?.bid?.lotId !== lotId || body.bid.amount !== amount || typeof body.bid.id !== 'string' || typeof body.replayed !== 'boolean') throw new BidError('Resultado não confirmado. Repita a mesma tentativa.')
      return body
    } finally { running = false }
  }
}
