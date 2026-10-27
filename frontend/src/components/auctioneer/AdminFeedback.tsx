import type { ReactNode } from 'react'
import { Link } from 'react-router'
import { useAuth } from '../../hooks/useAuth'
import type { ApiError } from '../../services/api'
import type { Pagination } from '../../services/auctions'
import { consultationError } from '../../services/auctioneer'
import { DetailLoading } from '../auctions/DetailFeedback'

export const adminInput = 'min-h-11 w-full rounded-xl border border-line bg-canvas px-3 text-sm text-ink'
export const adminButton = 'inline-flex min-h-11 items-center justify-center rounded-xl border border-line px-4 text-sm font-medium hover:bg-accent/10 disabled:cursor-default disabled:opacity-40'

export function AdminHeading({ title, description, retry }: { title: string; description: string; retry: () => void }) {
  return <div className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><h2 className="text-2xl font-semibold tracking-tight">{title}</h2><p className="mt-2 max-w-xl text-sm leading-6 text-muted">{description}</p></div><button type="button" onClick={retry} className={adminButton}>Atualizar</button></div>
}
export function AdminFeedback({ loading, error, retry, empty, children }: { loading: boolean; error: ApiError | null; retry: () => void; empty: boolean; children: ReactNode }) {
  const auth = useAuth()
  if (loading) return <DetailLoading label="Consultando registros..." />
  if (error) return <div role="alert" className="rounded-2xl border border-line bg-surface p-6"><p className="text-sm leading-6">{consultationError(error)}</p><div className="mt-4 flex flex-wrap gap-3"><button type="button" className={adminButton} onClick={retry}>Tentar novamente</button>{error.status === 401 && <><button type="button" className={adminButton} onClick={() => void auth.refresh()}>Verificar sessão</button><Link className={adminButton} to="/entrar">Entrar novamente</Link></>}</div></div>
  if (empty) return <p role="status" className="rounded-2xl border border-dashed border-line bg-surface p-10 text-center text-sm text-muted">Nenhum registro encontrado para esta consulta.</p>
  return children
}
export function AdminPagination({ pagination: p, change }: { pagination: Pagination; change: (page: number) => void }) {
  return <nav aria-label="Paginação dos registros" className="mt-5 flex flex-wrap items-center justify-between gap-3 text-sm"><p className="text-muted">{p.total.toLocaleString('pt-BR')} registros · Página {p.page} de {Math.max(1, p.totalPages)}</p><div className="flex gap-2"><button className={adminButton} type="button" disabled={p.page <= 1} onClick={() => change(p.page - 1)}>Anterior</button><button className={adminButton} type="button" disabled={p.page >= p.totalPages} onClick={() => change(p.page + 1)}>Próxima</button></div></nav>
}
export function AdminTable({ headers, children }: { headers: string[]; children: ReactNode }) {
  return <div className="overflow-x-auto rounded-2xl border border-line bg-surface"><table className="w-full text-left text-sm"><caption className="sr-only">Registros consultados</caption><thead className="border-b border-line bg-canvas text-xs text-muted"><tr>{headers.map(header => <th key={header} scope="col" className="whitespace-nowrap px-5 py-4 font-medium">{header}</th>)}</tr></thead><tbody className="divide-y divide-line">{children}</tbody></table></div>
}
export function StatusBadge({ children }: { children: ReactNode }) {
  return <span className="inline-flex whitespace-nowrap rounded-full border border-line bg-accent/5 px-2.5 py-1 text-xs font-medium">{children}</span>
}
