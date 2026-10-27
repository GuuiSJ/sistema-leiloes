import { useId, type ChangeEvent, type FormEvent } from 'react'
import { type AuctionDraft, type AuctionFields } from '../../services/auction-management'
import { AuctionDateTimeField } from './AuctionDateTimeField'
import { adminButton, adminInput } from './AdminFeedback'

export function AuctionForm({ draft, errors, busy, blocked, editing, change, submit }: { draft: AuctionDraft; errors: AuctionFields; busy: boolean; blocked: boolean; editing: boolean; change: (field: keyof AuctionDraft, value: string) => void; submit: (event: FormEvent<HTMLFormElement>) => void }) {
  const prefix = useId()
  function field(name: keyof AuctionDraft, label: string, textarea = false) {
    if (name === 'startsAt' || name === 'endsAt') return <AuctionDateTimeField id={`${prefix}-${name}`} name={name} label={label} value={draft[name]} error={errors[name]} change={value => change(name, value)} />
    const id = `${prefix}-${name}`
    const props = { id, name, value: draft[name], onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => change(name, event.target.value), required: name !== 'description', maxLength: name === 'title' ? 150 : name === 'description' ? 10000 : 29, 'aria-invalid': !!errors[name], 'aria-describedby': `${id}-help`, className: `${adminInput} ${textarea ? 'min-h-28 py-3' : ''}` }
    return <div className="space-y-2"><label htmlFor={id} className="text-sm font-medium">{label}{name !== 'description' && ' *'}</label>{textarea ? <textarea {...props} rows={4} /> : <input {...props} type="text" />}<p id={`${id}-help`} className={`text-xs leading-5 ${errors[name] ? 'text-red-600 dark:text-red-300' : 'text-muted'}`}>{errors[name] ?? (name === 'title' ? 'Até 150 caracteres.' : 'Opcional, até 10.000 caracteres.')}</p></div>
  }
  return <form aria-label={editing ? 'Editar leilão' : 'Cadastrar leilão'} onSubmit={submit} noValidate className="rounded-2xl border border-line bg-surface p-5 sm:p-6"><fieldset disabled={busy || blocked} className="min-w-0 space-y-6 disabled:opacity-60"><legend className="mb-5 text-lg font-semibold">Dados do leilão</legend><p className="text-xs text-muted">* Campos obrigatórios. Revise o período antes de salvar.</p>{field('title', 'Título')}{field('description', 'Descrição', true)}<div className="grid gap-5 xl:grid-cols-2">{field('startsAt', 'Início do leilão')}{field('endsAt', 'Término do leilão')}</div><p className="text-xs leading-5 text-muted">{editing ? 'A edição depende das regras atuais verificadas pela plataforma.' : 'O leilão será cadastrado como rascunho.'}</p><button type="submit" className={`${adminButton} bg-accent text-white hover:bg-blue-700`}>{busy ? 'Salvando...' : editing ? 'Salvar alterações' : 'Cadastrar leilão'}</button></fieldset></form>
}
