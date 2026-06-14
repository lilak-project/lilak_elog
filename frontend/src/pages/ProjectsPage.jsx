import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Icon, Button, Container } from 'lilak-ui'
import { launcher, getExperiment, setExperiment } from '../api'
import { useLang } from '../context/LangContext'

/**
 * ProjectsPage — the elog "home" / launcher cover, rebuilt on the kit.
 *
 * Mirrors the original lilak_elog launcher: each project ("experiment") is its
 * own database. This page lists them (via the launcher API), lets you create /
 * start / stop / delete, and "enter" one — which stores the selected experiment
 * and reloads into the elog, whose every API call is then routed through the
 * launcher's `/p/<experiment>/api/...` proxy (see api.js).
 */
export default function ProjectsPage() {
  const { t } = useLang()
  const navigate = useNavigate()
  const [projects, setProjects] = useState(null)   // null = loading
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')             // name currently acting on
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const newRef = useRef(null)
  const current = getExperiment()

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

  async function create(e) {
    e?.preventDefault()
    const name = newName.trim()
    if (!name) return
    setCreating(true); setError('')
    try {
      await launcher.post('/projects', { name })
      setNewName('')
      await refresh()
    } catch (err) {
      setError(err?.response?.data?.detail || t('projects_create_fail'))
    } finally { setCreating(false) }
  }

  async function stop(name) {
    setBusy(name)
    try { await launcher.post(`/projects/${name}/stop`); await refresh() }
    catch { /* surfaced on refresh */ } finally { setBusy('') }
  }

  async function remove(name) {
    if (!window.confirm(t('projects_delete_confirm', name))) return
    setBusy(name)
    try {
      await launcher.delete(`/projects/${name}`)
      if (current === name) setExperiment('')   // dropped the active one
      await refresh()
    } catch { /* surfaced on refresh */ } finally { setBusy('') }
  }

  const card = {
    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px',
    border: '1px solid var(--border-default)', borderRadius: 10, backgroundColor: 'var(--surface)',
  }

  return (
    <div style={{ minHeight: '100vh', backgroundColor: 'var(--app-bg, var(--surface-2))', paddingBottom: 64 }}>
      <Container max={760}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '40px 0 8px' }}>
          <Icon name="lilak" size={36} style={{ height: 36, width: 'auto' }} />
          <div>
            <h1 style={{ margin: 0, fontSize: 'var(--fs-title, 22px)', color: 'var(--text-emphasis)', letterSpacing: '0.01em' }}>
              {t('projects_title')}
            </h1>
            <p style={{ margin: '2px 0 0', fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>
              {t('projects_subtitle')}
            </p>
          </div>
        </header>

        {error && (
          <div style={{ margin: '8px 0', padding: '10px 12px', borderRadius: 8, fontSize: 'var(--fs-small, 12px)',
            backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)', border: '1px solid var(--danger-border, transparent)' }}>
            {error}
          </div>
        )}

        {/* New project */}
        <form onSubmit={create} style={{ display: 'flex', gap: 8, margin: '16px 0 20px' }}>
          <input
            ref={newRef} value={newName} onChange={(e) => setNewName(e.target.value)}
            placeholder={t('projects_new_placeholder')}
            style={{ flex: 1, height: 34, padding: '0 12px', borderRadius: 8, fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-body, 13px)', backgroundColor: 'var(--input-bg)', color: 'var(--text-primary)',
              border: '1px solid var(--input-border)', outline: 'none' }} />
          <Button type="submit" disabled={creating || !newName.trim()}>
            <Icon name="plus" size={15} /> {t('projects_create')}
          </Button>
        </form>

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
                <Icon name="flask" size={20} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
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
                <Button variant="primary" onClick={() => enter(p.name)}>{t('projects_open')}</Button>
                {p.running && (
                  <Button variant="secondary" disabled={busy === p.name} onClick={() => stop(p.name)}>{t('projects_stop')}</Button>
                )}
                <Button variant="dangerSoft" icon disabled={busy === p.name} onClick={() => remove(p.name)} title={t('projects_delete')}>
                  <Icon name="trash" size={15} />
                </Button>
              </div>
            )
          })}
        </div>
      </Container>
    </div>
  )
}
