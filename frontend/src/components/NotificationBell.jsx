import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import { useLang } from '../context/LangContext'
import { useTab } from '../context/TabContext'
import { combo } from '../theme/textCombos'

export default function NotificationBell() {
  const { t } = useLang()
  const navigate = useNavigate()
  const { activateTab } = useTab()
  const [count, setCount] = useState(0)
  const [notifs, setNotifs] = useState([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const dropRef = useRef(null)

  const fetchCount = useCallback(async () => {
    try {
      const r = await api.get('/notifications/unread-count')
      setCount(r.data.count)
    } catch { /* silent — user may not be logged in */ }
  }, [])

  // Poll every 30 s
  useEffect(() => {
    fetchCount()
    const id = setInterval(fetchCount, 30_000)
    return () => clearInterval(id)
  }, [fetchCount])

  // Close when clicking outside
  useEffect(() => {
    function onMouseDown(e) {
      if (dropRef.current && !dropRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  async function openPanel() {
    if (open) { setOpen(false); return }
    setLoading(true)
    try {
      const r = await api.get('/notifications')
      setNotifs(r.data)
    } catch { /* silent */ }
    finally { setLoading(false) }
    setOpen(true)
  }

  async function markAllRead() {
    try {
      await api.post('/notifications/read-all')
      setCount(0)
      setNotifs(prev => prev.map(n => ({ ...n, is_read: true })))
    } catch { /* silent */ }
  }

  async function clickNotif(n) {
    if (!n.is_read) {
      try { await api.post(`/notifications/${n.id}/read`) } catch { /* silent */ }
      setNotifs(prev => prev.map(x => x.id === n.id ? { ...x, is_read: true } : x))
      setCount(prev => Math.max(0, prev - 1))
    }
    setOpen(false)
    if (n.notif_type === 'mention') {
      navigate('/')
      activateTab('community')
    } else if (n.log_id) {
      // Open in the Logs tab instead of navigating to a separate route
      activateTab('logs')
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent('lilak:cmd:open-log', { detail: { id: Number(n.log_id) } }))
      }, 100)
    }
  }

  return (
    <div className="relative shrink-0" ref={dropRef}>
      <button
        onClick={openPanel}
        className="relative h-8 w-8 inline-flex items-center justify-center border rounded transition-colors"
        style={{ color: 'var(--nav-text-muted)', borderColor: 'var(--nav-accent)' }}
        onMouseEnter={e => { e.currentTarget.style.color = 'var(--nav-text)'; e.currentTarget.style.borderColor = 'var(--nav-text-muted)' }}
        onMouseLeave={e => { e.currentTarget.style.color = 'var(--nav-text-muted)'; e.currentTarget.style.borderColor = 'var(--nav-accent)' }}
        title={t('notif_title')}
      >
        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {count > 0 && (
          <span className="absolute -top-1 -right-1 h-4 min-w-[1rem] px-0.5 text-[10px] font-bold rounded-full flex items-center justify-center leading-none"
                style={combo('solidDanger')}>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-1 w-80 border rounded-xl shadow-xl z-50 overflow-hidden"
             style={{ ...combo('body'), borderColor: 'var(--border-default)' }}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b"
               style={{ borderColor: 'var(--border-subtle)' }}>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-secondary)' }}>{t('notif_title')}</span>
            {count > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs hover:underline"
                style={{ color: 'var(--text-link)' }}
              >
                {t('notif_read_all')}
              </button>
            )}
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto">
            {loading && (
              <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>{t('home_loading')}</div>
            )}
            {!loading && notifs.length === 0 && (
              <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--text-muted)' }}>{t('notif_empty')}</div>
            )}
            {!loading && notifs.map(n => (
              <button
                key={n.id}
                onClick={() => clickNotif(n)}
                className="w-full text-left px-4 py-3 border-b transition-colors"
                style={{
                  borderColor: 'var(--border-subtle)',
                  backgroundColor: !n.is_read ? 'var(--info-bg)' : 'transparent',
                }}
                onMouseEnter={e => { if (n.is_read) e.currentTarget.style.backgroundColor = 'var(--surface-2)' }}
                onMouseLeave={e => { e.currentTarget.style.backgroundColor = !n.is_read ? 'var(--info-bg)' : 'transparent' }}
              >
                <div className="flex items-start gap-2">
                  {!n.is_read && (
                    <span className="mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full"
                          style={{ backgroundColor: 'var(--btn-primary-bg)' }} />
                  )}
                  <div className={`flex-1 min-w-0 ${n.is_read ? 'ml-3.5' : ''}`}>
                    <p className="text-xs font-semibold truncate" style={{ color: 'var(--text-secondary)' }}>
                      {n.notif_type === 'comment' && (
                        <>
                          <span style={{ color: 'var(--text-link)' }}>{n.from_user_name}</span>
                          {' '}{t('notif_commented_on')}{' '}
                          <span style={{ color: 'var(--text-secondary)' }}>#{n.log_id}</span>
                          {n.log_title && <span style={{ color: 'var(--text-muted)' }}> {n.log_title}</span>}
                        </>
                      )}
                      {n.notif_type === 'mention' && (
                        <>
                          <span style={{ color: 'var(--text-link)' }}>@{n.from_user_name}</span>
                          {' '}{t('notif_mentioned_you')}
                        </>
                      )}
                    </p>
                    {n.comment_excerpt && (
                      <p className="text-xs mt-0.5 line-clamp-2" style={{ color: 'var(--text-muted)' }}>
                        "{n.comment_excerpt}"
                      </p>
                    )}
                    <p className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
                      {new Date(n.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
