import { useEffect, useState, type ReactNode } from 'react'
import { authApi } from '../../services/auth'
import { createAuthSession } from '../../services/auth-session'
import { AuthContext } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => createAuthSession({ api: authApi, storage: {
    getItem: key => window.sessionStorage.getItem(key),
    setItem: (key, value) => window.sessionStorage.setItem(key, value),
    removeItem: key => window.sessionStorage.removeItem(key),
  } }))
  useEffect(() => {
    void session.refresh()
    const verify = () => {
      const status = session.getSnapshot().status
      if (status === 'authenticated' || status === 'unavailable') void session.refresh()
    }
    const onVisible = () => { if (document.visibilityState === 'visible') verify() }
    window.addEventListener('focus', verify)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', verify)
      document.removeEventListener('visibilitychange', onVisible)
      session.stop()
    }
  }, [session])
  return <AuthContext.Provider value={session}>{children}</AuthContext.Provider>
}
