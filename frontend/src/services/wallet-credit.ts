import { API_BASE_URL } from './api'
import { WalletError, type WalletSnapshot } from './wallet'

export interface PendingCredit { amount: string; key: string }
export class WalletCreditError extends WalletError {
  constructor(message: string, status?: number, readonly retrySameKey = false, readonly unavailable = false) { super(message, status) }
}
export function demoCreditEnvironment({ development, hostname, apiUrl }: { development: boolean; hostname: string; apiUrl: string }) {
  const local = ['localhost', '127.0.0.1', '[::1]', '::1']
  try { return development && local.includes(hostname) && local.includes(new URL(apiUrl).hostname) } catch { return false }
}
export function localCreditAllowed() {
  return typeof window !== 'undefined' && demoCreditEnvironment({ development: import.meta.env.DEV, hostname: window.location.hostname, apiUrl: API_BASE_URL })
}
export function parseCreditAmount(value: string): string | null {
  if (!/^(0|[1-9]\d{0,15})(,\d{1,2})?$/.test(value.trim())) return null
  const [whole, decimals = ''] = value.trim().split(',')
  const result = `${whole}.${decimals.padEnd(2, '0')}`
  return BigInt(result.replace('.', '')) > 0n ? result : null
}
const money = (v: unknown): v is string => typeof v === 'string' && /^(0|[1-9]\d{0,15})\.\d{2}$/.test(v)
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const keyValid = (key: unknown): key is string => typeof key === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(key)
function validAttempt(v: unknown): v is PendingCredit { return record(v) && money(v.amount) && BigInt(v.amount.replace('.', '')) > 0n && keyValid(v.key) }
const pendingKey = (userId: string) => `pending-demo-credit:${userId}`
export function readPendingCredit(userId: string, storage: Pick<Storage, 'getItem'> = sessionStorage): PendingCredit | null {
  const raw = storage.getItem(pendingKey(userId))
  if (!raw) return null
  const v: unknown = JSON.parse(raw)
  if (!validAttempt(v)) throw new WalletCreditError('Não foi possível validar uma tentativa anterior. Confira o histórico antes de continuar.')
  return { amount: v.amount, key: v.key }
}
export function savePendingCredit(userId: string, attempt: PendingCredit, storage: Pick<Storage, 'setItem'> = sessionStorage) {
  if (!validAttempt(attempt)) throw new WalletCreditError('Tentativa de crédito inválida.')
  storage.setItem(pendingKey(userId), JSON.stringify(attempt))
}
export function clearPendingCredit(userId: string, storage: Pick<Storage, 'removeItem'> = sessionStorage) { storage.removeItem(pendingKey(userId)) }
export function createWalletCreditAttempt(attempt: PendingCredit) {
  if (!validAttempt(attempt)) throw new WalletCreditError('Informe um valor de crédito válido.')
  const { amount, key } = attempt
  let sending = false
  return async (token: string, signal: AbortSignal): Promise<WalletSnapshot> => {
    if (!localCreditAllowed()) throw new WalletCreditError('Crédito de demonstração indisponível neste ambiente. Não há depósitos reais.', 403, false, true)
    if (!token || /\s/.test(token)) throw new WalletCreditError('Entre novamente para adicionar saldo de demonstração.', 401, true)
    if (sending) throw new WalletCreditError('Um crédito já está sendo enviado.', undefined, true)
    if (signal.aborted) throw new WalletCreditError('Envio cancelado. Preserve esta tentativa para consultar ou repetir com segurança.', undefined, true)
    sending = true
    const controller = new AbortController(), abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true }); const timer = setTimeout(abort, 12000)
    try {
      const response = await fetch(`${API_BASE_URL}/api/wallet/credit`, {
        method: 'POST', signal: controller.signal, credentials: 'omit', redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify({ amount }),
      })
      if (!response.ok) {
        const body: unknown = await response.json().catch(() => null)
        const limit = response.status === 409 && record(body) && body.message === 'Crédito excede o limite de saldo da carteira.'
        throw new WalletCreditError(response.status === 403 ? 'Crédito de demonstração indisponível. O ambiente não está autorizado ou seu perfil não permite esta operação. Confira no histórico qualquer tentativa anterior pendente.'
          : response.status === 401 ? 'Sua sessão expirou. Entre novamente para repetir a mesma tentativa.'
            : response.status === 400 ? 'O crédito não foi aceito. Confira o valor informado.'
              : limit ? 'O valor excede o limite de saldo da carteira. Informe um valor menor.'
                : response.status === 409 ? 'A operação foi bloqueada. Consulte o histórico e preserve esta tentativa antes de repetir.'
                : 'Não foi possível confirmar o crédito. Repita somente esta mesma tentativa.', response.status, response.status !== 400 && !limit, response.status === 403)
      }
      const body: unknown = await response.json()
      if (!record(body) || body.simulated !== true || typeof body.replayed !== 'boolean' || response.status !== (body.replayed ? 200 : 201) || !record(body.wallet) || !record(body.transaction)) throw new WalletCreditError('Não foi possível validar o crédito. Repita a mesma tentativa.', undefined, true)
      const w = body.wallet, t = body.transaction
      if (!money(w.totalBalance) || !money(w.reservedBalance) || !money(w.availableBalance) || BigInt(w.totalBalance.replace('.', '')) !== BigInt(w.reservedBalance.replace('.', '')) + BigInt(w.availableBalance.replace('.', '')) || t.type !== 'CREDIT' || t.simulated !== true || t.amount !== amount || !money(t.balanceAfter) || typeof t.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(t.id) || typeof t.createdAt !== 'string' || !Number.isFinite(Date.parse(t.createdAt))) throw new WalletCreditError('Não foi possível validar o crédito. Repita a mesma tentativa.', undefined, true)
      return { totalBalance: w.totalBalance, reservedBalance: w.reservedBalance, availableBalance: w.availableBalance }
    } catch (error) {
      if (error instanceof WalletCreditError) throw error
      throw new WalletCreditError('Resultado não confirmado. Consulte o histórico e repita somente esta mesma tentativa.', undefined, true)
    } finally { sending = false; clearTimeout(timer); signal.removeEventListener('abort', abort) }
  }
}
