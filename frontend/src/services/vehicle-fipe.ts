import type { FipeDetails } from './fipe'
import { validateVehicle, vehicleDraft, type VehicleDraft } from './vehicles'

export interface FipeSelection { brand: string; model: string; year: string }
export const emptyFipeSelection: FipeSelection = { brand: '', model: '', year: '' }
export function selectFipe(current: FipeSelection, field: keyof FipeSelection, value: string): FipeSelection {
  if (field === 'brand') return { brand: value, model: '', year: '' }
  if (field === 'model') return { ...current, model: value, year: '' }
  return { ...current, year: value }
}

// Only fields supplied by the existing FIPE contract are applied. In particular,
// modelo may contain trim information, but it is not a separate version field.
export function fipeVehicleValues(details: FipeDetails, selection: FipeSelection): Partial<VehicleDraft> | null {
  if (!selection.brand || !selection.model || !selection.year || Number(selection.year.split('-')[0]) !== details.year) return null
  const values = {
    brand: details.brand, model: details.model, year: String(details.year),
    fipeReferencePrice: details.price.replace('.', ','), fipeCode: details.fipeCode,
    fipeReferenceMonth: details.month, fipeBrandCode: selection.brand,
    fipeModelCode: selection.model, fipeYearCode: selection.year,
  }
  return Object.keys(validateVehicle({ ...vehicleDraft(), ...values })).length ? null : values
}
