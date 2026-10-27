// Public Vite configuration. No requests are made in this initial stage.
export const API_BASE_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3000').replace(/\/+$/, '')
