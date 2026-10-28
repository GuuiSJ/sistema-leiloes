import { useEffect, useId, useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { formatMoney } from '../../services/formatters'
import { clearPendingCredit, createWalletCreditAttempt, localCreditAllowed, parseCreditAmount, readPendingCredit, savePendingCredit, WalletCreditError, type PendingCredit } from '../../services/wallet-credit'

export function WalletCredit({ disabled, onSuccess }: { disabled: boolean; onSuccess: () => void }) {
  const auth = useAuth(), id = useId()
  const [open, setOpen] = useState(false), [value, setValue] = useState(''), [confirmedAmount, setConfirmedAmount] = useState<string | null>(null), [pending, setPending] = useState<PendingCredit | null>(null)
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [unavailable, setUnavailable] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('')
  const active = useRef(true), sending = useRef(false), request = useRef<AbortController | null>(null), attempt = useRef<PendingCredit | null>(null)
  const allowed = localCreditAllowed() && auth.status === 'authenticated' && auth.user?.role === 'BIDDER'
  useEffect(() => { active.current = true; return () => { active.current = false; request.current?.abort() } }, [])
  useEffect(() => {
    if (!allowed || !auth.user) return
    try {
      const previous = readPendingCredit(auth.user.id)
      if (previous) { attempt.current = previous; setPending(previous); setConfirmedAmount(previous.amount); setOpen(true); setMessage('Existe uma tentativa pendente. Nenhum crédito será reenviado automaticamente; repita somente a mesma operação.') }
      setReady(true)
    } catch { setError('Não foi possível verificar tentativas anteriores. Consulte o histórico; o envio está bloqueado neste navegador.') }
  }, [allowed, auth.user?.id])
  if (auth.status !== 'authenticated' || auth.user?.role !== 'BIDDER') return null
  if (!allowed) return <p className="text-sm leading-6 text-muted">Crédito de demonstração indisponível neste ambiente. Não há depósitos reais.</p>
  async function credit() {
    if (sending.current || !ready || unavailable || !confirmedAmount || !auth.user) return
    sending.current = true; setBusy(true); setError(''); setMessage('')
    const controller = new AbortController(); request.current = controller
    try {
      if (!attempt.current) {
        const next = { amount: confirmedAmount, key: crypto.randomUUID() }
        // Persist before POST. A storage failure must prevent the operation entirely.
        try { savePendingCredit(auth.user.id, next) } catch { setReady(false); throw new WalletCreditError('Não foi possível guardar a tentativa com segurança. Nenhum crédito foi enviado.') }
        attempt.current = next; setPending(next)
      }
      await auth.withSession(createWalletCreditAttempt(attempt.current), controller.signal)
      if (!active.current) return
      try { clearPendingCredit(auth.user.id) } catch { setReady(false); setError('Crédito confirmado, mas não foi possível limpar a tentativa neste navegador. Novas operações estão bloqueadas.') }
      attempt.current = null; setPending(null); setConfirmedAmount(null); setValue(''); setOpen(false)
      setMessage('Saldo de demonstração adicionado com sucesso. Não possui valor monetário real.'); onSuccess()
    } catch (failure) {
      if (!active.current) return
      const problem = failure instanceof WalletCreditError ? failure : new WalletCreditError('Resultado não confirmado. Preserve a mesma tentativa para repetir com segurança.', undefined, true)
      setError(problem.message); if (problem.unavailable) setUnavailable(true)
      if (!problem.retrySameKey && attempt.current) {
        try { clearPendingCredit(auth.user!.id); attempt.current = null; setPending(null); setConfirmedAmount(null) } catch { setReady(false) }
      }
    } finally { sending.current = false; if (active.current) setBusy(false) }
  }
  return <section aria-label="Adicionar saldo de demonstração" className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
    <h3 className="text-lg font-semibold">Saldo de demonstração</h3><p className="mt-3 text-sm leading-6 text-muted">Créditos simulados para testes locais. Sem depósito, cobrança ou valor monetário real. A disponibilidade depende da autorização do backend.</p>
    {message && <p role="status" className="mt-4 text-sm">{message}</p>}{error && <p role="alert" className="mt-4 text-sm text-red-700 dark:text-red-300">{error}</p>}
    {!open ? <button type="button" disabled={disabled || !ready || unavailable} onClick={() => { setOpen(true); setError(''); setMessage('') }} className="mt-5 min-h-12 rounded-lg bg-accent px-5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">Adicionar saldo</button> : confirmedAmount ? <div role="alertdialog" aria-labelledby={`${id}-confirm`} className="mt-5 rounded-xl border border-line bg-canvas p-5"><h4 id={`${id}-confirm`} className="font-semibold">Confirmar crédito simulado de {formatMoney(confirmedAmount)}?</h4><p className="mt-3 text-sm text-muted">{pending ? 'Repetir esta tentativa usa o mesmo valor e a mesma chave para evitar duplicidade.' : 'O valor será adicionado somente à carteira virtual de demonstração.'}</p><div className="mt-5 flex flex-wrap gap-3">{!pending && <button type="button" disabled={busy} className="min-h-11 rounded-lg border border-line px-4 text-sm" onClick={() => setConfirmedAmount(null)}>Voltar</button>}<button type="button" disabled={busy || disabled || !ready || unavailable} onClick={() => void credit()} className="min-h-11 rounded-lg bg-accent px-5 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Adicionando...' : pending ? 'Repetir mesma tentativa' : 'Confirmar crédito simulado'}</button></div></div> : <form aria-label="Informar crédito simulado" className="mt-5" onSubmit={event => { event.preventDefault(); const amount = parseCreditAmount(value); if (!amount) { setError('Informe um valor positivo em reais, sem separador de milhar e com até duas casas decimais. Ex.: 1500,50.'); return } setError(''); setConfirmedAmount(amount) }}>
      <label htmlFor={id} className="block text-sm font-medium">Valor em reais (R$)</label><input id={id} value={value} onChange={event => setValue(event.target.value)} inputMode="decimal" type="text" placeholder="Ex.: 1500,50" disabled={!ready || unavailable} className="mt-2 min-h-12 w-full rounded-xl border border-line bg-canvas px-4" /><div className="mt-4 flex flex-wrap gap-3"><button disabled={disabled || !ready || unavailable} className="min-h-11 rounded-lg bg-accent px-5 text-sm font-semibold text-white disabled:opacity-50">Revisar crédito</button><button type="button" onClick={() => setOpen(false)} className="min-h-11 rounded-lg border border-line px-4 text-sm">Cancelar</button></div>
    </form>}
  </section>
}
