import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import api from '../api'
import { emitUserChanged, loadServerPrefs } from './userPrefs'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)       // { user_id, username, role, profile_color, ... }
  const [token, setToken] = useState(null)
  const [loading, setLoading] = useState(true)

  // Restore session from localStorage on mount, then refresh from server
  // so profile fields edited elsewhere (e.g. profile_color) stay in sync.
  useEffect(() => {
    const stored = localStorage.getItem('elog_token')
    const storedUser = localStorage.getItem('elog_user')
    if (stored && storedUser) {
      setToken(stored)
      const parsedUser = JSON.parse(storedUser)
      setUser(parsedUser)
      api.defaults.headers.common['Authorization'] = `Bearer ${stored}`
      // Emit immediately so contexts apply stored user prefs
      emitUserChanged(parsedUser)
      api.get('/auth/me').then(async r => {
        const cached = JSON.parse(storedUser)
        const merged = { ...cached, ...r.data, user_id: r.data.id }
        setUser(merged)
        localStorage.setItem('elog_user', JSON.stringify(merged))
        // Load server prefs and emit again so contexts pick up any server-side updates
        await loadServerPrefs()
        emitUserChanged(merged)
      }).catch(() => { /* token expired — 401 listener handles cleanup */ })
    }
    setLoading(false)
  }, [])

  // Listen for 401s from the API interceptor — token expired or invalid.
  useEffect(() => {
    function onExpired() {
      setToken(null)
      setUser(null)
      emitUserChanged(null)
      try { window.alert('세션이 만료되었습니다. 다시 로그인해 주세요.') } catch (_) {}
    }
    window.addEventListener('lilak:auth:expired', onExpired)
    return () => window.removeEventListener('lilak:auth:expired', onExpired)
  }, [])

  const login = useCallback(async (username, password) => {
    const res = await api.post('/auth/login', { username, password })
    const { access_token, user_id, role } = res.data
    let u = { user_id, username: res.data.username, role }
    setToken(access_token)
    setUser(u)
    api.defaults.headers.common['Authorization'] = `Bearer ${access_token}`
    localStorage.setItem('elog_token', access_token)
    localStorage.setItem('elog_user', JSON.stringify(u))
    // Enrich with full profile fields
    try {
      const r = await api.get('/auth/me')
      u = { ...u, ...r.data, user_id: r.data.id }
      setUser(u)
      localStorage.setItem('elog_user', JSON.stringify(u))
    } catch { /* ignore */ }
    // Load per-user prefs from server, then notify contexts
    await loadServerPrefs()
    emitUserChanged(u)
    return u
  }, [])

  const logout = useCallback(() => {
    api.post('/auth/logout').catch(() => {})   // best-effort audit marker (token still set)
    setToken(null)
    setUser(null)
    delete api.defaults.headers.common['Authorization']
    localStorage.removeItem('elog_token')
    localStorage.removeItem('elog_user')
    emitUserChanged(null)
  }, [])

  // Re-fetch /auth/me and merge into the cached user record.
  const refreshUser = useCallback(async () => {
    try {
      const r = await api.get('/auth/me')
      setUser(prev => {
        const merged = { ...(prev || {}), ...r.data, user_id: r.data.id }
        localStorage.setItem('elog_user', JSON.stringify(merged))
        return merged
      })
      return r.data
    } catch { return null }
  }, [])

  return (
    <AuthContext.Provider value={{ user, token, loading, login, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
