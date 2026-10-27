import { API_BASE_URL } from './api'
import { AuthError } from './auth'
import { isAuction, type Auction, type AuctionStatus } from './auctions'

export interface AuctionDraft { title: string; description: string; startsAt: string; endsAt: string }
export type AuctionFields = Partial<Record<keyof AuctionDraft, string>>
export class AuctionManagementError extends AuthError {
  constructor(message: string, status?: number, readonly uncertain = false) { super(message, status) }
}
export const validAuctionId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
// Status only narrows the visible actions; ownership and temporal rules remain server-side.
export const auctionActions = (status: AuctionStatus) => ({ edit: status === 'DRAFT', cancel: status === 'DRAFT' || status === 'SCHEDULED' })
export function auctionDraft(auction?: Auction): AuctionDraft {
  return { title: auction?.title ?? '', description: auction?.description ?? '', startsAt: auction?.startsAt ?? '', endsAt: auction?.endsAt ?? '' }
}
export function validAuctionDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value)
  if (!match) return false
  const [, y, m, d, h, min, s, oh, om] = match
  const days = new Date(Date.UTC(Number(y), Number(m), 0)).getUTCDate()
  return Number(y) >= 1000 && Number(m) >= 1 && Number(m) <= 12 && Number(d) >= 1 && Number(d) <= days && Number(h) <= 23 && Number(min) <= 59 && Number(s) <= 59 && Number(oh ?? 0) <= 23 && Number(om ?? 0) <= 59 && Number.isFinite(Date.parse(value))
}
export function validateAuction(draft: AuctionDraft): AuctionFields {
  const errors: AuctionFields = {}
  if (!draft.title.trim() || draft.title.trim().length > 150 || draft.title.includes('\0')) errors.title = 'Informe um título entre 1 e 150 caracteres.'
  if (draft.description.length > 10000 || draft.description.includes('\0')) errors.description = 'Use até 10.000 caracteres, sem caracteres nulos.'
  for (const field of ['startsAt', 'endsAt'] as const) if (!validAuctionDate(draft[field])) errors[field] = 'Selecione uma data e um horário válidos no horário de Brasília.'
  if (!errors.startsAt && !errors.endsAt && Date.parse(draft.endsAt) <= Date.parse(draft.startsAt)) errors.endsAt = 'O término deve ser posterior ao início.'
  return errors
}
export function auctionInput(draft: AuctionDraft) {
  if (Object.keys(validateAuction(draft)).length) throw new AuctionManagementError('Confira os campos destacados.', 400)
  return { title: draft.title.trim(), description: draft.description.trim() || null, startsAt: draft.startsAt, endsAt: draft.endsAt }
}
async function mutate(operation: 'create' | 'update' | 'cancel', id: string | undefined, body: object | undefined, token: string, signal: AbortSignal): Promise<Auction> {
  if (!token || /\s/.test(token)) throw new AuctionManagementError('Entre novamente para gerenciar leilões.', 401)
  if (id !== undefined && !validAuctionId(id)) throw new AuctionManagementError('Identificador de leilão inválido.', 400)
  if (signal.aborted) throw new DOMException('Operação cancelada', 'AbortError')
  const controller = new AbortController(), abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 12000)
  try {
    const response = await fetch(`${API_BASE_URL}/api/auctions${id ? `/${id}` : ''}${operation === 'cancel' ? '/cancel' : ''}`, {
      method: operation === 'create' ? 'POST' : 'PATCH', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      const message = response.status === 400 ? 'Confira os campos e as datas. Na edição, o início precisa estar no futuro e o término deve ser posterior ao início.'
        : response.status === 401 ? 'Sua sessão expirou. Entre novamente.'
          : response.status === 403 ? 'Operação não permitida. É necessário ser leiloeiro e responsável pelo leilão para alterá-lo ou cancelá-lo.'
            : response.status === 404 ? 'Leilão não encontrado. Atualize a listagem.'
              : response.status === 409 ? 'A operação foi bloqueada pelas regras de estado, prazo, compatibilidade do registro, vínculos ou alterações simultâneas. Atualize os dados antes de continuar.'
                : response.status === 429 ? 'Muitas tentativas. Aguarde antes de continuar.' : 'Não foi possível confirmar o resultado. Consulte a listagem antes de tentar novamente.'
      throw new AuctionManagementError(message, response.status, response.status >= 500)
    }
    const result: unknown = await response.json()
    if (!result || typeof result !== 'object' || !('auction' in result) || !isAuction(result.auction) || !validAuctionId(result.auction.id) || (id && result.auction.id !== id) || (operation === 'cancel' && result.auction.status !== 'CANCELLED')) throw new AuctionManagementError('A resposta não pôde ser validada. Consulte a listagem para verificar o resultado.', undefined, true)
    return result.auction
  } catch (error) {
    if (error instanceof AuctionManagementError) throw error
    throw new AuctionManagementError('Resultado não confirmado. Verifique sua conexão e consulte a listagem antes de repetir a operação.', undefined, true)
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
export const createAuction = (draft: AuctionDraft, token: string, signal: AbortSignal) => mutate('create', undefined, auctionInput(draft), token, signal)
export const updateAuction = (id: string, draft: AuctionDraft, token: string, signal: AbortSignal) => mutate('update', id, auctionInput(draft), token, signal)
export const cancelAuction = (id: string, token: string, signal: AbortSignal) => mutate('cancel', id, undefined, token, signal)
