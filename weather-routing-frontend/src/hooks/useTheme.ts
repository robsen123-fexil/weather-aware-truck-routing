import { useCallback, useState } from 'react'

export type ThemeMode = 'light' | 'dark'

const STORAGE_KEY = 'wr-theme'

function readStoredTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw === 'dark' || raw === 'light') return raw
  } catch {
    /* ignore */
  }
  return 'dark'
}

function applyTheme(mode: ThemeMode) {
  const root = document.documentElement
  root.classList.toggle('dark', mode === 'dark')
  root.dataset.theme = mode
  root.style.colorScheme = mode
}

function persistTheme(mode: ThemeMode) {
  try {
    localStorage.setItem(STORAGE_KEY, mode)
  } catch {
    /* ignore */
  }
}

/** Apply theme before React paints (also used from index.html inline script). */
export function initTheme() {
  applyTheme(readStoredTheme())
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(() =>
    typeof document !== 'undefined' ? readStoredTheme() : 'light',
  )

  const setTheme = useCallback((mode: ThemeMode) => {
    applyTheme(mode)
    persistTheme(mode)
    setThemeState(mode)
  }, [])

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next: ThemeMode = prev === 'dark' ? 'light' : 'dark'
      applyTheme(next)
      persistTheme(next)
      return next
    })
  }, [])

  return { theme, setTheme, toggleTheme, isDark: theme === 'dark' }
}
