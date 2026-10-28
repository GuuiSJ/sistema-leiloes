import { Link, useSearchParams } from 'react-router'
import { useAuth } from '../hooks/useAuth'
import { usePublicResource } from '../hooks/usePublicResource'
import { getLotResults, type LotResult } from '../services/live-room'
import { AuthError } from '../services/auth'
import { ApiError } from '../services/api'
import { formatMoney } from '../services/formatters'
import { AdminFeedback, AdminHeading, AdminPagination } from '../components/auctioneer/AdminFeedback'

export function AuctioneerResultCard({ result: r }: { result: LotResult }) {
  return <article className="min-w-0 rounded-2xl border border-line bg-surface p-6"><p className="text-xs text-muted">{r.auctionTitle} · Lote {r.number}</p><h3 className="mt-3 break-words text-xl font-semibold">{r.vehicle.brand} {r.vehicle.model} · {r.vehicle.year}</h3><p className="mt-4 text-sm font-medium">{r.status === 'SOLD' ? 'Arrematado' : 'Encerrado sem vencedor'}</p>
    {r.status === 'SOLD' && (r.finalAmount !== null ? <><p className="mt-4 text-xs text-muted">Valor final confirmado</p><p className="mt-2 text-2xl font-semibold">{formatMoney(r.finalAmount)}</p><details className="mt-4 text-xs text-muted"><summary className="min-h-8 cursor-pointer">Identificador público do lance vencedor</summary><p className="break-all font-mono">{r.winningBidId}</p></details></> : <p role="status" className="mt-4 text-sm text-muted">Valor final e comprovante ainda não disponíveis. Atualize a consulta.</p>)}
    <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm font-medium text-accent dark:text-blue-300"><Link className="inline-flex min-h-11 items-center" to={`/area-leiloeiro/lotes/${r.auctionId}/${r.lotId}/editar`}>Detalhes do lote</Link><Link className="inline-flex min-h-11 items-center" to={`/auditoria/${r.lotId}`}>Histórico e auditoria</Link>{r.receiptPublicId && <Link className="inline-flex min-h-11 items-center" to={`/comprovantes/${r.receiptPublicId}`}>Comprovante público</Link>}</div>
  </article>
}
function ResultsContent() {
  const auth = useAuth(), [query, setQuery] = useSearchParams()
  const rawPage = Number(query.get('page') ?? 1), page = Number.isSafeInteger(rawPage) && rawPage > 0 && rawPage <= 1000000 ? rawPage : 1
  const auctionId = query.get('auctionId') ?? undefined
  const resource = usePublicResource(`own-results:${auth.user?.id}:${auth.status}:${page}:${auctionId ?? ''}`, async signal => {
    try { return await auth.withSession((token, inner) => getLotResults(page, auctionId, token, inner), signal) }
    catch (error) { if (error instanceof AuthError) throw new ApiError(error.message, error.status); throw error }
  })
  return <><AdminHeading title="Resultados dos meus leilões" description="Lotes encerrados dos leilões sob sua responsabilidade, com valores finais confirmados e acesso ao histórico." retry={resource.retry} />
    {auctionId && <Link to="/area-leiloeiro/resultados" className="mb-5 inline-flex min-h-11 items-center text-sm font-medium text-accent dark:text-blue-300">Ver resultados de todos os meus leilões</Link>}
    <p className="mb-6 text-xs leading-6 text-muted">A identificação pública é a do lance vencedor. Dados pessoais do participante não são divulgados.</p>
    <AdminFeedback {...resource} empty={resource.data?.pagination.total === 0}>{resource.data && <>
      {resource.data.data.length ? <div className="grid gap-6 xl:grid-cols-2">{resource.data.data.map(result => <AuctioneerResultCard key={result.lotId} result={result} />)}</div> : resource.data.pagination.total > 0 && <p role="status">Nenhum resultado nesta página.</p>}
      <div className="mt-6"><AdminPagination pagination={resource.data.pagination} change={nextPage => { const next = new URLSearchParams(query); next.set('page', String(nextPage)); setQuery(next) }} /></div>
    </>}</AdminFeedback>
  </>
}
export function AuctioneerResultsPage() {
  const auth = useAuth()
  if (auth.status !== 'authenticated' || auth.user?.role !== 'AUCTIONEER') return <p role="alert">Consulta exclusiva para o leiloeiro autenticado responsável pelos leilões.</p>
  return <ResultsContent key={auth.user.id} />
}
