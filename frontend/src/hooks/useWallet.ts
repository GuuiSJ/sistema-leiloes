import { useEffect, useState } from 'react'
import { useAuth } from './useAuth'
import { canViewWallet, getWallet, getWalletHistory, WalletError } from '../services/wallet'

export interface FinancialState<T> { loading: boolean; data: T | null; error: WalletError | null; retry: () => void }

function useWalletResource<T>(key: string, read: (token: string, signal: AbortSignal) => Promise<T>, requested: boolean): FinancialState<T> {
  const auth = useAuth()
  const enabled = requested && auth.status === 'authenticated' && canViewWallet(auth.user?.role)
  const identity = `${auth.status}:${auth.user?.id ?? ''}:${auth.user?.role ?? ''}:${key}`
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ identity: string; loading: boolean; data: T | null; error: WalletError | null }>({ identity, loading: enabled, data: null, error: null })
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    setState({ identity, loading: true, data: null, error: null })
    auth.withSession(read, controller.signal).then(data => {
      if (!controller.signal.aborted) setState({ identity, data, loading: false, error: null })
    }).catch(error => {
      if (!controller.signal.aborted) setState({ identity, data: null, loading: false,
        error: error instanceof WalletError ? error : new WalletError('Não foi possível consultar os dados financeiros. Tente novamente.') })
    })
    return () => controller.abort()
  }, [identity, enabled, attempt, auth.withSession])
  // Never show a previous user's balances while session identity is changing.
  const current = enabled && state.identity === identity
  return { loading: enabled && (!current || state.loading), data: current ? state.data : null, error: current ? state.error : null, retry: () => setAttempt(value => value + 1) }
}
export function useWallet(requested: boolean, page: number) {
  const wallet = useWalletResource('wallet', getWallet, requested)
  const history = useWalletResource(`history:${page}`, (token, signal) => getWalletHistory(page, token, signal), requested)
  return { wallet, history }
}
