/**
 * Run-group EXPANDED view. The collapsed row and the expanded frame use the
 * SAME kit components as a normal log entry (LogEntryCard / LogDetail) — only
 * the *content* differs: instead of one log's body, the expanded card stacks
 * every log of the run (fields + body + attachments) in time order, dropped
 * into LogDetail's `body` slot. So list / collapsed / expanded shapes, run
 * badges, nav and space-toggle all match Normal mode for free.
 */
import { useState, useEffect } from 'react'
import { Markdown, LogDetail } from 'lilak-ui'
import api, { apiBaseFor, getExperiment } from '../api'
import { formatNumberEntry } from '../utils/formatUtils'

const attUrl = (id) => `${apiBaseFor(getExperiment())}/attachments/${id}`
const isImg = (a) => a.content_type
  ? a.content_type.startsWith('image/')
  : /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(a.original_filename || '')

// Custom format fields → "label value" chips (number_entry shown as mean ± err).
function Fields({ detail, formats }) {
  if (!detail?.format_fields_json) return null
  let values
  try { values = JSON.parse(detail.format_fields_json) } catch { return null }
  if (!values || !Object.keys(values).length) return null
  const fmt = formats.find(f => f.id === detail.format_id)
  const labelByKey = Object.fromEntries((fmt?.fields || []).map(f => [f.key, f.label || f.key]))
  const cells = Object.entries(values).filter(([, v]) => v != null && v !== '')
  if (!cells.length) return null
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm mt-1">
      {cells.map(([k, v]) => {
        const val = (v && typeof v === 'object' && 'value' in v) ? formatNumberEntry(v) : String(v ?? '')
        return (
          <span key={k} className="inline-flex items-baseline gap-1">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{labelByKey[k] || k}</span>
            <span className="font-mono" style={{ color: 'var(--text-primary)' }}>{val}</span>
          </span>
        )
      })}
    </div>
  )
}

// One log's content inside a run group — fetched on demand (only when open).
function RunLogBlock({ entry, formats }) {
  const [detail, setDetail] = useState(null)
  useEffect(() => {
    let alive = true
    api.get(`/logs/${entry.id}`).then(r => { if (alive && r.data && !Array.isArray(r.data)) setDetail(r.data) }).catch(() => {})
    return () => { alive = false }
  }, [entry.id])

  const d = detail || entry
  const atts = detail?.attachments || []
  const images = atts.filter(isImg)
  const files = atts.filter(a => !isImg(a))

  return (
    <div className="border-t pt-2 mt-2" style={{ borderColor: 'var(--border-subtle)' }}>
      <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-xs mb-0.5" style={{ color: 'var(--text-muted)' }}>
        <span className="font-mono">_{entry.log_index ?? entry.id}</span>
        {entry.run_type && <span className="font-mono">{entry.run_type}</span>}
        <span>{entry.created_at ? new Date(entry.created_at).toLocaleString() : ''}</span>
        <span>{entry.author_name}</span>
        {entry.title && <span style={{ color: 'var(--text-secondary)' }}>· {entry.title}</span>}
      </div>
      <Fields detail={detail} formats={formats} />
      {d.body && <div className="text-sm mt-1" style={{ color: 'var(--text-primary)' }}><Markdown>{d.body}</Markdown></div>}
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {images.map(a => (
            <a key={a.id} href={attUrl(a.id)} target="_blank" rel="noopener noreferrer" title={a.original_filename}
               style={{ display: 'block', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--border-default)', lineHeight: 0 }}>
              <img src={attUrl(a.id)} alt={a.original_filename} loading="lazy"
                   style={{ display: 'block', maxWidth: 180, maxHeight: 180, objectFit: 'cover' }} />
            </a>
          ))}
        </div>
      )}
      {files.length > 0 && (
        <div className="flex flex-wrap gap-2 mt-2">
          {files.map(a => (
            <a key={a.id} href={attUrl(a.id)} target="_blank" rel="noopener noreferrer"
               className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border" style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)', textDecoration: 'none' }}>
              <span className="truncate" style={{ maxWidth: 180 }}>{a.original_filename}</span>
            </a>
          ))}
        </div>
      )}
    </div>
  )
}

// Expanded run group — the kit LogDetail (identical to a normal expanded log),
// with the merged per-log timeline in its `body` slot.
export function RunGroupExpanded({ entry, formats, focused, onClose }) {
  const logs = entry._runLogs || []
  const body = (
    <div>
      {logs.map(lg => <RunLogBlock key={lg.id} entry={lg} formats={formats} />)}
    </div>
  )
  return (
    <LogDetail entry={entry} detail={entry} focused={focused} onClose={onClose}
      labels={{ noBody: '내용 없음', close: '닫기' }} body={body} showIndex={false} />
  )
}
