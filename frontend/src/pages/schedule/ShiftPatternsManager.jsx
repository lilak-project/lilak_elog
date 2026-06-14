import { useState, useEffect } from 'react'
import api from '../../api'
import { useLang } from '../../context/LangContext'
import { PALETTE, PALETTE_KEYS, paletteClasses } from '../../theme/palette'
import {
  btnPrimary, btnPrimaryHover,
  modalFrame, modalOverlay,
  inputBase, hoverify,
} from '../../theme/uiStyles'

// Shared field className used inside PatternEditor.
const editorInputCls = 'border rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--input-focus-border)]'

// ROLE_COLORS / COLOR_KEYS / roleColorClasses are kept as named exports
// for back-compat; they all source from the canonical palette now.
export const ROLE_COLORS = Object.fromEntries(
  PALETTE_KEYS.map(k => [k, PALETTE[k].tw])
)
const COLOR_KEYS = PALETTE_KEYS
export function roleColorClasses(name) {
  return paletteClasses(name)
}

/**
 * Roles are PATTERN-LEVEL (shared across all slots).
 * Each role: { name, color }
 */
/** Visual color-swatch picker — replaces a <select> dropdown. */
function ColorSwatchPicker({ value, onChange }) {
  const selected = value || 'emerald'
  return (
    <div className="flex items-center gap-1">
      {COLOR_KEYS.map(c => {
        const cls = roleColorClasses(c)
        const isSelected = c === selected
        return (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            title={c}
            className={`w-5 h-5 rounded-full ${cls.solid} transition-transform ${
              isSelected
                ? 'ring-2 ring-offset-1 ring-slate-700 scale-110'
                : 'hover:scale-110 opacity-70 hover:opacity-100'
            }`}
          />
        )
      })}
    </div>
  )
}

function RoleEditor({ roles, onChange, t }) {
  function add() { onChange([...roles, { name: '', color: COLOR_KEYS[roles.length % COLOR_KEYS.length] }]) }
  function update(i, patch) { onChange(roles.map((r, k) => k === i ? { ...r, ...patch } : r)) }
  function remove(i) { onChange(roles.filter((_, k) => k !== i)) }

  return (
    <div className="space-y-2">
      {roles.map((r, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={r.name}
            onChange={e => update(i, { name: e.target.value })}
            placeholder={t('sched_pat_role_name_ph')}
            className="border rounded px-2 py-0.5 text-xs flex-1 focus:outline-none focus:ring-2 focus:ring-[var(--input-focus-border)]"
            style={inputBase}
          />
          <ColorSwatchPicker value={r.color} onChange={c => update(i, { color: c })} />
          <button onClick={() => remove(i)} className="text-xs"
                  style={{ color: 'var(--danger-text)' }}>✕</button>
        </div>
      ))}
      <button onClick={add} className="text-[11px] hover:underline"
              style={{ color: 'var(--text-link)' }}>{t('sched_pat_add_role')}</button>
    </div>
  )
}

function PatternEditor({ initial, onSave, onCancel }) {
  const { t, lang } = useLang()
  const isNew = !initial
  const [name, setName]   = useState(initial?.name || '')
  // Slots: just label + start/end hour (no per-slot roles)
  const [slots, setSlots] = useState(() => {
    if (initial?.slots) {
      return initial.slots.map(s => ({
        label: s.label, start_hour: s.start_hour, end_hour: s.end_hour, color: s.color || null,
      }))
    }
    const day   = lang === 'ko' ? '주간' : 'Day'
    const night = lang === 'ko' ? '야간' : 'Night'
    return [
      { label: day,   start_hour: 8,  end_hour: 16 },
      { label: night, start_hour: 16, end_hour: 0  },
    ]
  })
  // Pattern-level roles: applied to every slot.
  // Backend stores roles as "name|color" strings; we also handle object form and legacy slot.roles.
  const [roles, setRoles] = useState(() => {
    if (initial?.roles && initial.roles.length > 0) {
      const parsed = initial.roles
        .map(r => {
          if (typeof r === 'string') {
            const [name, color] = r.split('|')
            if (!name) return null
            return { name, color: color || 'emerald' }
          }
          if (r && typeof r === 'object' && r.name) {
            return { name: r.name, color: r.color || 'emerald' }
          }
          return null
        })
        .filter(Boolean)
      if (parsed.length > 0) return parsed
    }
    // Migrate from old slot.roles if pattern.roles is empty
    if (initial?.slots && initial.slots.length > 0 && initial.slots[0].roles?.length > 0) {
      const seen = new Map()
      for (const s of initial.slots) {
        for (const r of (s.roles || [])) {
          if (!seen.has(r.name)) seen.set(r.name, { name: r.name, color: r.color || 'emerald' })
        }
      }
      return Array.from(seen.values())
    }
    return [{ name: 'shifter', color: 'emerald' }]
  })
  const [isActive, setActive] = useState(initial?.is_active ?? true)
  const [effectiveFrom, setEffectiveFrom] = useState(initial?.effective_from || '')
  const [effectiveTo,   setEffectiveTo]   = useState(initial?.effective_to   || '')
  const [err, setErr] = useState(null)

  function updateSlot(idx, patch) { setSlots(s => s.map((x, i) => i === idx ? { ...x, ...patch } : x)) }
  function removeSlot(idx)         { setSlots(s => s.filter((_, i) => i !== idx)) }
  function addSlot()               { setSlots(s => [...s, { label: '', start_hour: 0, end_hour: 8 }]) }

  async function save() {
    if (!name.trim()) { setErr(t('sched_pat_err_name')); return }
    const cleanSlots = slots.filter(s => s.label.trim()).map(s => ({
      label: s.label.trim(),
      start_hour: Number(s.start_hour) || 0,
      end_hour:   Number(s.end_hour) || 0,
      color: s.color || null,
      roles: [],  // pattern-level roles; per-slot is empty
    }))
    if (cleanSlots.length === 0) { setErr(t('sched_pat_err_slot')); return }
    const cleanRoles = roles.filter(r => r.name.trim()).map(r => ({
      name: r.name.trim(),
      color: r.color || 'emerald',
    }))
    setErr(null)
    try {
      // We store roles as JSON objects in roles_json (backend just stores arbitrary list).
      // The schema accepts list[str], so we stuff JSON-encoded objects in.
      // Easier: just send role NAMES; colors are looked up via name → color map elsewhere.
      // BUT we want colors — so we extend the backend to store list of {name,color}.
      // Workaround: send "name|color" strings.
      const payload = {
        name: name.trim(),
        slots: cleanSlots,
        roles: cleanRoles.map(r => `${r.name}|${r.color}`),
        effective_from: effectiveFrom || null,
        effective_to:   effectiveTo   || null,
        is_active: isActive,
      }
      if (isNew) await api.post('/schedule/shift-patterns', payload)
      else       await api.put(`/schedule/shift-patterns/${initial.id}`, payload)
      onSave()
    } catch (e) {
      setErr(e.response?.data?.detail || t('sched_err_save'))
    }
  }

  return (
    <div className="border rounded-lg p-4 space-y-3"
         style={{ borderColor: 'var(--border-default)', backgroundColor: 'var(--surface-2)' }}>
      {err && (
        <div className="border text-xs px-3 py-2 rounded"
             style={{ backgroundColor: 'var(--danger-bg)', borderColor: 'var(--danger-text)', color: 'var(--danger-text)' }}>{err}</div>
      )}

      <div className="flex items-center gap-2">
        <label className="text-xs w-16" style={{ color: 'var(--text-secondary)' }}>{t('sched_pat_name')}</label>
        <input value={name} onChange={e => setName(e.target.value)}
          placeholder={t('sched_pat_name_ph')}
          className={`flex-1 ${editorInputCls}`} style={inputBase} />
        <label className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-secondary)' }}>
          <input type="checkbox" checked={isActive} onChange={e => setActive(e.target.checked)} />
          {t('sched_pat_active')}
        </label>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs w-16" style={{ color: 'var(--text-secondary)' }}>적용 기간</label>
        <input type="date" value={effectiveFrom}
          onChange={e => setEffectiveFrom(e.target.value)}
          className={editorInputCls} style={inputBase} />
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>~</span>
        <input type="date" value={effectiveTo}
          onChange={e => setEffectiveTo(e.target.value)}
          className={editorInputCls} style={inputBase} />
        <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>비우면 무제한</span>
      </div>

      {/* Slots (label + hours only) */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>시간 슬롯</span>
          <button onClick={addSlot} className="text-[11px] hover:underline"
                  style={{ color: 'var(--text-link)' }}>{t('sched_pat_add_slot')}</button>
        </div>
        <p className="text-[10px] mb-1" style={{ color: 'var(--text-muted)' }}>
          종료 시각이 시작 시각보다 작거나, 24 이상의 값을 입력하면 다음날로 이어집니다.
          예) 22 ~ 6 또는 22 ~ 30 = 밤 10시부터 다음날 6시.
        </p>
        <div className="space-y-1">
          {slots.map((s, i) => {
            const sh = Number(s.start_hour) || 0
            const eh = Number(s.end_hour) || 0
            const wraps = eh >= 24 || eh <= sh
            const endDisplay = ((eh % 24) + 24) % 24
            return (
              <div key={i} className="flex items-center gap-1.5">
                <input value={s.label} onChange={e => updateSlot(i, { label: e.target.value })}
                  placeholder={t('sched_pat_slot_name_ph')}
                  className={`${editorInputCls} flex-1`} style={inputBase} />
                <input type="number" min={0} max={23} value={s.start_hour}
                  onChange={e => updateSlot(i, { start_hour: e.target.value })}
                  className={`${editorInputCls} w-14 no-spin`} style={inputBase} />
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>~</span>
                <input type="number" min={0} max={47} value={s.end_hour}
                  onChange={e => updateSlot(i, { end_hour: e.target.value })}
                  className={`${editorInputCls} w-14 no-spin`} style={inputBase} />
                {wraps && (
                  <span className="text-[10px] whitespace-nowrap"
                        style={{ color: 'var(--warning-text)' }}
                        title="다음날로 이어집니다">
                    +1d ({String(endDisplay).padStart(2, '0')}:00)
                  </span>
                )}
                <button onClick={() => removeSlot(i)} className="text-xs ml-1"
                        style={{ color: 'var(--danger-text)' }}>✕</button>
              </div>
            )
          })}
        </div>
      </div>

      {/* Pattern-level roles (apply to every slot) */}
      <div className="border-t pt-3" style={{ borderColor: 'var(--border-default)' }}>
        <div className="mb-1.5">
          <span className="text-[11px] uppercase tracking-wider" style={{ color: 'var(--text-secondary)' }}>역할 (모든 슬롯 공통)</span>
          <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-muted)' }}>한 번 정한 역할이 모든 시간 슬롯에 자동 적용됩니다. 예: daq, shift, beam</p>
        </div>
        <RoleEditor t={t} roles={roles} onChange={setRoles} />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <button onClick={onCancel} className="text-xs px-3 py-1.5 hover:underline"
                style={{ color: 'var(--text-secondary)' }}>{t('sched_pat_cancel')}</button>
        <button onClick={save} className="px-4 py-1.5 rounded text-xs transition-colors"
                style={btnPrimary}
                {...hoverify(btnPrimary, btnPrimaryHover)}>{t('sched_pat_save')}</button>
      </div>
    </div>
  )
}


export default function ShiftPatternsManager({ patterns: initial, activePattern, onClose }) {
  const { t } = useLang()
  const [patterns, setPatterns] = useState(initial || [])
  const [activeId, setActiveId] = useState(activePattern?.id ?? null)
  const [editing, setEditing]   = useState(null)

  // ESC to close
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        if (editing) setEditing(null)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing, onClose])

  async function load() {
    const [pr, ar] = await Promise.all([
      api.get('/schedule/shift-patterns'),
      api.get('/schedule/active-pattern'),
    ])
    setPatterns(pr.data)
    setActiveId(ar.data?.id ?? null)
  }

  async function handleDelete(p) {
    if (!window.confirm(t('sched_pat_delete_confirm', p.name))) return
    try {
      await api.delete(`/schedule/shift-patterns/${p.id}`)
      await load()
    } catch (err) {
      const msg = err?.response?.data?.detail || err?.message || 'Delete failed'
      window.alert(`삭제 실패: ${msg}`)
      // eslint-disable-next-line no-console
      console.error('[ShiftPattern delete]', err)
    }
  }

  async function makeActive(p) {
    await api.post(`/schedule/active-pattern/${p.id}`)
    load()
  }

  /** Parse "name|color" strings (or fall back to legacy formats) into role objects */
  function parseRoles(p) {
    const out = []
    for (const r of (p.roles || [])) {
      if (typeof r === 'string') {
        const [name, color] = r.split('|')
        out.push({ name, color: color || 'emerald' })
      } else if (r && typeof r === 'object' && r.name) {
        out.push({ name: r.name, color: r.color || 'emerald' })
      }
    }
    if (out.length === 0 && Array.isArray(p.slots)) {
      // Legacy: merge from per-slot roles
      const seen = new Map()
      for (const s of p.slots) {
        for (const r of (s.roles || [])) {
          if (!seen.has(r.name)) seen.set(r.name, { name: r.name, color: r.color || 'emerald' })
        }
      }
      return Array.from(seen.values())
    }
    return out
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={modalOverlay}
      onClick={onClose}>
      <div className="rounded-2xl shadow-2xl w-full max-w-2xl mt-10 mb-10 border"
        style={modalFrame}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b"
             style={{ borderColor: 'var(--border-subtle)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{t('sched_pat_title')}</h2>
          <button onClick={onClose} className="text-xl transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>×</button>
        </div>

        <div className="p-6 space-y-4">
          {patterns.length === 0 && !editing && (
            <div className="text-center text-xs py-6" style={{ color: 'var(--text-muted)' }}>
              {t('sched_pat_empty')}
            </div>
          )}

          {patterns.map(p => (
            editing?.pattern?.id === p.id ? (
              <PatternEditor key={p.id} initial={p}
                onSave={() => { setEditing(null); load() }}
                onCancel={() => setEditing(null)} />
            ) : (
              <div key={p.id} className="border rounded-lg px-4 py-3 flex items-center gap-2"
                   style={activeId === p.id
                     ? { borderColor: 'var(--success-text)', backgroundColor: 'var(--success-bg)' }
                     : { borderColor: 'var(--border-default)', backgroundColor: 'var(--surface)' }}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{p.name}</span>
                    {activeId === p.id && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded"
                            style={{ backgroundColor: 'var(--success-text)', color: 'var(--btn-primary-text)' }}>{t('sched_pat_active')}</span>
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-[11px]">
                      {p.slots.map(s => (
                        <span key={s.label} className="px-2 py-0.5 rounded"
                              style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
                          {s.label} {s.start_hour}-{s.end_hour}
                        </span>
                      ))}
                    </div>
                    <div className="flex items-center gap-2 text-[11px] flex-wrap">
                      <span style={{ color: 'var(--text-muted)' }}>역할:</span>
                      {parseRoles(p).map(r => {
                        const c = roleColorClasses(r.color)
                        return (
                          <span key={r.name} className={`${c.bg} ${c.text} px-2 py-0.5 rounded inline-flex items-center gap-1`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${c.solid}`} />
                            {r.name}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                </div>
                {activeId !== p.id && (
                  <button onClick={() => makeActive(p)}
                    className="text-xs border px-3 py-1.5 rounded transition-colors"
                    style={{ color: 'var(--success-text)', borderColor: 'var(--success-text)' }}>{t('sched_pat_activate')}</button>
                )}
                <button onClick={() => setEditing({ pattern: p })}
                  className="text-xs border px-3 py-1.5 rounded transition-colors"
                  style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }}>{t('sched_pat_edit')}</button>
                <button onClick={() => handleDelete(p)}
                  className="text-xs border px-3 py-1.5 rounded transition-colors"
                  style={{ color: 'var(--danger-text)', borderColor: 'var(--border-default)' }}>{t('sched_pat_delete')}</button>
              </div>
            )
          ))}

          {editing === 'new' ? (
            <PatternEditor onSave={() => { setEditing(null); load() }} onCancel={() => setEditing(null)} />
          ) : (
            <button onClick={() => setEditing('new')}
              className="w-full border border-dashed rounded-lg py-2 text-xs transition-colors"
              style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-strong)' }}>
              {t('sched_pat_new')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
