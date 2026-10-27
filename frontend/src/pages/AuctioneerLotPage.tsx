import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { usePublicResource } from '../hooks/usePublicResource'
import { getAuction, getLot, type Auction, type Lot } from '../services/auctions'
import { createLot, deleteLot, lotActions, lotDraft, LotManagementError, updateLot, validLotId, validateLot, type LotFields } from '../services/lot-management'
import { formatDate, formatMoney } from '../services/formatters'
import { auctionStatusLabels, lotStatusLabels } from '../components/auctions/AuctionInfo'
import { AdminFeedback, adminButton } from '../components/auctioneer/AdminFeedback'
import { LotForm } from '../components/auctioneer/LotForm'
import { LotVehiclePicker } from '../components/auctioneer/LotVehiclePicker'

export function LotDeleteConfirmation({ lot, busy, confirm, dismiss }: { lot: Lot; busy: boolean; confirm: () => void; dismiss: () => void }) {
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => { button.current?.focus() }, [])
  return <div role="alertdialog" aria-labelledby="delete-lot-title" aria-describedby="delete-lot-description" className="mt-4 rounded-xl border border-red-500/30 p-5" onKeyDown={event => { if (event.key === 'Escape' && !busy) dismiss() }}><h3 id="delete-lot-title" className="font-semibold">Excluir este lote?</h3><p id="delete-lot-description" className="mt-2 text-sm leading-6">Lote {lot.number} · {lot.vehicle.brand} {lot.vehicle.model} · {lot.vehicle.year}. A exclusão é definitiva. O cadastro do veículo será preservado.</p><div className="mt-4 flex flex-wrap gap-3"><button ref={button} type="button" disabled={busy} className={adminButton} onClick={dismiss}>Manter lote</button><button type="button" disabled={busy} className={`${adminButton} text-red-600 dark:text-red-300`} onClick={confirm}>{busy ? 'Excluindo...' : 'Confirmar exclusão definitiva'}</button></div></div>
}
export function LotEditor({ auction, lot, reload = () => {} }: { auction: Auction; lot?: Lot; reload?: () => void }) {
  const auth = useAuth(), navigate = useNavigate(), listPath = `/area-leiloeiro/lotes/${auction.id}`
  const [draft, setDraft] = useState(() => lotDraft(lot)), [selected, setSelected] = useState(lot?.vehicle ?? null), [errors, setErrors] = useState<LotFields>({})
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null), [failure, setFailure] = useState<LotManagementError | null>(null), [confirmDelete, setConfirmDelete] = useState(false), [notice, setNotice] = useState('')
  const active = useRef(true), sending = useRef(false), request = useRef<AbortController | null>(null), errorBox = useRef<HTMLDivElement>(null), deleteButton = useRef<HTMLButtonElement>(null)
  useEffect(() => { active.current = true; return () => { active.current = false; request.current?.abort() } }, [])
  const actions = lotActions(auction.status, lot?.status), canSave = lot ? actions.edit : actions.create
  const blocked = !!failure?.uncertain || failure?.status === 409 || auth.status !== 'authenticated' || auth.user?.role !== 'AUCTIONEER'
  async function run(operation: 'save' | 'delete') {
    if (sending.current || blocked || (operation === 'save' && !canSave) || (operation === 'delete' && (!lot || !actions.delete || !confirmDelete))) return
    sending.current = true; setBusy(operation); setFailure(null); setNotice('')
    const controller = new AbortController(); request.current = controller
    try {
      await auth.withSession((token, signal) => operation === 'delete' ? deleteLot(auction.id, lot!.id, token, signal) : lot ? updateLot(auction.id, lot.id, draft, token, signal) : createLot(auction.id, draft, token, signal), controller.signal)
      if (active.current) navigate(listPath, { replace: true, state: { lotNotice: operation === 'delete' ? 'Lote excluído com sucesso.' : lot ? 'Lote atualizado com sucesso.' : 'Lote cadastrado com sucesso.' } })
    } catch (error) {
      if (active.current) { setFailure(error instanceof LotManagementError ? error : new LotManagementError(error instanceof Error ? error.message : 'Não foi possível concluir a operação.')); setConfirmDelete(false); setTimeout(() => errorBox.current?.focus(), 0) }
    } finally { sending.current = false; if (active.current) setBusy(null) }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending.current || blocked || confirmDelete || !canSave) return
    const fields = validateLot(draft, !!lot); setErrors(fields)
    if (Object.keys(fields).length) { setNotice('Confira os campos destacados antes de salvar.'); if (fields.vehicleId) document.getElementById('lot-selected-vehicle')?.focus(); else event.currentTarget.querySelector<HTMLElement>(`[name="${Object.keys(fields)[0]}"]`)?.focus(); return }
    void run('save')
  }
  return <>
    <Link to={listPath} className="mb-5 inline-flex min-h-11 items-center text-sm font-medium text-accent dark:text-blue-300">← Voltar aos lotes deste leilão</Link>
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-2xl font-semibold tracking-tight">{lot ? 'Gerenciar lote' : 'Cadastrar lote'}</h2><p className="mt-2 text-sm text-muted">{auction.title} · {auctionStatusLabels[auction.status]}</p></div><button type="button" disabled={!!busy} className={adminButton} onClick={reload}>Reconsultar dados</button></div>
    <div className="mb-6 rounded-2xl border border-line bg-surface p-5 text-sm leading-6"><p>As operações dependem da responsabilidade pelo leilão, propriedade dos veículos, prazos e histórico, verificados pela plataforma.</p><p className="mt-2 text-muted">Prazo {lot ? 'do lote' : 'do leilão'} · Brasília: <time dateTime={lot?.endsAt ?? auction.endsAt}>{formatDate(lot?.endsAt ?? auction.endsAt)}</time></p>{lot && <p className="mt-2">Lote {lot.number} · {lotStatusLabels[lot.status]} · {lot.vehicle.brand} {lot.vehicle.model} · Preço inicial: {formatMoney(lot.startingPrice)}</p>}</div>
    {failure && <div ref={errorBox} tabIndex={-1} role="alert" className="mb-5 rounded-xl border border-red-500/30 bg-surface p-5 text-sm leading-6"><p>{failure.message}</p>{failure.status === 401 && <Link to="/entrar" className={adminButton}>Entrar novamente</Link>}{failure.uncertain && <Link to={listPath} className={`${adminButton} mt-3`}>Consultar listagem antes de continuar</Link>}{failure.status === 409 && <p className="mt-2">Reconsulte os dados antes de uma nova tentativa. Isso substituirá os campos pelas informações atuais.</p>}</div>}
    {notice && <p role="status" className="mb-5 text-sm">{notice}</p>}
    {canSave ? <><LotVehiclePicker selected={selected} disabled={!!busy || blocked || confirmDelete} error={errors.vehicleId} select={vehicle => { setSelected(vehicle); setDraft(current => ({ ...current, vehicleId: vehicle.id })); setErrors(current => ({ ...current, vehicleId: undefined })) }} /><LotForm draft={draft} errors={errors} busy={busy === 'save'} blocked={blocked || !!busy || confirmDelete} editing={!!lot} change={(field, value) => { setDraft(current => ({ ...current, [field]: value })); setErrors(current => ({ ...current, [field]: undefined })); setNotice('') }} submit={submit} /></> : <p role="status" className="rounded-2xl border border-line bg-surface p-6 text-sm text-muted">Este status não permite gerenciar o lote. Apenas leilões em rascunho ainda não iniciados e lotes pendentes podem receber essas operações, conforme validação da plataforma.</p>}
    {lot && actions.delete && <section aria-label="Exclusão do lote" className="mt-6 rounded-2xl border border-line bg-surface p-6"><h3 className="font-semibold">Excluir lote</h3><p className="mt-2 text-sm leading-6 text-muted">Lotes com histórico ou estado incompatível não podem ser excluídos.</p>{confirmDelete ? <LotDeleteConfirmation lot={lot} busy={!!busy} confirm={() => void run('delete')} dismiss={() => { setConfirmDelete(false); setTimeout(() => deleteButton.current?.focus(), 0) }} /> : <button ref={deleteButton} type="button" disabled={!!busy || blocked} className={`${adminButton} mt-4 text-red-600 dark:text-red-300`} onClick={() => setConfirmDelete(true)}>Excluir lote</button>}</section>}
  </>
}
function LoadLot({ auctionId, lotId }: { auctionId: string; lotId?: string }) {
  const resource = usePublicResource(`manage-lot:${auctionId}:${lotId ?? 'new'}`, async signal => {
    const [auction, lot] = await Promise.all([getAuction(auctionId, signal), lotId ? getLot(auctionId, lotId, signal) : Promise.resolve(undefined)])
    return { auction, lot }
  })
  return <AdminFeedback {...resource} empty={false}>{resource.data && <LotEditor {...resource.data} reload={resource.retry} />}</AdminFeedback>
}
export function AuctioneerLotPage({ create = false }: { create?: boolean }) {
  const auth = useAuth(), { auctionId, lotId } = useParams()
  if (auth.status !== 'authenticated' || auth.user?.role !== 'AUCTIONEER') return <p role="alert">Acesso exclusivo para leiloeiros.</p>
  if (!auctionId || !validLotId(auctionId) || (!create && (!lotId || !validLotId(lotId)))) return <div><h2 className="text-2xl font-semibold">Leilão ou lote inválido</h2><Link to="/area-leiloeiro/lotes" className={adminButton}>Selecionar leilão</Link></div>
  return <LoadLot key={`${auctionId}:${create ? 'new' : lotId}`} auctionId={auctionId} lotId={create ? undefined : lotId} />
}
