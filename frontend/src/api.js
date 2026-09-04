import axios from 'axios'

// ── Multi-experiment routing ────────────────────────────────────────────────
// Like the original elog launcher: each experiment ("project") is its own DB.
// When an experiment is selected, every call is routed through the launcher's
// stable reverse proxy `/launcher/p/<experiment>/api/...` (the `/launcher`
// prefix is proxied to the launcher :8010 by Vite). With no experiment chosen,
// we fall back to the plain `/api` proxy (the single default backend) so the
// app still works standalone.
// Portal mode: when this app is served behind the LILAK Service Manager proxy
// (`/pp/<svc>/<proj>/`), the portal injects `window.__PORTAL_BASE__` = that
// prefix. The experiment's own backend is then reached DIRECTLY at
// `<base>/api` (the portal proxies it), not via the launcher's `/launcher/p/…`.
export const PORTAL_BASE =
  (typeof window !== 'undefined' && window.__PORTAL_BASE__) || ''

const EXPERIMENT_KEY = 'elog_experiment'
export function getExperiment() {
  // Under the portal, the experiment is fixed by the URL: /pp/<svc>/<proj>.
  if (PORTAL_BASE) return PORTAL_BASE.split('/').filter(Boolean).pop() || ''
  return localStorage.getItem(EXPERIMENT_KEY) || ''
}
export function setExperiment(name) {
  if (PORTAL_BASE) return                          // fixed by URL; ignore
  if (name) localStorage.setItem(EXPERIMENT_KEY, name)
  else localStorage.removeItem(EXPERIMENT_KEY)
}
export function apiBaseFor(name) {
  if (PORTAL_BASE) return `${PORTAL_BASE}/api`
  return name ? `/launcher/p/${name}/api` : '/api'
}

// The launcher's own API (project list / create / start / stop / delete) lives
// at `/launcher/api/...`. Unused under the portal (the portal owns that surface).
export const launcher = axios.create({
  baseURL: PORTAL_BASE ? `${PORTAL_BASE}/api` : '/launcher/api', timeout: 30000,
})

const api = axios.create({
  baseURL: apiBaseFor(getExperiment()),
  timeout: 30000,
})

// Restore the auth header SYNCHRONOUSLY at module load — before any component
// effect runs. React runs child effects before parent ones, so without this the
// Shell's notification poll (and others) would fire before AuthContext's effect
// sets the header, get a spurious 401, and wrongly tear down a valid session.
// The portal hands its token over as the elog session token, but only when a
// project is ENTERED from the project list (ProjectsPage.enter). So once
// `elog_token` is gone, reloading the page does not bring it back: the app sits
// permanently logged out, reads still work because most GETs allow anonymous,
// and every Edit/Delete button silently disappears because they are gated on
// `user`. That is not a session that expired -- it is a session that was thrown
// away while the portal one is still perfectly good. Re-adopt it here.
const PORTAL_TOKEN_KEY = 'lilak_portal_token'

function useToken(tok) {
  localStorage.setItem('elog_token', tok)
  localStorage.removeItem('elog_user')      // force AuthContext to re-fetch /auth/me
  api.defaults.headers.common['Authorization'] = `Bearer ${tok}`
}

{
  const t = localStorage.getItem('elog_token')
  if (t) {
    api.defaults.headers.common['Authorization'] = `Bearer ${t}`
  } else {
    // No elog session, but the portal one is still in this browser: adopt it
    // rather than showing a logged-out page the user cannot log back in to.
    const portal = localStorage.getItem(PORTAL_TOKEN_KEY)
    if (portal) useToken(portal)
  }
}

// Clear stale credentials and tell the app to surface the login screen. We
// dispatch a custom event so any listener (AuthContext) can react without
// coupling api.js to React state. Idempotent — only fires once per session.
function endSession() {
  const failed = localStorage.getItem('elog_token')
  if (!failed) return
  localStorage.removeItem('elog_token')
  localStorage.removeItem('elog_user')
  delete api.defaults.headers.common['Authorization']

  // Falling back to the portal token is what makes this recoverable. It is only
  // tried when the token that failed was a DIFFERENT one -- re-adopting the very
  // token that just 401'd would loop.
  const portal = localStorage.getItem(PORTAL_TOKEN_KEY)
  if (portal && portal !== failed) {
    useToken(portal)
    window.dispatchEvent(new CustomEvent('lilak:auth:renewed'))
    return
  }
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
    // Portal account-link required: an independent local account shares this
    // portal user's email. Surface a one-time link prompt (PortalLinkGate).
    const detail = err?.response?.data?.detail
    if (status === 409 && detail && detail.code === 'PORTAL_LINK_REQUIRED') {
      window.dispatchEvent(new CustomEvent('lilak:portal-link-required', { detail }))
      return Promise.reject(err)
    }
    if (status !== 401 || !localStorage.getItem('elog_token')) return Promise.reject(err)

    // The session check itself failed. Before throwing the session away, make
    // sure it is really gone: a service that has just restarted answers the
    // first request in flight with a 401 while it is still coming up, and one
    // such answer used to log the tab out for good -- reads kept working (most
    // GETs allow anonymous) so the page looked normal, with every Edit/Delete
    // button quietly missing. Confirm once, out of band so this interceptor
    // does not recurse on its own retry.
    if (isAuthCheck(url)) {
      const tok = localStorage.getItem('elog_token')
      if (tok) {
        try {
          await new Promise(r => setTimeout(r, 700))
          await axios.get(`${api.defaults.baseURL}/auth/me`, {
            headers: { Authorization: `Bearer ${tok}` }, timeout: 10000,
          })
          // Still good — that 401 was the restart, not the session.
          window.dispatchEvent(new CustomEvent('lilak:auth:renewed'))
          return Promise.reject(err)
        } catch { /* genuinely rejected → fall through and end it */ }
      }
      endSession()
      return Promise.reject(err)
    }

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
