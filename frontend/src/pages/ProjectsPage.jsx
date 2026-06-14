import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, Button, Container, Modal, randomProjectIcon, PROJECT_ICONS, AVATAR_COLORS } from 'lilak-ui'
import { launcher, getExperiment, setExperiment } from '../api'
import { useLang } from '../context/LangContext'
import { useAuth } from '../context/AuthContext'

/**
 * ProjectsPage — the elog "home" / project (experiment) page, on the kit.
 *
 * Each project ("experiment") is its own database. This page lists them (via the
 * launcher API), lets you create / stop / delete, and "enter" one. Managing
 * projects (create / stop / delete) requires a manager login; entering one is
 * open to anyone. Each experiment carries its own icon/colour, stored with its
 * data so it travels when the data folder is copied.
 */

// Stable per-name fallback so experiments without a stored icon still look
// distinct (e.g. ones created before icons existed).
function hashStr(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h) }
const iconFor = (name, stored) => stored || PROJECT_ICONS[hashStr(name) % PROJECT_ICONS.length]
const colorFor = (name, stored) => stored || AVATAR_COLORS[hashStr(name + '·c') % AVATAR_COLORS.length]

const loginInput = {
  width: '100%', height: 36, padding: '0 12px', borderRadius: 8, fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-body, 13px)', backgroundColor: 'var(--input-bg)', color: 'var(--text-primary)',
  border: '1px solid var(--input-border)', outline: 'none',
}

export default function ProjectsPage() {
  const { t } = useLang()
  const { user, login, logout } = useAuth()
  const navigate = useNavigate()
  const isManager = user?.role === 'manager'

  const [projects, setProjects] = useState(null)   // null = loading
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')             // name currently acting on
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const newRef = useRef(null)
  const current = getExperiment()

  // manager login modal
  const [loginOpen, setLoginOpen] = useState(false)
  const [lform, setLform] = useState({ username: '', password: '' })
  const [loginErr, setLoginErr] = useState('')
  const [loggingIn, setLoggingIn] = useState(false)

  // import (drag-drop / file picker) + export
  const fileRef = useRef(null)
  const [importing, setImporting] = useState(false)
  const [dragOver, setDragOver] = useState(false)

  async function refresh() {
    try {
      const r = await launcher.get('/projects')
      setProjects(r.data)
      setError('')
    } catch {
      setProjects([])
      setError(t('projects_unreachable'))
    }
  }
  useEffect(() => { refresh() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  function enter(name) {
    setExperiment(name)
    // Full reload so api.js rebuilds its baseURL for the chosen experiment.
    window.location.assign('/')
  }

  async function doLogin(e) {
    e?.preventDefault?.()
    setLoggingIn(true); setLoginErr('')
    try {
      await login(lform.username.trim(), lform.password)
      setLoginOpen(false); setLform({ username: '', password: '' })
    } catch {
      setLoginErr(t('projects_login_fail'))
    } finally { setLoggingIn(false) }
  }

  async function create(e) {
    e?.preventDefault()
    if (!isManager) return
    const name = newName.trim()
    if (!name) return
    setCreating(true); setError('')
    try {
      // Pick a random icon + colour now; the launcher stores them with the data.
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

  // Import an exported .zip (drag-dropped or picked) → creates a new project.
  async function doImportFile(f) {
    if (!isManager || !f) return
    setImporting(true); setError('')
    try {
      const fd = new FormData()
      fd.append('file', f, f.name)
      await launcher.post('/projects/import', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      await refresh()
    } catch (err) {
      setError(err?.response?.data?.detail || t('projects_import_fail'))
    } finally { setImporting(false); if (fileRef.current) fileRef.current.value = '' }
  }

  const card = {
    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
    border: '1px solid var(--border-default)', borderRadius: 10, backgroundColor: 'var(--surface)',
  }

  return (
    // Cover page is always bright — a nested data-theme re-scopes the tokens for
    // this subtree, so logging out never flips it to the app's dark/low theme.
    <div data-theme="bright" style={{ minHeight: '100vh', backgroundColor: 'var(--app-bg, var(--surface-2))', paddingBottom: 64 }}>
      <Container max={760}>
        <header style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '40px 0 8px' }}>
          <Icon name="lilak" size={36} style={{ height: 36, width: 'auto' }} />
          <div style={{ flex: 1 }}>
            <h1 style={{ margin: 0, fontSize: 'var(--fs-title, 22px)', color: 'var(--text-emphasis)', letterSpacing: '0.01em' }}>
              {t('projects_title')}
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>
              {t('projects_subtitle')}
            </p>
          </div>
          {/* Manager auth control */}
          <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
            {isManager ? (
              <>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)' }}>
                  <Icon name="user" size={14} /> {user.username}
                </span>
                <Button variant="ghost" onClick={logout}>{t('projects_logout')}</Button>
              </>
            ) : (
              <Button variant="secondary" onClick={() => { setLoginErr(''); setLoginOpen(true) }}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                <Icon name="key" size={14} /> {t('projects_login')}
              </Button>
            )}
          </div>
        </header>

        {!isManager && (
          <div style={{ margin: '8px 0', fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>
            {t('projects_manager_only')}
          </div>
        )}

        {error && (
          <div style={{ margin: '8px 0', padding: '10px 12px', borderRadius: 8, fontSize: 'var(--fs-small, 12px)',
            backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)', border: '1px solid var(--danger-border, transparent)' }}>
            {error}
          </div>
        )}

        {/* New project + import (manager only). The whole block is a drop target. */}
        <div
          onDragOver={(e) => { if (!isManager) return; e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); doImportFile(e.dataTransfer.files?.[0]) }}
          style={{ margin: '12px 0 20px', padding: 8, borderRadius: 10, transition: 'background-color .1s, box-shadow .1s',
            border: '2px dashed', borderColor: dragOver ? 'var(--btn-primary-bg)' : 'transparent',
            backgroundColor: dragOver ? 'var(--info-bg)' : 'transparent' }}>
          <form onSubmit={create} style={{ display: 'flex', gap: 8 }}>
            <input
              ref={newRef} value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder={t('projects_new_placeholder')} disabled={!isManager}
              style={{ flex: 1, height: 34, padding: '0 12px', borderRadius: 8, fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-body, 13px)', backgroundColor: 'var(--input-bg)', color: 'var(--text-primary)',
                border: '1px solid var(--input-border)', outline: 'none', opacity: isManager ? 1 : 0.5 }} />
            <Button type="submit" disabled={!isManager || creating || !newName.trim()}
              style={{ minWidth: 116, justifyContent: 'center' }}>
              {t('projects_create')}
            </Button>
            <Button type="button" variant="secondary" disabled={!isManager || importing}
              onClick={() => fileRef.current?.click()} style={{ minWidth: 92, justifyContent: 'center' }}>
              {t('projects_import')}
            </Button>
          </form>
          {isManager && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 8, paddingLeft: 2, fontSize: 'var(--fs-micro, 10px)', color: 'var(--text-muted)' }}>
              <Icon name="upload" size={12} /> {t('projects_drop_hint')}
            </div>
          )}
          <input ref={fileRef} type="file" accept=".zip" hidden
            onChange={(e) => doImportFile(e.target.files?.[0])} />
        </div>

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
              <div key={p.name} style={{ ...card, borderColor: isCurrent ? 'var(--border-focus, var(--btn-primary-bg))' : 'var(--border-default)' }}>
                <Icon name={iconFor(p.name, p.icon)} size={22} weight="regular"
                  color="var(--text-primary)" style={{ flexShrink: 0 }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-body, 13px)', color: 'var(--text-primary)', fontWeight: 600 }}>{p.name}</span>
                    {isCurrent && <span style={{ fontSize: 'var(--fs-micro, 10px)', padding: '1px 6px', borderRadius: 999, backgroundColor: 'var(--info-bg)', color: 'var(--info-text)' }}>{t('projects_current')}</span>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 2, fontSize: 'var(--fs-micro, 10px)', color: 'var(--text-muted)' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: p.running ? 'var(--success-text)' : 'var(--text-muted)' }} />
                    {p.running ? t('projects_running', p.port) : t('projects_stopped')}
                  </div>
                </div>
                {/* Actions — always in the same place. Enter: anyone. Stop/Delete: manager. */}
                <Button variant="primary" onClick={() => enter(p.name)}
                  style={{ minWidth: 72, justifyContent: 'center' }}>{t('projects_open')}</Button>
                <Button variant="secondary" disabled={!isManager || !p.running || busy === p.name} onClick={() => stop(p.name)}
                  style={{ minWidth: 56, justifyContent: 'center' }}>{t('projects_stop')}</Button>
                <Button variant="ghost" icon disabled={!isManager} onClick={() => exportProject(p.name)} title={t('projects_export')}>
                  <Icon name="download" size={15} />
                </Button>
                <Button variant="dangerSoft" icon disabled={!isManager || busy === p.name} onClick={() => remove(p.name)} title={t('projects_delete')}>
                  <Icon name="trash" size={15} />
                </Button>
              </div>
            )
          })}
        </div>
      </Container>

      {loginOpen && (
        <Modal title={t('projects_login')} width={360} onClose={() => setLoginOpen(false)} onSubmit={doLogin}>
          <form onSubmit={doLogin} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input autoFocus placeholder={t('projects_login_user')} value={lform.username}
              onChange={(e) => setLform((f) => ({ ...f, username: e.target.value }))} style={loginInput} />
            <input type="password" placeholder={t('projects_login_pass')} value={lform.password}
              onChange={(e) => setLform((f) => ({ ...f, password: e.target.value }))} style={loginInput} />
            {loginErr && <div style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--danger-text)' }}>{loginErr}</div>}
            <Button type="submit" disabled={loggingIn || !lform.username.trim()} style={{ justifyContent: 'center', marginTop: 2 }}>
              {t('projects_login_submit')}
            </Button>
          </form>
        </Modal>
      )}
    </div>
  )
}
