import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../hooks/useTheme'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()
  const label = theme === 'dark' ? 'Ativar modo claro' : 'Ativar modo escuro'
  return (
    <button type="button" onClick={toggleTheme} aria-label={label} title={label}
      className="inline-flex size-11 items-center justify-center rounded-full border border-line text-ink transition-colors hover:border-accent hover:bg-accent/10 hover:text-accent">
      {theme === 'dark' ? <Sun size={19} aria-hidden="true" /> : <Moon size={19} aria-hidden="true" />}
    </button>
  )
}
