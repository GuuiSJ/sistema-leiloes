import { createContext } from 'react'
import type { AuthSession } from '../../services/auth-session'
export const AuthContext = createContext<AuthSession | null>(null)
