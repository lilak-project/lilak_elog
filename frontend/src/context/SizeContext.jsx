import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { readPref, writePref, savePref, USER_CHANGED_EVENT } from './userPrefs'

const SIZES = ['normal', 'large']

const SizeContext = createContext(null)

export function SizeProvider({ children }) {
  const [size, setSize] = useState(
    () => readPref('size', 'normal')
  )

  useEffect(() => {
    document.documentElement.setAttribute('data-size', size)
    writePref('size', size)
    savePref('size', size)
  }, [size])

  useEffect(() => {
    function onUserChanged() {
      setSize(readPref('size', 'normal'))
    }
    window.addEventListener(USER_CHANGED_EVENT, onUserChanged)
    return () => window.removeEventListener(USER_CHANGED_EVENT, onUserChanged)
  }, [])

  const toggle = useCallback(() => {
    setSize(prev => (prev === 'normal' ? 'large' : 'normal'))
  }, [])

  const set = useCallback((name) => {
    if (SIZES.includes(name)) setSize(name)
  }, [])

  return (
    <SizeContext.Provider value={{ size, sizes: SIZES, toggle, set }}>
      {children}
    </SizeContext.Provider>
  )
}

export function useSize() {
  return useContext(SizeContext)
}
