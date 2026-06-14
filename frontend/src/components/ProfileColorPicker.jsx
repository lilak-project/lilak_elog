/**
 * ProfileColorPicker — a small swatch row for choosing an avatar tint.
 *
 * Props:
 *   • value:    current color string (e.g. '#3b82f6') or null
 *   • onChange: (newColor:string|null) => void
 *   • label:    optional label text
 *
 * Behavior:
 *   • Click a swatch to select it.
 *   • Click the "no-color" chip to clear (falls back to theme default).
 *   • Includes a free-form hex input for users who want a custom color.
 */

// 10 friendly preset colors that look OK on both light and dark backgrounds.
export const PROFILE_COLOR_PRESETS = [
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#14b8a6', // teal
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#a855f7', // purple
  '#ec4899', // pink
  '#64748b', // slate
]

export default function ProfileColorPicker({ value, onChange, label }) {
  const v = (value || '').toLowerCase()

  return (
    <div>
      {label && (
        <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </label>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {/* "No color" / reset chip */}
        <button
          type="button"
          onClick={() => onChange(null)}
          className="h-7 w-7 rounded-full border-2 flex items-center justify-center transition-transform"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: !v ? 'var(--info-text)' : 'var(--border-default)',
            transform: !v ? 'scale(1.1)' : undefined,
          }}
          title="기본"
        >
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>—</span>
        </button>

        {PROFILE_COLOR_PRESETS.map(c => {
          const sel = c === v
          return (
            <button
              key={c}
              type="button"
              onClick={() => onChange(c)}
              className="h-7 w-7 rounded-full border-2 transition-transform"
              style={{
                backgroundColor: c,
                borderColor: sel ? 'var(--text-primary)' : 'transparent',
                transform: sel ? 'scale(1.1)' : undefined,
              }}
              title={c}
            />
          )
        })}
      </div>
    </div>
  )
}
