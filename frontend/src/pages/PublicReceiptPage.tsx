import { useState } from 'react'
import { Link, useParams } from 'react-router'
import { usePublicResource } from '../hooks/usePublicResource'
import { getPublicReceipt, publicIdValid, type Receipt } from '../services/participation-audit'
import { formatDate, formatMoney } from '../services/formatters'
import { DetailError, DetailLoading } from '../components/auctions/DetailFeedback'

export function ReceiptContent({ receipt: r }: { receipt: Receipt }) {
  const [notice, setNotice] = useState('')
  const path = `/comprovantes/${r.publicId}`, url = typeof window === 'undefined' ? path : `${window.location.origin}${path}`
  return <article className="rounded-2xl border border-line bg-surface p-6 sm:p-9">
    <p className="text-xs font-medium uppercase tracking-widest text-accent dark:text-blue-300">Comprovante público de arremate</p><h1 className="mt-4 text-3xl font-semibold">{r.auctionTitle}</h1><p className="mt-3 text-sm text-muted">Lote {r.lotNumber} · Emitido em {formatDate(r.issuedAt)} (Brasília)</p>
    <h2 className="mt-8 break-words text-xl font-semibold">{r.vehicleBrand} {r.vehicleModel} · {r.vehicleYear}</h2>{r.vehicleVersion && <p className="mt-2 text-muted">{r.vehicleVersion}</p>}
    <p className="mt-6 text-sm text-muted">Valor final</p><p className="mt-2 text-3xl font-semibold tracking-tight">{formatMoney(r.finalAmount)}</p>
    <dl className="mt-7 space-y-4 text-xs text-muted"><div><dt>Identificador público do comprovante</dt><dd className="mt-1 break-all font-mono">{r.publicId}</dd></div><div><dt>Lance vencedor · identificador público</dt><dd className="mt-1 break-all font-mono">{r.winningBidId}</dd></div></dl>
    <label className="mt-8 block text-sm font-medium">Link compartilhável<input readOnly value={url} onFocus={event => event.target.select()} className="mt-2 min-h-12 w-full rounded-lg border border-line bg-surface px-3 text-sm" /></label>
    <div className="mt-4 flex flex-wrap gap-4"><button type="button" className="min-h-11 rounded-lg bg-accent px-5 text-sm font-semibold text-white hover:bg-blue-700" onClick={async () => { try { await navigator.clipboard.writeText(url); setNotice('Link copiado.') } catch { setNotice('Selecione o link acima e copie para compartilhar.') } }}>Copiar link</button><Link to={`/auditoria/${r.lotId}`} className="inline-flex min-h-11 items-center text-sm font-medium text-accent dark:text-blue-300">Consultar auditoria do lote</Link></div>
    {notice && <p role="status" className="mt-4 text-sm text-muted">{notice}</p>}<p className="mt-6 text-xs leading-6 text-muted">Este documento exibe os dados registrados na emissão do comprovante. Informações pessoais do vencedor não são divulgadas.</p>
  </article>
}
function ReceiptLookup({ id }: { id: string }) {
  const resource = usePublicResource(`receipt:${id}`, signal => getPublicReceipt(id, signal))
  return resource.loading ? <DetailLoading label="Consultando comprovante..." /> : resource.error ? <DetailError message={resource.error.message} retry={resource.retry} /> : resource.data && <ReceiptContent receipt={resource.data} />
}
export function PublicReceiptPage() {
  const { publicId = '' } = useParams()
  return <div className="page-container max-w-4xl py-8 sm:py-12">{publicIdValid(publicId) ? <ReceiptLookup key={publicId} id={publicId} /> : <p role="alert" className="rounded-2xl border border-line bg-surface p-7">Identificador de comprovante inválido.</p>}</div>
}
