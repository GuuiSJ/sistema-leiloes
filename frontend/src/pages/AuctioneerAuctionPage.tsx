import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { usePublicResource } from '../hooks/usePublicResource'
import { getAuction, type Auction } from '../services/auctions'
import { auctionActions, auctionDraft, AuctionManagementError, cancelAuction, createAuction, updateAuction, validAuctionId, validateAuction, type AuctionFields } from '../services/auction-management'
import { AuctionInfo } from '../components/auctions/AuctionInfo'
import { AdminFeedback, adminButton } from '../components/auctioneer/AdminFeedback'
import { AuctionForm } from '../components/auctioneer/AuctionForm'

export function AuctionCancelConfirmation({ auction, busy, confirm, dismiss }: { auction: Auction; busy: boolean; confirm: () => void; dismiss: () => void }) {
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => { button.current?.focus() }, [])
  return <div role="alertdialog" aria-labelledby="cancel-auction-title" aria-describedby="cancel-auction-description" className="mt-4 rounded-xl border border-red-500/30 p-5" onKeyDown={event => { if (event.key === 'Escape' && !busy) dismiss() }}><h3 id="cancel-auction-title" className="font-semibold">Cancelar este leilão?</h3><p id="cancel-auction-description" className="mt-2 text-sm leading-6">{auction.title}. Confirme o cancelamento definitivo. A plataforma verificará responsabilidade, prazo e operações incompatíveis antes de aceitar.</p><div className="mt-4 flex flex-wrap gap-3"><button ref={button} type="button" disabled={busy} className={adminButton} onClick={dismiss}>Manter leilão</button><button type="button" disabled={busy} className={`${adminButton} text-red-600 dark:text-red-300`} onClick={confirm}>{busy ? 'Cancelando...' : 'Confirmar cancelamento definitivo'}</button></div></div>
}

export function AuctionEditor({ auction, reload = () => {} }: { auction?: Auction; reload?: () => void }) {
  const auth = useAuth(), navigate = useNavigate()
  const [draft, setDraft] = useState(() => auctionDraft(auction)), [errors, setErrors] = useState<AuctionFields>({})
  const [busy, setBusy] = useState<'save' | 'cancel' | null>(null), [failure, setFailure] = useState<AuctionManagementError | null>(null), [confirmCancel, setConfirmCancel] = useState(false), [notice, setNotice] = useState('')
  const active = useRef(true), sending = useRef(false), request = useRef<AbortController | null>(null), errorBox = useRef<HTMLDivElement>(null), cancelButton = useRef<HTMLButtonElement>(null)
  useEffect(() => { active.current = true; return () => { active.current = false; request.current?.abort() } }, [])
  const actions = auction ? auctionActions(auction.status) : { edit: true, cancel: false }
  const blocked = !!failure?.uncertain || failure?.status === 409 || auth.status !== 'authenticated' || auth.user?.role !== 'AUCTIONEER'
  async function run(operation: 'save' | 'cancel') {
    if (sending.current || blocked || (operation === 'save' && !actions.edit) || (operation === 'cancel' && (!auction || !actions.cancel || !confirmCancel))) return
    sending.current = true; setBusy(operation); setFailure(null); setNotice('')
    const controller = new AbortController(); request.current = controller
    try {
      await auth.withSession((token, signal) => operation === 'cancel' ? cancelAuction(auction!.id, token, signal) : auction ? updateAuction(auction.id, draft, token, signal) : createAuction(draft, token, signal), controller.signal)
      if (active.current) navigate('/area-leiloeiro/leiloes', { replace: true, state: { auctionNotice: operation === 'cancel' ? 'Leilão cancelado com sucesso.' : auction ? 'Leilão atualizado com sucesso.' : 'Leilão cadastrado como rascunho com sucesso.' } })
    } catch (error) {
      if (active.current) { setFailure(error instanceof AuctionManagementError ? error : new AuctionManagementError(error instanceof Error ? error.message : 'Não foi possível concluir a operação.')); setConfirmCancel(false); setTimeout(() => errorBox.current?.focus(), 0) }
    } finally { sending.current = false; if (active.current) setBusy(null) }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending.current || blocked || confirmCancel || !actions.edit) return
    const fields = validateAuction(draft); setErrors(fields)
    if (Object.keys(fields).length) { setNotice('Confira os campos destacados antes de salvar.'); event.currentTarget.querySelector<HTMLElement>(`[name="${Object.keys(fields)[0]}"]`)?.focus(); return }
    void run('save')
  }
  return <>
    <Link to="/area-leiloeiro/leiloes" className="mb-5 inline-flex min-h-11 items-center text-sm font-medium text-accent dark:text-blue-300">← Voltar aos leilões</Link>
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-semibold tracking-tight">{auction ? 'Gerenciar leilão' : 'Cadastrar leilão'}</h2><p className="mt-2 text-sm leading-6 text-muted">{auction ? 'As ações dependem do status, da responsabilidade pelo leilão e das regras temporais verificadas pela plataforma.' : 'Defina o título, a descrição e o período do leilão.'}</p></div>{auction && <button type="button" disabled={!!busy} onClick={reload} className={adminButton}>Reconsultar leilão</button>}</div>
    {auction && <div className="mb-6"><AuctionInfo auction={auction} /></div>}
    {failure && <div ref={errorBox} tabIndex={-1} role="alert" className="mb-5 rounded-xl border border-red-500/30 bg-surface p-5 text-sm leading-6"><p>{failure.message}</p>{failure.status === 401 && <Link to="/entrar" className={adminButton}>Entrar novamente</Link>}{failure.uncertain && <Link to="/area-leiloeiro/leiloes" className={`${adminButton} mt-3`}>Consultar listagem antes de continuar</Link>}{failure.status === 409 && <p className="mt-2">Reconsulte o leilão antes de uma nova tentativa. Isso substituirá os campos pelas informações atuais.</p>}</div>}
    {notice && <p role="status" className="mb-5 text-sm">{notice}</p>}
    {actions.edit ? <AuctionForm draft={draft} errors={errors} busy={busy === 'save'} blocked={blocked || !!busy || confirmCancel} editing={!!auction} change={(field, value) => { setDraft(current => ({ ...current, [field]: value })); setErrors(current => ({ ...current, [field]: undefined })); setNotice('') }} submit={submit} /> : <p role="status" className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">Este status não permite edição. Apenas rascunhos ainda não iniciados podem ser editados, conforme validação da plataforma.</p>}
    {auction && (actions.cancel ? <section aria-label="Cancelamento do leilão" className="mt-6 rounded-2xl border border-line bg-surface p-6"><h3 className="font-semibold">Cancelar leilão</h3><p className="mt-2 text-sm leading-6 text-muted">O cancelamento pode ser solicitado para rascunhos e agendados ainda não iniciados. A existência de operações incompatíveis pode impedir a solicitação.</p>{confirmCancel ? <AuctionCancelConfirmation auction={auction} busy={!!busy} confirm={() => void run('cancel')} dismiss={() => { setConfirmCancel(false); setTimeout(() => cancelButton.current?.focus(), 0) }} /> : <button ref={cancelButton} type="button" disabled={!!busy || blocked} className={`${adminButton} mt-4 text-red-600 dark:text-red-300`} onClick={() => setConfirmCancel(true)}>Cancelar leilão</button>}</section> : <p className="mt-5 text-sm text-muted">Este status não permite solicitar cancelamento.</p>)}
  </>
}
function EditAuction({ id }: { id: string }) {
  const resource = usePublicResource(`edit-auction:${id}`, signal => getAuction(id, signal))
  return <AdminFeedback {...resource} empty={false}>{resource.data && <AuctionEditor auction={resource.data} reload={resource.retry} />}</AdminFeedback>
}
export function AuctioneerAuctionPage({ create = false }: { create?: boolean }) {
  const auth = useAuth(), { auctionId } = useParams()
  if (auth.status !== 'authenticated' || auth.user?.role !== 'AUCTIONEER') return <p role="alert">Acesso exclusivo para leiloeiros.</p>
  if (create) return <AuctionEditor />
  if (!auctionId || !validAuctionId(auctionId)) return <div><h2 className="text-2xl font-semibold">Leilão inválido</h2><Link to="/area-leiloeiro/leiloes" className={adminButton}>Voltar aos leilões</Link></div>
  return <EditAuction key={auctionId} id={auctionId} />
}
