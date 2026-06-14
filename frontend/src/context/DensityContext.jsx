import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { readPref, writePref, savePref, USER_CHANGED_EVENT } from './userPrefs'

const DENSITIES = ['cozy', 'compact']

const DensityContext = createContext(null)

export function DensityProvider({ children }) {
  const [density, setDensity] = useState(
    () => readPref('density', 'cozy')
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-density', density)
    writePref('density', density)
    savePref('density', density)
  }, [density])

  useEffect(() => {
    function onUserChanged() {
      setDensity(readPref('density', 'cozy'))
    }
    window.addEventListener(USER_CHANGED_EVENT, onUserChanged)
    return () => window.removeEventListener(USER_CHANGED_EVENT, onUserChanged)
  }, [])

  const toggle = useCallback(() => {
    setDensity(prev => {
      const idx = DENSITIES.indexOf(prev)
      return DENSITIES[(idx + 1) % DENSITIES.length]
    })
  }, [])

  const isCompact = density === 'compact'

  const set = useCallback((name) => {
    if (DENSITIES.includes(name)) setDensity(name)
  }, [])

  return (
    <DensityContext.Provider value={{ density, densities: DENSITIES, toggle, set, isCompact }}>
      {children}
    </DensityContext.Provider>
  )
}

export function useDensity() {
  return useContext(DensityContext)
}
