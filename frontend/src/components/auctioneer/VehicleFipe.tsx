import { useReducer, useState } from 'react'
import { usePublicResource } from '../../hooks/usePublicResource'
import { getFipeBrands, getFipeModels, getFipeYears, getFipeDetails, type FipeOption } from '../../services/fipe'
import type { VehicleDraft } from '../../services/vehicles'
import { formatMoney } from '../../services/formatters'
import { adminButton, adminInput } from './AdminFeedback'
import { emptyFipeSelection, selectFipe, fipeVehicleValues } from '../../services/vehicle-fipe'

export function VehicleFipe({ disabled, apply }: { disabled: boolean; apply: (values: Partial<VehicleDraft>) => void }) {
  const [enabled, setEnabled] = useState(false)
  const [selection, dispatch] = useReducer((current: typeof emptyFipeSelection, action: { field: keyof typeof emptyFipeSelection; value: string }) => selectFipe(current, action.field, action.value), emptyFipeSelection)
  const { brand, model, year } = selection
  const brands = usePublicResource('fipe:brands', getFipeBrands, enabled)
  const models = usePublicResource(`fipe:models:${brand}`, signal => getFipeModels(brand, signal), enabled && !!brand)
  const years = usePublicResource(`fipe:years:${brand}:${model}`, signal => getFipeYears(brand, model, signal), enabled && !!model)
  const details = usePublicResource(`fipe:details:${brand}:${model}:${year}`, signal => getFipeDetails(brand, model, year, signal), enabled && !!year)
  const values = details.data && !details.loading && !details.error ? fipeVehicleValues(details.data, selection) : null
  const validYear = details.data && details.data.year >= 1886 && details.data.year <= new Date().getUTCFullYear() + 1
  const select = (label: string, value: string, data: FipeOption[] | null, loading: boolean, blocked: boolean, change: (value: string) => void) => <label className="space-y-2 text-sm font-medium">{label}<select className={adminInput} value={value} disabled={disabled || loading || blocked} onChange={event => change(event.target.value)}><option value="">{loading ? 'Consultando...' : 'Selecione'}</option>{data?.map(item => <option value={item.code} key={item.code}>{item.label}</option>)}</select></label>
  return <section aria-label="Preenchimento pela FIPE" className="mb-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
    <h3 className="font-semibold">Preencher com a FIPE</h3><p className="mt-2 text-sm leading-6 text-muted">Selecione marca, modelo e ano e clique em “Usar dados deste veículo”. Depois, confira os dados abaixo. A consulta é opcional: se estiver indisponível, preencha manualmente. O preço FIPE é uma referência, sem garantia de valor de mercado.</p>
    {!enabled ? <button type="button" disabled={disabled} className={`${adminButton} mt-4`} onClick={() => setEnabled(true)}>Consultar FIPE</button> : <>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">{select('Marca FIPE', brand, brands.data, brands.loading, false, value => dispatch({ field: 'brand', value }))}{select('Modelo FIPE', model, models.data, models.loading, !brand, value => dispatch({ field: 'model', value }))}{select('Ano / combustível FIPE', year, years.data, years.loading, !model, value => dispatch({ field: 'year', value }))}</div>
      {[brands, models, years, details].map((resource, index) => resource.error && <div key={index} role="alert" className="mt-4 text-sm"><p>{resource.error.message}</p><button type="button" disabled={disabled} className={adminButton} onClick={resource.retry}>Repetir consulta FIPE</button></div>)}
      {enabled && !brands.loading && brands.data?.length === 0 && <p role="status" className="mt-4 text-sm text-muted">Nenhuma marca FIPE disponível.</p>}
      {brand && !models.loading && models.data?.length === 0 && <p role="status" className="mt-4 text-sm text-muted">Nenhum modelo FIPE disponível.</p>}
      {model && !years.loading && years.data?.length === 0 && <p role="status" className="mt-4 text-sm text-muted">Nenhum ano FIPE disponível.</p>}
      {details.loading && <p role="status" className="mt-4 text-sm text-muted">Consultando referência FIPE...</p>}
      {details.data && year && <div className="mt-4 border-t border-line pt-4 text-sm"><p className="font-medium">{details.data.brand} {details.data.model} · {details.data.year} · {formatMoney(details.data.price)}</p><p className="mt-2 text-muted">{details.data.month} · Código {details.data.fipeCode}</p>{!validYear && <p role="status" className="mt-2">Esta referência usa um ano especial da FIPE, incompatível com o cadastro. Preencha o ano e os dados manualmente.</p>}{validYear && !values && <p role="alert" className="mt-2">Os dados FIPE excedem os limites do cadastro. Preencha os campos manualmente.</p>}<button type="button" disabled={disabled || !values} className={`${adminButton} mt-4`} onClick={() => { if (values) apply(values) }}>Usar dados deste veículo</button></div>}
    </>}
  </section>
}
