import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { usePublicResource } from '../hooks/usePublicResource'
import type { Vehicle } from '../services/auctions'
import { createVehicle, deleteVehicle, getVehicle, updateVehicle, validVehicleId, validateVehicle, vehicleDraft, VehicleError, type VehicleDraft, type VehicleFields } from '../services/vehicles'
import { AdminFeedback, adminButton } from '../components/auctioneer/AdminFeedback'
import { VehicleForm } from '../components/auctioneer/VehicleForm'
import { VehicleFipe } from '../components/auctioneer/VehicleFipe'

export function VehicleDeleteConfirmation({ vehicle, busy, confirm, cancel }: { vehicle: Vehicle; busy: boolean; confirm: () => void; cancel: () => void }) {
  const cancelButton = useRef<HTMLButtonElement>(null)
  useEffect(() => { cancelButton.current?.focus() }, [])
  return <div role="alertdialog" aria-labelledby="delete-vehicle-title" aria-describedby="delete-vehicle-description" className="mt-4 rounded-xl border border-red-500/30 p-5" onKeyDown={event => { if (event.key === 'Escape' && !busy) cancel() }}><h3 id="delete-vehicle-title" className="font-semibold">Excluir este veículo?</h3><p id="delete-vehicle-description" className="mt-2 text-sm leading-6">{vehicle.brand} {vehicle.model} · {vehicle.year}. Esta ação é definitiva e só será permitida sem vínculos ou histórico impeditivos.</p><div className="mt-4 flex flex-wrap gap-3"><button ref={cancelButton} type="button" disabled={busy} className={adminButton} onClick={cancel}>Manter veículo</button><button type="button" disabled={busy} className={`${adminButton} text-red-600 dark:text-red-300`} onClick={confirm}>{busy ? 'Excluindo...' : 'Confirmar exclusão definitiva'}</button></div></div>
}

function VehicleEditor({ vehicle }: { vehicle?: Vehicle }) {
  const auth = useAuth(), navigate = useNavigate()
  const [draft, setDraft] = useState(() => vehicleDraft(vehicle)), [errors, setErrors] = useState<VehicleFields>({})
  const [busy, setBusy] = useState<'save' | 'delete' | null>(null), [failure, setFailure] = useState<VehicleError | null>(null), [confirmDelete, setConfirmDelete] = useState(false), [notice, setNotice] = useState('')
  const active = useRef(true), sending = useRef(false), request = useRef<AbortController | null>(null), errorBox = useRef<HTMLDivElement>(null), deleteButton = useRef<HTMLButtonElement>(null)
  useEffect(() => { active.current = true; return () => { active.current = false; request.current?.abort() } }, [])
  const allowed = auth.status === 'authenticated' && auth.user?.role === 'AUCTIONEER'
  const blocked = !!failure?.uncertain || !allowed
  function change(field: keyof VehicleDraft, value: string) {
    setDraft(current => ({ ...current, ...(['brand', 'model', 'year'].includes(field) ? { fipeCode: '', fipeBrandCode: '', fipeModelCode: '', fipeYearCode: '', fipeReferenceMonth: '', fipeReferencePrice: '' } : {}), [field]: value }))
    setErrors(current => ({ ...current, [field]: undefined })); setNotice('')
  }
  async function run(operation: 'save' | 'delete') {
    if (sending.current || blocked || (operation === 'delete' && (!vehicle || !confirmDelete))) return
    sending.current = true; setBusy(operation); setFailure(null); setNotice('')
    const controller = new AbortController(); request.current = controller
    try {
      await auth.withSession((token, signal) => operation === 'delete' ? deleteVehicle(vehicle!.id, token, signal) : vehicle ? updateVehicle(vehicle.id, draft, token, signal) : createVehicle(draft, token, signal), controller.signal)
      if (active.current) navigate('/area-leiloeiro/veiculos', { replace: true, state: { vehicleNotice: operation === 'delete' ? 'Veículo excluído com sucesso.' : vehicle ? 'Veículo atualizado com sucesso.' : 'Veículo cadastrado com sucesso.' } })
    } catch (error) {
      if (active.current) { setFailure(error instanceof VehicleError ? error : new VehicleError(error instanceof Error ? error.message : 'Não foi possível concluir a operação.')); setTimeout(() => errorBox.current?.focus(), 0) }
    } finally { sending.current = false; if (active.current) setBusy(null) }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (sending.current || blocked || confirmDelete) return
    const fields = validateVehicle(draft); setErrors(fields)
    if (Object.keys(fields).length) { setNotice('Confira os campos destacados antes de salvar.'); event.currentTarget.querySelector<HTMLElement>('[name="' + Object.keys(fields)[0] + '"]')?.focus(); return }
    void run('save')
  }
  return <>
    <Link to="/area-leiloeiro/veiculos" className="mb-5 inline-flex min-h-11 items-center text-sm font-medium text-accent dark:text-blue-300">← Voltar aos veículos</Link>
    <h2 className="text-2xl font-semibold tracking-tight">{vehicle ? 'Gerenciar veículo' : 'Cadastrar veículo'}</h2><p className="mb-6 mt-2 text-sm leading-6 text-muted">{vehicle ? 'A edição e a exclusão dependem de propriedade e dos vínculos e histórico do veículo, verificados pela plataforma.' : 'Preencha os dados do veículo e revise antes de cadastrar.'}</p>
    {failure && <div ref={errorBox} tabIndex={-1} role="alert" className="mb-5 rounded-xl border border-red-500/30 bg-surface p-5 text-sm leading-6"><p>{failure.message}</p>{failure.status === 401 && <Link to="/entrar" className={adminButton}>Entrar novamente</Link>}{failure.uncertain && <Link to="/area-leiloeiro/veiculos" className={`${adminButton} mt-3`}>Consultar listagem antes de continuar</Link>}</div>}
    {notice && <p role="status" className="mb-5 text-sm">{notice}</p>}
    <VehicleFipe disabled={!!busy || blocked || confirmDelete} apply={values => { setDraft(current => ({ ...current, ...values })); setErrors({}); setNotice('Referência FIPE aplicada. Revise os campos antes de salvar.') }} />
    <VehicleForm draft={draft} errors={errors} busy={busy === 'save'} blocked={blocked || !!busy || confirmDelete} editing={!!vehicle} change={change} submit={submit} />
    {vehicle && <section aria-label="Exclusão do veículo" className="mt-6 rounded-2xl border border-line bg-surface p-6"><h3 className="font-semibold">Excluir veículo</h3><p className="mt-2 text-sm leading-6 text-muted">Somente o proprietário pode excluir. Veículos com lotes ou histórico vinculado não podem ser excluídos.</p>{confirmDelete ? <VehicleDeleteConfirmation vehicle={vehicle} busy={!!busy || blocked} confirm={() => void run('delete')} cancel={() => { setConfirmDelete(false); setTimeout(() => deleteButton.current?.focus(), 0) }} /> : <button ref={deleteButton} type="button" disabled={!!busy || blocked} className={`${adminButton} mt-4 text-red-600 dark:text-red-300`} onClick={() => setConfirmDelete(true)}>Excluir veículo</button>}</section>}
  </>
}
function EditVehicle({ id }: { id: string }) {
  const resource = usePublicResource(`edit-vehicle:${id}`, signal => getVehicle(id, signal))
  return <AdminFeedback {...resource} empty={false}>{resource.data && <VehicleEditor key={resource.data.id} vehicle={resource.data} />}</AdminFeedback>
}
export function AuctioneerVehiclePage({ create = false }: { create?: boolean }) {
  const auth = useAuth(), { vehicleId } = useParams()
  if (auth.status !== 'authenticated' || auth.user?.role !== 'AUCTIONEER') return <p role="alert">Acesso exclusivo para leiloeiros.</p>
  if (create) return <VehicleEditor />
  if (!vehicleId || !validVehicleId(vehicleId)) return <div><h2 className="text-2xl font-semibold">Veículo inválido</h2><Link to="/area-leiloeiro/veiculos" className={adminButton}>Voltar aos veículos</Link></div>
  return <EditVehicle key={vehicleId} id={vehicleId} />
}
