export const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/+$/, '')

export class ApiError extends Error {}

export async function getJson(path: string, signal: AbortSignal): Promise<unknown> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  if (signal.aborted) controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, 12_000)
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET', signal: controller.signal, credentials: 'omit', headers: { Accept: 'application/json' },
    })
    if (!response.ok) throw new ApiError('Não foi possível carregar os dados dos leilões. Tente novamente.')
    return await response.json()
  } catch (error) {
    if (signal.aborted) throw error
    if (error instanceof ApiError) throw error
    throw new ApiError(controller.signal.aborted
      ? 'A consulta demorou mais que o esperado. Tente novamente.'
      : 'Não foi possível acessar os leilões. Verifique sua conexão e tente novamente.')
  } finally {
    clearTimeout(timeout)
    signal.removeEventListener('abort', abort)
  }
}
