import { useState } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { useParticipations } from '../hooks/useParticipations'
import { formatDate, formatMoney } from '../services/formatters'
import type { Participation } from '../services/participation-audit'
import { DetailError, DetailLoading } from '../components/auctions/DetailFeedback'
import { AdminPagination } from '../components/auctioneer/AdminFeedback'

const outcomeLabels = { WON: 'Arrematado por você', NOT_WON: 'Encerrado · outro vencedor', IN_PROGRESS: 'Participação em andamento', CANCELLED: 'Lote cancelado', UNSOLD: 'Encerrado sem arremate' }
export function ParticipationCard({ participation: p }: { participation: Participation }) {
  return <article className="min-w-0 rounded-2xl border border-line bg-surface p-6 sm:p-7">
    <div className="flex flex-wrap items-center justify-between gap-3"><p className="text-xs font-medium text-muted">{p.auction.title} · Lote {p.lot.number}</p><span className={`rounded-full px-3 py-1 text-xs font-medium ${p.outcome === 'WON' ? 'bg-accent/10 text-accent dark:text-blue-300' : 'bg-muted/10 text-muted'}`}>{outcomeLabels[p.outcome]}</span></div>
    <h2 className="mt-4 break-words text-xl font-semibold">{p.vehicle.brand} {p.vehicle.model} · {p.vehicle.year}</h2>
    {p.vehicle.version && <p className="mt-2 text-sm text-muted">{p.vehicle.version}</p>}
    <dl className="mt-6 grid gap-5 text-sm sm:grid-cols-2"><div><dt className="text-muted">Seu último lance</dt><dd className="mt-1 text-lg font-semibold">{formatMoney(p.myBid.amount)}</dd><dd className="mt-1 text-xs text-muted">{formatDate(p.myBid.createdAt)} · Brasília</dd></div><div><dt className="text-muted">Seus lances neste lote</dt><dd className="mt-1 font-medium">{p.bidCount}</dd></div>{p.finalAmount !== null && <div><dt className="text-muted">Valor final do arremate</dt><dd className="mt-1 text-lg font-semibold">{formatMoney(p.finalAmount)}</dd></div>}</dl>
    {p.outcome === 'WON' && !p.receiptPublicId && <p role="status" className="mt-5 text-sm text-muted">O comprovante ainda não está disponível. Atualize a consulta mais tarde.</p>}
    <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium text-accent dark:text-blue-300">
      <Link className="inline-flex min-h-11 items-center" to={`/leiloes/${p.auction.id}`}>Ver leilão</Link>
      <Link className="inline-flex min-h-11 items-center" to={`/auditoria/${p.lot.id}`}>Auditoria pública</Link>
      {p.receiptPublicId && <Link className="inline-flex min-h-11 items-center" to={`/comprovantes/${p.receiptPublicId}`}>Comprovante e link compartilhável</Link>}
    </div>
  </article>
}
function MyAcquisitionsContent() {
  const [page, setPage] = useState(1), resource = useParticipations(page)
  return <div className="page-container py-8 sm:py-12"><Link to="/minha-conta" className="inline-flex min-h-11 items-center text-sm font-medium text-accent dark:text-blue-300">← Minha conta</Link>
    <header className="my-6 rounded-2xl bg-navy p-7 text-white sm:p-10"><p className="text-xs font-medium tracking-[0.2em] text-blue-200 uppercase">Sua participação</p><h1 className="mt-4 text-3xl font-semibold sm:text-4xl">Meus arremates</h1><p className="mt-4 text-sm leading-7 text-slate-300">Acompanhe os lotes em que você deu lances, seus resultados e comprovantes.</p></header>
    <button type="button" onClick={resource.retry} disabled={resource.loading} className="mb-6 min-h-11 rounded-lg border border-line bg-surface px-5 text-sm font-medium hover:bg-accent/10 disabled:opacity-50">Atualizar participações</button>
    {resource.loading ? <DetailLoading label="Consultando suas participações..." /> : resource.error ? <DetailError message={resource.error.message} retry={resource.retry} /> : resource.data && <>
      {!resource.data.data.length ? <p role="status" className="rounded-2xl border border-line bg-surface p-7 text-sm text-muted">{resource.data.pagination.total === 0 ? 'Você ainda não participou de nenhum lote.' : 'Nenhuma participação nesta página.'}</p> : <div className="grid gap-6 lg:grid-cols-2">{resource.data.data.map(p => <ParticipationCard key={p.lot.id} participation={p} />)}</div>}
      <div className="mt-6"><AdminPagination pagination={resource.data.pagination} change={setPage} /></div>
    </>}
  </div>
}
export function MyAcquisitionsPage() {
  const auth = useAuth()
  if (auth.status !== 'authenticated' || auth.user?.role !== 'BIDDER') return <div className="page-container py-12"><h1 className="text-2xl font-semibold">Meus arremates</h1><p role="alert" className="mt-5">Esta consulta está disponível para participantes autenticados.</p><Link to="/entrar" className="mt-5 inline-flex min-h-11 items-center text-accent">Entrar</Link></div>
  return <MyAcquisitionsContent key={auth.user.id} />
}
