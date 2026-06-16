/**
 * Per-user, per-experiment UI preference helpers.
 *
 * localStorage keys are namespaced by username AND experiment, so different
 * accounts on the same browser — and the same account across different projects
 * — keep independent settings. The server copy (/auth/me/preferences) is already
 * per-experiment (separate DB per project), so the cache key now matches it.
 *
 * Flow:
 *   1. On login:  AuthContext fires `elog:user_changed` with the user object.
 *   2. Each context listens, reads the user-keyed localStorage value (or the
 *      server-fetched value), and updates its state.
 *   3. On change: context writes to user-keyed localStorage AND calls
 *      savePref() which PUTs the new value to the server (best-effort).
 */

import api, { getExperiment } from '../api'

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

/** Current experiment (project) — prefs are scoped to it. */
function currentExperiment() {
  return getExperiment() || '__default__'
}

/** localStorage key for a given pref under the current user + experiment. */
export function prefKey(name) {
  return `elog_${name}_${currentUsername()}@${currentExperiment()}`
}

/** Read a pref for the current user + experiment.
 *  Falls back (one-time, for seamless migration) to the previous per-user key,
 *  then the legacy global key. */
export function readPref(name, fallback) {
  const username = currentUsername()
  for (const k of [
    `elog_${name}_${username}@${currentExperiment()}`, // per-user, per-project (current)
    `elog_${name}_${username}`,                        // legacy per-user (pre project-scoping)
    `elog_${name}`,                                    // legacy global
  ]) {
    const v = localStorage.getItem(k)
    if (v !== null) return v
  }
  return fallback
}

/** Write a pref for the current user + experiment. */
export function writePref(name, value) {
  localStorage.setItem(prefKey(name), value)
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
    const exp = currentExperiment()
    for (const [k, v] of Object.entries(prefs)) {
      if (v) localStorage.setItem(`elog_${k}_${username}@${exp}`, v)
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
