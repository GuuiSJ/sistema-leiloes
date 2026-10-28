import { ApiError, getJson } from './api'

export interface FipeOption { label: string; code: string }
export interface FipeDetails { brand: string; model: string; year: number; price: string; fipeCode: string; month: string }
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const text = (v: unknown): v is string => typeof v === 'string' && !!v.trim()
const code = (v: string) => /^[1-9]\d*$/.test(v) && Number.isSafeInteger(Number(v))
const yearCode = (v: string) => /^\d{4,5}-[1-9]\d{0,2}$/.test(v)
function invalid(): never { throw new ApiError('A consulta FIPE retornou dados inválidos. Você pode preencher o veículo manualmente.') }
async function fipeJson(path: string, signal: AbortSignal): Promise<unknown> {
  try { return await getJson(`/api/fipe/${path}`, signal) }
  catch (error) {
    if (signal.aborted) throw error
    const status = error instanceof ApiError ? error.status : undefined
    const message = status === 502
      ? 'A consulta FIPE retornou dados inválidos ou incompletos. Nenhum dado foi aplicado. Tente novamente ou preencha o veículo manualmente.'
      : status === 404
        ? 'Referência FIPE não encontrada para esta seleção. Nenhum dado foi aplicado. Escolha outra referência ou preencha manualmente.'
        : status === 504
          ? 'A consulta FIPE excedeu o tempo limite. Nenhum dado foi aplicado. Tente novamente ou preencha manualmente.'
          : 'Não foi possível consultar a FIPE. Nenhum dado foi aplicado. Tente novamente ou preencha o veículo manualmente.'
    throw new ApiError(message, status)
  }
}
export function fipeMoney(value: string): string {
  const match = /^R\$\s*((?:\d{1,3}(?:\.\d{3})+)|\d+),(\d{2})$/.exec(value)
  if (!match) return invalid()
  const whole = match[1]!.replaceAll('.', '').replace(/^0+(?=\d)/, '')
  if (whole.length > 16) return invalid()
  return `${whole}.${match[2]}`
}
async function options(path: string, name: 'nome' | 'modelo', year: boolean, signal: AbortSignal): Promise<FipeOption[]> {
  const result = await fipeJson(path, signal)
  if (!Array.isArray(result)) return invalid()
  return result.map(item => {
    if (!record(item) || !text(item[name]) || !text(item.valor) || !(year ? yearCode(item.valor) : code(item.valor))) return invalid()
    return { label: item[name], code: item.valor }
  })
}
export const getFipeBrands = (signal: AbortSignal) => options('marcas/carros', 'nome', false, signal)
export function getFipeModels(brand: string, signal: AbortSignal) {
  if (!code(brand)) return Promise.reject(new ApiError('Selecione uma marca FIPE válida.'))
  return options(`modelos/carros/${brand}`, 'modelo', false, signal)
}
export function getFipeYears(brand: string, model: string, signal: AbortSignal) {
  if (!code(brand) || !code(model)) return Promise.reject(new ApiError('Selecione um modelo FIPE válido.'))
  return options(`anos/carros/${brand}/${model}`, 'nome', true, signal)
}
export async function getFipeDetails(brand: string, model: string, year: string, signal: AbortSignal): Promise<FipeDetails> {
  if (!code(brand) || !code(model) || !yearCode(year)) throw new ApiError('Selecione marca, modelo e ano FIPE válidos.')
  const v = await fipeJson(`detalhes/carros/${brand}/${model}/${year}`, signal)
  if (!record(v) || !text(v.marca) || !text(v.modelo) || !Number.isSafeInteger(v.anoModelo) || Number(v.anoModelo) !== Number(year.split('-')[0]) || v.tipoVeiculo !== 1 || !text(v.codigoFipe) || !/^\d{6}-\d$/.test(v.codigoFipe) || !text(v.mesReferencia) || !text(v.valor)) return invalid()
  return { brand: v.marca, model: v.modelo, year: Number(v.anoModelo), price: fipeMoney(v.valor), fipeCode: v.codigoFipe, month: v.mesReferencia }
}
