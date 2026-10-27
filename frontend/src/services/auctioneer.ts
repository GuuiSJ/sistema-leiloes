import { ApiError } from './api'
import { getPage, isVehicle, listAuctions } from './auctions'

export interface VehicleFilters { brand?: string; model?: string; year?: string }
export function listVehicles(page: number, filters: VehicleFilters, signal: AbortSignal, limit = 10) {
  const query = new URLSearchParams({ page: String(page), limit: String(limit) })
  for (const key of ['brand', 'model', 'year'] as const) {
    const value = filters[key]?.trim()
    if (value) query.set(key, value)
  }
  return getPage(`/api/vehicles?${query}`, isVehicle, signal)
}

export async function getOverview(signal: AbortSignal) {
  const [vehicles, auctions, open, scheduled] = await Promise.all([
    listVehicles(1, {}, signal, 1), listAuctions(1, 1, signal),
    listAuctions(1, 1, signal, 'OPEN'), listAuctions(1, 1, signal, 'SCHEDULED'),
  ])
  return { vehicles: vehicles.pagination.total, auctions: auctions.pagination.total,
    open: open.pagination.total, scheduled: scheduled.pagination.total }
}

export function consultationError(error: ApiError): string {
  if (error.status === 401) return 'Sua sessão precisa ser verificada. Entre novamente ou verifique sua sessão.'
  if (error.status === 403) return 'A consulta não foi permitida para seu acesso.'
  if (error.status === 404) return 'O registro consultado não foi encontrado.'
  return error.message
}
