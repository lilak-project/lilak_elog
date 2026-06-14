import { useState, useEffect, useRef } from 'react'
import { LogDetail, Icon } from 'lilak-ui'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { useTab } from '../context/TabContext'
import { formatNumberEntry, formatLogTitle, runBadgeStyle, runNumberText, runStatusLabel } from '../utils/formatUtils'
import { CommentsSection, ActionBtn, RunBadges, severityStyle } from './EntryShared'
import { useTagColors, synthChipProps, chipProps, RUN_STATUS_TAG } from '../utils/tagColors'


// Phase 6: confirmation tag names (must match utils_tasks.py constants).
const CONFIRMATION_REQUIRED_TAG = 'confirmation required'
const CONFIRMED_BY_PREFIX       = 'confirmed by '

/* Banner shown at the top of a task log's tag row.
   When the entry carries `confirmation required` → big warning + Confirm btn.
   When it carries `confirmed by X` → small green check + reviewer name. */
function ConfirmationBanner({ entry, onChanged }) {
  const { user } = useAuth()
  const { t, lang } = useLang()
  const [busy, setBusy] = useState(false)

  const needsConfirm = !!entry?.tags?.some(t => t.name === CONFIRMATION_REQUIRED_TAG)
  const isConfirmed  = !!entry?.tags?.some(t => t.name === 'confirmed')
  const isReported   = !!entry?.tags?.some(t => t.name === 'reported')

  async function confirm() {
    if (busy) return
    setBusy(true)
    try {
      await api.post(`/logs/${entry.id}/confirm`)
      if (onChanged) onChanged()
    } catch (e) {
      alert((lang === 'ko' ? '확인 실패: ' : 'Confirm failed: ')
            + (e?.response?.data?.detail || e?.message || e))
    } finally {
      setBusy(false)
    }
  }

  if (needsConfirm) {
    return (
      <div className="flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-lg border"
           style={{ backgroundColor: 'var(--warning-bg)',
                    borderColor:     'var(--warning-text)',
                    color:           'var(--warning-text)' }}>
        <div className="text-sm flex items-center gap-1.5">
          <Icon name="warning" weight="fill" size={14} />
          <span>{lang === 'ko'
            ? '시스템이 자동으로 채운 값입니다. 검토 후 [확인] 을 눌러주세요.'
            : 'System-filled values — please review and click [Confirm].'}</span>
        </div>
        {user && (
          <div className="flex items-center gap-1.5 shrink-0">
            <button onClick={() => window.dispatchEvent(new CustomEvent('lilak:cmd:report', { detail: { id: entry.id } }))}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md transition-colors"
                    style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)', border: '1px solid var(--danger-text)' }}>
              {lang === 'ko' ? '리포트' : 'Report'}
            </button>
            <button onClick={confirm} disabled={busy}
                    className="text-xs font-semibold px-3 py-1.5 rounded-md transition-colors disabled:opacity-60"
                    style={{ backgroundColor: 'var(--warning-text)', color: 'var(--btn-primary-text)' }}>
              {busy
                ? (lang === 'ko' ? '확인 중…' : 'Confirming…')
                : (lang === 'ko' ? '확인' : 'Confirm')}
            </button>
          </div>
        )}
      </div>
    )
  }

  if (isReported) {
    return (
      <div className="mb-3 text-xs flex items-center gap-2" style={{ color: 'var(--danger-text)' }}>
        <Icon name="warning" weight="fill" size={13} />
        <span>{lang === 'ko' ? '리포트됨' : 'Reported'}</span>
      </div>
    )
  }

  if (isConfirmed) {
    return (
      <div className="mb-3 text-xs flex items-center gap-2" style={{ color: 'var(--success-text)' }}>
        <Icon name="check" weight="bold" size={13} />
        <span>{lang === 'ko' ? '확인됨' : 'Confirmed'}</span>
      </div>
    )
  }

  return null
}

/* Phase 6b: list child task logs of a Start/End/Monitoring parent log.
   Each row links to the child log with its current status:
     • blank  → "filling required"  (no body, no field values)
     • filled → checkmark
     • carrying 'confirmation required' tag → warning chip
     • carrying 'confirmed by X' tag       → ✓ chip
   Clicking a row opens that child's detail page in the Logs tab. */
function ChildTasksBlock({ detail }) {
  const { activateTab } = useTab()
  const { lang } = useLang()
  const [children, setChildren] = useState([])

  const ids = detail?.child_task_ids || []
  useEffect(() => {
    if (!ids.length) { setChildren([]); return }
    let cancelled = false
    Promise.all(ids.map(id => api.get(`/logs/${id}`).then(r => r.data).catch(() => null)))
      .then(rows => { if (!cancelled) setChildren(rows.filter(Boolean)) })
    return () => { cancelled = true }
    // ids identity is stable per detail fetch
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids.join(',')])

  if (!detail || !ids.length) return null

  function openChild(id) {
    window.location.hash = `#/logs/${id}`     // SPA hash route into Logs tab detail
    activateTab('logs')
  }

  return (
    <div className="border-t pt-3 mb-3 space-y-1"
         style={{ borderColor: 'var(--border-subtle)' }}>
      <p className="text-xs uppercase tracking-wide mb-1"
         style={{ color: 'var(--text-muted)' }}>
        {lang === 'ko' ? `자식 태스크 (${ids.length})` : `Child tasks (${ids.length})`}
      </p>
      {children.map(c => {
        const needsConfirm = c.tags?.some(t => t.name === CONFIRMATION_REQUIRED_TAG)
        const isConfirmed = c.tags?.some(t => t.name === 'confirmed')
        const isReported = c.tags?.some(t => t.name === 'reported')
        const empty = !c.body && !c.format_fields_json
        return (
          <button key={c.id} type="button" onClick={() => openChild(c.id)}
            className="w-full flex items-center gap-2 text-left text-xs px-2 py-1.5 rounded border transition-colors"
            style={{ borderColor: 'var(--border-default)' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--surface-2)'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}>
            <span className="font-mono shrink-0" style={{ color: 'var(--text-muted)' }}>
              #{c.log_index ?? c.id}
            </span>
            <span className="truncate flex-1" style={{ color: 'var(--text-primary)' }}>
              {c.title || c.author_name}
            </span>
            {empty && !needsConfirm && (
              <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                    style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }}>
                {lang === 'ko' ? '미입력' : 'pending'}
              </span>
            )}
            {needsConfirm && (
              <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0 inline-flex items-center gap-1"
                    style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning-text)' }}>
                <Icon name="warning" weight="fill" size={11} /> {lang === 'ko' ? '확인 필요' : 'confirm'}
              </span>
            )}
            {isReported && (
              <span className="text-[10px] shrink-0 inline-flex items-center gap-1" style={{ color: 'var(--danger-text)' }}><Icon name="warning" weight="fill" size={11} /> reported</span>
            )}
            {isConfirmed && !isReported && (
              <span className="text-[10px] shrink-0 inline-flex items-center" style={{ color: 'var(--success-text)' }}><Icon name="check" weight="bold" size={12} /></span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/* Render the custom-field values stored on the entry. number_entry is shown
   as "main ± error" using its canonical {value, error} shape; other types
   display their raw value verbatim. Formats themselves are fetched lazily
   so we can also render the configured label per key. */
function CustomFieldsBlock({ detail }) {
  const [fmt, setFmt] = useState(null)
  useEffect(() => {
    if (detail?.format_id) {
      api.get('/formats').then(r => {
        setFmt(r.data.find(f => f.id === detail.format_id) || null)
      }).catch(() => {})
    } else {
      setFmt(null)
    }
  }, [detail?.format_id])

  if (!detail?.format_fields_json) return null
  let values
  try { values = JSON.parse(detail.format_fields_json) }
  catch { return null }
  if (!values || !Object.keys(values).length) return null

  const fieldByKey = Object.fromEntries((fmt?.fields || []).map(f => [f.key, f]))

  return (
    <div className="border-t pt-3 mb-3 space-y-1.5"
         style={{ borderColor: 'var(--border-subtle)' }}>
      {Object.entries(values).map(([key, val]) => {
        const spec = fieldByKey[key]
        const label = spec?.label || key
        // number_entry — stored as { value, error, variant, raw }
        if (val && typeof val === 'object' && 'value' in val && 'error' in val) {
          return (
            <div key={key} className="flex items-baseline gap-2 text-sm">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
              <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
                {formatNumberEntry(val)}
              </span>
              {val.variant && val.variant !== 'single' && (
                <span className="text-[10px] font-mono"
                      style={{ color: 'var(--text-muted)' }}>({val.variant})</span>
              )}
            </div>
          )
        }
        // Plain text / number
        return (
          <div key={key} className="flex items-baseline gap-2 text-sm">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
            <span style={{ color: 'var(--text-primary)' }}>{String(val ?? '')}</span>
          </div>
        )
      })}
    </div>
  )
}


function isImage(ct) { return ct && ct.startsWith('image/') }

function formatSize(bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Small action button shared by reply / continue / edit / delete in the action bar.
export default function LogCardExpanded({
  entry,
  focused = false,
  refreshTrigger = 0,   // increment from outside to re-fetch comments
  onClose,
  onNoticeToggled,      // called after notice state changes (re-fetches parent list)
  onDeleted,            // called after soft-delete so parent can refresh
  onComment,            // if provided, 댓글 버튼이 이 콜백을 호출 (Home bottom bar); 없으면 인라인 폼
}) {
  const { user } = useAuth()
  const { t, lang } = useLang()
  const { openNewLog } = useTab()
  const tagColorsExp = useTagColors()
  const [detail, setDetail] = useState(null)
  const [comments, setComments] = useState([])
  const [isNotice, setIsNotice] = useState(entry.is_notice ?? false)
  const [togglingNotice, setTogglingNotice] = useState(false)
  const [showCommentBox, setShowCommentBox] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [reportMode, setReportMode] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const commentRef = useRef(null)
  const mountedRef = useRef(true)

  // Inline comment/report is the single path now (the old Home bottom bar is
  // gone). Open it from the `r` shortcut (focus-comment) or the report button.
  useEffect(() => {
    if (onComment) return   // host is handling comments instead
    const open = (report, text) => { if (text != null) setCommentText(text); setReportMode(report); setShowCommentBox(true); setTimeout(() => commentRef.current?.focus(), 50) }
    const onFocus = (e) => { if (e.detail?.id === entry.id) open(!!e.detail.report, e.detail.text) }
    const onReportEvt = (e) => { if (e.detail?.id === entry.id) open(true) }
    window.addEventListener('lilak:cmd:focus-comment', onFocus)
    window.addEventListener('lilak:cmd:report', onReportEvt)
    return () => { window.removeEventListener('lilak:cmd:focus-comment', onFocus); window.removeEventListener('lilak:cmd:report', onReportEvt) }
  }, [entry.id, onComment])

  const focusRing = focused ? 'ring-2 ring-blue-500 ring-offset-1' : ''

  // Re-usable detail fetcher — called on mount and after confirmation.
  function reloadDetail() {
    api.get(`/logs/${entry.id}`)
      .then(r => {
        if (mountedRef.current && r.data && typeof r.data === 'object' && !Array.isArray(r.data))
          setDetail(r.data)
      })
      .catch(() => {})
  }

  // Fetch full detail + comments on mount; cancel on unmount
  useEffect(() => {
    mountedRef.current = true
    reloadDetail()
    api.get(`/logs/${entry.id}/comments`)
      .then(r => { if (mountedRef.current && Array.isArray(r.data)) setComments(r.data) })
      .catch(() => {})
    return () => { mountedRef.current = false }
  }, [entry.id])

  // Re-fetch comments AND detail (tags) when parent signals a change — e.g.
  // a report comment that adds #reported and drops 'confirmation required'.
  useEffect(() => {
    if (refreshTrigger === 0) return
    api.get(`/logs/${entry.id}/comments`)
      .then(r => { if (mountedRef.current && Array.isArray(r.data)) setComments(r.data) })
      .catch(() => {})
    reloadDetail()
  }, [refreshTrigger])  // eslint-disable-line react-hooks/exhaustive-deps

  async function deleteComment(commentId) {
    try {
      await api.delete(`/logs/${entry.id}/comments/${commentId}`)
      if (mountedRef.current)
        setComments(prev => prev.filter(c => c.id !== commentId))
    } catch { /* silent */ }
  }

  async function toggleNotice() {
    setTogglingNotice(true)
    try {
      await api.put(`/logs/${entry.id}`, { is_notice: !isNotice })
      if (mountedRef.current) setIsNotice(v => !v)
      onNoticeToggled?.()
    } catch { /* silent */ }
    finally { if (mountedRef.current) setTogglingNotice(false) }
  }

  async function handleSubmitComment(e) {
    e?.preventDefault()
    const body = commentText.trim()
    if (!body || commentSubmitting) return
    setCommentSubmitting(true)
    try {
      const r = await api.post(`/logs/${entry.id}/comments`, { body, report: reportMode })
      if (mountedRef.current) {
        setComments(prev => [...prev, r.data])
        setCommentText('')
        setShowCommentBox(false)
        setReportMode(false)
      }
    } catch { /* silent */ }
    finally { if (mountedRef.current) setCommentSubmitting(false) }
  }

  async function handleDelete() {
    if (!window.confirm(t('detail_delete_confirm'))) return
    setDeleting(true)
    try {
      await api.delete(`/logs/${entry.id}`)
      onDeleted?.()
      onClose?.()
    } catch {
      if (mountedRef.current) setDeleting(false)
    }
  }

  function openCommentBox(report = false) {
    setReportMode(report)
    setShowCommentBox(true)
    setTimeout(() => commentRef.current?.focus(), 50)
  }

  const canEdit = user && (user.role === 'manager' || user.username === entry.author_name)
  const canDelete = user?.role === 'manager'

  if (!entry) return null

  const e = detail || entry
  const pending = e.task_status === 'pending' && !e.task_service_id && !e.task_module

  const noticeBadge = isNotice
    ? <span style={{ fontSize: 'var(--fs-tiny, 11px)', padding: '2px 8px', borderRadius: 999, backgroundColor: 'var(--warning-bg)', color: 'var(--warning-text)' }}>{t('notice_badge')}</span>
    : null

  const headerRight = user?.role === 'manager'
    ? <button onClick={toggleNotice} disabled={togglingNotice}
        className="text-xs px-2 py-0.5 rounded transition-colors disabled:opacity-50"
        style={isNotice ? { backgroundColor: 'var(--warning-bg)', color: 'var(--warning-text)' } : { color: 'var(--text-muted)' }}
        title={isNotice ? t('notice_unmark') : t('notice_mark')}>
        {isNotice ? t('notice_unmark') : t('notice_mark')}
      </button>
    : null

  const banner = (
    <>
      <ConfirmationBanner entry={detail || entry} onChanged={reloadDetail} />
      {pending && (
        <div className="flex items-center justify-between gap-3 mb-3 px-3 py-2 rounded-lg border"
             style={{ backgroundColor: 'var(--info-bg)', borderColor: '#2563eb', color: 'var(--info-text)' }}>
          <div className="text-sm flex items-center gap-1.5">
            <Icon name="warning" weight="fill" size={14} />
            <span>{lang === 'ko' ? '아직 입력되지 않은 task 입니다. [Go] 를 눌러 작성하세요.'
                           : 'This task has not been filled — click [Go] to complete it.'}</span>
          </div>
          {user && (
            <button onClick={() => openNewLog({ editId: entry.id })}
                    className="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-md"
                    style={{ backgroundColor: '#2563eb', color: '#ffffff' }}>
              {t('detail_go') || 'Go'}
            </button>
          )}
        </div>
      )}
    </>
  )

  const beforeBody = (
    <>
      <CustomFieldsBlock detail={detail} />
      <ChildTasksBlock detail={detail} />
    </>
  )

  const actions = user && (
    <div className="border-t pt-3 mt-1 flex items-center gap-1.5 flex-wrap"
         style={{ borderColor: 'var(--border-subtle)' }}>
      <ActionBtn onClick={onComment ?? openCommentBox} hoverFg="var(--text-link)" hoverBg="var(--info-bg)">{t('cmd_hint_reply')}</ActionBtn>
      <ActionBtn onClick={() => openNewLog({ fromId: entry.id })} hoverFg="var(--success-text)" hoverBg="var(--success-bg)">{t('detail_continue')}</ActionBtn>
      {canEdit && (
        <ActionBtn onClick={() => openNewLog({ editId: entry.id })} hoverFg="var(--warning-text)" hoverBg="var(--warning-bg)">{t('detail_edit')}</ActionBtn>
      )}
      {canDelete && (
        <ActionBtn onClick={handleDelete} disabled={deleting} hoverFg="var(--danger-text)" hoverBg="var(--danger-bg)" extraClass="ml-auto"><span className="inline-flex items-center gap-1"><Icon name="trash" size={13} /> {t('detail_delete')}</span></ActionBtn>
      )}
    </div>
  )

  const footer = (
    <>
      {!onComment && showCommentBox && (
        <form onSubmit={handleSubmitComment} className="mt-2 flex gap-2 items-start">
          {reportMode && (
            <span className="shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded text-xs" style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)' }}>
              <Icon name="warning" weight="fill" size={12} /> {lang === 'ko' ? '리포트' : 'Report'}
            </span>
          )}
          <textarea
            ref={commentRef}
            value={commentText}
            onChange={ev => setCommentText(ev.target.value)}
            onKeyDown={ev => {
              if (ev.key === 'Enter' && !ev.shiftKey) { ev.preventDefault(); handleSubmitComment() }
              if (ev.key === 'Escape') { ev.stopPropagation(); setShowCommentBox(false); setCommentText(''); setReportMode(false) }
            }}
            placeholder={reportMode ? (lang === 'ko' ? '리포트 사유를 입력하세요…' : 'Reason for report…') : t('comments_placeholder_short')}
            rows={2}
            className="flex-1 text-sm border rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2"
            style={{ backgroundColor: 'var(--input-bg)', borderColor: reportMode ? 'var(--danger-text)' : 'var(--input-border)', color: 'var(--text-primary)' }}
            disabled={commentSubmitting}
          />
          <div className="flex flex-col gap-1 shrink-0">
            <button type="submit" disabled={!commentText.trim() || commentSubmitting}
              className="text-xs disabled:opacity-40 px-3 py-1.5 rounded-lg transition-colors"
              style={{ backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}>
              {commentSubmitting ? '…' : t('community_send')}
            </button>
            <button type="button" onClick={() => { setShowCommentBox(false); setCommentText('') }}
              className="text-xs px-3 py-1.5 rounded-lg transition-colors" style={{ color: 'var(--text-muted)' }}>취소</button>
          </div>
        </form>
      )}
      {comments.length > 0 && <CommentsSection comments={comments} user={user} onDelete={deleteComment} />}
    </>
  )

  return (
    <LogDetail
      entry={entry}
      detail={detail}
      tagColorMap={tagColorsExp}
      focused={focused}
      onClose={onClose}
      labels={{
        noBody: t('detail_no_body'),
        attachments: (n) => t('detail_attachments', n),
        close: t('cmd_close'),
        editedBy: (by, at) => t('detail_edited_by', by, at),
      }}
      noticeBadge={noticeBadge}
      headerRight={headerRight}
      banner={banner}
      beforeBody={beforeBody}
      actions={actions}
      footer={footer}
    />
  )
}
