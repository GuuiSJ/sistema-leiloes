import { API_BASE_URL, ApiError, getJson } from './api'
import { AuthError } from './auth'
import { isVehicle, type Vehicle } from './auctions'
import { validPhotoUrl } from './formatters'

export const vehicleTextLimits = { brand: 100, model: 150, version: 150, description: 10000, fipeCode: 30, fipeBrandCode: 30, fipeModelCode: 30, fipeYearCode: 30, fipeReferenceMonth: 50 } as const
export type VehicleDraft = Record<keyof typeof vehicleTextLimits | 'year' | 'imageUrls' | 'fipeReferencePrice', string>
export type VehicleInput = { brand: string; model: string; year: number; imageUrls: string[]; fipeReferencePrice: string | null } & Record<Exclude<keyof typeof vehicleTextLimits, 'brand' | 'model'>, string | null>
export type VehicleFields = Partial<Record<keyof VehicleDraft, string>>
export class VehicleError extends AuthError {
  constructor(message: string, status?: number, readonly uncertain = false) { super(message, status) }
}
export const validVehicleId = (id: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)
export function vehicleDraft(vehicle?: Vehicle): VehicleDraft {
  return { brand: vehicle?.brand ?? '', model: vehicle?.model ?? '', year: vehicle ? String(vehicle.year) : '', version: vehicle?.version ?? '', description: vehicle?.description ?? '', imageUrls: vehicle?.imageUrls.join('\n') ?? '', fipeCode: vehicle?.fipeCode ?? '', fipeBrandCode: vehicle?.fipeBrandCode ?? '', fipeModelCode: vehicle?.fipeModelCode ?? '', fipeYearCode: vehicle?.fipeYearCode ?? '', fipeReferenceMonth: vehicle?.fipeReferenceMonth ?? '', fipeReferencePrice: vehicle?.fipeReferencePrice?.replace('.', ',') ?? '' }
}
export function validateVehicle(draft: VehicleDraft): VehicleFields {
  const errors: VehicleFields = {}
  for (const [field, max] of Object.entries(vehicleTextLimits) as [keyof typeof vehicleTextLimits, number][]) {
    const value = draft[field].trim()
    if ((['brand', 'model'].includes(field) && !value) || value.length > max || value.includes('\0')) errors[field] = `Informe ${field === 'brand' ? 'a marca' : field === 'model' ? 'o modelo' : 'um texto'} com até ${max} caracteres.`
  }
  if (!/^\d{4}$/.test(draft.year) || Number(draft.year) < 1886 || Number(draft.year) > new Date().getUTCFullYear() + 1) errors.year = 'Informe um ano entre 1886 e o próximo ano.'
  const urls = draft.imageUrls.split(/\r?\n/).map(value => value.trim()).filter(Boolean)
  if (urls.length > 20 || urls.some(value => value.length > 2048 || value.includes('\0') || !validPhotoUrl(value))) errors.imageUrls = 'Use até 20 URLs HTTP(S), uma por linha, sem credenciais e com até 2048 caracteres cada.'
  if (draft.fipeReferencePrice.trim() && !/^(0|[1-9]\d{0,15})([.,]\d{1,2})?$/.test(draft.fipeReferencePrice.trim())) errors.fipeReferencePrice = 'Informe um valor não negativo, sem separador de milhar, com até 16 inteiros e duas casas decimais.'
  return errors
}
export function vehicleInput(draft: VehicleDraft): VehicleInput {
  if (Object.keys(validateVehicle(draft)).length) throw new VehicleError('Confira os campos destacados.', 400)
  const result = {} as VehicleInput
  for (const field of Object.keys(vehicleTextLimits) as (keyof typeof vehicleTextLimits)[]) Object.assign(result, { [field]: draft[field].trim() || null })
  return { ...result, year: Number(draft.year), imageUrls: draft.imageUrls.split(/\r?\n/).map(value => value.trim()).filter(Boolean), fipeReferencePrice: draft.fipeReferencePrice.trim().replace(',', '.') || null }
}
export async function getVehicle(id: string, signal: AbortSignal): Promise<Vehicle> {
  if (!validVehicleId(id)) throw new ApiError('Identificador de veículo inválido.', 400)
  const result = await getJson(`/api/vehicles/${id}`, signal)
  if (!result || typeof result !== 'object' || !('vehicle' in result) || !isVehicle(result.vehicle) || result.vehicle.id !== id) throw new ApiError('Dados do veículo em formato inesperado.')
  return result.vehicle
}
async function mutate(method: 'POST' | 'PATCH' | 'DELETE', id: string | undefined, body: object | undefined, token: string, signal: AbortSignal): Promise<Vehicle | null> {
  if (!token || /\s/.test(token)) throw new VehicleError('Entre novamente para gerenciar veículos.', 401)
  if (id !== undefined && !validVehicleId(id)) throw new VehicleError('Identificador de veículo inválido.', 400)
  const controller = new AbortController(), abort = () => controller.abort()
  if (signal.aborted) { throw new DOMException('Operação cancelada', 'AbortError') }
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 12000)
  try {
    const response = await fetch(`${API_BASE_URL}/api/vehicles${id ? `/${id}` : ''}`, {
      method, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      const message = response.status === 400 ? 'Confira os dados do veículo. Há campos inválidos.'
        : response.status === 401 ? 'Sua sessão expirou. Entre novamente.'
          : response.status === 403 ? 'Operação não permitida. É necessário ser leiloeiro e proprietário do veículo para alterá-lo ou excluí-lo.'
            : response.status === 404 ? 'Veículo não encontrado. Atualize a listagem.'
              : response.status === 409 ? 'O veículo possui vínculos, histórico ou estado que impedem esta operação. Atualize os dados antes de continuar.'
                : response.status === 429 ? 'Muitas tentativas. Aguarde antes de continuar.' : 'Não foi possível confirmar o resultado. Consulte a listagem antes de tentar novamente.'
      throw new VehicleError(message, response.status, response.status >= 500)
    }
    if (method === 'DELETE') {
      if (response.status === 204) return null
      throw new VehicleError('A resposta da exclusão não pôde ser validada. Consulte a listagem para verificar o resultado.', undefined, true)
    }
    const result: unknown = await response.json()
    if (!result || typeof result !== 'object' || !('vehicle' in result) || !isVehicle(result.vehicle) || !validVehicleId(result.vehicle.id) || (id && result.vehicle.id !== id)) throw new VehicleError('A resposta não pôde ser validada. Consulte a listagem para verificar o resultado.', undefined, true)
    return result.vehicle
  } catch (error) {
    if (error instanceof VehicleError) throw error
    throw new VehicleError('Resultado não confirmado. Verifique sua conexão e consulte a listagem antes de repetir a operação.', undefined, true)
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
export const createVehicle = (draft: VehicleDraft, token: string, signal: AbortSignal) => mutate('POST', undefined, vehicleInput(draft), token, signal)
export const updateVehicle = (id: string, draft: VehicleDraft, token: string, signal: AbortSignal) => mutate('PATCH', id, vehicleInput(draft), token, signal)
export const deleteVehicle = (id: string, token: string, signal: AbortSignal) => mutate('DELETE', id, undefined, token, signal)
