import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { LockKeyhole } from 'lucide-react'
import { useAuth } from '../../hooks/useAuth'
import type { Auction, Lot } from '../../services/auctions'
import { bidAvailability } from '../../services/bid-eligibility'
import { usePublicResource } from '../../hooks/usePublicResource'
import { BidError, belowMinimum, clearPendingBid, createBidAttempt, getBidEligibility, parseBidAmount, readPendingBid, savePendingBid } from '../../services/bids'
import { formatMoney } from '../../services/formatters'
import { getWallet, type WalletSnapshot } from '../../services/wallet'
import { BidConfirmation } from './BidConfirmation'

function Participation({ lot, onSuccess }: { lot: Lot; onSuccess: () => void }) {
  const auth = useAuth(), inputId = useId()
  const eligibility = usePublicResource(`eligibility:${lot.id}:${auth.user?.id}`, signal => auth.withSession((token, inner) => getBidEligibility(lot.id, token, inner), signal))
  const [value, setValue] = useState(''), [confirmation, setConfirmation] = useState<string | null>(null)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [balance, setBalance] = useState<WalletSnapshot | null>(null)
  const attempt = useRef<ReturnType<typeof createBidAttempt> | null>(null), sending = useRef(false)
  const [storageReady, setStorageReady] = useState(false)
  useEffect(() => {
    try {
      const pending = readPendingBid(auth.user!.id, lot.id)
      if (pending) { attempt.current = createBidAttempt(lot.id, pending.amount, pending.key); setConfirmation(pending.amount) }
      setStorageReady(true)
    } catch { setMessage('Não foi possível verificar tentativas anteriores neste navegador. O envio está bloqueado; verifique o histórico antes de continuar.') }
  }, [auth.user?.id, lot.id])
  const allowed = storageReady && eligibility.data?.eligible === true && !busy && !eligibility.loading && !eligibility.error
  async function confirm() {
    if (sending.current || !confirmation) return
    sending.current = true; setBusy(true); setMessage('')
    try {
      if (!attempt.current) {
        const key = crypto.randomUUID()
        try { savePendingBid(auth.user!.id, lot.id, { amount: confirmation, key }) }
        catch { throw new BidError('Não foi possível salvar a chave de segurança neste navegador. Nenhum lance foi enviado.', 400) }
        attempt.current = createBidAttempt(lot.id, confirmation, key)
      }
      await auth.withSession(attempt.current, new AbortController().signal)
      try { clearPendingBid(auth.user!.id, lot.id) } catch { /* A retained key only replays the confirmed bid. */ }
      attempt.current = null; setConfirmation(null); setValue(''); setMessage('Lance confirmado com sucesso.'); eligibility.retry()
      try { const wallet = await auth.withSession(getWallet, new AbortController().signal); setBalance(wallet) }
      catch { setBalance(null); setMessage('Lance confirmado. Não foi possível atualizar o saldo; consulte sua carteira.') }
      onSuccess()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Resultado não confirmado. Repita a mesma tentativa.')
      if (error instanceof BidError && !error.retrySameKey && [400, 403, 404, 409].includes(error.status ?? 0)) {
        try { clearPendingBid(auth.user!.id, lot.id) } catch { setStorageReady(false) }
        attempt.current = null; setConfirmation(null); eligibility.retry()
      }
    } finally { sending.current = false; setBusy(false) }
  }
  return <div className="mt-4 space-y-4">
    {message && <p role="status" className="text-sm">{message}</p>}
    {balance !== null && <dl aria-label="Saldos atualizados" className="space-y-2 text-sm"><div><dt className="inline">Disponível: </dt><dd className="inline font-semibold">{formatMoney(balance.availableBalance)}</dd></div><div><dt className="inline">Reservado: </dt><dd className="inline">{formatMoney(balance.reservedBalance)}</dd></div><div><dt className="inline">Total: </dt><dd className="inline">{formatMoney(balance.totalBalance)}</dd></div></dl>}
    {confirmation ? <BidConfirmation lot={lot} amount={confirmation} busy={busy} uncertain={!!attempt.current} onConfirm={() => void confirm()} onCancel={() => setConfirmation(null)} /> : <>
      {eligibility.loading ? <p role="status">Consultando elegibilidade...</p> : eligibility.error ? <p role="alert">Não foi possível consultar sua elegibilidade.</p> : eligibility.data?.eligible === false ? <p>{eligibility.data.reason}</p> : null}
      {allowed && eligibility.data?.eligible && <div className="space-y-2 text-sm">{eligibility.data.currentAmount !== null && <p>Lance atual consultado: {formatMoney(eligibility.data.currentAmount)}</p>}<p>Mínimo consultado: {formatMoney(eligibility.data.minimumAmount)}. Pode mudar antes do envio.</p></div>}
      <form aria-label="Preparar lance" onSubmit={event => {
        event.preventDefault(); if (!allowed || !eligibility.data?.eligible) return
        const amount = parseBidAmount(value)
        if (!amount || belowMinimum(amount, eligibility.data.minimumAmount)) { setMessage('Informe um valor positivo, sem separador de milhar, com até duas casas decimais e igual ou superior ao mínimo.'); return }
        setMessage(''); setConfirmation(amount)
      }}>
        <label htmlFor={inputId} className="block text-sm font-medium">Valor do lance (R$)</label>
        <input id={inputId} inputMode="decimal" type="text" value={value} onChange={event => setValue(event.target.value)} disabled={!allowed} placeholder="Ex.: 1500,50" className="mt-2 w-full rounded-xl border border-line bg-canvas px-4 py-3 disabled:opacity-50" />
        <button disabled={!allowed} className="mt-3 w-full rounded-xl bg-accent px-4 py-3 font-semibold text-white disabled:opacity-50">Revisar lance</button>
      </form>
      <button type="button" onClick={eligibility.retry} className="text-sm font-medium text-accent">Atualizar elegibilidade</button>
    </>}
  </div>
}

export function BidForm({ auction, lot, onSuccess = () => {} }: { auction: Auction; lot: Lot; onSuccess?: () => void }) {
  const auth = useAuth()
  const headingId = useId()
  const availability = bidAvailability(auction, lot)
  const bidder = auth.status === 'authenticated' && auth.user?.role === 'BIDDER'

  return <section aria-labelledby={headingId} className="rounded-2xl border border-line bg-surface p-6">
    <div className="flex items-center gap-3"><LockKeyhole aria-hidden="true" className="size-5 text-accent" /><h3 id={headingId} className="text-lg font-semibold">Participar do leilão</h3></div>
    {availability === 'closed' ? <p className="mt-4 text-sm text-muted">Este lote está encerrado ou cancelado e não recebe novos lances.</p>
      : availability === 'not-open' ? <p className="mt-4 text-sm text-muted">O leilão e o lote precisam estar abertos para receber lances.</p>
      : auth.status === 'restoring' ? <p className="mt-4 text-sm text-muted" role="status">Verificando sua sessão...</p>
      : auth.status === 'unavailable' ? <div className="mt-4 text-sm"><p className="text-muted">Não foi possível verificar sua sessão. Nenhum lance será enviado.</p><button type="button" onClick={() => void auth.refresh()} className="mt-3 font-medium text-accent">Verificar sessão</button></div>
      : auth.status !== 'authenticated' ? <p className="mt-4 text-sm text-muted"><Link to="/entrar" className="font-medium text-accent">Entre na sua conta</Link> de participante para acompanhar sua participação. O envio depende da confirmação de elegibilidade do lote.</p>
      : !bidder ? <p className="mt-4 text-sm text-muted">Somente contas de participante (BIDDER) podem enviar lances.</p>
      : <Participation key={`${lot.id}:${auth.user?.id}`} lot={lot} onSuccess={onSuccess} />}
  </section>
}
