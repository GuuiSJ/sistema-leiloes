import { useState } from 'react'
import { useNavigate, useParams } from 'react-router'
import { usePublicResource } from '../hooks/usePublicResource'
import { getPublicAudit, publicIdValid, auditActionLabels, type PublicAudit } from '../services/participation-audit'
import { getBidHistory } from '../services/auctions'
import { formatDate } from '../services/formatters'
import { BidHistory } from '../components/auctions/BidHistory'
import { DetailError, DetailLoading } from '../components/auctions/DetailFeedback'
import { AdminPagination } from '../components/auctioneer/AdminFeedback'

export function IntegrityResult({ integrity }: { integrity: PublicAudit['integrity'] }) {
  const valid = integrity.status === 'VALID'
  return <div role={valid ? 'status' : 'alert'} className={`rounded-2xl border bg-surface p-6 ${valid ? 'border-accent/40' : 'border-amber-500/40'}`}>
    <h2 className="text-lg font-semibold">{valid ? 'Integridade da cadeia confirmada' : integrity.status === 'INVALID' ? 'Integridade não confirmada: cadeia inválida' : 'Integridade não confirmada: sem eventos disponíveis'}</h2>
    <p className="mt-3 text-sm leading-6 text-muted">{valid ? `${integrity.eventsChecked} eventos verificados na cadeia global em ${formatDate(integrity.checkedAt)} (Brasília).` : 'Não é possível garantir a integridade dos eventos deste lote nesta consulta.'}</p>
    <p className="mt-3 text-xs leading-6 text-muted">A verificação cobre os hashes e o encadeamento dos eventos registrados. O histórico de lances é uma consulta separada e não é assinado por esta verificação.</p>
  </div>
}
function AuditLookup({ lotId }: { lotId: string }) {
  const [page, setPage] = useState(1)
  const audit = usePublicResource(`audit:${lotId}:${page}`, signal => getPublicAudit(lotId, page, signal))
  const bids = usePublicResource(`audit-bids:${lotId}`, signal => getBidHistory(lotId, 1, signal))
  return <div className="mt-7 space-y-7">
    {audit.loading ? <DetailLoading label="Verificando a cadeia de auditoria..." /> : audit.error ? <DetailError message="Não foi possível verificar a integridade. Nenhuma confirmação de integridade está disponível." retry={audit.retry} /> : audit.data && <>
      <IntegrityResult integrity={audit.data.integrity} />
      <section className="rounded-2xl border border-line bg-surface p-6"><h2 className="text-xl font-semibold">Eventos públicos do lote e do leilão</h2>
        {!audit.data.data.length ? <p role="status" className="mt-5 text-sm text-muted">{audit.data.integrity.status === 'INVALID' ? 'Os eventos não são exibidos porque a cadeia não pôde ser validada.' : 'Nenhum evento disponível nesta página.'}</p> : <ol className="mt-5 divide-y divide-line">{audit.data.data.map(event => <li key={event.id} className="py-5"><p className="font-medium">#{event.sequence} · {auditActionLabels[event.action]}</p><p className="mt-2 text-xs text-muted">{formatDate(event.occurredAt)} · Brasília · {event.entityType === 'Lot' ? 'Lote' : 'Leilão'}</p><details className="mt-3 text-xs text-muted"><summary className="min-h-8 cursor-pointer">Identificadores e hashes públicos</summary><dl className="mt-3 space-y-3 break-all font-mono"><div><dt>Evento</dt><dd>{event.id}</dd></div><div><dt>Hash</dt><dd>{event.currentHash}</dd></div><div><dt>Hash anterior</dt><dd>{event.previousHash ?? 'Início da cadeia'}</dd></div></dl></details></li>)}</ol>}
        <div className="mt-5"><AdminPagination pagination={audit.data.pagination} change={setPage} /></div>
      </section>
    </>}
    <BidHistory key={lotId} lotId={lotId} firstPage={bids.data} loading={bids.loading} error={bids.error} retry={bids.retry} />
  </div>
}
export function PublicAuditPage() {
  const { lotId = '' } = useParams(), navigate = useNavigate(), [input, setInput] = useState(lotId), [error, setError] = useState('')
  return <div className="page-container max-w-5xl py-8 sm:py-12"><header className="rounded-2xl bg-navy p-7 text-white sm:p-10"><p className="text-xs font-medium uppercase tracking-[0.2em] text-blue-200">Transparência</p><h1 className="mt-4 text-3xl font-semibold sm:text-4xl">Auditoria pública</h1><p className="mt-4 text-sm leading-7 text-slate-300">Consulte os lances e a integridade dos eventos de um lote, sem precisar entrar na conta.</p></header>
    <form className="mt-7 rounded-2xl border border-line bg-surface p-6" onSubmit={event => { event.preventDefault(); const id = input.trim(); if (!publicIdValid(id)) { setError('Informe um identificador de lote válido.'); return } setError(''); navigate(`/auditoria/${id}`) }}><label className="block text-sm font-medium" htmlFor="audit-lot">Identificador público do lote</label><div className="mt-3 flex flex-col gap-3 sm:flex-row"><input id="audit-lot" value={input} onChange={event => setInput(event.target.value)} aria-invalid={!!error} aria-describedby="audit-lot-error" className="min-h-12 min-w-0 flex-1 rounded-lg border border-line bg-surface px-4 text-sm" /><button type="submit" className="min-h-12 rounded-lg bg-accent px-5 text-sm font-semibold text-white hover:bg-blue-700">Consultar auditoria</button></div><p id="audit-lot-error" role={error ? 'alert' : undefined} className="mt-2 text-sm text-muted">{error}</p></form>
    {lotId && (publicIdValid(lotId) ? <AuditLookup key={lotId} lotId={lotId} /> : <p role="alert" className="mt-6">Identificador de lote inválido. Revise a consulta.</p>)}
  </div>
}
