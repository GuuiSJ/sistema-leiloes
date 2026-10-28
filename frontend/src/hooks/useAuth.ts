import { useContext, useSyncExternalStore } from 'react'
import { AuthContext } from '../components/auth/auth-context'

export function useAuth() {
  const session = useContext(AuthContext)
  if (!session) throw new Error('useAuth deve ser utilizado dentro de AuthProvider.')
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot)
  return { ...state, login: session.login, logout: session.logout, refresh: session.refresh, withSession: session.withSession }
}
