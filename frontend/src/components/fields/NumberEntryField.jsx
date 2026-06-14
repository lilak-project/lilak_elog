/**
 * NumberEntryField — input widget for the `number_entry` field type.
 *
 *  • single   — one numeric input.  main = value,  error = 0.
 *  • range    — min + max.          main = mid,    error = half-width.
 *  • multiple — 10-slot grid.       main = mean,   error = sample stddev.
 *
 * The component is *controlled*: the parent owns the raw value object
 * ({single}, {min,max}, or {values}). On every keystroke we send the new raw
 * object back and live-recompute the canonical {value, error} for the preview.
 */

import { computeNumberEntry } from '../../utils/formatUtils'
import { Icon } from 'lilak-ui'

const inputCls = 'w-full border rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--input-focus-border)]'

function NumInput({ value, onChange, placeholder }) {
  return (
    <input
      type="number"
      step="any"
      className={inputCls}
      style={{
        backgroundColor: 'var(--input-bg)',
        borderColor:     'var(--input-border)',
        color:           'var(--text-primary)',
      }}
      value={value ?? ''}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
    />
  )
}

function ResultPreview({ canonical }) {
  const { value, error } = canonical
  // Strip trailing zeros for readability — 1.230 → 1.23, 1.000 → 1.
  const fmt = n => {
    if (n === 0) return '0'
    const s = Number(n).toPrecision(5)
    return parseFloat(s).toString()
  }
  return (
    <div className="text-xs whitespace-nowrap font-mono"
         style={{ color: 'var(--text-secondary)' }}>
      {error
        ? <>= <strong style={{ color: 'var(--text-primary)' }}>{fmt(value)}</strong> ± {fmt(error)}</>
        : <>= <strong style={{ color: 'var(--text-primary)' }}>{fmt(value)}</strong></>}
    </div>
  )
}


export default function NumberEntryField({
  variant = 'single',
  value,         // raw object — depends on variant
  onChange,      // (newRaw) => void
  disabled = false,
  inline = false,   // compact single-row layout (used in the log edit form)
}) {
  const v = value && typeof value === 'object'
    ? value
    : {}
  const canonical = computeNumberEntry(v, variant)

  if (variant === 'range') {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <NumInput
          value={v.min}
          onChange={x => onChange({ ...v, min: x })}
          placeholder="min"
        />
        <span style={{ color: 'var(--text-muted)' }}>~</span>
        <NumInput
          value={v.max}
          onChange={x => onChange({ ...v, max: x })}
          placeholder="max"
        />
        <ResultPreview canonical={canonical} />
      </div>
    )
  }

  if (variant === 'multiple') {
    // Start with a single slot; add slots one at a time (no fixed 10-grid).
    const existing = Array.isArray(v.values) ? v.values : []
    const slots = existing.length ? existing : ['']
    function setSlot(i, x) {
      const next = slots.slice(); next[i] = x
      onChange({ ...v, values: next })
    }
    function addSlot() { onChange({ ...v, values: [...slots, ''] }) }
    function removeSlot(i) {
      const next = slots.filter((_, j) => j !== i)
      onChange({ ...v, values: next.length ? next : [''] })
    }
    const addBtn = !disabled && (
      <button type="button" onClick={addSlot}
              className="border rounded-lg text-sm font-medium px-2 shrink-0"
              style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)', backgroundColor: 'var(--surface-2)' }}
              title="add value">+</button>
    )
    if (inline) {
      // One compact row: = value ± err   [input] [✕] … [+]
      return (
        <div className="flex items-center gap-1.5 flex-wrap">
          <ResultPreview canonical={canonical} />
          {slots.map((s, i) => (
            <div key={i} className="flex items-center gap-0.5" style={{ width: 90 }}>
              <NumInput value={s} onChange={x => setSlot(i, x)} placeholder={`#${i + 1}`} />
              {slots.length > 1 && !disabled && (
                <button type="button" onClick={() => removeSlot(i)}
                        className="text-xs shrink-0 px-0.5" style={{ color: 'var(--danger-text)' }}
                        title="remove"><Icon name="close" size={12} /></button>
              )}
            </div>
          ))}
          {addBtn}
        </div>
      )
    }
    return (
      <div className="space-y-1.5">
        <div className="grid grid-cols-5 gap-1.5">
          {slots.map((s, i) => (
            <div key={i} className="flex items-center gap-0.5">
              <NumInput value={s} onChange={x => setSlot(i, x)} placeholder={`#${i + 1}`} />
              {slots.length > 1 && !disabled && (
                <button type="button" onClick={() => removeSlot(i)}
                        className="text-xs shrink-0 px-0.5" style={{ color: 'var(--danger-text)' }}
                        title="remove"><Icon name="close" size={12} /></button>
              )}
            </div>
          ))}
          {!disabled && (
            <button type="button" onClick={addSlot}
                    className="border rounded-lg text-sm font-medium"
                    style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)', backgroundColor: 'var(--surface-2)' }}
                    title="add value">+</button>
          )}
        </div>
        <ResultPreview canonical={canonical} />
      </div>
    )
  }

  // single (default)
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <NumInput
        value={v.single ?? v.value}
        onChange={x => onChange({ single: x })}
        placeholder="value"
      />
      <ResultPreview canonical={canonical} />
    </div>
  )
}
