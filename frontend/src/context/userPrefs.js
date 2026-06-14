/**
 * Per-user UI preference helpers.
 *
 * localStorage keys are namespaced by username so different accounts on the
 * same browser keep independent settings.
 *
 * Flow:
 *   1. On login:  AuthContext fires `elog:user_changed` with the user object.
 *   2. Each context listens, reads the user-keyed localStorage value (or the
 *      server-fetched value), and updates its state.
 *   3. On change: context writes to user-keyed localStorage AND calls
 *      savePref() which PUTs the new value to the server (best-effort).
 */

import api from '../api'

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Returns the current username from localStorage (no React dep). */
function currentUsername() {
  try {
    const u = JSON.parse(localStorage.getItem('elog_user') || 'null')
    return u?.username || '__guest__'
  } catch {
    return '__guest__'
  }
}

/** localStorage key for a given pref under the current user. */
export function prefKey(name) {
  return `elog_${name}_${currentUsername()}`
}

/** Read a pref for the current user (falls back to legacy unkeyed value). */
export function readPref(name, fallback) {
  const username = currentUsername()
  // User-specific key first
  const userVal = localStorage.getItem(`elog_${name}_${username}`)
  if (userVal !== null) return userVal
  // Legacy global key (first login after migration)
  const legacyVal = localStorage.getItem(`elog_${name}`)
  return legacyVal !== null ? legacyVal : fallback
}

/** Write a pref for the current user. */
export function writePref(name, value) {
  const username = currentUsername()
  localStorage.setItem(`elog_${name}_${username}`, value)
}

// Gate: provider effects fire on initial mount with locally-cached values.
// Writing those to the server before the server copy has been read once
// would clobber newer prefs saved from another device — so PUTs are
// disabled until loadServerPrefs() has completed for this session.
let serverPrefsLoaded = false

/** POST pref to the server (best-effort, never throws). */
export async function savePref(name, value) {
  if (!serverPrefsLoaded) return
  try {
    await api.put('/auth/me/preferences', { [name]: value })
  } catch {
    // ignore — offline or not authenticated
  }
}

/**
 * Load all prefs from the server for the current user and write them to
 * user-keyed localStorage. Call this right after login.
 */
export async function loadServerPrefs() {
  try {
    const res = await api.get('/auth/me/preferences')
    const prefs = res.data || {}
    const username = currentUsername()
    for (const [k, v] of Object.entries(prefs)) {
      if (v) localStorage.setItem(`elog_${k}_${username}`, v)
    }
    serverPrefsLoaded = true
    return prefs
  } catch {
    return {}
  }
}

/** Custom event fired by AuthContext after user changes. */
export const USER_CHANGED_EVENT = 'elog:user_changed'

export function emitUserChanged(user) {
  window.dispatchEvent(new CustomEvent(USER_CHANGED_EVENT, { detail: user }))
}
