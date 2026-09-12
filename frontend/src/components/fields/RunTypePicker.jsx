/**
 * RunTypePicker — pill row for choosing the log's run type.
 *
 *   Start | Running | End | IDLE
 *
 * Four, not the whole catalogue: Init and Monitoring only ever arrive from a
 * system format's `run_type_lock`, and `A` exists only so old rows still read.
 * Names rather than letters — `S`/`E`/`M` mean nothing until someone has been
 * told what they mean, and this is the control that decides whether a log
 * counts as a run boundary.
 *
 * When the active format has a `run_type_lock`, the picker becomes a single
 * read-only pill so users can't override the locked value (per Phase 4 spec
 * — Start/End/Monitoring system formats are fixed).
 */

import { PICKABLE_RUN_TYPES, runTypeLabel } from '../../utils/formatUtils'

export default function RunTypePicker({
  value,            // current run_type letter, or null
  onChange,         // (letter) => void
  lockedTo = null,  // when set, picker is read-only and forced to this letter
  lang = 'ko',
  hint = null,      // small text shown to the right (e.g. "auto: R")
}) {
  const effective = lockedTo || value || 'IDLE'

  if (lockedTo) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs px-2 py-1 rounded border"
              style={{
                backgroundColor: 'var(--warning-bg)',
                borderColor:     'var(--warning-text)',
                color:           'var(--warning-text)',
              }}
              title={lang === 'ko' ? '시스템 포멧으로 고정됨' : 'Locked by system format'}>
              {runTypeLabel(lockedTo, lang)}
        </span>
      </div>
    )
  }

  // A log written before this picker was trimmed can hold `M` or `A`. Show it
  // alongside the four rather than leaving nothing selected — otherwise the row
  // looks unset and the first click silently rewrites a value nobody meant to
  // touch. (Not picking it again is the point: it stays until overwritten.)
  const ids = PICKABLE_RUN_TYPES.includes(effective)
    ? PICKABLE_RUN_TYPES
    : [...PICKABLE_RUN_TYPES, effective]

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {ids.map(id => {
        const active = id === effective
        return (
          <button
            key={id}
            type="button"
            onClick={() => onChange(id)}
            className="text-xs px-2.5 py-1 rounded border transition-colors"
            style={{
              backgroundColor: active ? 'var(--info-bg)'   : 'var(--surface-2)',
              borderColor:     active ? 'var(--info-text)' : 'var(--border-default)',
              color:           active ? 'var(--info-text)' : 'var(--text-secondary)',
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.backgroundColor = 'var(--surface-3)' }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.backgroundColor = 'var(--surface-2)' }}
          >
            {runTypeLabel(id, lang)}
          </button>
        )
      })}
      {hint && (
        <span className="text-[10px] ml-1" style={{ color: 'var(--text-muted)' }}>
          {hint}
        </span>
      )}
    </div>
  )
}
