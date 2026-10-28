import { API_BASE_URL, ApiError } from './api'
import { AuthError } from './auth'
import { getLotsPage, isLot, type AuctionStatus, type Lot, type LotStatus } from './auctions'

export interface LotDraft { vehicleId: string; number: string; startingPrice: string; minimumIncrement: string }
export type LotFields = Partial<Record<keyof LotDraft, string>>
export class LotManagementError extends AuthError {
  constructor(message: string, status?: number, readonly uncertain = false) { super(message, status) }
}
// Only these locally known API messages may select a more specific explanation.
// Unknown server text never reaches the interface.
const lotConflictMessages = new Map([
  ['Somente leilões DRAFT ainda não iniciados permitem gerenciar lotes.', 'O leilão precisa estar em rascunho e com início e término futuros para gerenciar lotes. Se o horário de início já passou, o backend também impede reagendar esse leilão. Cadastre outro leilão operacional com início futuro.'],
  ['Leilão LEGACY ou sem geração temporal válida: operação bloqueada. Histórico disponível para consulta.', 'Este leilão está disponível apenas para consulta do histórico e não permite cadastrar ou alterar lotes. É necessário um novo leilão em um ambiente com operação temporal habilitada; alterar as datas não remove esse bloqueio.'],
  ['Número ou veículo já associado a este leilão.', 'O número do lote ou o veículo já está vinculado a este leilão. Confira os lotes existentes e escolha outro número ou veículo.'],
  ['Lote alterado simultaneamente. Tente novamente.', 'O lote foi alterado simultaneamente. Reconsulte os dados antes de tentar novamente.'],
  ['Lote possui estado ou histórico incompatível com alteração ou exclusão.', 'O estado ou o histórico deste lote impede sua alteração ou exclusão.'],
])
async function lotConflictMessage(response: Response): Promise<string> {
  const fallback = 'A operação foi bloqueada. Verifique se o número ou veículo já está vinculado ao leilão. Estado, prazo, histórico ou alterações simultâneas também podem impedir a operação.'
  const body: unknown = await response.json().catch(() => null)
  if (!body || typeof body !== 'object' || !('message' in body) || typeof body.message !== 'string') return fallback
  return lotConflictMessages.get(body.message) ?? fallback
}
export const validLotId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
// Public status only narrows actions; deadlines, ownership and history are checked by the API.
export const lotActions = (auction: AuctionStatus, lot?: LotStatus) => ({ create: auction === 'DRAFT', edit: auction === 'DRAFT' && lot === 'PENDING', delete: auction === 'DRAFT' && lot === 'PENDING' })
export function lotDraft(lot?: Lot): LotDraft {
  return { vehicleId: lot?.vehicle.id ?? '', number: lot ? String(lot.number) : '', startingPrice: lot?.startingPrice.replace('.', ',') ?? '', minimumIncrement: lot?.minimumIncrement.replace('.', ',') ?? '' }
}
export function lotMoney(value: string): string | null {
  const normalized = value.trim().replace(',', '.')
  if (!/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/.test(normalized)) return null
  const [whole, fraction = ''] = normalized.split('.')
  const amount = `${whole}.${fraction.padEnd(2, '0')}`
  return BigInt(amount.replace('.', '')) > 0n ? amount : null
}
export function validateLot(draft: LotDraft, editing = false): LotFields {
  const errors: LotFields = {}
  if (!validLotId(draft.vehicleId)) errors.vehicleId = 'Selecione um veículo existente.'
  if (!/^\d+$/.test(draft.number) || Number(draft.number) < 1 || Number(draft.number) > 2147483647) errors.number = 'Informe um número inteiro entre 1 e 2147483647.'
  for (const field of editing ? ['startingPrice'] as const : ['startingPrice', 'minimumIncrement'] as const) if (!lotMoney(draft[field])) errors[field] = 'Informe um valor positivo, sem separador de milhar, com até 16 inteiros e duas casas decimais.'
  return errors
}
export function lotInput(draft: LotDraft, editing = false) {
  if (Object.keys(validateLot(draft, editing)).length) throw new LotManagementError('Confira os campos destacados.', 400)
  return { vehicleId: draft.vehicleId, number: Number(draft.number), startingPrice: lotMoney(draft.startingPrice)!, ...(!editing ? { minimumIncrement: lotMoney(draft.minimumIncrement)! } : {}) }
}
export async function getManagedLotsPage(auctionId: string, page: number, signal: AbortSignal) {
  if (!validLotId(auctionId)) throw new ApiError('Identificador de leilão inválido.', 400)
  const result = await getLotsPage(auctionId, page, signal)
  if (result.data.some(lot => lot.auctionId !== auctionId) || result.pagination.page !== page) throw new ApiError('Dados dos lotes em formato inesperado.')
  return result
}
async function mutate(operation: 'create' | 'update' | 'delete', auctionId: string, id: string | undefined, body: object | undefined, token: string, signal: AbortSignal): Promise<Lot | null> {
  if (!token || /\s/.test(token)) throw new LotManagementError('Entre novamente para gerenciar lotes.', 401)
  if (!validLotId(auctionId) || (id !== undefined && !validLotId(id))) throw new LotManagementError('Identificador de leilão ou lote inválido.', 400)
  if (signal.aborted) throw new DOMException('Operação cancelada', 'AbortError')
  const controller = new AbortController(), abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 12000)
  try {
    const response = await fetch(`${API_BASE_URL}/api/auctions/${auctionId}/lots${id ? `/${id}` : ''}`, {
      method: operation === 'create' ? 'POST' : operation === 'update' ? 'PATCH' : 'DELETE', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      const message = response.status === 400 ? 'Confira o veículo, o número e os valores do lote.'
        : response.status === 401 ? 'Sua sessão expirou. Entre novamente.'
          : response.status === 403 ? 'Operação não permitida. É necessário ser responsável pelo leilão e proprietário dos veículos envolvidos.'
            : response.status === 404 ? 'Leilão, lote ou veículo não encontrado. Reconsulte os dados.'
              : response.status === 409 ? await lotConflictMessage(response)
                : response.status === 429 ? 'Muitas tentativas. Aguarde antes de continuar.' : 'Não foi possível confirmar o resultado. Consulte a listagem antes de tentar novamente.'
      throw new LotManagementError(message, response.status, response.status >= 500)
    }
    if (operation === 'delete') {
      if (response.status === 204) return null
      throw new LotManagementError('A resposta da exclusão não pôde ser validada. Consulte a listagem para verificar o resultado.', undefined, true)
    }
    const result: unknown = await response.json()
    if (!result || typeof result !== 'object' || !('lot' in result) || !isLot(result.lot) || !validLotId(result.lot.id) || result.lot.auctionId !== auctionId || (id && result.lot.id !== id)) throw new LotManagementError('A resposta não pôde ser validada. Consulte a listagem para verificar o resultado.', undefined, true)
    return result.lot
  } catch (error) {
    if (error instanceof LotManagementError) throw error
    throw new LotManagementError('Resultado não confirmado. Verifique sua conexão e consulte a listagem antes de repetir a operação.', undefined, true)
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
export const createLot = (auctionId: string, draft: LotDraft, token: string, signal: AbortSignal) => mutate('create', auctionId, undefined, lotInput(draft), token, signal)
export const updateLot = (auctionId: string, id: string, draft: LotDraft, token: string, signal: AbortSignal) => mutate('update', auctionId, id, lotInput(draft, true), token, signal)
export const deleteLot = (auctionId: string, id: string, token: string, signal: AbortSignal) => mutate('delete', auctionId, id, undefined, token, signal)
