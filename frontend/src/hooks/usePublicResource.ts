import { useEffect, useState } from 'react'
import { ApiError } from '../services/api'

// The key identifies every input to the supplied read operation.
export function usePublicResource<T>(key: string, load: (signal: AbortSignal) => Promise<T>, enabled = true) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; data: T | null; error: ApiError | null; loading: boolean }>({ key, data: null, error: null, loading: enabled })
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    setState({ key, data: null, error: null, loading: true })
    load(controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ key, data, error: null, loading: false })
    }).catch(error => {
      if (!controller.signal.aborted) setState({ key, data: null, loading: false, error: error instanceof ApiError ? error : new ApiError('Não foi possível consultar os dados. Tente novamente.') })
    })
    return () => controller.abort()
  }, [key, attempt, enabled])
  return { data: state.key === key ? state.data : null, error: state.key === key ? state.error : null,
    loading: enabled && (state.key !== key || state.loading), retry: () => setAttempt(value => value + 1) }
}
