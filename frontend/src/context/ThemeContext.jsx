import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { readPref, writePref, savePref, USER_CHANGED_EVENT } from './userPrefs'

const THEMES = ['bright', 'dark', 'lowcontrast']
const ICONS  = { bright: '☀', dark: '🌙', lowcontrast: '🌥' }

const ThemeContext = createContext(null)

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(
    () => readPref('theme', 'bright')
  )

  // Apply to DOM + persist whenever theme changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    writePref('theme', theme)
    savePref('theme', theme)
  }, [theme])

  // Reload on account switch. Logged OUT → always bright (the default look).
  useEffect(() => {
    function onUserChanged(e) {
      const loggedOut = !e?.detail
      setTheme(loggedOut ? 'bright' : readPref('theme', 'bright'))
    }
    window.addEventListener(USER_CHANGED_EVENT, onUserChanged)
    return () => window.removeEventListener(USER_CHANGED_EVENT, onUserChanged)
  }, [])

  const cycle = useCallback(() => {
    setTheme(prev => {
      const idx = THEMES.indexOf(prev)
      return THEMES[(idx + 1) % THEMES.length]
    })
  }, [])

  const icon = ICONS[theme] ?? '☀'

  const set = useCallback((name) => {
    if (THEMES.includes(name)) setTheme(name)
  }, [])

  return (
    <ThemeContext.Provider value={{ theme, themes: THEMES, cycle, set, icon }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
