/**
 * Shared building blocks for "entry" cards (log entries + infography entries),
 * so both render the exact same UI from one source of truth.
 */
import { useState } from 'react'
import { Icon } from 'lilak-ui'
import { useLang } from '../context/LangContext'
import { runNumberText } from '../utils/formatUtils'

// Collapsed comment list shows only the most recent comment; expand for all.
const COMMENTS_PREVIEW = 1

/** Severity → badge colors. Single source for the list card, expanded card,
 *  detail page and inline-editor header. */
export function severityStyle(sev, { withBorder = false } = {}) {
  const map = {
    warning:  ['var(--warning-bg)',    'var(--warning-text)',    'var(--warning-text)'],
    error:    ['var(--danger-bg)',     'var(--danger-text)',     'var(--danger-text)'],
    critical: ['var(--btn-danger-bg)', 'var(--btn-danger-text)', 'var(--btn-danger-bg)'],
    info:     ['var(--info-bg)',       'var(--info-text)',       'var(--info-text)'],
  }
  const [backgroundColor, color, borderColor] = map[sev] || map.info
  return withBorder ? { backgroundColor, color, borderColor } : { backgroundColor, color }
}

// Run-number box alternates near-black / light gray as the run changes, so
// consecutive runs are visually separable in the log list.
const RUN_NUM_STYLE     = { backgroundColor: '#374151', color: '#ffffff' }   // near-black
const RUN_NUM_ALT_STYLE = { backgroundColor: '#d1d5db', color: '#111827' }   // light gray, dark text
const BEAM_STYLE        = { backgroundColor: '#0d9488', color: '#ffffff' }   // teal
const TARGET_STYLE      = { backgroundColor: '#db2777', color: '#ffffff' }   // pink

/** Badges in order: [*run] [>beam] [@target]. (Run status is shown as a tag.) */
export function RunBadges({ entry, size = 'md' }) {
  const num = runNumberText(entry)
  if (!num && !entry.beam && !entry.target) return null
  const pad = size === 'sm' ? 'px-1.5 py-0.5' : 'px-2 py-0.5'
  const cls = `text-xs font-mono ${pad} rounded shrink-0`
  // run number is prefixed with '*'; run_log_index "(N)" is recorded but not shown.
  const numText = num ? `*${num}` : ''
  const single = entry.run_number_type === 'single' || !entry.run_number_type
  const numStyle = (single && entry.run_number != null && entry.run_number % 2 === 1)
    ? RUN_NUM_ALT_STYLE : RUN_NUM_STYLE
  return (
    <>
      {numText && <span className={cls} style={numStyle}>{numText}</span>}
      <span className={cls} style={BEAM_STYLE}>{`>${entry.beam || ''}`}</span>
      <span className={cls} style={TARGET_STYLE}>{`@${entry.target || ''}`}</span>
    </>
  )
}

/** Number badge — e.g. "_42" for logs, "&3" for infographs. */
export function NumberBadge({ children }) {
  return (
    <span className="text-xs font-mono px-2 py-0.5 rounded border"
          style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface)', borderColor: 'var(--border-default)' }}>
      {children}
    </span>
  )
}

/** Card action button (Edit / Comment / Delete …). */
export function ActionBtn({ onClick, disabled, children, hoverFg, hoverBg, extraClass = '' }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg transition-colors disabled:opacity-50 ${extraClass}`}
      style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)' }}
      onMouseEnter={e => {
        if (e.currentTarget.disabled) return
        if (hoverBg) e.currentTarget.style.backgroundColor = hoverBg
        if (hoverFg) e.currentTarget.style.color = hoverFg
      }}
      onMouseLeave={e => {
        e.currentTarget.style.backgroundColor = 'var(--surface-2)'
        e.currentTarget.style.color = 'var(--text-secondary)'
      }}
    >
      {children}
    </button>
  )
}

/** Comment list. Collapsed → most recent comment only; expand to see all. */
export function CommentsSection({ comments, user, onDelete }) {
  const { t } = useLang()
  const [expanded, setExpanded] = useState(false)
  const hidden = Math.max(0, comments.length - COMMENTS_PREVIEW)
  // Most recent comments are last; collapsed view shows the final one.
  const visible = expanded ? comments : comments.slice(-COMMENTS_PREVIEW)

  if (comments.length === 0) return null

  return (
    <div className="border-t pt-3 mt-3" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-muted)' }}>
          {t('comments_title')} ({comments.length})
        </p>
        {comments.length > COMMENTS_PREVIEW && (
          <button onClick={() => setExpanded(v => !v)}
            className="text-xs transition-colors hover:underline" style={{ color: 'var(--text-link)' }}>
            {expanded ? '▲ 접기' : `▼ ${hidden}개 더 보기`}
          </button>
        )}
      </div>
      <div className="space-y-1.5">
        {visible.map(c => (
          <div key={c.id} className="text-xs group flex items-start gap-1.5">
            <span className="flex-1 min-w-0">
              <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>{c.author_name}</span>{' '}
              <span className="whitespace-pre-wrap" style={{ color: 'var(--text-primary)' }}>{c.body}</span>
            </span>
            {user && onDelete && (user.username === c.author_name || user.role === 'manager') && (
              <button onClick={() => onDelete(c.id)}
                className="shrink-0 opacity-0 group-hover:opacity-100 transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--danger-text)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
              ><Icon name="close" size={13} /></button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
