import { useState, useEffect } from 'react'
import { Icon } from 'lilak-ui'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { BUILTIN_FIELDS, CUSTOM_FIELD_TYPES, NUMBER_ENTRY_VARIANTS } from '../utils/formatUtils'
import {
  btnPrimary, btnPrimaryHover,
  modalFrame, modalOverlay,
  inputBase, hoverify,
} from '../theme/uiStyles'

const fieldInputCls = 'border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--input-focus-border)]'
const formInputCls  = 'flex-1 border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--input-focus-border)]'

// Mandatory builtins that are not "required" toggles: log# auto-increments,
// run follows the previous run number, title is the format name (auto title).
const normBuiltin = (id) => (id === 'run_number' ? 'run' : id)
const AUTO_BUILTINS = new Set(['log_index', 'run', 'title'])
// `tags` is a mandatory required field too, but it's a normal (non-auto) field.
const MANDATORY_BUILTINS = new Set([...AUTO_BUILTINS, 'tags'])
// The fields every new/cleared format starts with.
const DEFAULT_BUILTIN_IDS = ['log_index', 'run', 'title', 'tags']

// ── Field editor ──────────────────────────────────────────────────────────────

function FieldEditor({ fields, onChange, t, lang }) {
  function setField(idx, patch) {
    onChange(fields.map((f, i) => i === idx ? { ...f, ...patch } : f))
  }

  function moveUp(idx) {
    if (idx === 0) return
    const next = [...fields]
    ;[next[idx - 1], next[idx]] = [next[idx], next[idx - 1]]
    onChange(next.map((f, i) => ({ ...f, order: i })))
  }

  function moveDown(idx) {
    if (idx === fields.length - 1) return
    const next = [...fields]
    ;[next[idx], next[idx + 1]] = [next[idx + 1], next[idx]]
    onChange(next.map((f, i) => ({ ...f, order: i })))
  }

  function removeField(idx) {
    onChange(fields.filter((_, i) => i !== idx).map((f, i) => ({ ...f, order: i })))
  }

  return (
    <div className="space-y-1.5">
      {fields.map((field, idx) => (
        <div key={field.key}
          className="flex items-center gap-2 border rounded-lg px-3 py-2"
          style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--border-default)' }}>
          {/* Order controls */}
          <div className="flex flex-col gap-0.5 shrink-0">
            <button type="button" onClick={() => moveUp(idx)}
              disabled={idx === 0}
              className="disabled:opacity-30 text-xs leading-none transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.color = 'var(--text-primary)' }}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>▲</button>
            <button type="button" onClick={() => moveDown(idx)}
              disabled={idx === fields.length - 1}
              className="disabled:opacity-30 text-xs leading-none transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={e => { if (!e.currentTarget.disabled) e.currentTarget.style.color = 'var(--text-primary)' }}
              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>▼</button>
          </div>

          {field.field_type === 'builtin' ? (
            <div className="flex-1 flex items-center gap-3 min-w-0">
              <span className="text-xs font-mono px-1.5 py-0.5 rounded shrink-0"
                    style={{ backgroundColor: 'var(--info-bg)', color: 'var(--info-text)' }}>
                {field.builtin_id}
              </span>
              <span className="text-sm truncate" style={{ color: 'var(--text-primary)' }}>{field.label}</span>
              {/* log#/run/title auto-update or follow context — no "required" toggle */}
              {AUTO_BUILTINS.has(normBuiltin(field.builtin_id)) ? (
                normBuiltin(field.builtin_id) === 'title' ? (
                  <label className="ml-auto flex items-center gap-1 text-xs shrink-0 cursor-pointer"
                         style={{ color: field.auto_title ? 'var(--text-link)' : 'var(--text-secondary)' }}
                         title="제목을 직접 입력하지 않고 포맷 이름으로 자동 설정">
                    <input type="checkbox" checked={!!field.auto_title}
                      onChange={e => setField(idx, { auto_title: e.target.checked })} className="rounded" />
                    auto title
                  </label>
                ) : (
                  <span className="ml-auto text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>auto</span>
                )
              ) : normBuiltin(field.builtin_id) === 'tags' ? (
                <span className="ml-auto text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {t('admin_fmt_field_required')}
                </span>
              ) : (
                <label className="ml-auto flex items-center gap-1 text-xs shrink-0 cursor-pointer"
                       style={{ color: 'var(--text-secondary)' }}>
                  <input type="checkbox"
                    checked={field.required}
                    onChange={e => setField(idx, { required: e.target.checked })}
                    className="rounded"
                  />
                  {t('admin_fmt_field_required')}
                </label>
              )}
            </div>
          ) : (
            <div className="flex-1 grid grid-cols-3 gap-2 min-w-0">
              <input
                type="text"
                value={field.label}
                onChange={e => setField(idx, { label: e.target.value })}
                placeholder={t('admin_fmt_field_label')}
                className={fieldInputCls}
                style={inputBase}
              />
              <select
                value={field.field_type}
                onChange={e => {
                  const next = { field_type: e.target.value }
                  // Logs unify every number_entry to the `multiple` variant.
                  next.variant = e.target.value === 'number_entry' ? 'multiple' : null
                  setField(idx, next)
                }}
                className={fieldInputCls}
                style={inputBase}
              >
                {CUSTOM_FIELD_TYPES.map(ct => (
                  <option key={ct.id} value={ct.id}>
                    {lang === 'ko' ? ct.labelKo : ct.labelEn}
                  </option>
                ))}
              </select>
              {field.field_type !== 'number_entry' && (
                <input
                  type="text"
                  value={field.placeholder || ''}
                  onChange={e => setField(idx, { placeholder: e.target.value })}
                  placeholder={t('admin_fmt_field_placeholder')}
                  className={fieldInputCls}
                  style={inputBase}
                />
              )}
            </div>
          )}

          {field.field_type === 'number_entry' && (
            <label className="flex items-center gap-1 text-xs shrink-0"
                   title="Infography 그래프 변수로 사용"
                   style={{ color: field.metric ? 'var(--text-link)' : 'var(--text-muted)' }}>
              <input type="checkbox" checked={!!field.metric}
                     onChange={e => setField(idx, { metric: e.target.checked })} />
              metric
            </label>
          )}

          {!(field.field_type === 'builtin' && MANDATORY_BUILTINS.has(normBuiltin(field.builtin_id))) && (
            <button type="button" onClick={() => removeField(idx)}
              className="text-sm shrink-0 ml-1" style={{ color: 'var(--danger-text)' }}><Icon name="close" size={13} /></button>
          )}
        </div>
      ))}
    </div>
  )
}

// ── Format modal (create / edit) ──────────────────────────────────────────────

function FormatModal({ initial, onSave, onClose, t, lang }) {
  const isNew = !initial

  // Close on Esc
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function makeBuiltin(id, order) {
    const bf = BUILTIN_FIELDS.find(b => b.id === id) || { id, labelEn: id, labelKo: id }
    return {
      key: id,
      label: lang === 'ko' ? bf.labelKo : bf.labelEn,
      field_type: 'builtin',
      builtin_id: id,
      required: id === 'tags' ? true : false,
      auto_title: id === 'title' ? true : undefined,   // title defaults to format name
      order,
    }
  }

  // Every format starts with just log#, run#, title.
  function defaultFields() {
    return DEFAULT_BUILTIN_IDS.map((id, i) => makeBuiltin(id, i))
  }

  // Keep built-in fields above custom fields, preserving each group's order.
  function normalize(list) {
    const builtins = list.filter(f => f.field_type === 'builtin')
    const customs  = list.filter(f => f.field_type !== 'builtin')
    return [...builtins, ...customs].map((f, i) => ({ ...f, order: i }))
  }

  const [name, setName] = useState(initial?.name ?? '')
  const [isDefault, setIsDefault] = useState(initial?.is_default ?? false)
  const [notifyCommunity, setNotifyCommunity] = useState(initial?.notify_community ?? false)
  const [fields, setFields] = useState(() => {
    if (initial) return [...initial.fields].sort((a, b) => a.order - b.order)
    return defaultFields()
  })
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState(null)

  const activeBuiltinIds = new Set(
    fields.filter(f => f.field_type === 'builtin').map(f => f.builtin_id)
  )

  function toggleBuiltin(bf) {
    if (MANDATORY_BUILTINS.has(normBuiltin(bf.id))) return   // mandatory, can't toggle off
    if (activeBuiltinIds.has(bf.id)) {
      setFields(prev => normalize(prev.filter(f => !(f.field_type === 'builtin' && f.builtin_id === bf.id))))
    } else {
      setFields(prev => normalize([...prev, makeBuiltin(bf.id, prev.length)]))
    }
  }

  function addCustomField() {
    const key = `custom_${Date.now()}`
    setFields(prev => normalize([...prev, {
      key, label: '', field_type: 'text', placeholder: '',
      required: false, metric: false, order: prev.length,
    }]))
  }

  function clearFields() {
    setFields(defaultFields())
  }

  async function handleSave() {
    if (!name.trim()) { setErr('Name is required.'); return }
    const hasNonRun = fields.some(
      f => !(f.field_type === 'builtin' && ['run', 'run_number'].includes(f.builtin_id))
    )
    if (!hasNonRun) { setErr('At least one field besides run is required.'); return }

    setSaving(true); setErr(null)
    try {
      const payload = {
        name: name.trim(),
        fields: fields.map((f, i) => ({ ...f, order: i })),
        is_default: isDefault,
        notify_community: notifyCommunity,
      }
      if (isNew) {
        await api.post('/formats', payload)
      } else {
        await api.put(`/formats/${initial.id}`, payload)
      }
      onSave()
    } catch (e) {
      setErr(e.response?.data?.detail || 'Save failed.')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto"
      style={modalOverlay}
      onClick={onClose}>
      <div className="rounded-2xl shadow-2xl w-full max-w-2xl mt-8 mb-8 border"
        style={modalFrame}
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b"
             style={{ borderColor: 'var(--border-subtle)' }}>
          <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>
            {isNew ? t('admin_fmt_create') : t('admin_fmt_edit', initial.name)}
          </h2>
          <button onClick={onClose} className="text-xl transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>×</button>
        </div>

        <div className="p-6 space-y-5">
          {err && (
            <div className="border text-sm px-3 py-2 rounded-lg"
                 style={{ backgroundColor: 'var(--danger-bg)', borderColor: 'var(--danger-text)', color: 'var(--danger-text)' }}>{err}</div>
          )}

          {/* Name */}
          <div className="flex items-center gap-3">
            <label className="shrink-0 w-24 text-right text-sm font-medium"
                   style={{ color: 'var(--text-secondary)' }}>
              {t('admin_fmt_name_label')}
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="e.g. Beam Run"
              className={formInputCls}
              style={inputBase}
            />
          </div>

          <div className="flex items-center gap-5">
            <label className="flex items-center gap-2 text-sm cursor-pointer"
                   style={{ color: 'var(--text-primary)' }}>
              <input type="checkbox" checked={isDefault}
                onChange={e => setIsDefault(e.target.checked)}
                className="rounded" />
              {t('admin_fmt_is_default')}
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer"
                   style={{ color: 'var(--text-primary)' }}>
              <input type="checkbox" checked={notifyCommunity}
                onChange={e => setNotifyCommunity(e.target.checked)}
                className="rounded" />
              커뮤니티 알림
            </label>
            <button type="button" onClick={clearFields}
              className="ml-auto px-3 py-1 text-xs rounded-full border font-medium transition-colors"
              style={{ backgroundColor: '#f59e0b', borderColor: '#f59e0b', color: '#ffffff' }}>
              Clear Fields
            </button>
          </div>

          {/* Built-in field toggles + Add custom field below */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2"
               style={{ color: 'var(--text-secondary)' }}>
              {t('admin_fmt_builtin_fields')}
            </p>
            <div className="flex flex-wrap gap-2">
              {BUILTIN_FIELDS.map(bf => {
                const active = activeBuiltinIds.has(bf.id)
                const always = MANDATORY_BUILTINS.has(normBuiltin(bf.id))
                return (
                  <button key={bf.id} type="button"
                    onClick={() => toggleBuiltin(bf)}
                    disabled={always}
                    className={`px-3 py-1 text-xs rounded-full border font-medium transition-colors ${
                      always ? 'opacity-70 cursor-not-allowed' : ''
                    }`}
                    style={active
                      ? { backgroundColor: 'var(--btn-primary-bg)', borderColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }
                      : { backgroundColor: 'var(--surface)', borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }
                    }
                  >
                    {lang === 'ko' ? bf.labelKo : bf.labelEn}
                    {always && <Icon name="check" size={11} weight="bold" style={{ marginLeft: 2, verticalAlign: -1 }} />}
                  </button>
                )
              })}
              <button type="button" onClick={addCustomField}
                className="px-3 py-1 text-xs rounded-full border font-medium transition-colors"
                style={{ backgroundColor: '#111827', borderColor: '#111827', color: '#ffffff' }}>
                {t('admin_fmt_add_custom')}
              </button>
            </div>
          </div>

          {/* Current field order */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide mb-2"
               style={{ color: 'var(--text-secondary)' }}>
              {t('admin_fmt_fields')}{' '}
              <span className="font-normal normal-case" style={{ color: 'var(--text-muted)' }}>(drag order with ▲▼)</span>
            </p>
            <FieldEditor fields={fields} onChange={setFields} t={t} lang={lang} />
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t flex justify-end gap-3"
             style={{ borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-2)' }}>
          <button onClick={onClose}
            className="text-xs px-3 py-1.5 hover:underline" style={{ color: 'var(--text-secondary)' }}>{t('admin_cancel')}</button>
          <button onClick={handleSave} disabled={saving}
            className="disabled:opacity-50 px-4 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={btnPrimary}
            {...hoverify(btnPrimary, btnPrimaryHover)}>
            {saving ? t('admin_fmt_save') + '…' : t('admin_fmt_save')}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Format row ────────────────────────────────────────────────────────────────

function FormatRow({ fmt, onEdit, onDelete, t }) {
  return (
    <div
      className="border rounded-lg px-4 py-2.5 flex items-center gap-3"
      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-default)' }}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{fmt.name}</span>
          {fmt.is_default && (
            <span className="text-xs px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning-text)' }}>
              {t('admin_fmt_default_badge')}
            </span>
          )}
          {fmt.notify_community && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-teal-100 text-teal-700">커뮤니티 알림</span>
          )}
          {[...fmt.fields].sort((a, b) => a.order - b.order).map(f => (
            <span key={f.key}
              className="text-xs px-1.5 py-0.5 rounded-full"
              style={f.field_type === 'builtin'
                ? { backgroundColor: 'var(--info-bg)', color: 'var(--info-text)' }
                : { backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)' }
              }>
              {f.label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {['system', 'service', 'module'].includes(fmt.owner_kind) ? (
          <span className="text-xs px-2.5 py-1 rounded border"
                style={{ color: 'var(--text-muted)', borderColor: 'var(--border-subtle)' }}
                title="시스템/서비스/모듈이 관리하는 포맷은 편집할 수 없습니다">
            🔒 {fmt.owner_kind}
          </span>
        ) : (
          <>
            <button onClick={() => onEdit(fmt)}
              className="text-xs border px-2.5 py-1 rounded transition-colors"
              style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }}>
              {t('admin_edit')}
            </button>
            {!fmt.is_default && (
              <button onClick={() => onDelete(fmt)}
                className="text-xs border px-2.5 py-1 rounded transition-colors"
                style={{ color: 'var(--danger-text)', borderColor: 'var(--border-default)' }}>
                {t('admin_fmt_delete')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ── Collapsible group ─────────────────────────────────────────────────────────

function FormatGroup({ label, sublabel, formats, defaultOpen = true, onEdit, onDelete, t }) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-xl border overflow-hidden"
         style={{ borderColor: 'var(--border-default)' }}>
      {/* Group header */}
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-4 py-2 text-left transition-colors"
        style={{ backgroundColor: 'var(--surface-2)' }}
        onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--surface-3)'}
        onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--surface-2)'}
      >
        <span className="text-xs inline-flex" style={{ color: 'var(--text-muted)' }}><Icon name={open ? 'caret-down' : 'caret-right'} size={12} /></span>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{label}</span>
        {sublabel && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{sublabel}</span>
        )}
        <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>{formats.length}</span>
      </button>

      {/* Group rows */}
      {open && (
        <div className="p-2 space-y-1.5"
             style={{ backgroundColor: 'var(--surface)' }}>
          {formats.map(fmt => (
            <FormatRow key={fmt.id} fmt={fmt} onEdit={onEdit} onDelete={onDelete} t={t} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminFormats() {
  const { user } = useAuth()
  const { t, lang } = useLang()
  const [formats, setFormats] = useState([])
  const [loading, setLoading] = useState(true)
  const [modal, setModal] = useState(null)

  function load() {
    setLoading(true)
    api.get('/formats').then(r => setFormats(r.data)).finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [])

  async function handleDelete(fmt) {
    if (!window.confirm(t('admin_fmt_delete_confirm', fmt.name))) return
    await api.delete(`/formats/${fmt.id}`)
    load()
  }

  function closeModal() { setModal(null); load() }

  if (!user || user.role !== 'manager') {
    return <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>Access denied.</div>
  }

  // ── Group formats ──────────────────────────────────────────────────────────
  // Groups: "Default" (is_default), "General" (no system, not default, not module),
  //         per system_name, "Module" (created_by starts with <module:)
  const groups = []

  const isModuleFmt = f => f.owner_kind === 'module' || f.created_by?.startsWith('<module:')

  const defaultFmts  = formats.filter(f => f.is_default)
  const moduleFmts   = formats.filter(f => !f.is_default && isModuleFmt(f))
  const systemGroups  = {}   // system services, grouped by name
  const serviceGroups = {}   // service services, grouped by name
  const generalFmts   = []

  for (const f of formats) {
    if (f.is_default) continue
    if (isModuleFmt(f)) continue
    if (f.system_name) {
      const bucket = f.owner_kind === 'service' ? serviceGroups : systemGroups
      if (!bucket[f.system_name]) bucket[f.system_name] = []
      bucket[f.system_name].push(f)
    } else {
      generalFmts.push(f)
    }
  }

  if (defaultFmts.length)  groups.push({ key: 'default', label: 'Default',  sublabel: null,       fmts: defaultFmts })
  if (generalFmts.length)  groups.push({ key: 'general', label: 'General',  sublabel: null,       fmts: generalFmts })
  for (const [name, fmts] of Object.entries(systemGroups)) {
    groups.push({ key: `sys:${name}`, label: name, sublabel: 'system', fmts })
  }
  for (const [name, fmts] of Object.entries(serviceGroups)) {
    groups.push({ key: `svc:${name}`, label: name, sublabel: 'service', fmts })
  }
  if (moduleFmts.length)   groups.push({ key: 'module',  label: 'Module',   sublabel: 'auto',     fmts: moduleFmts  })

  return (
    <div className="max-w-3xl mx-auto pb-20">
      <div className="flex items-center justify-end mb-3">
        <button
          onClick={() => setModal('new')}
          className="px-3 h-8 rounded-lg text-xs transition-colors"
          style={btnPrimary}
          {...hoverify(btnPrimary, btnPrimaryHover)}
        >
          {t('admin_fmt_new')}
        </button>
      </div>

      {loading ? (
        <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>{t('admin_fmt_loading')}</div>
      ) : formats.length === 0 ? (
        <div className="text-center py-12 rounded-xl border"
             style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-default)', color: 'var(--text-muted)' }}>
          <p className="text-xs">{t('admin_fmt_empty')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map(g => (
            <FormatGroup
              key={g.key}
              label={g.label}
              sublabel={g.sublabel}
              formats={g.fmts}
              defaultOpen={true}
              onEdit={fmt => setModal({ format: fmt })}
              onDelete={handleDelete}
              t={t}
            />
          ))}
        </div>
      )}

      {modal === 'new' && (
        <FormatModal
          initial={null}
          onSave={closeModal}
          onClose={() => setModal(null)}
          t={t}
          lang={lang}
        />
      )}
      {modal?.format && (
        <FormatModal
          initial={modal.format}
          onSave={closeModal}
          onClose={() => setModal(null)}
          t={t}
          lang={lang}
        />
      )}
    </div>
  )
}
