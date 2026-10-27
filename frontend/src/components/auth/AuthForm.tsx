import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Eye, EyeOff, LoaderCircle } from 'lucide-react'
import { Link, useNavigate } from 'react-router'
import { AuthError, authApi, validateAuthFields, type AuthFields } from '../../services/auth'
import { safeReturnPath } from '../../services/auth-session'
import { useAuth } from '../../hooks/useAuth'

export function AuthForm({ register = false, destination }: { register?: boolean; destination?: unknown }) {
  const auth = useAuth(), navigate = useNavigate()
  const [fields, setFields] = useState({ name: '', email: '', password: '', confirmation: '' })
  const [errors, setErrors] = useState<AuthFields>({})
  const [failure, setFailure] = useState<string | null>(null)
  const [busy, setBusy] = useState(false), [visible, setVisible] = useState(false)
  const request = useRef<AbortController | null>(null), form = useRef<HTMLFormElement>(null)
  useEffect(() => () => request.current?.abort(), [])
  function update(key: keyof typeof fields, value: string) {
    setFields(previous => ({ ...previous, [key]: value }))
    setErrors(previous => ({ ...previous, [key]: undefined })); setFailure(null)
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy) return
    const validation = validateAuthFields(fields, register)
    setErrors(validation); setFailure(null)
    if (Object.keys(validation).length) {
      form.current?.querySelector<HTMLInputElement>(`[name="${Object.keys(validation)[0]}"]`)?.focus()
      return
    }
    const controller = new AbortController()
    request.current?.abort(); request.current = controller; setBusy(true)
    try {
      if (register) {
        await authApi.register({ name: fields.name, email: fields.email, password: fields.password }, controller.signal)
        if (!controller.signal.aborted) navigate('/entrar', { replace: true, state: { registered: true } })
      } else {
        await auth.login({ email: fields.email, password: fields.password }, controller.signal)
        if (!controller.signal.aborted) navigate(safeReturnPath(destination), { replace: true })
      }
    } catch (error) {
      if (!controller.signal.aborted) {
        setFailure(error instanceof AuthError ? error.message : 'Não foi possível concluir o acesso. Tente novamente.')
        setFields(previous => ({ ...previous, password: '', confirmation: '' }))
      }
    } finally { if (!controller.signal.aborted) setBusy(false) }
  }
  const inputClass = 'mt-2 min-h-12 w-full rounded-lg border border-line bg-canvas px-4 text-sm text-ink placeholder:text-muted focus:border-accent'
  const feedback = (key: keyof AuthFields) => errors[key] ? <p id={`${key}-error`} className="mt-2 text-xs leading-5 text-red-700 dark:text-red-300">{errors[key]}</p> : null
  return <form ref={form} onSubmit={submit} noValidate aria-busy={busy} className="mt-7">
    {failure && <p role="alert" className="mb-5 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200">{failure}</p>}
    <fieldset disabled={busy} className="space-y-5 disabled:opacity-70">
      <legend className="sr-only">{register ? 'Dados para cadastro' : 'Dados de acesso'}</legend>
      {register && <div><label htmlFor="name" className="text-sm font-medium">Nome</label><input id="name" name="name" type="text" autoComplete="name" required minLength={2} maxLength={120} value={fields.name} onChange={e => update('name', e.target.value)} aria-invalid={!!errors.name} aria-describedby={errors.name ? 'name-error' : undefined} className={inputClass} />{feedback('name')}</div>}
      <div><label htmlFor="email" className="text-sm font-medium">E-mail</label><input id="email" name="email" type="email" autoComplete={register ? 'email' : 'username'} autoCapitalize="none" spellCheck={false} required maxLength={254} value={fields.email} onChange={e => update('email', e.target.value)} aria-invalid={!!errors.email} aria-describedby={errors.email ? 'email-error' : undefined} className={inputClass} />{feedback('email')}</div>
      <div><label htmlFor="password" className="text-sm font-medium">Senha</label><div className="relative"><input id="password" name="password" type={visible ? 'text' : 'password'} autoComplete={register ? 'new-password' : 'current-password'} required value={fields.password} onChange={e => update('password', e.target.value)} aria-invalid={!!errors.password} aria-describedby={`${register ? 'password-help ' : ''}${errors.password ? 'password-error' : ''}`.trim() || undefined} className={`${inputClass} pr-14`} />
        <button type="button" onClick={() => setVisible(value => !value)} aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={visible} className="absolute right-1 bottom-0 flex size-12 items-center justify-center rounded-lg text-muted hover:text-ink">{visible ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}</button></div>
        {register && <p id="password-help" className="mt-2 text-xs leading-5 text-muted">Mínimo de 8 caracteres e máximo de 72 bytes. Acentos e emojis podem ocupar mais de um byte.</p>}{feedback('password')}</div>
      {register && <div><label htmlFor="confirmation" className="text-sm font-medium">Confirmar senha</label><input id="confirmation" name="confirmation" type={visible ? 'text' : 'password'} autoComplete="new-password" required value={fields.confirmation} onChange={e => update('confirmation', e.target.value)} aria-invalid={!!errors.confirmation} aria-describedby={errors.confirmation ? 'confirmation-error' : undefined} className={inputClass} />{feedback('confirmation')}</div>}
      <button type="submit" className="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg bg-accent px-5 text-sm font-semibold text-white transition-colors hover:bg-blue-700 disabled:cursor-wait">
        {busy && <LoaderCircle size={18} className="animate-spin" aria-hidden="true" />}{busy ? register ? 'Criando cadastro...' : 'Verificando acesso...' : register ? 'Criar minha conta' : 'Entrar'}
      </button>
    </fieldset>
    <p className="mt-6 text-center text-sm text-muted">{register ? 'Já tem uma conta?' : 'Ainda não tem uma conta?'}{' '}<Link to={register ? '/entrar' : '/cadastro'} className="rounded-sm font-medium text-accent underline-offset-4 hover:underline dark:text-blue-300">{register ? 'Entrar' : 'Cadastre-se'}</Link></p>
  </form>
}
