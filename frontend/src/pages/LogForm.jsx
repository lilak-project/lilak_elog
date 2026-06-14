import { useState, useEffect, useRef } from 'react'
import { Icon, Button, CameraCapture } from 'lilak-ui'
import { useParams, useNavigate, Link, useSearchParams } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { getFields, formatLogTitle } from '../utils/formatUtils'
import NumberEntryField from '../components/fields/NumberEntryField'
import RunTypePicker from '../components/fields/RunTypePicker'

const SEVERITIES = ['info', 'warning', 'error', 'critical']
const LS_LAST_TITLE = 'elog_last_title'
const RUN_TYPES = ['single', 'range', 'multiple']    // run_number variants (legacy name)

// Coerce any stored number_entry shape into the canonical `multiple` raw
// ({values:[…]}). Logs unify every number_entry to the multiple variant, so a
// previously single/range value (or a service-pushed {value,error}) is turned
// into a one-element value list to keep editing consistent.
function toMultipleRaw(stored) {
  if (!stored || typeof stored !== 'object') return { values: [''] }
  const raw = (stored.raw && typeof stored.raw === 'object') ? stored.raw : stored
  if (Array.isArray(raw.values)) return { values: raw.values.length ? raw.values : [''] }
  const vals = []
  if (raw.single !== undefined && raw.single !== '' && raw.single !== null) vals.push(raw.single)
  else if (raw.min !== undefined || raw.max !== undefined) {
    if (raw.min !== undefined && raw.min !== null && raw.min !== '') vals.push(raw.min)
    if (raw.max !== undefined && raw.max !== null && raw.max !== '') vals.push(raw.max)
  } else if (raw.value !== undefined && raw.value !== null) vals.push(raw.value)
  else if (stored.value !== undefined && stored.value !== null) vals.push(stored.value)
  return { values: vals.length ? vals : [''] }
}

// ── Validation helpers ────────────────────────────────────────────────────────

function validateRange(text) {
  if (!text.trim()) return true
  const parts = text.split(',').map(s => s.trim()).filter(Boolean)
  return parts.every(p => {
    if (!/^\d+-\d+$/.test(p)) return false
    const [lo, hi] = p.split('-').map(Number)
    return lo <= hi
  })
}

function validateMultiple(text) {
  if (!text.trim()) return true
  return text.split(',').map(s => s.trim()).filter(Boolean).every(p => /^\d+$/.test(p))
}

// ── Format Picker ─────────────────────────────────────────────────────────────

function groupFormats(formats, stdItem) {
  const defaultFmts  = formats.filter(f => f.is_default)
  const moduleFmts   = formats.filter(f => !f.is_default && f.created_by?.startsWith('<module:'))
  const systemGroups = {}
  const generalFmts  = []

  for (const f of formats) {
    if (f.is_default || f.created_by?.startsWith('<module:')) continue
    if (f.system_name) {
      if (!systemGroups[f.system_name]) systemGroups[f.system_name] = []
      systemGroups[f.system_name].push(f)
    } else {
      generalFmts.push(f)
    }
  }

  const groups = []
  groups.push({ key: 'standard', label: null, fmts: [stdItem] })
  if (defaultFmts.length)  groups.push({ key: 'default', label: 'Default',  fmts: defaultFmts })
  if (generalFmts.length)  groups.push({ key: 'general', label: 'General',  fmts: generalFmts })
  for (const [name, fmts] of Object.entries(systemGroups)) {
    groups.push({ key: `sys:${name}`, label: name, sublabel: 'system', fmts })
  }
  if (moduleFmts.length)   groups.push({ key: 'module',  label: 'Module',   fmts: moduleFmts })
  return groups
}

export function FormatPicker({ formats, onPick, onClose, t }) {
  const stdItem = { id: '__std__', name: t('form_format_standard'), fields: [], is_default: false, _isStandard: true }
  const groups = groupFormats(formats, stdItem)
  // Flat list for keyboard navigation
  const flatItems = groups.flatMap(g => g.fmts)
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [collapsed, setCollapsed] = useState({})  // group key → bool

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); onClose?.(); return }
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      if (inInput) return
      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault(); setFocusedIdx(i => Math.min(flatItems.length - 1, i + 1))
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault(); setFocusedIdx(i => Math.max(0, i - 1))
      } else if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        const it = flatItems[focusedIdx]
        if (it) onPick(it._isStandard ? null : it)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flatItems, focusedIdx, onPick, onClose])

  let globalIdx = 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
         style={{ backgroundColor: 'rgba(0,0,0,0.4)' }}
         onClick={onClose}>
      <div className="w-full max-w-lg rounded-xl border shadow-xl p-5 max-h-[85vh] overflow-y-auto"
           style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-default)' }}
           onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {t('form_format_pick')}
            <span className="ml-2 text-xs font-normal" style={{ color: 'var(--text-muted)' }}>↑↓ / jk · Enter</span>
          </p>
          <button type="button" onClick={onClose} className="text-sm" style={{ color: 'var(--text-muted)' }}><Icon name="close" size={13} /></button>
        </div>
        <div className="space-y-2">
        {groups.map(group => {
          const isOpen = !collapsed[group.key]
          return (
            <div key={group.key} className="rounded-xl border overflow-hidden"
                 style={{ borderColor: 'var(--border-default)' }}>
              {/* Group header — only show if there's a label */}
              {group.label && (
                <button
                  type="button"
                  onClick={() => setCollapsed(c => ({ ...c, [group.key]: !c[group.key] }))}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-left"
                  style={{ backgroundColor: 'var(--surface-2)' }}
                >
                  <span className="text-xs inline-flex" style={{ color: 'var(--text-muted)' }}><Icon name={isOpen ? 'caret-down' : 'caret-right'} size={12} /></span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>{group.label}</span>
                  {group.sublabel && (
                    <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>{group.sublabel}</span>
                  )}
                  <span className="ml-auto text-[10px]" style={{ color: 'var(--text-muted)' }}>{group.fmts.length}</span>
                </button>
              )}

              {/* Items */}
              {isOpen && (
                <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
                  {group.fmts.map(fmt => {
                    const idx = globalIdx++
                    const isFocused = idx === focusedIdx
                    return (
                      <button
                        key={fmt.id}
                        type="button"
                        onClick={() => onPick(fmt._isStandard ? null : fmt)}
                        onMouseEnter={() => setFocusedIdx(idx)}
                        className="w-full px-4 py-2.5 text-left transition-colors"
                        style={{
                          backgroundColor: isFocused ? 'var(--info-bg)' : 'var(--surface)',
                          borderLeft: isFocused ? '2px solid var(--border-focus)' : '2px solid transparent',
                        }}
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium"
                                style={{ color: isFocused ? 'var(--text-link)' : 'var(--text-primary)' }}>
                            {fmt.name}
                          </span>
                          {fmt.is_default && (
                            <span className="text-xs px-1.5 py-0.5 rounded"
                                  style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning-text)' }}>
                              {t('form_format_default_badge')}
                            </span>
                          )}
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                          {fmt._isStandard
                            ? 'title · run · level · tags · body · attachments'
                            : fmt.fields.slice().sort((a, b) => a.order - b.order).map(f => f.label).join(' · ')}
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function LogForm({
  embeddedEditId = null,   // set when rendered as an in-page tab (edit mode)
  embeddedFromId = null,   // set when rendered as an in-page tab (continue mode)
  onSaved = null,          // callback(logId) — replaces navigate after save
  onCancel = null,         // callback() — replaces navigate on cancel
} = {}) {
  const params = useParams()
  const id = embeddedEditId ?? params.id
  const isEdit = Boolean(id)
  const [searchParams] = useSearchParams()
  const fromId = embeddedFromId ?? searchParams.get('from')
  const navigate = useNavigate()
  const { user, loading: authLoading } = useAuth()
  const { t, lang } = useLang()
  const fileInputRef = useRef(null)
  const cameraInputRef = useRef(null)
  const tagInputRef = useRef(null)
  // Desktop can't reach the webcam via <input capture> — open a getUserMedia
  // modal instead; mobile keeps the native camera input.
  const [cameraOpen, setCameraOpen] = useState(false)
  const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
  const addCapturedFile = (file) => setFileItems(prev => [...prev, { file, name: file.name }])

  // ── Format state ─────────────────────────────────────────────────────────
  const [formats, setFormats] = useState([])
  const [selectedFormat, setSelectedFormat] = useState(undefined) // undefined = not yet chosen
  const [showPicker, setShowPicker] = useState(false)

  // ── Core form state ──────────────────────────────────────────────────────
  const [form, setForm] = useState({ title: '', body: '', level: 'info', beam: '', target: '' })
  const [customValues, setCustomValues] = useState({}) // custom field key → value

  // ── Run number ───────────────────────────────────────────────────────────
  const [runType, setRunType] = useState('single')
  const [runSingle, setRunSingle] = useState('')
  const [runText, setRunText] = useState('')
  const [runError, setRunError] = useState('')
  const [lastRunNumber, setLastRunNumber] = useState(null)
  const [lastRunLoaded, setLastRunLoaded] = useState(false)

  // ── Run type letter (Phase 4) ────────────────────────────────────────────
  // S/R/E/A/M/IDLE. Auto-derived from the previous log on this run, but the
  // user can override unless the active format locks it (run_type_lock).
  const [runTypeLetter, setRunTypeLetter] = useState(null)   // user's chosen letter
  const [autoRunTypeLetter, setAutoRunTypeLetter] = useState(null)  // server-suggested
  const [runTypeUserEdited, setRunTypeUserEdited] = useState(false)

  // ── Tags ─────────────────────────────────────────────────────────────────
  const [tagList, setTagList] = useState([])
  const [tagInput, setTagInput] = useState('')
  const [allTags, setAllTags] = useState([])
  const [showSuggestions, setShowSuggestions] = useState(false)

  // ── Files / attachments ──────────────────────────────────────────────────
  const [fileItems, setFileItems] = useState([])
  const [dragOver, setDragOver] = useState(false)

  // ── UI ───────────────────────────────────────────────────────────────────
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [existingAttachments, setExistingAttachments] = useState([])
  const [fromEntry, setFromEntry] = useState(null)
  const [fromAttachments, setFromAttachments] = useState([])
  const [lastTitle, setLastTitle] = useState('')

  // ── Auth guard — wait for auth to finish loading before redirecting ───────
  useEffect(() => {
    if (!authLoading && !user) {
      if (onCancel) onCancel()
      else navigate('/login', { replace: true })
    }
  }, [authLoading, user])

  // ── Load formats, categories, tags, last run number ──────────────────────
  useEffect(() => {
    api.get('/formats').then(r => {
      setFormats(r.data)
      // Show picker only for new logs (not edit, not continue)
      if (!isEdit && !fromId) {
        if (r.data.length > 0) {
          // Default selection sits behind the picker modal so the form is
          // usable immediately; the picker pops up for an explicit choice.
          const def = r.data.find(f => f.is_default)
          setSelectedFormat(def ?? null)
          setShowPicker(true)
        } else {
          setSelectedFormat(null)  // null = Standard (no format)
          setShowPicker(false)
        }
      } else {
        setSelectedFormat(null)
      }
    }).catch(() => {
      setSelectedFormat(null)
      setShowPicker(false)
    })

    api.get('/tags').then(r => setAllTags(r.data.map(tg => tg.name))).catch(() => {})
    api.get('/logs/last-run-number').then(r => {
      setLastRunNumber(r.data.last_run_number)
      setLastRunLoaded(true)
    }).catch(() => setLastRunLoaded(true))

    if (!isEdit && !fromId) {
      setLastTitle(localStorage.getItem(LS_LAST_TITLE) || '')
    }
  }, [])

  // ── "이어 쓰기" ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!fromId || isEdit) return
    api.get(`/logs/${fromId}`).then(r => {
      const e = r.data
      setFromEntry(e)
      setFromAttachments(e.attachments || [])
      const date = new Date(e.created_at).toLocaleString()
      const header = `> [#${e.id}] **${e.title}** (${e.author_name}, ${date}) 에서 이어 씀\n\n`
      setForm({
        title: e.title || '',
        body: `${header}${e.body ? e.body + '\n\n' : ''}---\n\n`,
        level: e.level || 'info',
        beam: e.beam || '', target: e.target || '',
      })
      const rt = e.run_number_type || 'single'
      setRunType(rt)
      if (rt === 'single') setRunSingle(e.run_number != null ? String(e.run_number) : '')
      else setRunText(e.run_number_text || '')
      setTagList(e.tags.map(tg => tg.name))
    }).catch(() => {})
  }, [fromId, isEdit])

  // ── Document title (must be before any conditional returns) ─────────────
  const pageTitle = isEdit ? t('form_edit') : fromEntry ? t('form_continue') : t('form_new')
  useEffect(() => {
    document.title = `${pageTitle} — lilak elog`
    return () => { document.title = 'lilak elog' }
  }, [pageTitle])

  // ── Edit mode ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isEdit) return
    api.get(`/logs/${id}`).then(async r => {
      const e = r.data
      setForm({
        title: e.title || '',
        body: e.body || '',
        level: e.level || 'info',
        beam: e.beam || '', target: e.target || '',
      })
      const rt = e.run_number_type || 'single'
      setRunType(rt)
      if (rt === 'single') setRunSingle(e.run_number != null ? String(e.run_number) : '')
      else setRunText(e.run_number_text || '')
      if (e.run_type) {
        setRunTypeLetter(e.run_type)
        setRunTypeUserEdited(true)   // editing an existing log → respect stored choice
      }
      setTagList(e.tags.map(tg => tg.name))
      setExistingAttachments(e.attachments || [])
      // Restore custom fields if the entry had a format
      if (e.format_fields_json) {
        try { setCustomValues(JSON.parse(e.format_fields_json)) } catch {}
      }
      // Restore the format so custom fields render correctly
      if (e.format_id) {
        try {
          const fmtRes = await api.get('/formats')
          const fmt = fmtRes.data.find(f => f.id === e.format_id)
          if (fmt) setSelectedFormat(fmt)
        } catch {}
      }
    }).catch(() => setError(t('form_load_fail')))
  }, [id, isEdit])

  // ── Derived: active fields from selected format ──────────────────────────
  const activeFields = getFields(selectedFormat)

  function fieldVisible(builtinId) {
    return selectedFormat === null || activeFields.some(
      f => f.field_type === 'builtin' && f.builtin_id === builtinId
    )
  }

  const customFields = activeFields.filter(f => f.field_type !== 'builtin')

  // Auto-title: when the format's title field has auto_title, the title is the
  // format name (no manual entry, input hidden).
  const titleField = activeFields.find(f => f.field_type === 'builtin' && f.builtin_id === 'title')
  const autoTitle = !!titleField?.auto_title
  const autoTitleValue = selectedFormat?.name || ''

  // ── Phase 4: Run type auto-flow ──────────────────────────────────────────
  const runTypeLock = selectedFormat?.run_type_lock || null   // 'S' | 'E' | 'M' | …
  // Precedence: format lock > user choice > server suggestion. Null when none
  // is known — the server then computes the run_type on save. The UI shows
  // 'IDLE' for that unknown state.
  const chosenRunType = runTypeLock || runTypeLetter || autoRunTypeLetter || null
  const effectiveRunType = chosenRunType || 'IDLE'

  /* When the user types a run number, ask the server what run_type a new log
     on that run should default to.  Skips the call when the format already
     locks the type or when the user has manually chosen one. */
  useEffect(() => {
    if (runTypeLock) return
    if (runTypeUserEdited) return
    const parsed = parseInt(runSingle, 10)
    if (runType !== 'single' || !isFinite(parsed)) {
      setAutoRunTypeLetter(null)
      return
    }
    const ctrl = new AbortController()
    api.get(`/logs/next-run-type?run_number=${parsed}`, { signal: ctrl.signal })
       .then(r => setAutoRunTypeLetter(r.data?.run_type || null))
       .catch(() => {})
    return () => ctrl.abort()
  }, [runSingle, runType, runTypeLock, runTypeUserEdited])

  /* If the selected format has a run_type_lock, clear the user override so
     the lock visibly takes over. Reset on format change too. */
  useEffect(() => {
    setRunTypeUserEdited(false)
    if (runTypeLock) {
      setRunTypeLetter(null)
      setAutoRunTypeLetter(null)
    }
  }, [selectedFormat?.id, runTypeLock])

  // ── Tag helpers ──────────────────────────────────────────────────────────
  const tagSuggestions = allTags
    .filter(name =>
      tagInput.trim() &&
      name.toLowerCase().includes(tagInput.toLowerCase()) &&
      !tagList.includes(name)
    ).slice(0, 8)

  function addTag(name) {
    const clean = name.trim().toLowerCase()
    if (clean && !tagList.includes(clean)) setTagList(prev => [...prev, clean])
    setTagInput('')
    setShowSuggestions(false)
    tagInputRef.current?.focus()
  }

  function removeTag(name) { setTagList(prev => prev.filter(n => n !== name)) }

  function handleTagKeyDown(e) {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault()
      if (tagInput.trim()) addTag(tagInput)
    } else if (e.key === 'Backspace' && !tagInput && tagList.length > 0) {
      setTagList(prev => prev.slice(0, -1))
    } else if (e.key === 'Escape') {
      setShowSuggestions(false)
    }
  }

  // ── Run number validation ────────────────────────────────────────────────
  function checkRun() {
    // Run number is required (unless the log is IDLE or the format omits run).
    const runProvided = runType === 'single' ? runSingle.trim() : runText.trim()
    const isIdle = chosenRunType === 'IDLE'
    if (fieldVisible('run') && !isIdle && !runProvided) {
      setRunError(t('form_run_required')); return false
    }
    if (runType === 'range' && runText.trim() && !validateRange(runText)) {
      setRunError(t('form_run_range_error')); return false
    }
    if (runType === 'multiple' && runText.trim() && !validateMultiple(runText)) {
      setRunError(t('form_run_multiple_error')); return false
    }
    setRunError(''); return true
  }

  // ── Drag-and-drop ────────────────────────────────────────────────────────
  function handleDragOver(e) { e.preventDefault(); setDragOver(true) }
  function handleDragLeave() { setDragOver(false) }
  function handleDrop(e) {
    e.preventDefault(); setDragOver(false)
    const dropped = Array.from(e.dataTransfer.files)
    if (dropped.length > 0)
      setFileItems(prev => [...prev, ...dropped.map(f => ({ file: f, name: f.name }))])
  }

  // ── Submit ───────────────────────────────────────────────────────────────
  async function handleSubmit(e) {
    e.preventDefault()
    if (!checkRun()) return
    setSaving(true); setError(null)

    let run_number = null, run_number_text = null
    if (runType === 'single') {
      if (runSingle.trim()) {
        const parsed = parseInt(runSingle, 10)
        if (!isNaN(parsed)) { run_number = parsed; run_number_text = runSingle.trim() }
      } else if (!isEdit && lastRunNumber != null) {
        // Leaving the run number blank on a new log auto-fills the last run number.
        run_number = lastRunNumber
        run_number_text = String(lastRunNumber)
      }
    } else {
      run_number_text = runText.trim() || null
    }

    const payload = {
      title: autoTitle ? (autoTitleValue || null) : (form.title.trim() || null),
      body: form.body,
      run_number,
      run_number_type: runType,
      run_number_text,
      run_type: chosenRunType,
      level: form.level,
      beam: fieldVisible('beam') ? (form.beam.trim() || null) : null,
      target: fieldVisible('target') ? (form.target.trim() || null) : null,
      tags: tagList,
      format_id: selectedFormat?.id ?? null,
      format_fields: Object.keys(customValues).length > 0 ? customValues : null,
    }

    try {
      let entryId
      if (isEdit) {
        const res = await api.put(`/logs/${id}`, payload)
        entryId = res.data.id
      } else {
        const res = await api.post('/logs', payload)
        entryId = res.data.id
        if (payload.title) localStorage.setItem(LS_LAST_TITLE, payload.title)
      }

      // Attachments
      const fd = new FormData()
      for (const att of fromAttachments) {
        try {
          const resp = await fetch(`/api/attachments/${att.id}`)
          const blob = await resp.blob()
          fd.append('files', blob, att.original_filename)
        } catch {}
      }
      fileItems.forEach(({ file, name }) => fd.append('files', file, name || file.name))
      if ([...fd.entries()].length > 0) {
        await api.post(`/logs/${entryId}/attachments`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        })
      }

      if (onSaved) onSaved(entryId)
      else navigate(`/logs/${entryId}`)
    } catch (err) {
      setError(err.response?.data?.detail || t('form_save_fail'))
      setSaving(false)
    }
  }

  if (authLoading) return null   // wait for localStorage restore before rendering
  if (!user) return null

  // Wait until format is resolved
  if (selectedFormat === undefined) {
    return <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>{t('home_loading')}</div>
  }

  // Shared input style — matches --input-* tokens (theme/tokens.js).
  const inputStyle = {
    backgroundColor: 'var(--input-bg)',
    borderColor:     'var(--input-border)',
    color:           'var(--text-primary)',
  }
  const inputCls = 'w-full border rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--input-focus-border)]'
  const labelCls = 'shrink-0 w-20 text-right text-sm font-medium'
  const labelStyle = { color: 'var(--text-secondary)' }

  const cancelTo  = isEdit ? `/logs/${id}` : fromEntry ? `/logs/${fromId}` : '/'
  const handleCancel = () => { if (onCancel) onCancel(); else navigate(cancelTo) }
  const saveLabel = saving ? t('form_saving') : isEdit ? t('form_save_edit') : fromEntry ? t('form_save_new') : t('form_save')

  const runPlaceholder = runType === 'range'
    ? t('form_run_range_placeholder')
    : runType === 'multiple'
      ? t('form_run_multiple_placeholder')
      : t('form_run_placeholder')

  const runHint = runType === 'range'
    ? t('form_run_range_hint')
    : runType === 'multiple' ? t('form_run_multiple_hint') : null

  return (
    <div className={onSaved || onCancel ? 'w-full' : 'max-w-2xl mx-auto'}>
      {/* Format picker popup */}
      {showPicker && (
        <FormatPicker
          formats={formats}
          t={t}
          onPick={fmt => { setSelectedFormat(fmt); setShowPicker(false) }}
          onClose={() => setShowPicker(false)}
        />
      )}

      {/* Desktop webcam capture (#8) */}
      <CameraCapture open={cameraOpen} onClose={() => setCameraOpen(false)}
        onCapture={addCapturedFile} title={t('form_camera') || '카메라 / 사진'} />

      {/* Header — format badge (new log only); Cancel/Save live in the form actions */}
      {!isEdit && !fromId && formats.length > 0 && (
        <div className="flex items-center gap-3 mb-3">
          <button
            type="button"
            onClick={() => setShowPicker(true)}
            className="text-xs border px-2 py-1 rounded transition-colors inline-flex items-center gap-1"
            style={{ backgroundColor: 'var(--info-bg)', color: 'var(--info-text)', borderColor: 'var(--border-focus)' }}
          >
            {selectedFormat ? selectedFormat.name : t('form_format_standard')}
            <Icon name="edit" size={12} />
          </button>
        </div>
      )}

      {fromEntry && (
        <div className="mb-4 border text-sm px-4 py-3 rounded-lg"
             style={{ backgroundColor: 'var(--success-bg)', borderColor: 'var(--success-text)', color: 'var(--success-text)' }}>
          {t('form_continue_banner', fromEntry.id, fromEntry.title)}
        </div>
      )}
      {error && (
        <div className="mb-4 border text-sm px-4 py-3 rounded-lg"
             style={{ backgroundColor: 'var(--danger-bg)', borderColor: 'var(--danger-text)', color: 'var(--danger-text)' }}>{error}</div>
      )}

      <form onSubmit={handleSubmit} className="rounded-xl border shadow-sm"
            style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-default)' }}>
        {/* Top actions — same Cancel / Save as the footer (#4) */}
        <div className="px-4 py-2.5 border-b flex items-center justify-end gap-2"
             style={{ borderColor: 'var(--border-subtle)' }}>
          <Button variant="secondary" type="button" onClick={handleCancel}>{t('form_cancel')}</Button>
          <Button variant="primary" type="submit" disabled={saving}>{saveLabel}</Button>
        </div>
        <div className="p-4 space-y-3">

          {/* ── Title ─────────────────────────────────────────────────── */}
          {fieldVisible('title') && autoTitle && (
            <div className="flex items-center gap-3">
              <label className={labelCls} style={labelStyle}>{t('form_title')}</label>
              <div className="flex-1 text-sm px-1" style={{ color: 'var(--text-secondary)' }}>
                <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{autoTitleValue}</span>
                <span className="ml-2 text-xs" style={{ color: 'var(--text-muted)' }}>(auto title — 포맷 이름)</span>
              </div>
            </div>
          )}
          {fieldVisible('title') && !autoTitle && (
            <div className="flex items-center gap-3">
              <label className={labelCls} style={labelStyle}>
                {t('form_title')}
              </label>
              <div className="flex-1 flex items-center gap-2">
                <input
                  name="title"
                  value={form.title}
                  onChange={e => setForm(prev => ({ ...prev, title: e.target.value }))}
                  placeholder={t('form_title_placeholder')}
                  className={`flex-1 ${inputCls}`}
                  style={inputStyle}
                />
                {lastTitle && !isEdit && !fromId && (
                  <button
                    type="button"
                    title={lastTitle}
                    onClick={() => { setForm(prev => ({ ...prev, title: lastTitle })); setLastTitle('') }}
                    className="shrink-0 text-xs border rounded px-2 py-1.5 whitespace-nowrap transition-colors"
                    style={{ color: 'var(--text-muted)', borderColor: 'var(--border-default)' }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-link)'; e.currentTarget.style.borderColor = 'var(--border-focus)' }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.borderColor = 'var(--border-default)' }}
                  >
                    ↩ {lastTitle.length > 18 ? lastTitle.slice(0, 18) + '…' : lastTitle}
                  </button>
                )}
              </div>
              {/* Phase 5: live preview of the composed title that will land on
                  the log card.  Shows the run prefix + (N) + the user input. */}
              {(() => {
                const composed = formatLogTitle({
                  title: form.title,
                  run_number: runType === 'single' && runSingle ? Number(runSingle) : null,
                  run_number_text: runType !== 'single' ? runText : null,
                  run_number_type: runType,
                  run_type: chosenRunType,
                  // run_log_index isn't known until the server assigns it on insert.
                })
                if (!composed || composed === form.title) return null
                return (
                  <div className="text-[11px] font-mono ml-[88px]"
                       style={{ color: 'var(--text-muted)' }}>
                    → {composed}{!form.title && (
                      <span className="ml-2 italic" style={{ color: 'var(--text-muted)' }}>
                        ({lang === 'ko' ? '제목 없이' : 'no user title'})
                      </span>
                    )}
                  </div>
                )
              })()}
            </div>
          )}

          {/* ── Run number ────────────────────────────────────────────── */}
          <div>
            <div className="flex items-start gap-3">
              <label className={`${labelCls} pt-2`} style={labelStyle}>
                {t('form_run')}
              </label>
              <div className="flex-1 space-y-2">
                {/* Type selector */}
                <div className="flex gap-1">
                  {RUN_TYPES.map(rt => (
                    <button key={rt} type="button"
                      onClick={() => { setRunType(rt); setRunError('') }}
                      className="px-3 py-1 text-xs font-medium rounded border transition-colors"
                      style={runType === rt
                        ? { backgroundColor: 'var(--btn-primary-bg)', borderColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }
                        : { backgroundColor: 'var(--surface)',        borderColor: 'var(--input-border)',   color: 'var(--text-secondary)'  }
                      }
                    >
                      {t(`form_run_${rt}`)}
                    </button>
                  ))}
                </div>

                {/* Value input */}
                {runType === 'single' ? (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={runSingle}
                        onChange={e => setRunSingle(e.target.value.replace(/[^0-9]/g, ''))}
                        placeholder={t('form_run_placeholder')}
                        className={`w-28 ${inputCls}`}
                        style={{ ...inputStyle, MozAppearance: 'textfield' }}
                      />
                      {/* Last run number helpers */}
                      {lastRunLoaded && (
                        lastRunNumber != null ? (
                          <div className="flex items-center gap-1.5">
                            <button type="button"
                              onClick={() => setRunSingle(String(lastRunNumber))}
                              className="text-xs border rounded px-2 py-1.5 transition-colors whitespace-nowrap"
                              style={{ color: 'var(--text-secondary)', borderColor: 'var(--border-default)' }}
                            >
                              {t('form_run_last', lastRunNumber)}
                            </button>
                            <button type="button"
                              onClick={() => setRunSingle(String(lastRunNumber + 1))}
                              className="text-xs rounded px-2 py-1.5 transition-colors whitespace-nowrap"
                              style={{ backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}
                            >
                              {t('form_run_next', lastRunNumber + 1)}
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('form_run_no_last')}</span>
                        )
                      )}
                    </div>
                  </div>
                ) : (
                  <div>
                    <input
                      type="text"
                      value={runText}
                      onChange={e => { setRunText(e.target.value); setRunError('') }}
                      onBlur={checkRun}
                      placeholder={runPlaceholder}
                      className={inputCls}
                      style={{ ...inputStyle, borderColor: runError ? 'var(--danger-text)' : 'var(--input-border)' }}
                    />
                    {runHint && !runError && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{runHint}</p>}
                  </div>
                )}
                {runError && <p className="text-xs" style={{ color: 'var(--danger-text)' }}>{runError}</p>}

                {/* Phase 4: run_type pill picker. Locks when the active format
                    has run_type_lock; otherwise defaults to the server's
                    auto-suggestion, with the user free to override. */}
                <div className="mt-1.5">
                  <RunTypePicker
                    value={runTypeLetter || autoRunTypeLetter}
                    onChange={(l) => { setRunTypeLetter(l); setRunTypeUserEdited(true) }}
                    lockedTo={runTypeLock}
                    lang={lang}
                    hint={!runTypeLock && autoRunTypeLetter && !runTypeUserEdited
                      ? `auto: ${autoRunTypeLetter}`
                      : null}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* ── Beam / Target (setter) ─────────────────────────────── */}
          {fieldVisible('beam') && (
            <div className="flex items-center gap-3">
              <label className={labelCls} style={labelStyle}>Beam</label>
              <input value={form.beam}
                onChange={e => setForm(prev => ({ ...prev, beam: e.target.value }))}
                placeholder="예: 7Li" className={`flex-1 ${inputCls}`} style={inputStyle} />
            </div>
          )}
          {fieldVisible('target') && (
            <div className="flex items-center gap-3">
              <label className={labelCls} style={labelStyle}>Target</label>
              <input value={form.target}
                onChange={e => setForm(prev => ({ ...prev, target: e.target.value }))}
                placeholder="예: CD2" className={`flex-1 ${inputCls}`} style={inputStyle} />
            </div>
          )}

          {/* ── Level ──────────────────────────────────────────────── */}
          {fieldVisible('level') && (
            <div className="flex items-center gap-3">
              <label className={labelCls} style={labelStyle}>
                {t('form_level')}
              </label>
              <select
                name="level"
                value={form.level}
                onChange={e => setForm(prev => ({ ...prev, level: e.target.value }))}
                className={`flex-1 ${inputCls}`}
                style={inputStyle}
              >
                {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          {/* ── Tags ──────────────────────────────────────────────────── */}
          {fieldVisible('tags') && (
            <div className="flex items-start gap-3">
              <label className={`${labelCls} pt-2`} style={labelStyle}>
                {t('form_tags')}
              </label>
              <div className="flex-1 relative">
                <div
                  className="flex flex-wrap gap-1.5 p-2 border rounded-lg focus-within:ring-2 min-h-[42px] cursor-text"
                  style={{ ...inputStyle, '--tw-ring-color': 'var(--input-focus-border)' }}
                  onClick={() => tagInputRef.current?.focus()}
                >
                  {tagList.map(name => (
                    <span key={name}
                      className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: 'var(--info-bg)', color: 'var(--info-text)' }}>
                      {name}
                      <button type="button" onClick={e => { e.stopPropagation(); removeTag(name) }}
                        className="leading-none hover:opacity-70">×</button>
                    </span>
                  ))}
                  <input
                    ref={tagInputRef}
                    value={tagInput}
                    onChange={e => { setTagInput(e.target.value); setShowSuggestions(true) }}
                    onKeyDown={handleTagKeyDown}
                    onFocus={() => setShowSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
                    placeholder={tagList.length === 0 ? t('form_tags_input_placeholder') : ''}
                    className="flex-1 min-w-24 text-sm outline-none bg-transparent"
                    style={{ color: 'var(--text-primary)' }}
                  />
                </div>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{t('form_tags_add_hint')}</p>
                {showSuggestions && tagSuggestions.length > 0 && (
                  <ul className="absolute z-20 left-0 right-0 mt-1 border rounded-lg shadow-lg overflow-hidden"
                      style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-default)' }}>
                    {tagSuggestions.map(name => (
                      <li key={name}>
                        <button type="button"
                          onMouseDown={e => { e.preventDefault(); addTag(name) }}
                          className="w-full text-left px-3 py-2 text-sm transition-colors"
                          style={{ color: 'var(--text-primary)' }}
                          onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--info-bg)'; e.currentTarget.style.color = 'var(--info-text)' }}
                          onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = 'var(--text-primary)' }}
                        >
                          {name}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* ── Custom fields ─────────────────────────────────────────── */}
          {customFields.map(field => {
            const isNumberEntry = field.field_type === 'number_entry'
            return (
              <div key={field.key} className="flex items-center gap-3">
                <label className={labelCls} style={labelStyle}>
                  {field.label}
                  {field.required && <span className="ml-0.5" style={{ color: 'var(--danger-text)' }}>*</span>}
                </label>
                <div className="flex-1">
                  {isNumberEntry ? (
                    <NumberEntryField
                      variant="multiple"
                      inline
                      value={toMultipleRaw(customValues[field.key])}
                      onChange={raw => setCustomValues(prev => ({ ...prev, [field.key]: raw }))}
                    />
                  ) : (
                    <input
                      type={field.field_type === 'number' ? 'number' : 'text'}
                      value={customValues[field.key] ?? ''}
                      onChange={e => setCustomValues(prev => ({ ...prev, [field.key]: e.target.value }))}
                      placeholder={field.placeholder || ''}
                      required={field.required}
                      className={inputCls}
                      style={inputStyle}
                    />
                  )}
                </div>
              </div>
            )
          })}

          {/* ── Body ──────────────────────────────────────────────────── */}
          {fieldVisible('body') && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-medium" style={labelStyle}>{t('form_body')}</label>
                <button type="button" onClick={() => setPreview(p => !p)}
                  className="text-xs hover:underline" style={{ color: 'var(--text-link)' }}>
                  {preview ? t('form_edit') : t('form_preview')}
                </button>
              </div>
              {preview ? (
                <div className="min-h-24 border rounded-lg p-4 markdown-body text-sm"
                     style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}>
                  {form.body
                    ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{form.body}</ReactMarkdown>
                    : <span className="italic" style={{ color: 'var(--text-muted)' }}>{t('form_preview_empty')}</span>
                  }
                </div>
              ) : (
                <textarea
                  name="body"
                  value={form.body}
                  onChange={e => setForm(prev => ({ ...prev, body: e.target.value }))}
                  rows={5}
                  placeholder={t('form_body_placeholder')}
                  className={`${inputCls} font-mono resize-y`}
                  style={inputStyle}
                />
              )}
            </div>
          )}

          {/* ── Attachments ───────────────────────────────────────────── */}
          {fieldVisible('attachments') && (
            <div className="flex items-start gap-3">
              <label className={`${labelCls} pt-2`} style={labelStyle}>
                {t('form_attachments')}
              </label>
              <div className="flex-1">
                {existingAttachments.length > 0 && (
                  <ul className="mb-2 space-y-1">
                    {existingAttachments.map(a => (
                      <li key={a.id} className="text-xs flex items-center gap-1"
                          style={{ color: 'var(--text-secondary)' }}>
                        {a.original_filename}
                        <button type="button"
                          onClick={async () => {
                            if (!window.confirm(`Delete ${a.original_filename}?`)) return
                            await api.delete(`/attachments/${a.id}`)
                            setExistingAttachments(prev => prev.filter(x => x.id !== a.id))
                          }}
                          className="ml-1"
                          style={{ color: 'var(--text-muted)' }}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--danger-text)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                        >remove</button>
                      </li>
                    ))}
                  </ul>
                )}
                {fromAttachments.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs mb-1" style={{ color: 'var(--success-text)' }}>{t('form_from_attachments')}</p>
                    <ul className="space-y-1">
                      {fromAttachments.map(a => (
                        <li key={a.id} className="text-xs flex items-center gap-1"
                            style={{ color: 'var(--text-secondary)' }}>
                          {a.original_filename}
                          <button type="button"
                            onClick={() => setFromAttachments(prev => prev.filter(x => x.id !== a.id))}
                            className="ml-1"
                            style={{ color: 'var(--text-muted)' }}
                            onMouseEnter={e => e.currentTarget.style.color = 'var(--danger-text)'}
                            onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                          ><Icon name="close" size={13} /></button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                <div
                  className="border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition-colors"
                  style={{
                    borderColor:     dragOver ? 'var(--border-focus)' : 'var(--border-default)',
                    backgroundColor: dragOver ? 'var(--info-bg)'      : 'transparent',
                  }}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                >
                  <p className="text-sm flex items-center justify-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
                    <Icon name={dragOver ? 'folder' : 'attach'} size={14} />
                    {dragOver ? '여기에 놓으세요'
                      : fileItems.length > 0 ? t('form_files_selected', fileItems.length)
                      : t('form_drop')}
                  </p>
                  <input ref={fileInputRef} type="file" multiple className="hidden"
                    onChange={e => setFileItems(prev => [
                      ...prev,
                      ...Array.from(e.target.files).map(f => ({ file: f, name: f.name })),
                    ])}
                  />
                </div>
                {/* Camera — mobile uses the native capture input; desktop opens the
                    getUserMedia modal (the webcam isn't reachable via <input capture>). */}
                <div className="mt-2 flex items-center gap-2">
                  <Button variant="secondary" type="button"
                    onClick={() => { if (isMobile) cameraInputRef.current?.click(); else setCameraOpen(true) }}>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><Icon name="camera" size={14} />{t('form_camera') || '카메라 / 사진'}</span>
                  </Button>
                  <input ref={cameraInputRef} type="file" accept="image/*" capture="environment" className="hidden"
                    onChange={e => setFileItems(prev => [
                      ...prev,
                      ...Array.from(e.target.files).map(f => ({ file: f, name: f.name })),
                    ])}
                  />
                </div>
                {fileItems.length > 0 && (
                  <ul className="mt-2 space-y-1.5">
                    {fileItems.map((item, i) => (
                      <li key={i} className="flex items-center gap-1.5">
                        <span className="shrink-0" style={{ color: 'var(--text-muted)' }}>·</span>
                        <input
                          type="text"
                          value={item.name}
                          onChange={e => setFileItems(prev =>
                            prev.map((x, j) => j === i ? { ...x, name: e.target.value } : x)
                          )}
                          title={t('form_file_rename_hint')}
                          className="flex-1 text-xs border rounded px-2 py-1 focus:outline-none focus:ring-1"
                          style={inputStyle}
                        />
                        <button type="button"
                          onClick={() => setFileItems(prev => prev.filter((_, j) => j !== i))}
                          className="text-xs shrink-0"
                          style={{ color: 'var(--text-muted)' }}
                          onMouseEnter={e => e.currentTarget.style.color = 'var(--danger-text)'}
                          onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                        ><Icon name="close" size={13} /></button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

        </div>

        {/* Footer — Cancel / Save (#4) */}
        <div className="px-4 py-3 border-t rounded-b-xl flex items-center justify-between gap-3"
             style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--border-subtle)' }}>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{t('form_author', user.username)}</span>
          <div className="flex items-center gap-2">
            <Button variant="secondary" type="button" onClick={handleCancel}>{t('form_cancel')}</Button>
            <Button variant="primary" type="submit" disabled={saving}>{saveLabel}</Button>
          </div>
        </div>
      </form>
    </div>
  )
}
