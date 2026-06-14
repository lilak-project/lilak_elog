import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import {
  btnPrimary, btnPrimaryHover,
  inputBase, hoverify,
} from '../theme/uiStyles'

export default function AdminExperiments() {
  const { user } = useAuth()
  const { t } = useLang()
  const navigate = useNavigate()

  const [experiments, setExperiments] = useState([])
  const [current, setCurrent] = useState('')
  const [loading, setLoading] = useState(true)

  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createOk, setCreateOk] = useState(null)
  const [createErr, setCreateErr] = useState(null)

  useEffect(() => {
    if (!user || user.role !== 'manager') {
      navigate('/', { replace: true })
      return
    }
    Promise.all([
      api.get('/experiments'),
      api.get('/info'),
    ]).then(([expRes, infoRes]) => {
      setExperiments(expRes.data.map(e => typeof e === 'string' ? { name: e, port: null } : e))
      setCurrent(infoRes.data.experiment)
    }).catch(() => {})
      .finally(() => setLoading(false))
  }, [user])

  async function handleCreate(e) {
    e.preventDefault()
    setCreateOk(null); setCreateErr(null)
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    try {
      const res = await api.post(`/experiments/${encodeURIComponent(name)}`)
      setCreateOk(res.data)
      setNewName('')
      setExperiments(prev => [...prev, { name, port: null }].sort((a, b) => a.name.localeCompare(b.name)))
    } catch (err) {
      setCreateErr(err.response?.data?.detail || 'Error')
    } finally {
      setCreating(false)
    }
  }

  if (!user || user.role !== 'manager') return null

  const cardStyle       = { backgroundColor: 'var(--surface)', borderColor: 'var(--border-default)' }
  const cardHeaderStyle = { backgroundColor: 'var(--surface-2)', borderColor: 'var(--border-subtle)' }
  const successBanner   = { backgroundColor: 'var(--success-bg)', borderColor: 'var(--success-text)', color: 'var(--success-text)' }
  const errorBanner     = { backgroundColor: 'var(--danger-bg)',  borderColor: 'var(--danger-text)',  color: 'var(--danger-text)' }
  const codeStyle       = { color: 'var(--text-muted)', backgroundColor: 'var(--surface-2)', borderColor: 'var(--border-default)' }

  return (
    <div className="max-w-xl mx-auto space-y-4">
      {/* Current experiment */}
      <div className="rounded-xl border shadow-sm p-5" style={cardStyle}>
        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-secondary)' }}>
          {t('admin_exp_current')}
        </p>
        <div className="flex items-center gap-3">
          <span className="font-mono font-bold px-3 py-1.5 rounded-lg text-sm"
                style={{ backgroundColor: 'var(--info-bg)', color: 'var(--info-text)' }}>
            {current || '—'}
          </span>
          <code className="text-xs px-2 py-1 rounded border" style={codeStyle}>
            {t('admin_exp_switch_hint', current)}
          </code>
        </div>
      </div>

      {/* All experiments */}
      <div className="rounded-xl border shadow-sm overflow-hidden" style={cardStyle}>
        <div className="px-5 py-3 border-b text-sm font-semibold"
             style={{ ...cardHeaderStyle, color: 'var(--text-secondary)' }}>
          {loading ? t('admin_exp_loading') : t('admin_exp_list')}
        </div>
        {!loading && (
          <ul className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {experiments.map(({ name, port }) => {
              const url = port ? `http://${window.location.hostname}:${port}` : null
              const isCurrent = name === current
              return (
                <li key={name} className="px-5 py-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className={`font-mono text-sm ${isCurrent ? 'font-bold' : ''}`}
                          style={{ color: isCurrent ? 'var(--text-link)' : 'var(--text-primary)' }}>
                      {name}
                    </span>
                    {isCurrent && (
                      <span className="text-xs px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: 'var(--info-bg)', color: 'var(--info-text)' }}>{t('admin_exp_current')}</span>
                    )}
                    {port && !isCurrent && (
                      <span className="text-xs px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success-text)' }}>:{port}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {url && !isCurrent && (
                      <a href={url} target="_blank" rel="noopener noreferrer"
                        className="text-xs px-2.5 py-1 rounded transition-colors"
                        style={btnPrimary}
                        {...hoverify(btnPrimary, btnPrimaryHover)}>
                        {t('admin_exp_open')}
                      </a>
                    )}
                    {!port && !isCurrent && (
                      <code className="text-xs px-2 py-1 rounded border" style={codeStyle}>
                        ./elog.sh -e {name}
                      </code>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Create new */}
      <div className="rounded-xl border shadow-sm p-5" style={cardStyle}>
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-secondary)' }}>{t('admin_exp_create')}</h2>

        {createOk && (
          <div className="mb-3 border text-sm px-4 py-3 rounded-lg space-y-1" style={successBanner}>
            <p>{t('admin_exp_created', createOk.created)}</p>
            <code className="text-xs px-2 py-0.5 rounded"
                  style={{ backgroundColor: 'var(--success-text)', color: 'var(--btn-primary-text)' }}>
              {t('admin_exp_start_cmd', createOk.created)}
            </code>
          </div>
        )}
        {createErr && (
          <div className="mb-3 border text-sm px-4 py-3 rounded-lg" style={errorBanner}>{createErr}</div>
        )}

        <form onSubmit={handleCreate} className="flex gap-2">
          <div className="flex-1">
            <input
              value={newName}
              onChange={e => { setNewName(e.target.value); setCreateOk(null); setCreateErr(null) }}
              placeholder={t('admin_exp_name_label')}
              pattern="[A-Za-z0-9_-]+"
              title={t('admin_exp_name_hint')}
              required
              className="w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--input-focus-border)]"
              style={inputBase}
            />
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{t('admin_exp_name_hint')}</p>
          </div>
          <button
            type="submit"
            disabled={creating}
            className="disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0"
            style={btnPrimary}
            {...hoverify(btnPrimary, btnPrimaryHover)}
          >
            {creating ? t('admin_exp_creating') : t('admin_exp_create_btn')}
          </button>
        </form>
      </div>
    </div>
  )
}
