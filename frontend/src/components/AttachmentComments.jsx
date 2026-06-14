import { useState, useEffect, useCallback } from 'react'
import { Input, Button } from 'lilak-ui'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'

/**
 * AttachmentComments — comments on the log an attachment belongs to. Used by the
 * Gallery and Files views so a photo/file can be commented on directly; clicking
 * a comment opens its log (via onOpenLog).
 */
export default function AttachmentComments({ logId, onOpenLog, compact = false }) {
  const { user } = useAuth()
  const { t } = useLang()
  const [comments, setComments] = useState([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    if (!logId) { setComments([]); return }
    api.get(`/logs/${logId}/comments`).then(r => setComments(r.data || [])).catch(() => setComments([]))
  }, [logId])
  useEffect(() => { load() }, [load])

  async function post() {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    try { await api.post(`/logs/${logId}/comments`, { body }); setText(''); load() }
    catch { /* ignore — surfaced by the disabled state */ }
    finally { setBusy(false) }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 'var(--fs-tiny, 11px)', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-muted)' }}>
        {t('comments') || '댓글'} ({comments.length})
      </div>
      {comments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: compact ? 120 : 180, overflowY: 'auto' }}>
          {comments.map(c => (
            <button key={c.id} type="button" onClick={() => onOpenLog?.(logId)} title={t('comment_open_log') || '로그에서 보기'}
              style={{ textAlign: 'left', background: 'none', border: '1px solid var(--border-subtle)', borderRadius: 8, padding: '6px 8px', cursor: 'pointer' }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-focus)' }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border-subtle)' }}>
              <div style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-primary)', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>{c.body}</div>
              <div style={{ fontSize: 'var(--fs-micro, 10px)', color: 'var(--text-muted)', marginTop: 2 }}>
                {c.author_name} · {c.created_at ? new Date(c.created_at).toLocaleString() : ''}
              </div>
            </button>
          ))}
        </div>
      )}
      {user ? (
        <div style={{ display: 'flex', gap: 6 }}>
          <Input value={text} onChange={e => setText(e.target.value)} placeholder={t('comments_placeholder_short') || '댓글…'} size="md" style={{ flex: 1 }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); post() } }} />
          <Button variant="primary" size="sm" onClick={post} disabled={busy || !text.trim()}>{t('comment_post') || '등록'}</Button>
        </div>
      ) : (
        <div style={{ fontSize: 'var(--fs-tiny, 11px)', color: 'var(--text-muted)' }}>{t('comment_login_hint') || '로그인 후 댓글을 달 수 있습니다.'}</div>
      )}
    </div>
  )
}
