/**
 * RunTypePicker — pill row for choosing one of the 6 run_type letters.
 *
 *   S | R | E | A | M | IDLE
 *
 * When the active format has a `run_type_lock`, the picker becomes a single
 * read-only pill so users can't override the locked value (per Phase 4 spec
 * — Start/End/Monitoring system formats are fixed).
 */

import { RUN_TYPES } from '../../utils/formatUtils'

export default function RunTypePicker({
  value,            // current run_type letter, or null
  onChange,         // (letter) => void
  lockedTo = null,  // when set, picker is read-only and forced to this letter
  lang = 'ko',
  hint = null,      // small text shown to the right (e.g. "auto: R")
}) {
  const effective = lockedTo || value || 'IDLE'

  if (lockedTo) {
    const spec = RUN_TYPES.find(r => r.id === lockedTo)
    return (
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono px-2 py-1 rounded border"
              style={{
                backgroundColor: 'var(--warning-bg)',
                borderColor:     'var(--warning-text)',
                color:           'var(--warning-text)',
              }}
              title={lang === 'ko' ? '시스템 포멧으로 고정됨' : 'Locked by system format'}>
          {spec?.id} · {lang === 'ko' ? spec?.labelKo : spec?.labelEn}
        </span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {RUN_TYPES.map(r => {
        const active = r.id === effective
        return (
          <button
            key={r.id}
            type="button"
            onClick={() => onChange(r.id)}
            className="text-xs font-mono px-2 py-1 rounded border transition-colors"
            title={lang === 'ko' ? r.labelKo : r.labelEn}
            style={{
              backgroundColor: active ? 'var(--info-bg)'   : 'var(--surface-2)',
              borderColor:     active ? 'var(--info-text)' : 'var(--border-default)',
              color:           active ? 'var(--info-text)' : 'var(--text-secondary)',
            }}
            onMouseEnter={e => { if (!active) e.currentTarget.style.backgroundColor = 'var(--surface-3)' }}
            onMouseLeave={e => { if (!active) e.currentTarget.style.backgroundColor = 'var(--surface-2)' }}
          >
            {r.id}
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
