import { useId, type FormEvent } from 'react'
import type { VehicleDraft, VehicleFields } from '../../services/vehicles'
import { adminButton, adminInput } from './AdminFeedback'

export function VehicleForm({ draft, errors, busy, blocked, editing, change, submit }: { draft: VehicleDraft; errors: VehicleFields; busy: boolean; blocked: boolean; editing: boolean; change: (field: keyof VehicleDraft, value: string) => void; submit: (event: FormEvent<HTMLFormElement>) => void }) {
  const prefix = useId()
  function field(name: keyof VehicleDraft, label: string, options: { max?: number; required?: boolean; multiline?: boolean; type?: string; hint?: string } = {}) {
    const id = `${prefix}-${name}`, error = errors[name]
    const props = { id, name, value: draft[name], onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(name, event.target.value), required: options.required, maxLength: options.max, 'aria-invalid': !!error, 'aria-describedby': `${id}-help`, className: `${adminInput} ${options.multiline ? 'min-h-28 py-3' : ''}` }
    return <div className="space-y-2"><label htmlFor={id} className="text-sm font-medium">{label}{options.required ? ' *' : ''}</label>{options.multiline ? <textarea {...props} rows={4} /> : <input {...props} type={options.type ?? 'text'} {...(name === 'year' ? { min: 1886, max: new Date().getUTCFullYear() + 1, step: 1 } : {})} {...(name === 'fipeReferencePrice' ? { inputMode: 'decimal' } : {})} />}<p id={`${id}-help`} className={`text-xs leading-5 ${error ? 'text-red-600 dark:text-red-300' : 'text-muted'}`}>{error ?? options.hint}</p></div>
  }
  return <form aria-label={editing ? 'Editar veículo' : 'Cadastrar veículo'} onSubmit={submit} noValidate className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
    <fieldset disabled={busy || blocked} className="min-w-0 space-y-6 disabled:opacity-60"><legend className="mb-5 text-lg font-semibold">Dados do veículo</legend><p className="text-xs text-muted">* Campos obrigatórios</p>
      <div className="grid gap-5 sm:grid-cols-2">{field('brand', 'Marca', { required: true, max: 100 })}{field('model', 'Modelo', { required: true, max: 150 })}{field('year', 'Ano', { required: true, type: 'number' })}{field('version', 'Versão', { max: 150 })}</div>
      {field('description', 'Descrição', { multiline: true, max: 10000 })}
      {field('imageUrls', 'URLs das imagens', { multiline: true, hint: 'Até 20 URLs HTTP(S), uma por linha. Não há envio de arquivos nesta etapa.' })}
      <div className="border-t border-line pt-5"><h3 className="mb-4 font-medium">Referência FIPE</h3><p className="mb-5 text-xs leading-5 text-muted">O preço será salvo como referência não verificada, conforme o contrato da plataforma.</p><div className="grid gap-5 sm:grid-cols-2">{field('fipeReferencePrice', 'Preço de referência (R$)', { hint: 'Ex.: 95000,50. Sem separador de milhar.' })}{field('fipeCode', 'Código FIPE', { max: 30 })}{field('fipeReferenceMonth', 'Mês de referência', { max: 50 })}</div>
        <details className="mt-5"><summary className="cursor-pointer text-sm text-muted">Códigos de referência FIPE</summary><div className="mt-4 grid gap-4 sm:grid-cols-3">{field('fipeBrandCode', 'Código da marca', { max: 30 })}{field('fipeModelCode', 'Código do modelo', { max: 30 })}{field('fipeYearCode', 'Código do ano / combustível', { max: 30 })}</div></details>
      </div>
      <button type="submit" className={`${adminButton} bg-accent text-white hover:bg-blue-700`}>{busy ? 'Salvando...' : editing ? 'Salvar alterações' : 'Cadastrar veículo'}</button>
    </fieldset>
  </form>
}
