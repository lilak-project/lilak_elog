import { useState, useEffect } from 'react'
import api from '../../api'
import { useAuth } from '../../context/AuthContext'
import { useLang } from '../../context/LangContext'
import {
  btnPrimary, btnPrimaryHover,
  modalFrame, modalHeader, modalOverlay,
  inputBase, hoverify,
} from '../../theme/uiStyles'

// Shared input style: matches all other forms across the app.
const fieldInputCls = 'border rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-[var(--input-focus-border)]'
const fieldLabelCls = 'text-xs text-right'
const fieldLabelStyle = { color: 'var(--text-secondary)' }

// Pill button for type / slot / role selectors.
function pillStyle(active, accent = 'primary') {
  if (active && accent === 'success') {
    return { backgroundColor: 'var(--success-text)', color: 'var(--btn-primary-text)' }
  }
  if (active) {
    return { backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }
  }
  return { backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)' }
}

function toLocalInput(d) {
  if (!d) return ''
  const dt = new Date(d)
  const pad = n => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}T${pad(dt.getHours())}:${pad(dt.getMinutes())}`
}
function fromLocalInput(s) {
  if (!s) return null
  return new Date(s).toISOString()
}

export default function EventModal({
  initial, defaultDate, defaultStart, defaultEnd, defaultType,
  patterns, users: passedUsers,
  onSave, onClose, onDelete,
}) {
  const { user } = useAuth()
  const { t } = useLang()
  const isNew = !initial

  // ESC to close
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const [eventType, setEventType] = useState(initial?.event_type || defaultType || 'experiment')
  const [title, setTitle]         = useState(initial?.title || '')
  const [description, setDescription] = useState(initial?.description || '')
  const [color, setColor]         = useState(initial?.color || '')
  const [dataType, setDataType]   = useState(initial?.data_type || '')

  const computedStart = (() => {
    if (initial?.start_at) return initial.start_at
    if (defaultStart)      return defaultStart
    if (defaultDate) {
      const d = new Date(defaultDate); d.setHours(new Date().getHours(), 0, 0, 0); return d.toISOString()
    }
    const now = new Date(); now.setMinutes(0, 0, 0); return now.toISOString()
  })()
  const computedEnd = (() => {
    if (initial?.end_at) return initial.end_at
    if (defaultEnd)      return defaultEnd
    const s = new Date(computedStart); s.setHours(s.getHours() + 1); return s.toISOString()
  })()

  const [startAt, setStartAt] = useState(toLocalInput(computedStart))
  const [endAt, setEndAt]     = useState(toLocalInput(computedEnd))

  // Shift-specific
  const [patternId, setPatternId]   = useState(initial?.shift_pattern_id ? String(initial.shift_pattern_id) : '')
  const [slotLabel, setSlotLabel]   = useState(initial?.shift_slot_label || '')
  const [shiftRole, setShiftRole]   = useState(initial?.shift_role || '')
  const [assignedId, setAssignedId] = useState(initial?.assigned_user_id ?? null)
  const [assignedName, setAssignedName] = useState(initial?.assigned_user_name || '')

  // Use passed users (avoids re-fetching), or fetch if not provided
  const [users, setUsers] = useState(passedUsers || [])
  useEffect(() => {
    if (passedUsers && passedUsers.length) { setUsers(passedUsers); return }
    api.get('/users/public').then(r => setUsers(r.data)).catch(() => {})
  }, [passedUsers])

  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState(null)

  const currentPattern = patterns?.find(p => String(p.id) === String(patternId))

  function applySlot(label) {
    setSlotLabel(label)
    if (!currentPattern) return
    const slot = currentPattern.slots.find(s => s.label === label)
    if (!slot) return
    const baseDate = startAt ? new Date(startAt) : new Date()
    const s = new Date(baseDate); s.setHours(slot.start_hour, 0, 0, 0)
    const e = new Date(baseDate); e.setHours(slot.end_hour, 0, 0, 0)
    if (slot.end_hour <= slot.start_hour) e.setDate(e.getDate() + 1)
    setStartAt(toLocalInput(s))
    setEndAt(toLocalInput(e))
  }

  function handleAssigneeChange(val) {
    if (!val) { setAssignedId(null); setAssignedName(''); return }
    const u = users.find(u => String(u.id) === String(val))
    if (u) { setAssignedId(u.id); setAssignedName(u.username) }
  }

  async function handleSave() {
    if (!title.trim())   { setErr(t('sched_err_title')); return }
    if (!startAt)        { setErr(t('sched_err_start')); return }
    if (!endAt)          { setErr(t('sched_err_end')); return }
    setSaving(true); setErr(null)
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        start_at: fromLocalInput(startAt),
        end_at: fromLocalInput(endAt),
        event_type: eventType,
        color: color || null,
        data_type: eventType === 'experiment' ? (dataType.trim() || null) : null,
        shift_pattern_id: eventType === 'shift' && patternId ? Number(patternId) : null,
        shift_slot_label: eventType === 'shift' ? (slotLabel || null) : null,
        shift_role: eventType === 'shift' ? (shiftRole || null) : null,
        assigned_user_id: eventType === 'shift' ? assignedId : null,
        assigned_user_name: eventType === 'shift' ? (assignedName || null) : null,
      }
      if (isNew) await api.post('/schedule/events', payload)
      else       await api.put(`/schedule/events/${initial.id}`, payload)
      onSave()
    } catch (e) {
      setErr(e.response?.data?.detail || t('sched_err_save'))
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!window.confirm(t('sched_evt_delete_confirm'))) return
    setSaving(true)
    try {
      await api.delete(`/schedule/events/${initial.id}`)
      onDelete()
    } catch (e) {
      setErr(e.response?.data?.detail || t('sched_err_delete'))
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={modalOverlay}
      onClick={onClose}>
      <div className="rounded-2xl shadow-2xl w-full max-w-lg mt-10 mb-10 border"
        style={modalFrame}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b"
             style={{ borderColor: 'var(--border-subtle)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {isNew ? t('sched_evt_new') : `${t('sched_evt_edit')} — ${initial.title}`}
          </h2>
          <button onClick={onClose} className="text-xl transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>×</button>
        </div>

        <div className="p-6 space-y-4">
          {err && (
            <div className="border text-xs px-3 py-2 rounded-lg"
                 style={{ backgroundColor: 'var(--danger-bg)', borderColor: 'var(--danger-text)', color: 'var(--danger-text)' }}>
              {err}
            </div>
          )}

          {/* Type */}
          <div className="grid grid-cols-[6rem_1fr] items-center gap-3">
            <label className={fieldLabelCls} style={fieldLabelStyle}>{t('sched_evt_type')}</label>
            <div className="flex gap-1.5">
              {[
                { v: 'experiment', l: t('sched_filter_experiment') },
                { v: 'shift',      l: t('sched_filter_shift') },
                { v: 'other',      l: t('sched_track_other') },
              ].map(o => (
                <button key={o.v} type="button" onClick={() => setEventType(o.v)}
                  className="px-3 py-1.5 text-xs rounded transition-colors"
                  style={pillStyle(eventType === o.v)}>{o.l}</button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[6rem_1fr] items-center gap-3">
            <label className={fieldLabelCls} style={fieldLabelStyle}>{t('sched_evt_title')} *</label>
            <input value={title} onChange={e => setTitle(e.target.value)}
              placeholder={t('sched_evt_title_ph')}
              className={fieldInputCls} style={inputBase} />
          </div>

          <div className="grid grid-cols-[6rem_1fr] items-center gap-3">
            <label className={fieldLabelCls} style={fieldLabelStyle}>{t('sched_evt_start')} *</label>
            <input type="datetime-local" step={3600} value={startAt} onChange={e => setStartAt(e.target.value)}
              className={fieldInputCls} style={inputBase} />
          </div>
          <div className="grid grid-cols-[6rem_1fr] items-center gap-3">
            <label className={fieldLabelCls} style={fieldLabelStyle}>{t('sched_evt_end')} *</label>
            <input type="datetime-local" step={3600} value={endAt} onChange={e => setEndAt(e.target.value)}
              className={fieldInputCls} style={inputBase} />
          </div>

          {eventType === 'shift' && (
            <>
              <div className="grid grid-cols-[6rem_1fr] items-center gap-3">
                <label className={fieldLabelCls} style={fieldLabelStyle}>{t('sched_evt_pattern')}</label>
                <select value={patternId} onChange={e => { setPatternId(e.target.value); setSlotLabel(''); setShiftRole('') }}
                  className={fieldInputCls} style={inputBase}>
                  <option value="">{t('sched_evt_pattern_free')}</option>
                  {patterns?.filter(p => p.is_active).map(p => (
                    <option key={p.id} value={String(p.id)}>{p.name}</option>
                  ))}
                </select>
              </div>

              {currentPattern && currentPattern.slots.length > 0 && (
                <div className="grid grid-cols-[6rem_1fr] items-center gap-3">
                  <label className={fieldLabelCls} style={fieldLabelStyle}>{t('sched_evt_slot')}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {currentPattern.slots.map(s => (
                      <button key={s.label} type="button" onClick={() => applySlot(s.label)}
                        className="px-2.5 py-1 text-[11px] rounded"
                        style={pillStyle(slotLabel === s.label, 'success')}>
                        {s.label} ({s.start_hour}-{s.end_hour})
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {currentPattern && currentPattern.roles.length > 0 ? (
                <div className="grid grid-cols-[6rem_1fr] items-center gap-3">
                  <label className={fieldLabelCls} style={fieldLabelStyle}>{t('sched_evt_role')}</label>
                  <div className="flex flex-wrap gap-1.5">
                    {currentPattern.roles.map(r => (
                      <button key={r} type="button" onClick={() => setShiftRole(r)}
                        className="px-2.5 py-1 text-[11px] rounded"
                        style={pillStyle(shiftRole === r, 'success')}>{r}</button>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="grid grid-cols-[6rem_1fr] items-center gap-3">
                  <label className={fieldLabelCls} style={fieldLabelStyle}>{t('sched_evt_role')}</label>
                  <input value={shiftRole} onChange={e => setShiftRole(e.target.value)}
                    placeholder={t('sched_evt_role_ph')}
                    className={fieldInputCls} style={inputBase} />
                </div>
              )}

              <div className="grid grid-cols-[6rem_1fr] items-center gap-3">
                <label className={fieldLabelCls} style={fieldLabelStyle}>{t('sched_evt_assignee')}</label>
                <select value={assignedId == null ? '' : String(assignedId)}
                  onChange={e => handleAssigneeChange(e.target.value)}
                  className={fieldInputCls} style={inputBase}>
                  <option value="">{t('sched_evt_assignee_none')}</option>
                  {users.map(u => (
                    <option key={u.id} value={String(u.id)}>
                      @{u.username}{u.display_name ? ` (${u.display_name})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          {eventType === 'experiment' && (
            <div className="grid grid-cols-[6rem_1fr] items-center gap-3">
              <label className={fieldLabelCls} style={fieldLabelStyle}>{t('sched_evt_data_type')}</label>
              <input value={dataType} onChange={e => setDataType(e.target.value)}
                placeholder={t('sched_evt_data_type_ph')}
                className={fieldInputCls} style={inputBase} />
            </div>
          )}

          <div className="grid grid-cols-[6rem_1fr] items-start gap-3">
            <label className={`${fieldLabelCls} mt-1.5`} style={fieldLabelStyle}>{t('sched_evt_desc')}</label>
            <textarea value={description} onChange={e => setDescription(e.target.value)}
              rows={3} placeholder={t('sched_evt_desc_ph')}
              className={`${fieldInputCls} resize-y`} style={inputBase} />
          </div>
        </div>

        <div className="px-6 py-4 border-t flex justify-end gap-3"
             style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-2)' }}>
          {!isNew && (
            <button onClick={handleDelete} disabled={saving}
              className="text-xs px-3 py-2 mr-auto hover:underline"
              style={{ color: 'var(--danger-text)' }}>{t('sched_evt_delete')}</button>
          )}
          <button onClick={onClose} className="text-xs px-4 py-2 hover:underline"
                  style={{ color: 'var(--text-secondary)' }}>{t('sched_evt_cancel')}</button>
          <button onClick={handleSave} disabled={saving}
            className="disabled:opacity-50 px-5 py-2 rounded-lg text-xs transition-colors"
            style={btnPrimary}
            {...hoverify(btnPrimary, btnPrimaryHover)}>
            {saving ? t('sched_evt_saving') : t('sched_evt_save')}
          </button>
        </div>
      </div>
    </div>
  )
}
