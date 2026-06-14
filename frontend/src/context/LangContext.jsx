import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import ko from '../i18n/ko'
import en from '../i18n/en'
import { readPref, writePref, savePref, USER_CHANGED_EVENT } from './userPrefs'

const DICTS = { ko, en }
const LangContext = createContext(null)

export function LangProvider({ children }) {
  const [lang, setLang] = useState(() => readPref('lang', 'en'))

  useEffect(() => {
    writePref('lang', lang)
    savePref('lang', lang)
  }, [lang])

  useEffect(() => {
    function onUserChanged() {
      setLang(readPref('lang', 'en'))
    }
    window.addEventListener(USER_CHANGED_EVENT, onUserChanged)
    return () => window.removeEventListener(USER_CHANGED_EVENT, onUserChanged)
  }, [])

  const toggle = useCallback(() => {
    setLang(prev => prev === 'ko' ? 'en' : 'ko')
  }, [])

  const set = useCallback((name) => {
    if (name === 'ko' || name === 'en') setLang(name)
  }, [])

  function t(key, ...args) {
    const val = DICTS[lang]?.[key] ?? DICTS['en']?.[key] ?? key
    return typeof val === 'function' ? val(...args) : val
  }

  return (
    <LangContext.Provider value={{ lang, toggle, set, t }}>
      {children}
    </LangContext.Provider>
  )
}

export function useLang() {
  return useContext(LangContext)
}
