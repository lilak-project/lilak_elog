import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, Button, CoverPage, CoverCard, randomProjectIcon, PROJECT_ICONS, AVATAR_COLORS } from 'lilak-ui'
import { launcher, setExperiment, getExperiment } from '../api'
import { useLang } from '../context/LangContext'
import AdminPanel from './portal/AdminPanel'

/**
 * ProjectsPage — the LILAK portal cover page.
 *
 * Lists the services (elog projects today; other apps later) and gates them
 * behind a PORTAL account. Portal accounts are central, living at the launcher
 * (separate from each service's own users), so this page is login-first: you
 * sign in / sign up here, then see the list.
 *
 * Auth always targets the portal through the `launcher` axios
 * (`/launcher/api/auth/*` → the launcher's own `/api/auth/*`), independent of any
 * selected experiment — so it works whether the app is served by the launcher
 * or by the Vite dev proxy.
 */

const PORTAL_TOKEN_KEY = 'lilak_portal_token'

// Stable per-name fallback icon so services without a stored icon still look
// distinct (e.g. ones created before icons existed).
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) }
const iconFor = (name, stored) => stored || PROJECT_ICONS[hashStr(name) % PROJECT_ICONS.length]

const inputStyle = {
  width: '100%', height: 36, padding: '0 12px', borderRadius: 8, fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-body, 13px)', backgroundColor: 'var(--input-bg)', color: 'var(--text-primary)',
  border: '1px solid var(--input-border)', outline: 'none',
}

// Attach / clear the portal bearer token on the shared launcher axios.
function setPortalToken(token) {
  if (token) {
    localStorage.setItem(PORTAL_TOKEN_KEY, token)
    launcher.defaults.headers.common['Authorization'] = `Bearer ${token}`
  } else {
    localStorage.removeItem(PORTAL_TOKEN_KEY)
    delete launcher.defaults.headers.common['Authorization']
  }
}

// ── Login / Sign-up card (shown when logged out) ──────────────────────────────
function AuthCard({ t, onAuthed }) {
  const [mode, setMode] = useState('login')   // 'login' | 'signup'
  const [f, setF] = useState({ username: '', password: '', email: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setF((s) => ({ ...s, [k]: e.target.value }))

  async function submit(e) {
    e?.preventDefault()
    setBusy(true); setErr('')
    try {
      const res = mode === 'login'
        ? await launcher.post('/auth/login', { username: f.username.trim(), password: f.password })
        : await launcher.post('/auth/register', {
            // display_name is left unset → the backend defaults it to username.
            username: f.username.trim(), email: f.email.trim(), password: f.password,
          })
      const tok = res.data.access_token
      setPortalToken(tok)                      // authorize the follow-up /auth/me
      const me = await launcher.get('/auth/me')
      onAuthed(me.data)
    } catch (e2) {
      setErr(e2?.response?.data?.detail || t(mode === 'login' ? 'projects_login_fail' : 'projects_signup_fail'))
    } finally { setBusy(false) }
  }

  const tabBtn = (m, label) => (
    <Button variant={mode === m ? 'primary' : 'ghost'} onClick={() => { setMode(m); setErr('') }}
      style={{ flex: 1, justifyContent: 'center' }}>{label}</Button>
  )

  return (
    <div style={{ maxWidth: 360, margin: '28px auto 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)', textAlign: 'center' }}>
        {t('projects_login_prompt')}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        {tabBtn('login', t('projects_login_title'))}
        {tabBtn('signup', t('projects_signup'))}
      </div>
      <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <input autoFocus placeholder={t('projects_login_user')} value={f.username} onChange={set('username')} style={inputStyle} />
        {mode === 'signup' && (
          <input placeholder={t('projects_signup_email')} value={f.email} onChange={set('email')} style={inputStyle} />
        )}
        <input type="password" placeholder={t('projects_login_pass')} value={f.password} onChange={set('password')} style={inputStyle} />
        {err && <div style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--danger-text)' }}>{err}</div>}
        {mode === 'signup' && (
          <div style={{ fontSize: 'var(--fs-micro, 10px)', color: 'var(--text-muted)' }}>{t('projects_signup_admin_hint')}</div>
        )}
        <Button type="submit" style={{ justifyContent: 'center', marginTop: 2 }}
          disabled={busy || !f.username.trim() || !f.password || (mode === 'signup' && !f.email.trim())}>
          {t(mode === 'login' ? 'projects_login_submit' : 'projects_signup_submit')}
        </Button>
      </form>
    </div>
  )
}

export default function ProjectsPage() {
  const { t } = useLang()
  const navigate = useNavigate()  // eslint-disable-line no-unused-vars

  // ── Portal auth (central accounts at the launcher) ──
  const [user, setUser] = useState(null)        // null = logged out
  const [authReady, setAuthReady] = useState(false)
  const isManager = user?.role === 'manager'

  const [projects, setProjects] = useState(null)   // null = loading
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')             // name currently acting on
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const newRef = useRef(null)
  const current = getExperiment()

  // import (drag-drop / file picker) + export
  const fileRef = useRef(null)
  const [importing, setImporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [stagedFile, setStagedFile] = useState(null)   // file waiting for a confirming Import click

  // admin access-management panel
  const [adminOpen, setAdminOpen] = useState(false)

  // Restore a saved portal session.
  useEffect(() => {
    const tok = localStorage.getItem(PORTAL_TOKEN_KEY)
    if (!tok) { setAuthReady(true); return }
    setPortalToken(tok)
    launcher.get('/auth/me')
      .then((r) => setUser(r.data))
      .catch(() => setPortalToken(null))
      .finally(() => setAuthReady(true))
  }, [])

  async function refresh() {
    try {
      // Auth-aware, per-account filtered + flagged list (see /api/services).
      const r = await launcher.get('/services')
      setProjects(r.data)
      setError('')
    } catch {
      setProjects([])
      setError(t('projects_unreachable'))
    }
  }

  async function requestAccess(name) {
    setBusy(name)
    try { await launcher.post('/access-requests', { service: name }); await refresh() }
    catch (err) { setError(err?.response?.data?.detail || t('projects_request_fail')) }
    finally { setBusy('') }
  }
  useEffect(() => { refresh() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  function enter(name) {
    // Hand the portal token over to the elog app as its session token: the elog
    // backend recognizes a portal token and links/provisions a matching local
    // user by email (see auth._resolve_portal_user). Drop the cached elog_user
    // so AuthContext re-fetches /auth/me for the resolved account.
    const tok = localStorage.getItem(PORTAL_TOKEN_KEY)
    if (tok) localStorage.setItem('elog_token', tok)
    localStorage.removeItem('elog_user')
    setExperiment(name)
    // Full reload so api.js rebuilds its baseURL for the chosen experiment.
    window.location.assign('/')
  }

  function logout() {
    launcher.post('/auth/logout').catch(() => {})   // best-effort
    setPortalToken(null)
    setUser(null)
  }

  async function create(e) {
    e?.preventDefault()
    if (!isManager) return
    const name = newName.trim()
    if (!name) return
    setCreating(true); setError('')
    try {
      const icon = randomProjectIcon()
      const color = AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)]
      await launcher.post('/projects', { name, icon, color })
      setNewName('')
      await refresh()
    } catch (err) {
      setError(err?.response?.data?.detail || t('projects_create_fail'))
    } finally { setCreating(false) }
  }

  async function stop(name) {
    if (!isManager) return
    setBusy(name)
    try { await launcher.post(`/projects/${name}/stop`); await refresh() }
    catch { /* surfaced on refresh */ } finally { setBusy('') }
  }

  async function remove(name) {
    if (!isManager) return
    if (!window.confirm(t('projects_delete_confirm', name))) return
    setBusy(name)
    try {
      await launcher.delete(`/projects/${name}`)
      if (current === name) setExperiment('')   // dropped the active one
      await refresh()
    } catch { /* surfaced on refresh */ } finally { setBusy('') }
  }

  // Download a project's data as a single .zip (the launcher zips data/<name>/).
  function exportProject(name) {
    const a = document.createElement('a')
    a.href = `${launcher.defaults.baseURL}/projects/${name}/export`
    a.download = `${name}.zip`
    document.body.appendChild(a); a.click(); a.remove()
  }

  // First free name: base, else base_2, base_3, … (avoids clashing existing ones).
  function freeName(base) {
    const names = new Set((projects || []).map((p) => p.name))
    const clean = base.replace(/[^A-Za-z0-9_-]/g, '') || 'imported'
    if (!names.has(clean)) return clean
    let n = 2
    while (names.has(`${clean}_${n}`)) n++
    return `${clean}_${n}`
  }

  // Drag-dropping / picking a .zip STAGES the file and pre-fills a free name,
  // then highlights Import so the user confirms (with that name or a new one).
  function stageFile(f) {
    if (!isManager || !f) return
    setError(''); setStagedFile(f)
    setNewName(freeName(f.name.replace(/\.zip$/i, '')))
    newRef.current?.focus()
  }

  async function doImportFile() {
    if (!isManager || !stagedFile) return
    setImporting(true); setError('')
    try {
      const fd = new FormData()
      fd.append('file', stagedFile, stagedFile.name)
      const target = newName.trim()
      if (target) fd.append('name', target)
      await launcher.post('/projects/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setNewName(''); setStagedFile(null)
      await refresh()
    } catch (err) {
      if (err?.response?.status === 409) setError(t('projects_import_exists'))
      else setError(err?.response?.data?.detail || t('projects_import_fail'))
    } finally { setImporting(false); if (fileRef.current) fileRef.current.value = '' }
  }

  function cancelStaged() { setStagedFile(null); setNewName('') }

  return (
    <CoverPage
      icon="lilak"
      title={t('projects_title')}
      subtitle={t('projects_subtitle')}
      actions={user ? (
        <>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)' }}>
            <Icon name="user" size={14} /> {user.username}{isManager ? ' · admin' : ''}
          </span>
          {isManager && (
            <Button variant="secondary" onClick={() => setAdminOpen(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              <Icon name="settings" size={14} /> {t('portal_admin_manage')}
            </Button>
          )}
          <Button variant="ghost" onClick={logout}>{t('projects_logout')}</Button>
        </>
      ) : null}
    >
      {/* Login-first: nothing until we know the auth state; then the auth card
          (logged out) or the service list (logged in). */}
      {!authReady ? null : !user ? (
        <AuthCard t={t} onAuthed={(u) => { setUser(u); refresh() }} />
      ) : (
        <>
          {error && (
            <div style={{ margin: '8px 0', padding: '10px 12px', borderRadius: 8, fontSize: 'var(--fs-small, 12px)',
              backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)', border: '1px solid var(--danger-border, transparent)' }}>
              {error}
            </div>
          )}

          {/* New project + import — managers only; hidden entirely for everyone else. */}
          {isManager && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); stageFile(e.dataTransfer.files?.[0]) }}
            style={{ margin: '12px 0 20px', padding: 8, borderRadius: 10, transition: 'background-color .1s, box-shadow .1s',
              border: '2px dashed', borderColor: dragOver ? 'var(--btn-primary-bg)' : 'transparent',
              backgroundColor: dragOver ? 'var(--info-bg)' : 'transparent' }}>
            <form onSubmit={(e) => { e.preventDefault(); stagedFile ? doImportFile() : create(e) }} style={{ display: 'flex', gap: 8 }}>
              <input
                ref={newRef} value={newName} onChange={(e) => setNewName(e.target.value)}
                placeholder={t('projects_new_placeholder')}
                style={{ ...inputStyle, height: 34 }} />
              <Button type="button" disabled={creating || !newName.trim() || !!stagedFile}
                onClick={create} style={{ minWidth: 116, justifyContent: 'center' }}>
                {t('projects_create')}
              </Button>
              <Button key={stagedFile ? 'imp-staged' : 'imp-idle'} type="button" variant={stagedFile ? 'primary' : 'secondary'}
                disabled={importing || (!!stagedFile && !newName.trim())}
                onClick={() => stagedFile ? doImportFile() : fileRef.current?.click()}
                style={{ minWidth: 92, justifyContent: 'center',
                  ...(stagedFile ? { backgroundColor: 'var(--btn-primary-bg)', color: '#fff',
                    boxShadow: '0 0 0 3px color-mix(in srgb, var(--btn-primary-bg) 28%, transparent)' } : {}) }}>
                {t('projects_import')}
              </Button>
            </form>
            {stagedFile ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 8, paddingLeft: 2, fontSize: 'var(--fs-micro, 10px)', color: 'var(--text-secondary)' }}>
                <Icon name="upload" size={12} />
                <span>{t('projects_import_staged', stagedFile.name, newName.trim() || '—')}</span>
                <button type="button" onClick={cancelStaged} title={t('close') || 'cancel'}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'inline-flex', padding: 0 }}>
                  <Icon name="close" size={12} />
                </button>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8, paddingLeft: 2, fontSize: 'var(--fs-micro, 10px)', color: 'var(--text-muted)' }}>
                <Icon name="upload" size={12} /> {t('projects_drop_hint')}
              </div>
            )}
            <input ref={fileRef} type="file" accept=".zip" hidden
              onChange={(e) => stageFile(e.target.files?.[0])} />
          </div>
          )}

          {/* List */}
          {projects === null && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>{t('home_loading')}</div>
          )}
          {projects && projects.length === 0 && !error && (
            <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 'var(--fs-small, 12px)' }}>
              {t('projects_empty')}
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {projects && projects.map((p) => {
              const isCurrent = p.name === current
              return (
                <CoverCard
                  key={p.name}
                  icon={iconFor(p.name, p.icon)}
                  title={p.name}
                  active={isCurrent}
                  badge={(
                    <span style={{ fontSize: 'var(--fs-micro, 10px)', padding: '1px 6px', borderRadius: 999, backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                      {t('service_kind_elog')}
                    </span>
                  )}
                  statusOn={p.running}
                  statusText={p.running ? t('projects_running', p.port) : t('projects_stopped')}
                  actions={
                    <>
                      {p.can_enter ? (
                        <Button variant="primary" onClick={() => enter(p.name)}
                          style={{ minWidth: 72, justifyContent: 'center' }}>{t('projects_open')}</Button>
                      ) : p.can_request ? (
                        <Button variant="secondary" disabled={p.requested || busy === p.name} onClick={() => requestAccess(p.name)}
                          style={{ minWidth: 112, justifyContent: 'center' }}>
                          {p.requested ? t('projects_requested') : t('projects_request')}
                        </Button>
                      ) : null}
                      {isManager && (
                        <>
                          <Button variant="secondary" disabled={!p.running || busy === p.name} onClick={() => stop(p.name)}
                            style={{ minWidth: 56, justifyContent: 'center' }}>{t('projects_stop')}</Button>
                          <Button variant="ghost" icon onClick={() => exportProject(p.name)} title={t('projects_export')}>
                            <Icon name="download" size={15} />
                          </Button>
                          <Button variant="dangerSoft" icon disabled={busy === p.name} onClick={() => remove(p.name)} title={t('projects_delete')}>
                            <Icon name="trash" size={15} />
                          </Button>
                        </>
                      )}
                    </>
                  }
                />
              )
            })}
          </div>
        </>
      )}

      {adminOpen && isManager && (
        <AdminPanel onClose={() => setAdminOpen(false)} onChanged={refresh} />
      )}
    </CoverPage>
  )
}
