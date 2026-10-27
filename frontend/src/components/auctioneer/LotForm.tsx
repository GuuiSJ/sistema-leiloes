import { useId, type FormEvent } from 'react'
import type { LotDraft, LotFields } from '../../services/lot-management'
import { lotMoney } from '../../services/lot-management'
import { formatMoney } from '../../services/formatters'
import { adminButton, adminInput } from './AdminFeedback'

export function LotForm({ draft, errors, busy, blocked, editing, change, submit }: { draft: LotDraft; errors: LotFields; busy: boolean; blocked: boolean; editing: boolean; change: (field: keyof LotDraft, value: string) => void; submit: (event: FormEvent<HTMLFormElement>) => void }) {
  const prefix = useId()
  const field = (name: 'number' | 'startingPrice' | 'minimumIncrement', label: string) => {
    const id = `${prefix}-${name}`, money = name !== 'number' ? lotMoney(draft[name]) : null
    return <div className="space-y-2"><label htmlFor={id} className="text-sm font-medium">{label} *</label><input id={id} name={name} value={draft[name]} onChange={event => change(name, event.target.value)} type="text" inputMode={name === 'number' ? 'numeric' : 'decimal'} required aria-invalid={!!errors[name]} aria-describedby={`${id}-help`} className={adminInput} /><p id={`${id}-help`} className={`text-xs leading-5 ${errors[name] ? 'text-red-600 dark:text-red-300' : 'text-muted'}`}>{errors[name] ?? (name === 'number' ? 'Inteiro positivo, até 2147483647.' : 'Valor positivo, sem separador de milhar. Ex.: 1500,50.')}</p>{money && <p className="text-xs text-muted">{formatMoney(money)}</p>}</div>
  }
  return <form aria-label={editing ? 'Editar lote' : 'Cadastrar lote'} noValidate onSubmit={submit} className="rounded-2xl border border-line bg-surface p-5 sm:p-6"><fieldset disabled={busy || blocked} className="min-w-0 space-y-6 disabled:opacity-60"><legend className="mb-5 text-lg font-semibold">Dados do lote</legend><p className="text-xs text-muted">* Campos obrigatórios. O veículo é escolhido na seleção acima.</p><div className="grid gap-5 sm:grid-cols-2">{field('number', 'Número do lote')}{field('startingPrice', 'Preço inicial (R$)')}{!editing && field('minimumIncrement', 'Incremento mínimo (R$)')}</div>{editing && <p className="text-sm text-muted">Incremento mínimo: <strong>{formatMoney(lotMoney(draft.minimumIncrement))}</strong>. Este valor não pode ser alterado na edição.</p>}<p className="text-xs leading-5 text-muted">O prazo do lote é definido pela plataforma e apresentado conforme retornado pela API.</p><button type="submit" className={`${adminButton} bg-accent text-white hover:bg-blue-700`}>{busy ? 'Salvando...' : editing ? 'Salvar alterações' : 'Cadastrar lote'}</button></fieldset></form>
}
