import { useState } from 'react'
import { usePublicResource } from '../../hooks/usePublicResource'
import { getFipeBrands, getFipeModels, getFipeYears, getFipeDetails, type FipeOption } from '../../services/fipe'
import type { VehicleDraft } from '../../services/vehicles'
import { formatMoney } from '../../services/formatters'
import { adminButton, adminInput } from './AdminFeedback'

export function VehicleFipe({ disabled, apply }: { disabled: boolean; apply: (values: Partial<VehicleDraft>) => void }) {
  const [enabled, setEnabled] = useState(false), [brand, setBrand] = useState(''), [model, setModel] = useState(''), [year, setYear] = useState('')
  const brands = usePublicResource('fipe:brands', getFipeBrands, enabled)
  const models = usePublicResource(`fipe:models:${brand}`, signal => getFipeModels(brand, signal), enabled && !!brand)
  const years = usePublicResource(`fipe:years:${brand}:${model}`, signal => getFipeYears(brand, model, signal), enabled && !!model)
  const details = usePublicResource(`fipe:details:${brand}:${model}:${year}`, signal => getFipeDetails(brand, model, year, signal), enabled && !!year)
  const validYear = details.data && details.data.year >= 1886 && details.data.year <= new Date().getUTCFullYear() + 1
  const select = (label: string, value: string, data: FipeOption[] | null, loading: boolean, blocked: boolean, change: (value: string) => void) => <label className="space-y-2 text-sm font-medium">{label}<select className={adminInput} value={value} disabled={disabled || loading || blocked} onChange={event => change(event.target.value)}><option value="">{loading ? 'Consultando...' : 'Selecione'}</option>{data?.map(item => <option value={item.code} key={item.code}>{item.label}</option>)}</select></label>
  return <section aria-label="Preenchimento pela FIPE" className="mb-6 rounded-2xl border border-line bg-surface p-5 sm:p-6">
    <h3 className="font-semibold">Preencher com a FIPE</h3><p className="mt-2 text-sm leading-6 text-muted">Opcional. Selecione a referência e revise os dados antes de salvar. O cadastro também pode ser preenchido manualmente.</p>
    {!enabled ? <button type="button" disabled={disabled} className={`${adminButton} mt-4`} onClick={() => setEnabled(true)}>Consultar FIPE</button> : <>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">{select('Marca FIPE', brand, brands.data, brands.loading, false, value => { setBrand(value); setModel(''); setYear('') })}{select('Modelo FIPE', model, models.data, models.loading, !brand, value => { setModel(value); setYear('') })}{select('Ano / combustível FIPE', year, years.data, years.loading, !model, setYear)}</div>
      {[brands, models, years, details].map((resource, index) => resource.error && <div key={index} role="alert" className="mt-4 text-sm"><p>{resource.error.message}</p><button type="button" disabled={disabled} className={adminButton} onClick={resource.retry}>Repetir consulta FIPE</button></div>)}
      {enabled && !brands.loading && brands.data?.length === 0 && <p role="status" className="mt-4 text-sm text-muted">Nenhuma marca FIPE disponível.</p>}
      {brand && !models.loading && models.data?.length === 0 && <p role="status" className="mt-4 text-sm text-muted">Nenhum modelo FIPE disponível.</p>}
      {model && !years.loading && years.data?.length === 0 && <p role="status" className="mt-4 text-sm text-muted">Nenhum ano FIPE disponível.</p>}
      {details.loading && <p role="status" className="mt-4 text-sm text-muted">Consultando referência FIPE...</p>}
      {details.data && year && <div className="mt-4 border-t border-line pt-4 text-sm"><p className="font-medium">{details.data.brand} {details.data.model} · {details.data.year} · {formatMoney(details.data.price)}</p><p className="mt-2 text-muted">{details.data.month} · Código {details.data.fipeCode}</p>{!validYear && <p role="status" className="mt-2">Esta referência usa um ano especial da FIPE, incompatível com o cadastro. Preencha o ano e os dados manualmente.</p>}<button type="button" disabled={disabled || !validYear} className={`${adminButton} mt-4`} onClick={() => { if (details.data && validYear) apply({ brand: details.data.brand, model: details.data.model, year: String(details.data.year), fipeReferencePrice: details.data.price.replace('.', ','), fipeCode: details.data.fipeCode, fipeReferenceMonth: details.data.month, fipeBrandCode: brand, fipeModelCode: model, fipeYearCode: year }) }}>Usar esta referência no formulário</button></div>}
    </>}
  </section>
}
