import { Link, Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '../../hooks/useAuth'
import type { UserRole } from '../../services/auth'
import { sessionAccess } from '../../services/auth-session'
import { SessionFeedback } from './SessionFeedback'

export function ProtectedRoute({ roles }: { roles?: UserRole[] }) {
  const auth = useAuth(), location = useLocation()
  const access = sessionAccess(auth, roles)
  if (access === 'wait' || access === 'retry') return <SessionFeedback />
  if (access === 'login') return <Navigate to="/entrar" replace state={{ from: location.pathname }} />
  if (access === 'denied') return <section className="page-container py-16"><h1 className="text-3xl font-semibold">Acesso não permitido</h1><p className="mt-4 text-muted">Esta área é exclusiva do perfil de leiloeiro.</p><Link to="/minha-conta" className="mt-6 inline-flex min-h-11 items-center rounded-md text-accent dark:text-blue-300">Voltar à minha conta</Link></section>
  return <Outlet />
}
