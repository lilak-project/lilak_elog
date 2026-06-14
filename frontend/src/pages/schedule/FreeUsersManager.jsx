import { useState, useEffect } from 'react'
import api from '../../api'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LangContext'
import {
  btnPrimary, btnPrimaryHover,
  modalFrame, modalOverlay,
  inputBase, hoverify,
} from '../../theme/uiStyles'

export default function FreeUsersManager({ freeUsers: initial, onClose }) {
  const { user } = useAuth()
  const { t } = useLang()
  const [items, setItems]  = useState(initial || [])
  const [name, setName]    = useState('')
  const [err, setErr]      = useState(null)

  async function reload() {
    const r = await api.get('/schedule/free-users')
    setItems(r.data)
  }

  async function handleAdd() {
    if (!name.trim()) return
    setErr(null)
    try {
      await api.post('/schedule/free-users', { name: name.trim(), display_order: items.length })
      setName('')
      await reload()
    } catch (e) {
      setErr(e.response?.data?.detail || t('sched_fu_err_add'))
    }
  }

  async function handleDelete(f) {
    if (!window.confirm(t('sched_fu_delete_confirm', f.name))) return
    await api.delete(`/schedule/free-users/${f.id}`)
    await reload()
  }

  async function handleClaim(f) {
    try {
      await api.post(`/schedule/free-users/${f.id}/claim`)
      await reload()
    } catch (e) {
      alert(e.response?.data?.detail || t('sched_fail'))
    }
  }

  async function handleUnclaim(f) {
    try {
      await api.post(`/schedule/free-users/${f.id}/unclaim`)
      await reload()
    } catch (e) {
      alert(e.response?.data?.detail || t('sched_fail'))
    }
  }

  const isManager = user?.role === 'manager'

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={modalOverlay}
      onClick={onClose}>
      <div className="rounded-2xl shadow-2xl w-full max-w-xl mt-10 mb-10 border"
        style={modalFrame}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b"
             style={{ borderColor: 'var(--border-subtle)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('sched_fu_title')}</h2>
          <button onClick={onClose} className="text-xl transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>×</button>
        </div>

        <div className="p-6 space-y-4">
          <p className="text-[11px] leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            {t('sched_fu_blurb')}
          </p>

          {err && (
            <div className="border text-xs px-3 py-2 rounded"
                 style={{ backgroundColor: 'var(--danger-bg)', borderColor: 'var(--danger-text)', color: 'var(--danger-text)' }}>
              {err}
            </div>
          )}

          {isManager && (
            <div className="flex items-center gap-2">
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleAdd()}
                placeholder={t('sched_fu_name_ph')}
                className="flex-1 border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--input-focus-border)]"
                style={inputBase}
              />
              <button onClick={handleAdd}
                className="h-8 px-3 rounded text-xs transition-colors"
                style={btnPrimary}
                {...hoverify(btnPrimary, btnPrimaryHover)}>{t('sched_fu_add')}</button>
            </div>
          )}

          <div className="space-y-1.5">
            {items.length === 0 && (
              <div className="text-center text-xs py-6" style={{ color: 'var(--text-muted)' }}>{t('sched_fu_empty')}</div>
            )}
            {items.map(f => {
              const isClaimedByMe = f.claimed_by_id === user?.user_id
              return (
                <div key={f.id} className="border rounded-lg px-3 py-2 flex items-center gap-2"
                     style={{ borderColor: 'var(--border-default)' }}>
                  <span className={`text-sm flex-1 ${f.claimed_by_id ? 'line-through' : ''}`}
                        style={{ color: f.claimed_by_id ? 'var(--text-muted)' : 'var(--text-primary)' }}>
                    {f.name}
                  </span>
                  {f.claimed_by_id && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded"
                          style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success-text)' }}>
                      {t('sched_fu_claimed')}
                      {isClaimedByMe ? ' ' + t('sched_fu_self') : ''}
                    </span>
                  )}
                  {user && !f.claimed_by_id && (
                    <button onClick={() => handleClaim(f)}
                      className="text-[11px] px-2 py-1 border rounded transition-colors"
                      style={{ color: 'var(--info-text)', borderColor: 'var(--border-focus)' }}>
                      {t('sched_fu_claim')}
                    </button>
                  )}
                  {isClaimedByMe && (
                    <button onClick={() => handleUnclaim(f)}
                      className="text-[11px] px-2 py-1 border rounded transition-colors"
                      style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }}>
                      {t('sched_fu_unclaim')}
                    </button>
                  )}
                  {isManager && (
                    <button onClick={() => handleDelete(f)}
                      className="text-[11px] px-2 py-1 border rounded transition-colors"
                      style={{ color: 'var(--danger-text)', borderColor: 'var(--border-default)' }}>
                      {t('sched_fu_delete')}
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        </div>

        <div className="px-6 py-4 border-t flex justify-end"
             style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-2)' }}>
          <button onClick={onClose} className="text-xs px-4 py-2 hover:underline"
                  style={{ color: 'var(--text-secondary)' }}>{t('sched_fu_close')}</button>
        </div>
      </div>
    </div>
  )
}
