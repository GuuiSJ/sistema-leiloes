import { createContext } from 'react'

export type Theme = 'light' | 'dark'
export const themeStorageKey = 'leiloes-theme'
export const ThemeContext = createContext<{
  theme: Theme
  toggleTheme: () => void
} | null>(null)

export function readThemePreference(): Theme | null {
  try {
    const value = localStorage.getItem(themeStorageKey)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}
