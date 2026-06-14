import { useState, useEffect } from 'react'
import { Icon } from 'lilak-ui'
import { useParams, useNavigate, Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import api, { apiBaseFor, getExperiment } from '../api'

// Experiment-aware attachment URL (raw <img>/<a> bypass axios' baseURL).
const attUrl = (id) => `${apiBaseFor(getExperiment())}/attachments/${id}`
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { useTab } from '../context/TabContext'
import { severityStyle } from '../components/EntryShared'

function isImage(ct) { return ct && ct.startsWith('image/') }

export default function LogDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { t } = useLang()
  const { openNewLog } = useTab()
  const [entry, setEntry] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get(`/logs/${id}`)
      .then(r => {
        setEntry(r.data)
        document.title = `#${r.data.id} ${r.data.title || ''} — lilak elog`.trim()
      })
      .catch(() => setError(t('detail_not_found')))
      .finally(() => setLoading(false))
    return () => { document.title = 'lilak elog' }
  }, [id])

  async function handleDelete() {
    if (!window.confirm(t('detail_delete_confirm'))) return
    setDeleting(true)
    try { await api.delete(`/logs/${id}`); navigate('/') }
    catch { alert(t('detail_delete_fail')); setDeleting(false) }
  }

  async function handleRestore() {
    try { const res = await api.post(`/logs/${id}/restore`); setEntry(res.data) }
    catch { alert(t('detail_restore_fail')) }
  }

  if (loading) return <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>{t('home_loading')}</div>
  if (error)   return <div className="text-center py-16" style={{ color: 'var(--danger-text)' }}>{error}</div>

  const canEdit    = user && (user.role === 'manager' || user.user_id === entry.author_id)
  const canDelete  = user?.role === 'manager' && !entry.is_deleted
  const canRestore = user?.role === 'manager' && entry.is_deleted
  const sevStyle   = severityStyle(entry.level, { withBorder: true })

  const cardBorder = entry.is_deleted ? 'var(--danger-text)'
                  :  entry.is_auto    ? 'var(--border-focus)'
                  :                     'var(--border-default)'

  return (
    <div className="max-w-3xl mx-auto">
      {/* Breadcrumb */}
      <div className="text-sm mb-4 flex items-center gap-2" style={{ color: 'var(--text-secondary)' }}>
        <Link to="/" className="hover:underline" style={{ color: 'var(--text-link)' }}>{t('nav_home')}</Link>
        <span>/</span>
        <span className="font-mono font-bold px-2 py-0.5 rounded text-xs"
              style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--surface-2)' }}>
          #{entry.id}
        </span>
      </div>

      <div className="rounded-xl border shadow-sm"
           style={{ backgroundColor: 'var(--surface)', borderColor: cardBorder }}>
        {entry.is_deleted && (
          <div className="border-b px-6 py-2 text-sm rounded-t-xl"
               style={{ backgroundColor: 'var(--danger-bg)', borderColor: 'var(--danger-text)', color: 'var(--danger-text)' }}>
            {t('detail_deleted_banner', entry.deleted_by, new Date(entry.deleted_at).toLocaleString())}
          </div>
        )}
        {entry.is_auto && (
          <div className="border-b px-6 py-2 text-xs rounded-t-xl"
               style={{ backgroundColor: 'var(--info-bg)', borderColor: 'var(--border-focus)', color: 'var(--info-text)' }}>
            {t('detail_auto_banner', entry.source)}
          </div>
        )}

        <div className="p-6">
          {/* Badges */}
          <div className="flex flex-wrap gap-2 mb-3">
            <span className="text-xs font-semibold px-2.5 py-1 rounded-full border" style={sevStyle}>
              {entry.level.toUpperCase()}
            </span>
            {entry.category && (
              <span className="text-xs font-medium bg-purple-100 text-purple-700 px-2.5 py-1 rounded-full">
                {entry.category}
              </span>
            )}
            {(entry.run_number != null || entry.run_number_text) && (
              <span className="text-xs font-medium px-2.5 py-1 rounded-full"
                    style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
                {t('badge_run')}{' '}
                {entry.run_number_type === 'single' || !entry.run_number_type
                  ? entry.run_number
                  : entry.run_number_text}
                {entry.run_number_type && entry.run_number_type !== 'single' && (
                  <span className="ml-1 opacity-60 text-xs">({entry.run_number_type})</span>
                )}
              </span>
            )}
          </div>

          <h1 className="text-lg mb-3" style={{ color: 'var(--text-primary)' }}>{entry.title}</h1>

          <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs mb-4 pb-3 border-b"
               style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-subtle)' }}>
            <span>{entry.author_name}</span>
            <span>{new Date(entry.created_at).toLocaleString()}</span>
            {entry.updated_by && (
              <span style={{ color: 'var(--text-muted)' }}>
                {t('detail_edited_by', entry.updated_by, new Date(entry.updated_at).toLocaleString())}
              </span>
            )}
          </div>

          {entry.tags?.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-5">
              {entry.tags.map(tag => (
                <Link key={tag.id} to={`/?tag=${tag.name}`}
                  className="text-xs bg-sky-100 text-sky-700 hover:bg-sky-200 px-2.5 py-0.5 rounded-full transition-colors">
                  #{tag.name}
                </Link>
              ))}
            </div>
          )}

          {entry.body ? (
            <div className="markdown-body text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{entry.body}</ReactMarkdown>
            </div>
          ) : (
            <p className="italic text-sm" style={{ color: 'var(--text-muted)' }}>{t('detail_no_body')}</p>
          )}

          {entry.metadata_json && (
            <details className="mt-5 text-sm">
              <summary className="cursor-pointer hover:underline" style={{ color: 'var(--text-secondary)' }}>
                {t('detail_metadata')}
              </summary>
              <pre className="mt-2 p-3 rounded-lg text-xs overflow-x-auto border"
                   style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }}>
                {JSON.stringify(JSON.parse(entry.metadata_json), null, 2)}
              </pre>
            </details>
          )}
        </div>

        {/* Attachments */}
        {entry.attachments?.length > 0 && (
          <div className="border-t px-6 py-4" style={{ borderColor: 'var(--border-subtle)' }}>
            <h3 className="text-sm font-semibold mb-3" style={{ color: 'var(--text-secondary)' }}>
              {t('detail_attachments', entry.attachments.length)}
            </h3>
            <div className="flex flex-wrap gap-3 mb-3">
              {entry.attachments.filter(a => isImage(a.content_type)).map(a => (
                <a key={a.id} href={attUrl(a.id)} target="_blank" rel="noopener noreferrer">
                  <img src={attUrl(a.id)} alt={a.original_filename}
                    className="h-28 w-auto rounded-lg border object-cover hover:opacity-90 transition-opacity"
                    style={{ borderColor: 'var(--border-default)' }} />
                </a>
              ))}
            </div>
            <ul className="space-y-1">
              {entry.attachments.map(a => (
                <li key={a.id} className="flex items-center gap-2 text-sm">
                  <span className="text-[10px] font-mono uppercase" style={{ color: 'var(--text-muted)' }}>{isImage(a.content_type) ? 'img' : 'file'}</span>
                  <a href={attUrl(a.id)} className="hover:underline"
                     style={{ color: 'var(--text-link)' }}
                     download={a.original_filename}>
                    {a.original_filename}
                  </a>
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {a.size ? `(${(a.size / 1024).toFixed(1)} KB)` : ''}
                  </span>
                  {canEdit && (
                    <button
                      onClick={async () => {
                        if (!window.confirm(`Delete ${a.original_filename}?`)) return
                        await api.delete(`/attachments/${a.id}`)
                        setEntry(prev => ({ ...prev, attachments: prev.attachments.filter(x => x.id !== a.id) }))
                      }}
                      className="text-xs ml-1"
                      style={{ color: 'var(--text-muted)' }}
                      onMouseEnter={e => e.currentTarget.style.color = 'var(--danger-text)'}
                      onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                    ><Icon name="close" size={14} /></button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="border-t px-6 py-3 flex gap-3 flex-wrap" style={{ borderColor: 'var(--border-subtle)' }}>
          {user && !entry.is_deleted && (
            <button
              onClick={() => openNewLog({ fromId: entry.id })}
              className="text-sm px-4 py-1.5 rounded-lg font-medium transition-colors"
              style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success-text)' }}>
              {t('detail_continue')}
            </button>
          )}
          {canEdit && !entry.is_deleted && (
            <button
              onClick={() => openNewLog({ editId: entry.id })}
              className="text-sm px-4 py-1.5 rounded-lg font-medium transition-colors"
              style={entry.task_status === 'pending'
                ? { backgroundColor: 'var(--success-bg)', color: 'var(--success-text)' }
                : { backgroundColor: 'var(--surface-2)', color: 'var(--text-primary)' }}>
              {entry.task_status === 'pending' ? 'Go' : t('detail_edit')}
            </button>
          )}
          {canDelete && (
            <button onClick={handleDelete} disabled={deleting}
              className="text-sm px-4 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)' }}>
              {deleting ? t('detail_deleting') : t('detail_delete')}
            </button>
          )}
          {canRestore && (
            <button onClick={handleRestore}
              className="text-sm px-4 py-1.5 rounded-lg font-medium transition-colors"
              style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success-text)' }}>
              {t('detail_restore')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
