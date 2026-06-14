/**
 * Log format system utilities.
 *
 * A "format" defines which fields appear in the LogForm and in what order.
 * Built-in fields correspond to standard LogEntry columns. Custom fields
 * (text / number / number_entry / attachment) store values inside
 * format_fields_json on the entry.
 */

// ── Built-in field catalogue (Phase 2) ───────────────────────────────────────
// Each entry: id, labels per locale, optional `always` (cannot be removed),
// optional `preview` (=false hides from log list preview row),
// optional `auto`     (=true the field is filled by the backend).
//
//   log_index     — auto "#42" counter, server-assigned, read-only in UI
//   run           — main run number + run type (S/R/E/A/M/IDLE)
//   subsystem_run — secondary run number; same shape as `run` but NOT in
//                   the log list preview row (per spec)
//   title         — combined with log_index when displayed (Phase 5)
//   level         — info / warning / error
//   tags          — many-to-many (renamed from "tag" for backend compat)
//   body          — markdown content
//   attachments   — file uploads
export const BUILTIN_FIELDS = [
  { id: 'log_index',     labelEn: 'Log #',          labelKo: '로그 번호',     auto: true, always: true },
  { id: 'title',         labelEn: 'Title',          labelKo: '제목' },
  { id: 'run',           labelEn: 'Run',            labelKo: 'Run',           always: true },
  { id: 'beam',          labelEn: 'Beam (setter)',   labelKo: '빔 (설정)' },
  { id: 'target',        labelEn: 'Target (setter)', labelKo: '타겟 (설정)' },
  { id: 'tags',          labelEn: 'Tags',           labelKo: '태그' },
  { id: 'body',          labelEn: 'Body',           labelKo: '본문' },
  { id: 'attachments',   labelEn: 'Attachments',    labelKo: '첨부파일' },
]

export const BUILTIN_IDS = new Set(BUILTIN_FIELDS.map(f => f.id))

// Legacy `run_number` from pre-Phase-2 formats is treated as `run`.
export function normalizeBuiltinId(id) {
  if (id === 'run_number') return 'run'
  return id
}

// ── Run-type letters (Phase 4 will compute defaults from flow) ──────────────
export const RUN_TYPES = [
  { id: 'S',    labelEn: 'Start of run',     labelKo: '런 시작',     prefix: 'S' },
  { id: 'R',    labelEn: 'Running',          labelKo: '런 진행',     prefix: 'R' },
  { id: 'E',    labelEn: 'End of run',       labelKo: '런 종료',     prefix: 'E' },
  { id: 'M',    labelEn: 'Monitoring run',   labelKo: '런 모니터링', prefix: 'M' },
  { id: 'IDLE', labelEn: 'IDLE',             labelKo: 'IDLE',        prefix: 'IDLE' },
]
export const RUN_TYPE_IDS = new Set(RUN_TYPES.map(t => t.id))

// ── number_entry variants ────────────────────────────────────────────────────
export const NUMBER_ENTRY_VARIANTS = [
  { id: 'single',   labelEn: 'Single',   labelKo: 'Single',   slots: 1  },
  { id: 'range',    labelEn: 'Range',    labelKo: 'Range',    slots: 2  },
  { id: 'multiple', labelEn: 'Multiple', labelKo: 'Multiple', slots: 10 },
]
export const MULTIPLE_SLOT_COUNT = 10

// ── Field-type enumeration (UI dropdowns) ────────────────────────────────────
export const CUSTOM_FIELD_TYPES = [
  { id: 'text',         labelEn: 'Text',         labelKo: '텍스트' },
  { id: 'number_entry', labelEn: 'Number entry', labelKo: '숫자 입력 (mean ± error)' },
]

/**
 * Standard pseudo-format — every built-in field, in the canonical order.
 * id = null means "no specific format selected".
 */
export const STANDARD_FORMAT = {
  id: null,
  name: 'Standard',
  is_default: false,
  fields: BUILTIN_FIELDS.map((f, i) => ({
    key: f.id,
    label: f.labelEn,
    field_type: 'builtin',
    builtin_id: f.id,
    required: false,
    order: i,
  })),
}

/**
 * Given a format (or null), return the sorted field list.
 * Falls back to STANDARD_FORMAT. Legacy `run_number` ids are remapped
 * to `run` so older formats keep working.
 */
export function getFields(format) {
  const src = format ?? STANDARD_FORMAT
  return [...src.fields]
    .map(f => f.field_type === 'builtin' && f.builtin_id === 'run_number'
      ? { ...f, builtin_id: 'run' }
      : f)
    .sort((a, b) => a.order - b.order)
}

/**
 * True if a given builtin_id is in a format's field list (legacy-aware).
 */
export function hasBuiltin(format, builtinId) {
  return getFields(format).some(
    f => f.field_type === 'builtin'
      && normalizeBuiltinId(f.builtin_id) === builtinId
  )
}

// ── number_entry math (client side, for live preview) ────────────────────────

/** Returns canonical { value, error } for a raw client-side input. */
export function computeNumberEntry(raw, variant) {
  if (!raw || typeof raw !== 'object') {
    return { value: 0, error: 0 }
  }
  if (variant === 'single') {
    const v = parseFloat(raw.single)
    return { value: isFinite(v) ? v : 0, error: 0 }
  }
  if (variant === 'range') {
    const lo = parseFloat(raw.min)
    const hi = parseFloat(raw.max)
    if (!isFinite(lo) || !isFinite(hi)) return { value: 0, error: 0 }
    return { value: (lo + hi) / 2, error: Math.abs(hi - lo) / 2 }
  }
  if (variant === 'multiple') {
    const vals = (raw.values || []).map(x => parseFloat(x)).filter(x => isFinite(x))
    if (!vals.length) return { value: 0, error: 0 }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length
    if (vals.length === 1) return { value: mean, error: 0 }
    const variance = vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1)
    return { value: mean, error: Math.sqrt(variance) }
  }
  return { value: 0, error: 0 }
}

// ── Phase 5: composed title formatting ───────────────────────────────────────
//
//   final title = "<RUN_TYPE>#<run_number> (<run_log_index>) <user title>"
//
//   • "RUN_TYPE#run_number" comes from entry.run_type + entry.run_number
//     (or run_number_text for non-single variants).
//   • "(N)" is the per-run sequential counter run_log_index.
//   • "<user title>" is the title the user typed (entry.title); may be empty.
//   • For IDLE / no-run logs the prefix collapses to just "IDLE" (no #N), and
//     run_log_index is omitted.
//
// Examples:
//   R#55 (5) my title
//   E#55 (1) end summary
//   R#55 (3)                  ← user title was empty
//   IDLE just a note          ← run_type=IDLE, no run number
//   #42 fallback              ← no run context at all → log_index only

// Run-type letter → human label (shown after the run number: "[77] Init").
const RUN_TYPE_LABELS = {
  I: 'Init',
  S: 'Start',
  R: 'Running',
  E: 'End',
  M: 'Monitoring',
  A: 'IDLE',   // legacy 'After' → treated as IDLE
}

// Run-type badge colors. Purple family, lightening→darkening along the run
// lifecycle: Init → Start → Running → End. Monitoring is a very light tint
// (dark text); IDLE is a separate neutral color.
const RUN_TYPE_COLORS = {
  M: { bg: '#ede9fe', fg: '#5b21b6' },   // Monitoring — lightest tint, dark text
  I: { bg: '#a78bfa', fg: '#ffffff' },   // Init       — light purple
  S: { bg: '#8b5cf6', fg: '#ffffff' },   // Start
  R: { bg: '#7c3aed', fg: '#ffffff' },   // Running
  E: { bg: '#5b21b6', fg: '#ffffff' },   // End        — dark purple
}

/** Background/text style for the run-title badge, colored by run_type. */
export function runBadgeStyle(runType) {
  // IDLE (and legacy 'After') → neutral gray.
  if (runType === 'IDLE' || runType === 'A') return { backgroundColor: '#6b7280', color: '#ffffff' }
  const c = RUN_TYPE_COLORS[runType] || { bg: '#8b5cf6', fg: '#ffffff' }
  return { backgroundColor: c.bg, color: c.fg }
}

/** The run number as a string ("55"), or "" when there is none. IDLE logs also
 *  carry their (last-set) run number. */
export function runNumberText(entry) {
  if (!entry) return ''
  const num = entry.run_number_type === 'single' || !entry.run_number_type
    ? entry.run_number
    : entry.run_number_text
  if (num == null || num === '') return ''
  return String(num)
}

/** The run status label ("Init" / "Start" / … / "IDLE"), or "". */
export function runStatusLabel(entry) {
  if (!entry || !entry.run_type) return ''
  if (entry.run_type === 'IDLE') return 'IDLE'
  return RUN_TYPE_LABELS[entry.run_type] || entry.run_type
}

/** Returns "[55] Init" / "[55] End" / "IDLE" / "" based on the entry. */
export function formatRunPrefix(entry) {
  if (!entry) return ''
  const num = entry.run_number_type === 'single' || !entry.run_number_type
    ? entry.run_number
    : entry.run_number_text
  const label = entry.run_type === 'IDLE' ? 'IDLE'
              : (RUN_TYPE_LABELS[entry.run_type] || (entry.run_type || 'Run'))
  if (num == null || num === '') return label && label !== 'IDLE' ? '' : label
  return `[${num}] ${label}`
}

/** Returns the composed display title for a log entry. */
export function formatLogTitle(entry) {
  if (!entry) return ''
  const prefix = formatRunPrefix(entry)
  const title = (entry.title || '').trim()
  // No run context — just return the title (ID pill is shown separately in the card)
  if (!prefix) {
    return title
  }
  // run_log_index "(N)" is recorded but not displayed.
  return [prefix, title].filter(Boolean).join(' ').trim()
}

/** Format a number_entry value for display. */
export function formatNumberEntry(canonical, opts = {}) {
  if (!canonical || typeof canonical !== 'object') return ''
  const { value = 0, error = 0 } = canonical
  const digits = opts.digits ?? 3
  if (!error) return Number(value).toFixed(digits).replace(/\.?0+$/, '')
  return `${Number(value).toFixed(digits)} ± ${Number(error).toFixed(digits)}`
}
