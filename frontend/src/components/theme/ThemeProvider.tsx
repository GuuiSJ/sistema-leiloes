import { useEffect, useState, type ReactNode } from 'react'
import { readThemePreference, ThemeContext, themeStorageKey, type Theme } from './theme-context'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(() =>
    document.documentElement.classList.contains('dark') ? 'dark' : 'light',
  )

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    document.documentElement.style.colorScheme = theme
  }, [theme])

  useEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: dark)')
    const synchronize = () => setTheme(readThemePreference() ?? (system.matches ? 'dark' : 'light'))
    const onStorage = (event: StorageEvent) => {
      if (event.key === themeStorageKey || event.key === null) synchronize()
    }
    const onSystemChange = () => { if (!readThemePreference()) synchronize() }
    system.addEventListener('change', onSystemChange)
    window.addEventListener('storage', onStorage)
    return () => {
      system.removeEventListener('change', onSystemChange)
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  function toggleTheme() {
    const next = theme === 'dark' ? 'light' : 'dark'
    try { localStorage.setItem(themeStorageKey, next) } catch { /* Theme still works without storage. */ }
    setTheme(next)
  }

  return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>
}
