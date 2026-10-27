import { AuthError, type LoginInput, type LoginResponse, type SessionUser, type UserRole } from './auth'

export const sessionKey = 'leiloes-session-v1'
export type SessionState = { status: 'restoring' | 'anonymous' | 'authenticated' | 'unavailable'; user: SessionUser | null; message: string | null }
type SavedSession = { accessToken: string; expiresAt: number }
interface SessionApi { login(input: LoginInput, signal: AbortSignal): Promise<LoginResponse>; me(token: string, signal: AbortSignal): Promise<SessionUser> }
interface SessionStorage { getItem(key: string): string | null; setItem(key: string, value: string): void; removeItem(key: string): void }
interface SessionOptions { api: SessionApi; storage: SessionStorage; now?: () => number; schedule?: (fn: () => void, delay: number) => ReturnType<typeof setTimeout>; cancel?: (timer: ReturnType<typeof setTimeout>) => void }

export function createAuthSession({ api, storage, now = Date.now, schedule = setTimeout, cancel = clearTimeout }: SessionOptions) {
  let state: SessionState = { status: 'restoring', user: null, message: null }
  let saved: SavedSession | null = null, generation = 0, controller: AbortController | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  const listeners = new Set<() => void>()
  function publish(next: SessionState) { state = next; listeners.forEach(listener => listener()) }
  function removeStored() { try { storage.removeItem(sessionKey) } catch { /* Storage can be unavailable. */ } }
  function stop() { generation++; controller?.abort(); controller = null; if (timer !== undefined) cancel(timer); timer = undefined }
  function clear(message: string | null = null) {
    stop(); saved = null; removeStored(); publish({ status: 'anonymous', user: null, message })
  }
  function armExpiry() {
    if (timer !== undefined) cancel(timer)
    if (!saved) return
    const delay = saved.expiresAt - now()
    if (delay <= 0) { clear('Sua sessão expirou. Entre novamente.'); return }
    timer = schedule(() => { if (saved && saved.expiresAt > now()) armExpiry(); else clear('Sua sessão expirou. Entre novamente.') }, Math.min(delay, 2_147_483_647))
  }
  function readStored(): SavedSession | null {
    try {
      const raw = storage.getItem(sessionKey)
      if (!raw) return null
      const value: unknown = JSON.parse(raw)
      if (value && typeof value === 'object' && 'accessToken' in value && typeof value.accessToken === 'string' && value.accessToken && !/\s/.test(value.accessToken) &&
          'expiresAt' in value && typeof value.expiresAt === 'number' && Number.isSafeInteger(value.expiresAt)) return { accessToken: value.accessToken, expiresAt: value.expiresAt }
    } catch { /* Do not trust browser-stored data or publish it. */ }
    removeStored(); return null
  }
  async function refresh() {
    stop()
    saved ??= readStored()
    if (!saved) { publish({ status: 'anonymous', user: null, message: null }); return }
    if (saved.expiresAt <= now()) { clear('Sua sessão expirou. Entre novamente.'); return }
    const current = generation, candidate = saved
    controller = new AbortController()
    publish({ status: 'restoring', user: null, message: null })
    armExpiry()
    try {
      const profile = await api.me(candidate.accessToken, controller.signal)
      if (current !== generation) return
      if (candidate.expiresAt <= now()) { clear('Sua sessão expirou. Entre novamente.'); return }
      publish({ status: 'authenticated', user: profile, message: null })
    } catch (error) {
      if (current !== generation) return
      if (error instanceof AuthError && [401, 403].includes(error.status ?? 0)) clear('Sua sessão expirou ou não é mais válida. Entre novamente.')
      else publish({ status: 'unavailable', user: null, message: 'Não foi possível verificar sua sessão. Verifique a conexão e tente novamente.' })
    }
  }
  async function login(input: LoginInput, signal: AbortSignal) {
    stop()
    const current = generation, own = new AbortController()
    controller = own
    const abort = () => own.abort()
    if (signal.aborted) own.abort()
    signal.addEventListener('abort', abort, { once: true })
    try {
      const result = await api.login(input, own.signal)
      const expiresAt = now() + result.expiresIn * 1000
      const profile = await api.me(result.accessToken, own.signal)
      if (current !== generation || own.signal.aborted) throw new DOMException('Operação cancelada', 'AbortError')
      if (profile.id !== result.user.id || !Number.isSafeInteger(expiresAt) || expiresAt <= now()) throw new AuthError('Não foi possível validar a sessão recebida.')
      saved = { accessToken: result.accessToken, expiresAt }
      let message: string | null = null
      try { storage.setItem(sessionKey, JSON.stringify(saved)) } catch { message = 'A sessão funciona nesta página, mas o navegador não permitiu salvá-la para recarregamento.' }
      armExpiry()
      if (!saved || saved.expiresAt <= now()) throw new AuthError('Sua sessão expirou. Entre novamente.')
      publish({ status: 'authenticated', user: profile, message })
    } finally { signal.removeEventListener('abort', abort) }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    refresh, login, logout: () => clear(), stop,
  }
}
export type AuthSession = ReturnType<typeof createAuthSession>
export function safeReturnPath(value: unknown): string {
  return value === '/minha-conta' || value === '/area-leiloeiro' ? value : '/minha-conta'
}
export function sessionAccess(state: SessionState, roles?: UserRole[]): 'wait' | 'retry' | 'login' | 'denied' | 'allow' {
  if (state.status === 'restoring') return 'wait'
  if (state.status === 'unavailable') return 'retry'
  if (state.status !== 'authenticated' || !state.user) return 'login'
  return roles && !roles.includes(state.user.role) ? 'denied' : 'allow'
}
