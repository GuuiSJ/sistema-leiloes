import { API_BASE_URL } from './api'
import { AuthError, type UserRole } from './auth'
import type { Pagination } from './auctions'

export interface WalletSnapshot { totalBalance: string; reservedBalance: string; availableBalance: string }
export type MovementType = 'CREDIT' | 'DEBIT' | 'RESERVE' | 'RELEASE'
export interface WalletMovement {
  id: string; type: MovementType; amount: string; balanceAfter: string; createdAt: string; simulated: boolean
}
export interface WalletHistory { data: WalletMovement[]; pagination: Pagination }
export class WalletError extends AuthError {}
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const money = (value: unknown): value is string => typeof value === 'string' && /^\d{1,16}\.\d{2}$/.test(value)
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const cents = (value: string) => BigInt(value.replace('.', ''))
export const canViewWallet = (role: UserRole | undefined) => role === 'BIDDER'

async function read(path: string, token: string, signal: AbortSignal): Promise<unknown> {
  if (!token || /\s/.test(token)) throw new WalletError('Entre novamente para consultar sua carteira.', 401)
  const controller = new AbortController(), abort = () => controller.abort()
  if (signal.aborted) abort()
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 12_000)
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      const message = response.status === 401 ? 'Sua sessão expirou ou não é mais válida. Entre novamente.'
        : response.status === 403 ? 'Seu perfil não tem permissão para consultar a carteira.'
          : response.status === 409 ? 'Não foi possível validar os dados da carteira. Tente novamente mais tarde.'
            : 'A consulta financeira está indisponível. Tente novamente.'
      throw new WalletError(message, response.status)
    }
    return await response.json()
  } catch (error) {
    if (signal.aborted) throw error
    if (error instanceof WalletError) throw error
    throw new WalletError(controller.signal.aborted ? 'A consulta demorou mais que o esperado. Tente novamente.' : 'Não foi possível acessar sua carteira. Verifique a conexão e tente novamente.')
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
export async function getWallet(token: string, signal: AbortSignal): Promise<WalletSnapshot> {
  const result = await read('/api/wallet', token, signal)
  if (!object(result) || !object(result.wallet)) throw new WalletError('Os dados da carteira não puderam ser validados.')
  const wallet = result.wallet
  if (!money(wallet.totalBalance) || !money(wallet.reservedBalance) || !money(wallet.availableBalance) ||
      cents(wallet.totalBalance) !== cents(wallet.reservedBalance) + cents(wallet.availableBalance)) throw new WalletError('Os dados da carteira não puderam ser validados.')
  return { totalBalance: wallet.totalBalance, reservedBalance: wallet.reservedBalance, availableBalance: wallet.availableBalance }
}
export async function getWalletHistory(page: number, token: string, signal: AbortSignal): Promise<WalletHistory> {
  if (!Number.isSafeInteger(page) || page < 1 || page > 1_000_000) throw new WalletError('Página de movimentações inválida.')
  const result = await read(`/api/wallet/transactions?page=${page}&limit=10`, token, signal)
  if (!object(result) || !Array.isArray(result.data) || !object(result.pagination)) throw new WalletError('O histórico não pôde ser validado.')
  const data = result.data.map((item: unknown): WalletMovement => {
    if (!object(item) || typeof item.id !== 'string' || !['CREDIT', 'DEBIT', 'RESERVE', 'RELEASE'].includes(String(item.type)) ||
        !money(item.amount) || !money(item.balanceAfter) || typeof item.createdAt !== 'string' || !Number.isFinite(Date.parse(item.createdAt)) ||
        typeof item.simulated !== 'boolean' || (item.simulated && item.type !== 'CREDIT')) throw new WalletError('O histórico não pôde ser validado.')
    return { id: item.id, type: item.type as MovementType, amount: item.amount, balanceAfter: item.balanceAfter, createdAt: item.createdAt, simulated: item.simulated }
  })
  const p = result.pagination
  if (!integer(p.page) || p.page !== page || !integer(p.limit) || p.limit !== 10 || !integer(p.total) || !integer(p.totalPages) ||
      p.totalPages !== Math.ceil(p.total / p.limit) || data.length > p.limit) throw new WalletError('A paginação do histórico não pôde ser validada.')
  return { data, pagination: { page: p.page, limit: p.limit, total: p.total, totalPages: p.totalPages } }
}
