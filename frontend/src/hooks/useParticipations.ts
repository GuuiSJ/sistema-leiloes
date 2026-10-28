import { useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { getParticipations, type Participation } from '../services/participation-audit'
import type { Page } from '../services/auctions'
import { ApiError } from '../services/api'

export function useParticipations(page: number) {
  const auth = useAuth(), enabled = auth.status === 'authenticated' && auth.user?.role === 'BIDDER'
  const key = `${auth.status}:${auth.user?.id}:${auth.user?.role}:${page}`
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; data: Page<Participation> | null; loading: boolean; error: Error | null }>({ key, data: null, loading: enabled, error: null })
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    setState({ key, data: null, loading: true, error: null })
    auth.withSession((token, signal) => getParticipations(page, token, signal), controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ key, data, loading: false, error: null })
    }).catch(error => {
      if (!controller.signal.aborted) setState({ key, data: null, loading: false, error: error instanceof Error ? error : new ApiError('Não foi possível consultar seus arremates.') })
    })
    return () => controller.abort()
  }, [key, enabled, attempt, auth.withSession, page])
  const current = enabled && state.key === key
  return { data: current ? state.data : null, loading: enabled && (!current || state.loading), error: current ? state.error : null, retry: () => setAttempt(value => value + 1) }
}
