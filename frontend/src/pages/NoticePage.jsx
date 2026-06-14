import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import LogCard from '../components/LogCard'
import LogCardExpanded from '../components/LogCardExpanded'
import ErrorBoundary from '../components/ErrorBoundary'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'

export default function NoticePage() {
  const { user } = useAuth()
  const { t } = useLang()
  const [entries, setEntries] = useState([])
  const [loading, setLoading] = useState(true)
  const [expandedId, setExpandedId] = useState(null)
  const [commentRefresh, setCommentRefresh] = useState(0)

  const fetchNotices = useCallback(async () => {
    setLoading(true)
    try {
      const res = await api.get('/logs', { params: { is_notice: true, page_size: 100 } })
      setEntries(res.data.items || [])
    } catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchNotices() }, [fetchNotices])

  return (
    <div className="pb-10">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <span style={{ color: 'var(--warning-text)' }}>📌</span>
          {t('notice_title')}
        </h1>
      </div>

      {loading && <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>{t('home_loading')}</div>}

      {!loading && entries.length === 0 && (
        <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>
          <p className="text-4xl mb-3">📌</p>
          <p>{t('notice_empty')}</p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        {entries.map((e) =>
          expandedId === e.id ? (
            <ErrorBoundary key={`eb-${e.id}`}>
              <LogCardExpanded
                entry={e}
                focused={false}
                refreshTrigger={commentRefresh}
                onClose={() => setExpandedId(null)}
                onNoticeToggled={fetchNotices}
                onDeleted={() => { setExpandedId(null); fetchNotices() }}
              />
            </ErrorBoundary>
          ) : (
            <LogCard
              key={e.id}
              entry={e}
              viewMode="normal"
              focused={false}
              pinBadge
              onToggle={() => setExpandedId(prev => prev === e.id ? null : e.id)}
            />
          )
        )}
      </div>

      {/* Default bottom bar (provided by TabbedWorkspace z-20) */}
    </div>
  )
}
