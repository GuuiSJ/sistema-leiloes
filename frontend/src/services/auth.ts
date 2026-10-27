import { API_BASE_URL } from './api'

export type UserRole = 'BIDDER' | 'AUCTIONEER'
export interface SessionUser { id: string; name: string; email: string; role: UserRole; createdAt: string }
export interface LoginInput { email: string; password: string }
export interface RegisterInput extends LoginInput { name: string }
export interface LoginResponse { user: SessionUser; accessToken: string; tokenType: 'Bearer'; expiresIn: number }
export class AuthError extends Error {
  constructor(message: string, readonly status?: number) { super(message) }
}
export type AuthFields = Partial<Record<'name' | 'email' | 'password' | 'confirmation', string>>
export function validateAuthFields(input: LoginInput & { name?: string; confirmation?: string }, register = false): AuthFields {
  const errors: AuthFields = {}
  if (register && (!input.name || input.name.trim().length < 2 || input.name.trim().length > 120)) errors.name = 'Informe um nome entre 2 e 120 caracteres.'
  const email = input.email.trim()
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.email = 'Informe um e-mail válido.'
  if (!input.password || (register && input.password.length < 8) || new TextEncoder().encode(input.password).length > 72 || input.password.includes('\0')) {
    errors.password = register ? 'Use pelo menos 8 caracteres e no máximo 72 bytes na senha.' : 'Informe uma senha válida, com no máximo 72 bytes.'
  }
  if (register && input.confirmation !== undefined && input.confirmation !== input.password) errors.confirmation = 'As senhas precisam ser iguais.'
  return errors
}
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
function user(value: unknown): SessionUser {
  if (!object(value) || typeof value.id !== 'string' || typeof value.name !== 'string' || typeof value.email !== 'string' ||
      !['BIDDER', 'AUCTIONEER'].includes(String(value.role)) || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) {
    throw new AuthError('A resposta de autenticação não pôde ser validada.')
  }
  // Explicit public fields only. Never retain password hashes or unexpected response fields.
  return { id: value.id, name: value.name, email: value.email, role: value.role as UserRole, createdAt: value.createdAt }
}
async function request(path: '/register' | '/login' | '/me', signal: AbortSignal, body?: object, token?: string): Promise<Record<string, unknown>> {
  const controller = new AbortController(), abort = () => controller.abort()
  if (signal.aborted) abort()
  signal.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, 12_000)
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth${path}`, {
      method: body ? 'POST' : 'GET', credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
      headers: { Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    if (!response.ok) {
      const message = response.status === 401 ? path === '/login' ? 'E-mail ou senha inválidos.' : 'Sua sessão expirou ou não é mais válida. Entre novamente.'
        : response.status === 409 ? 'Não foi possível cadastrar este e-mail. Se já tiver conta, entre na plataforma.'
          : response.status === 400 ? 'Confira os campos preenchidos e tente novamente.'
            : response.status === 403 ? 'Você não tem permissão para esta operação.'
              : response.status === 429 ? 'Muitas tentativas. Aguarde um momento antes de tentar novamente.'
                : 'O serviço de acesso está indisponível. Tente novamente mais tarde.'
      throw new AuthError(message, response.status)
    }
    const result: unknown = await response.json()
    if (!object(result)) throw new AuthError('A resposta de autenticação não pôde ser validada.')
    return result
  } catch (error) {
    if (signal.aborted) throw error
    if (error instanceof AuthError) throw error
    throw new AuthError(controller.signal.aborted ? 'A verificação demorou mais que o esperado. Tente novamente.' : 'Não foi possível acessar o serviço. Verifique sua conexão e tente novamente.')
  } finally { clearTimeout(timer); signal.removeEventListener('abort', abort) }
}
export const authApi = {
  async register(input: RegisterInput, signal: AbortSignal): Promise<SessionUser> {
    const fields = { name: input.name, email: input.email, password: input.password }
    if (Object.keys(validateAuthFields(fields, true)).length) throw new AuthError('Confira os campos do cadastro.')
    return user((await request('/register', signal, { name: fields.name.trim(), email: fields.email.trim().toLowerCase(), password: fields.password, role: 'BIDDER' })).user)
  },
  async login(input: LoginInput, signal: AbortSignal): Promise<LoginResponse> {
    if (Object.keys(validateAuthFields(input)).length) throw new AuthError('Confira o e-mail e a senha.')
    const data = await request('/login', signal, { email: input.email.trim().toLowerCase(), password: input.password })
    if (typeof data.accessToken !== 'string' || !data.accessToken || /\s/.test(data.accessToken) || data.tokenType !== 'Bearer' ||
        typeof data.expiresIn !== 'number' || !Number.isSafeInteger(data.expiresIn) || data.expiresIn <= 0 || data.expiresIn > Number.MAX_SAFE_INTEGER / 1000) {
      throw new AuthError('A resposta de autenticação não pôde ser validada.')
    }
    return { user: user(data.user), accessToken: data.accessToken, tokenType: 'Bearer', expiresIn: data.expiresIn }
  },
  async me(token: string, signal: AbortSignal): Promise<SessionUser> {
    return user((await request('/me', signal, undefined, token)).user)
  },
}
