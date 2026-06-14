import axios from 'axios'

// ── Multi-experiment routing ────────────────────────────────────────────────
// Like the original elog launcher: each experiment ("project") is its own DB.
// When an experiment is selected, every call is routed through the launcher's
// stable reverse proxy `/launcher/p/<experiment>/api/...` (the `/launcher`
// prefix is proxied to the launcher :8010 by Vite). With no experiment chosen,
// we fall back to the plain `/api` proxy (the single default backend) so the
// app still works standalone.
const EXPERIMENT_KEY = 'elog_experiment'
export function getExperiment() { return localStorage.getItem(EXPERIMENT_KEY) || '' }
export function setExperiment(name) {
  if (name) localStorage.setItem(EXPERIMENT_KEY, name)
  else localStorage.removeItem(EXPERIMENT_KEY)
}
export function apiBaseFor(name) { return name ? `/launcher/p/${name}/api` : '/api' }

// The launcher's own API (project list / create / start / stop / delete) lives
// at `/launcher/api/...`, independent of any selected experiment.
export const launcher = axios.create({ baseURL: '/launcher/api', timeout: 30000 })

const api = axios.create({
  baseURL: apiBaseFor(getExperiment()),
  timeout: 30000,
})

// Restore the auth header SYNCHRONOUSLY at module load — before any component
// effect runs. React runs child effects before parent ones, so without this the
// Shell's notification poll (and others) would fire before AuthContext's effect
// sets the header, get a spurious 401, and wrongly tear down a valid session.
{
  const t = localStorage.getItem('elog_token')
  if (t) api.defaults.headers.common['Authorization'] = `Bearer ${t}`
}

// Clear stale credentials and tell the app to surface the login screen. We
// dispatch a custom event so any listener (AuthContext) can react without
// coupling api.js to React state. Idempotent — only fires once per session.
function endSession() {
  if (!localStorage.getItem('elog_token')) return
  localStorage.removeItem('elog_token')
  localStorage.removeItem('elog_user')
  delete api.defaults.headers.common['Authorization']
  window.dispatchEvent(new CustomEvent('lilak:auth:expired'))
}

// A 401 does NOT necessarily mean the session expired: individual endpoints can
// reject a perfectly valid token (e.g. a backend that doesn't implement
// /auth/me/preferences, or a notifications poll hitting a stricter route). If we
// logged out on every stray 401, one broken endpoint polled on a timer would
// kick the user out repeatedly.
//
// So: only `/auth/me` is treated as the canonical session check. A 401 from any
// OTHER endpoint triggers a single /auth/me verification — if the token is still
// good there, we keep the session and just let the caller handle its own error.
const isAuthCheck = (url = '') => /\/auth\/me(?:$|[/?])/.test(url) && !url.includes('preferences')
let verifying = false

api.interceptors.response.use(
  (resp) => resp,
  async (err) => {
    const status = err?.response?.status
    const url = err?.config?.url || ''
    if (status !== 401 || !localStorage.getItem('elog_token')) return Promise.reject(err)

    // The session check itself failed → genuinely logged out.
    if (isAuthCheck(url)) { endSession(); return Promise.reject(err) }

    // Stray 401 from some other endpoint → verify the token once before nuking.
    // Concurrent stray 401s (e.g. the 30s poll) while a check is in flight just
    // reject without logging out.
    if (!verifying) {
      verifying = true
      try {
        await api.get('/auth/me')   // 200 → session is fine, keep it
      } catch {
        // /auth/me also 401'd → its own pass through isAuthCheck called endSession
      } finally {
        verifying = false
      }
    }
    return Promise.reject(err)
  },
)

export default api
