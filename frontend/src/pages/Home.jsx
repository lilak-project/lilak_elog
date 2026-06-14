import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { LogToolbar, LogList, Pagination, useTaggables, tagColors, Icon, ChipGroup, Callout, openBarInput, closeBarInput } from 'lilak-ui'
import api from '../api'
import LogCard from '../components/LogCard'
import LogCardExpanded from '../components/LogCardExpanded'
import LogForm, { FormatPicker } from './LogForm'
import ErrorBoundary from '../components/ErrorBoundary'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { useTab } from '../context/TabContext'
import { useTheme } from '../context/ThemeContext'
import { combo } from '../theme/textCombos'
import { hoverify } from '../theme/uiStyles'
import { severityStyle } from '../components/EntryShared'

const VIEW_MODES = ['brief', 'normal', 'rich']

// The header bar shown above the inline editor — keeps "#1004 INFO AUTO"
// visible while editing.
function EditCardHeader({ entry }) {
  const level = entry.level || 'info'
  return (
    <div className="flex items-center gap-2 flex-wrap px-4 py-2.5 border-b rounded-t-xl"
         style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--border-subtle)' }}>
      <span className="text-xs font-mono px-2 py-0.5 rounded border"
            style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface)', borderColor: 'var(--border-default)' }}>
        _{entry.log_index ?? entry.id}
      </span>
      {level !== 'info' && (
        <span className="text-xs px-2 py-0.5 rounded-full" style={severityStyle(level)}>
          {level.toUpperCase()}
        </span>
      )}
      {entry.category && (
        <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ backgroundColor: 'var(--surface-3)', color: 'var(--text-secondary)' }}>
          {entry.category}
        </span>
      )}
      {entry.is_auto && (
        <span className="text-xs px-2 py-0.5 rounded-full"
              style={{ backgroundColor: 'var(--info-bg)', color: 'var(--info-text)' }}>
          AUTO
        </span>
      )}
    </div>
  )
}

function getSavedViewMode() {
  const saved = localStorage.getItem('elog_view_mode')
  if (saved === 'full') { localStorage.setItem('elog_view_mode', 'rich'); return 'rich' }
  return saved || 'brief'
}

const BAR_CMD     = null
const BAR_SEARCH  = 'search'
const BAR_COMMENT = 'comment'
const BAR_GOTO    = 'goto'

export default function Home() {
  const { user } = useAuth()
  const { t } = useLang()
  const { openNewLog, openSettings, pendingLogId, clearPendingLog, logFormReq, clearLogForm } = useTab()
  const { cycle: cycleTheme } = useTheme()

  // ── Filter state (owned here now) ───────────────────────────────────────────
  const [tags, setTags] = useState([])
  const [categories, setCategories] = useState([])
  const [activeTag, setActiveTag] = useState('')
  const [activeCategory, setActiveCategory] = useState('')
  const [activeSource, setActiveSource] = useState('')
  const [showFilter, setShowFilter] = useState(false)

  useEffect(() => {
    api.get('/tags').then(r => setTags(r.data)).catch(() => {})
    api.get('/categories').then(r => setCategories(r.data)).catch(() => {})
    api.get('/formats').then(r => setPickFormats(Array.isArray(r.data) ? r.data : [])).catch(() => {})
  }, [])

  // ── Log list state ───────────────────────────────────────────────────────────
  const [entries, setEntries] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [viewMode, setViewMode] = useState(getSavedViewMode)
  const [groupBy, setGroupBy] = useState(() => localStorage.getItem('elog_group_by') || 'run')
  function changeGroupBy(g) { setGroupBy(g); localStorage.setItem('elog_group_by', g) }

  // ── Command mode ─────────────────────────────────────────────────────────────
  const [cmdMode, setCmdMode] = useState(true)
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [expandedId, setExpandedId] = useState(null)
  // `g` gesture: a quick double-tap (gg) jumps to the top without opening the
  // full bar; a single `g` opens a tiny bubble input (`miniGoto`) for `_<n>`.
  const gTapRef = useRef(0)
  const gTimerRef = useRef(null)
  const miniRef = useRef(null)
  const [miniGoto, setMiniGoto] = useState(null)   // null = closed, '' or value = open

  // ── New-log draft flow ─────────────────────────────────────────────────────
  // New log = create an empty entry, then edit it inline. Cancel deletes it.
  const [draftId, setDraftId] = useState(null)        // id of the empty draft being filled
  const [pickFormats, setPickFormats] = useState([])  // formats for the new-log picker
  const [creating, setCreating] = useState(false)

  // ── Bottom bar ───────────────────────────────────────────────────────────────
  const [barMode, setBarMode]             = useState(BAR_CMD)
  const [searchQuery, setSearchQuery]     = useState('')
  const [serverSearchQuery, setServerSearchQuery] = useState('')
  // Command-mode find filters: { run, beam, target, tagExpr, logIndex }
  const [cmdFilter, setCmdFilter] = useState(null)
  const [commentText, setCommentText]     = useState('')
  const [commentSubmitting, setCommentSubmitting] = useState(false)
  const [reportMode, setReportMode]       = useState(false)
  const [commentRefresh, setCommentRefresh] = useState(0)
  const [gotoText, setGotoText]           = useState('')
  const barInputRef = useRef(null)
  const ggInProgressRef = useRef(false)

  // ── Pinned notices ───────────────────────────────────────────────────────────
  const [notices, setNotices]               = useState([])
  const [noticesCollapsed, setNoticesCollapsed] = useState(false)
  const [expandedNoticeId, setExpandedNoticeId] = useState(null)

  const fetchNotices = useCallback(async () => {
    try {
      const res = await api.get('/logs', { params: { is_notice: true, page: 1, page_size: 50 } })
      setNotices(res.data.items || [])
    } catch { /* silent */ }
  }, [])

  useEffect(() => { fetchNotices() }, [fetchNotices])

  function changeViewMode(m) {
    setViewMode(m)
    localStorage.setItem('elog_view_mode', m)
  }

  // Bring an entry into view reliably (scroll-margin on the cards clears the
  // fixed top/command bars). Used for explicit jumps; focus/open follow happens
  // in the effect below.
  function scrollToFocused(idx) {
    const entry = entries[idx]
    if (!entry) return
    requestAnimationFrame(() => {
      document.getElementById(`log-card-${entry.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }

  function gotoById(idStr) {
    const id = Number(idStr)
    if (!id) return
    const idx = entries.findIndex(e => e.id === id)
    if (idx >= 0) {
      setFocusedIdx(idx)
      setTimeout(() => {
        document.getElementById(`log-card-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 0)
    }
  }

  function clamp(idx) { return Math.max(0, Math.min(entries.length - 1, idx)) }

  function moveFocus(delta) {
    setFocusedIdx(prev => {
      const next = clamp(prev + delta)
      // If a log is currently open, follow focus: close old, open new.
      // Scrolling is handled by the focus/open effect below (keeps it in view).
      setExpandedId(cur => {
        if (cur == null) return null
        const nextEntry = entries[next]
        return nextEntry ? nextEntry.id : null
      })
      return next
    })
  }

  // Comment / report on a log — opens the ONE collapsible bottom bar as a text
  // input (no separate bottom bar). Posts to the log on Enter.
  function commentLog(logId, opts = {}) {
    if (!logId) return
    openBarInput({
      key: `comment-${logId}-${opts.report ? 'r' : 'c'}`,
      label: opts.report ? (t('report') || '리포트') : (t('comments') || '댓글'),
      placeholder: opts.report ? (t('report_reason') || '리포트 사유…') : (t('comments_placeholder_short') || '댓글…'),
      initialValue: opts.text || '',
      hint: 'Enter ↵',
      onSubmit: async (text) => {
        const body = (text || '').trim()
        if (!body) { closeBarInput(); return }
        try { await api.post(`/logs/${logId}/comments`, { body, report: !!opts.report }); setCommentRefresh(r => r + 1) } catch { /* silent */ }
        closeBarInput()
      },
      onCancel: closeBarInput,
    })
  }

  function enterCmdMode() {
    setCmdMode(true)
    setBarMode(BAR_CMD)
    scrollToFocused(focusedIdx)
  }

  function openBar(mode) {
    setCmdMode(false)
    setBarMode(mode)
    setTimeout(() => barInputRef.current?.focus(), 0)
  }

  // ── Keyboard handler ─────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e) {
      const tag = document.activeElement?.tagName
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(tag)

      if (e.key === 'Escape') {
        if (inInput) return
        if (!cmdMode)   { e.preventDefault(); enterCmdMode(); return }
        if (expandedId) { e.preventDefault(); setExpandedId(null); return }
        return
      }

      if (!cmdMode || inInput) return
      // Cmd/Ctrl 조합(Cmd+R 새로고침 등)은 브라우저에 위임
      if (e.metaKey || e.ctrlKey) return

      switch (e.key) {
        // Newest is at the TOP now (index 0 = newest = top). So:
        // down(j) → higher index (older), up(k) → lower index (newer).
        case 'j': case 'ArrowDown': e.preventDefault(); moveFocus(1);  break
        case 'k': case 'ArrowUp':   e.preventDefault(); moveFocus(-1); break
        case 'J':                   e.preventDefault(); moveFocus(10);  break
        case 'K':                   e.preventDefault(); moveFocus(-10); break
        case 'G':
        case 'End':
          // G/End → oldest = last index (bottom). Two-step: first jump to it,
          // a second G (already focused there) scrolls to the very bottom.
          e.preventDefault()
          { const last = entries.length - 1; if (last < 0) break
            if (focusedIdx === last) window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
            else { setFocusedIdx(last); scrollToFocused(last) } }
          break
        case 'Home':
          // Home → newest = index 0 (top). Two-step: second Home scrolls to the very top.
          e.preventDefault()
          if (focusedIdx === 0) window.scrollTo({ top: 0, behavior: 'smooth' })
          else { setFocusedIdx(0); scrollToFocused(0) }
          break
        case '{':
          e.preventDefault()
          if (page > 1) { setPage(p => p - 1); setFocusedIdx(0) }
          break
        case '}':
          e.preventDefault()
          { const totalPages = Math.ceil(total / pageSize); if (page < totalPages) { setPage(p => p + 1); setFocusedIdx(0) } }
          break
        case '-':
          e.preventDefault()
          { const idx = PAGE_SIZES.indexOf(pageSize); if (idx > 0) changePageSize(PAGE_SIZES[idx - 1]) }
          break
        case '=':
          e.preventDefault()
          { const idx = PAGE_SIZES.indexOf(pageSize); if (idx < PAGE_SIZES.length - 1) changePageSize(PAGE_SIZES[idx + 1]) }
          break
        case 'g': {
          // gg (quick double-tap) → jump to the top, no full bar. A lone g opens
          // a tiny bubble input for `_<n>` goto.
          e.preventDefault()
          const now = Date.now()
          if (now - gTapRef.current < 350) {
            gTapRef.current = 0
            if (gTimerRef.current) { clearTimeout(gTimerRef.current); gTimerRef.current = null }
            setMiniGoto(null)
            // two-step: first jump to the top entry; a second gg goes to the very top.
            if (focusedIdx === 0) window.scrollTo({ top: 0, behavior: 'smooth' })
            else { setFocusedIdx(0); setTimeout(() => scrollToFocused(0), 0) }
          } else {
            gTapRef.current = now
            if (gTimerRef.current) clearTimeout(gTimerRef.current)
            gTimerRef.current = setTimeout(() => {
              gTapRef.current = 0; gTimerRef.current = null
              setMiniGoto(''); setTimeout(() => miniRef.current?.focus(), 0)
            }, 320)
          }
          break
        }
        case 'o':
        case ' ': {
          e.preventDefault()
          const f = entries[focusedIdx]
          if (f) setExpandedId(prev => prev === f.id ? null : f.id)
          break
        }
        case 'r':
        case ',':
        case 'Tab': {
          e.preventDefault()
          const f = entries[focusedIdx]; if (!f) break
          // Open the focused log + comment via the collapsible bottom bar.
          setExpandedId(f.id)
          commentLog(f.id)
          break
        }
        case 'n':
        case '+': {
          if (user) { e.preventDefault(); openNewLog() }
          break
        }
        case 't': {
          e.preventDefault()
          cycleTheme()
          break
        }
        default: break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cmdMode, focusedIdx, expandedId, entries, user, openNewLog, cycleTheme])

  useEffect(() => { setFocusedIdx(0); setExpandedId(null) }, [entries])

  // The comment bar belongs to an open log — if no log is open, close it so it
  // can't get stuck after the entry is collapsed/closed. Also close on unmount
  // (leaving the logs tab).
  useEffect(() => { if (expandedId == null && expandedNoticeId == null) closeBarInput() }, [expandedId, expandedNoticeId])
  useEffect(() => () => closeBarInput(), [])

  // Keep the focused entry on screen. On tab-entry / new data this scrolls to
  // the focused (newest, index 0 = top of the feed); on arrow nav it
  // follows the cursor; when an entry is open it scrolls that entry into view —
  // top-aligned if it's taller than the viewport so its start is visible.
  useEffect(() => {
    const targetId = expandedId ?? entries[focusedIdx]?.id
    if (targetId == null) return
    const id = setTimeout(() => {
      const el = document.getElementById(`log-card-${targetId}`)
      if (!el) return
      const avail = window.innerHeight - 110   // minus fixed top + command bars
      const tall = el.getBoundingClientRect().height > avail
      // an opened entry taller than the viewport is top-aligned so its start
      // shows; otherwise just nudge the focused/opened entry fully into view.
      el.scrollIntoView({ behavior: 'auto', block: (expandedId != null && tall) ? 'start' : 'nearest' })
    }, 60)
    return () => clearTimeout(id)
  }, [focusedIdx, expandedId, entries])
  useEffect(() => { if (!expandedId && barMode === BAR_COMMENT) enterCmdMode() }, [expandedId])

  // Command palette → Home dispatch handlers
  useEffect(() => {
    function onGoto(e) {
      const n = e.detail?.number; if (!n) return
      gotoById(String(n))
    }
    function onOpenLog(e) {
      const id = e.detail?.id; if (!id) return
      // Scroll to and expand the log
      const idx = entries.findIndex(en => en.id === id)
      if (idx >= 0) {
        setFocusedIdx(idx)
        setExpandedId(id)
        setTimeout(() => {
          document.getElementById(`log-card-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 50)
      } else {
        // Log not on the current page — narrow the list to that log and expand
        // it. Filter by log_index (exact match); '#id' as a q= search would be
        // an FTS syntax error and wouldn't match the log anyway.
        api.get(`/logs/${id}`).then((res) => {
          const logIndex = res.data?.log_index
          if (logIndex != null) { setServerSearchQuery(''); setCmdFilter({ logIndex }) }
          setExpandedId(Number(id))
          setTimeout(() => {
            document.getElementById(`log-card-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }, 200)
        }).catch(() => {})
      }
    }
    function onClear() {
      setActiveTag(''); setActiveCategory(''); setActiveSource('')
      setSearchQuery(''); setServerSearchQuery(''); setCmdFilter(null)
    }
    function onFilter(e) {
      const { type, value } = e.detail || {}
      if (type === 'tag')      setActiveTag(value || '')
      if (type === 'category') setActiveCategory(value || '')
      if (type === 'level') setServerSearchQuery(`level:${value}`)   // simple fallback
      if (type === 'author')   setServerSearchQuery(`author:${value}`)
      if (type === 'run')      setServerSearchQuery(`run:${value}`)
      if (type === 'date')     setServerSearchQuery(`date:${value}`)
      if (type === 'notice')   setNoticesCollapsed(c => !c)
      if (type === 'deleted')  alert('Use settings to view deleted logs')
    }
    function onEditFocused() {
      const f = entries[focusedIdx]; if (f) openNewLog({ editId: f.id })
    }
    function onContinue() {
      const f = entries[focusedIdx]; if (f) openNewLog({ fromId: f.id })
    }
    function onComment(e) {
      const f = entries[focusedIdx]; if (!f) return
      setExpandedId(f.id)
      commentLog(f.id, { text: e.detail?.text || '' })
    }
    function onReport(e) {
      const id = e.detail?.id; if (id == null) return
      setExpandedId(id)
      commentLog(id, { report: true })
    }
    // `/search <q>` from the kit command bar → full-text log search (empty = clear).
    function onLogSearch(e) {
      const q = (e.detail?.q || '').trim()
      setSearchQuery(''); setCmdFilter(null); setServerSearchQuery(q); setPage(1)
    }
    function onToggleOpen() {
      const f = entries[focusedIdx]; if (!f) return
      setExpandedId(prev => prev === f.id ? null : f.id)
    }
    function onCopy() {
      const f = entries[focusedIdx]; if (!f) return
      navigator.clipboard?.writeText(`${location.origin}/logs/${f.id}`)
    }
    function onViewMode(e) {
      const m = e.detail?.mode; if (m) changeViewMode(m)
    }
    function onDeleteFocused() {
      const f = entries[focusedIdx]; if (!f) return
      if (!window.confirm(`Delete log #${f.id}?`)) return
      api.delete(`/logs/${f.id}`).then(() => fetchEntries(page))
    }
    function onRestoreFocused() {
      const f = entries[focusedIdx]; if (!f) return
      api.post(`/logs/${f.id}/restore`).then(() => fetchEntries(page))
    }
    function onExport() {
      window.open('/api/export/json', '_blank')
    }
    // ── Command find-modes ──
    function onFindLog(e) {
      const li = e.detail?.logIndex; if (li == null || Number.isNaN(li)) return
      setServerSearchQuery(''); setCmdFilter({ logIndex: li })
    }
    // `gg` from the `_` goto bar → jump to the top (newest = index 0). Two-step:
    // if already on the top entry, scroll to the very top.
    function onGotoTop() {
      if (entries.length === 0) return
      if (focusedIdx === 0) { window.scrollTo({ top: 0, behavior: 'smooth' }); return }
      setFocusedIdx(0)
      setTimeout(() => scrollToFocused(0), 0)
    }
    function onFindRun(e) {
      const run = e.detail?.run; if (run == null || Number.isNaN(run)) return
      setServerSearchQuery(''); setCmdFilter({ run })
    }
    function onFindBeam(e) {
      const beam = (e.detail?.beam || '').trim(); if (!beam) return
      setServerSearchQuery(''); setCmdFilter({ beam })
    }
    function onFindTarget(e) {
      const target = (e.detail?.target || '').trim(); if (!target) return
      setServerSearchQuery(''); setCmdFilter({ target })
    }
    function onFindTags(e) {
      const expr = (e.detail?.expr || '').trim(); if (!expr) return
      setServerSearchQuery(''); setCmdFilter({ tagExpr: expr })
    }
    window.addEventListener('lilak:cmd:find-log', onFindLog)
    window.addEventListener('lilak:cmd:goto-top', onGotoTop)
    window.addEventListener('lilak:cmd:find-run', onFindRun)
    window.addEventListener('lilak:cmd:find-beam', onFindBeam)
    window.addEventListener('lilak:cmd:find-target', onFindTarget)
    window.addEventListener('lilak:cmd:find-tags', onFindTags)
    window.addEventListener('lilak:cmd:goto', onGoto)
    window.addEventListener('lilak:cmd:open-log', onOpenLog)
    window.addEventListener('lilak:cmd:clear', onClear)
    window.addEventListener('lilak:cmd:filter', onFilter)
    window.addEventListener('lilak:cmd:edit-focused', onEditFocused)
    window.addEventListener('lilak:cmd:continue', onContinue)
    window.addEventListener('lilak:cmd:comment', onComment)
    window.addEventListener('lilak:cmd:report', onReport)
    window.addEventListener('lilak:cmd:log-search', onLogSearch)
    window.addEventListener('lilak:cmd:toggle-open', onToggleOpen)
    window.addEventListener('lilak:cmd:copy-link', onCopy)
    window.addEventListener('lilak:cmd:view-mode', onViewMode)
    window.addEventListener('lilak:cmd:delete-focused', onDeleteFocused)
    window.addEventListener('lilak:cmd:restore-focused', onRestoreFocused)
    window.addEventListener('lilak:cmd:export', onExport)
    return () => {
      window.removeEventListener('lilak:cmd:goto', onGoto)
      window.removeEventListener('lilak:cmd:open-log', onOpenLog)
      window.removeEventListener('lilak:cmd:clear', onClear)
      window.removeEventListener('lilak:cmd:filter', onFilter)
      window.removeEventListener('lilak:cmd:edit-focused', onEditFocused)
      window.removeEventListener('lilak:cmd:continue', onContinue)
      window.removeEventListener('lilak:cmd:comment', onComment)
      window.removeEventListener('lilak:cmd:report', onReport)
      window.removeEventListener('lilak:cmd:log-search', onLogSearch)
      window.removeEventListener('lilak:cmd:toggle-open', onToggleOpen)
      window.removeEventListener('lilak:cmd:copy-link', onCopy)
      window.removeEventListener('lilak:cmd:view-mode', onViewMode)
      window.removeEventListener('lilak:cmd:delete-focused', onDeleteFocused)
      window.removeEventListener('lilak:cmd:restore-focused', onRestoreFocused)
      window.removeEventListener('lilak:cmd:export', onExport)
      window.removeEventListener('lilak:cmd:find-log', onFindLog)
      window.removeEventListener('lilak:cmd:goto-top', onGotoTop)
      window.removeEventListener('lilak:cmd:find-run', onFindRun)
      window.removeEventListener('lilak:cmd:find-beam', onFindBeam)
      window.removeEventListener('lilak:cmd:find-target', onFindTarget)
      window.removeEventListener('lilak:cmd:find-tags', onFindTags)
    }
  }, [entries, focusedIdx, page]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pending log from another tab (e.g. "view" after Request Log) ────────────
  useEffect(() => {
    if (!pendingLogId || loading) return
    const entry = entries.find(e => e.id === pendingLogId)
    if (entry) {
      setExpandedId(pendingLogId)
      clearPendingLog()
      setTimeout(() => {
        document.getElementById(`log-card-${pendingLogId}`)
          ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }, 100)
    } else {
      // Log not on current page — clear anyway to avoid infinite loop
      clearPendingLog()
    }
  }, [pendingLogId, entries, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  const [pageSize, setPageSize] = useState(() => Number(localStorage.getItem('elog_page_size')) || 20)
  const PAGE_SIZES = [10, 20, 50]

  function changePageSize(n) {
    setPageSize(n)
    localStorage.setItem('elog_page_size', n)
    setPage(1)
    setFocusedIdx(0)
  }

  const fetchEntries = useCallback(async (p = 1) => {
    setLoading(true); setError(null)
    try {
      const params = { page: p, page_size: pageSize }
      if (activeTag)      params.tag = activeTag
      if (activeCategory) params.category = activeCategory
      if (activeSource === 'human') params.is_auto = false
      if (activeSource === 'auto')  params.is_auto = true
      if (serverSearchQuery) params.q = serverSearchQuery
      if (cmdFilter) {
        if (cmdFilter.logIndex != null) params.log_index = cmdFilter.logIndex
        if (cmdFilter.run != null)      params.run_number = cmdFilter.run
        if (cmdFilter.beam)             params.beam = cmdFilter.beam
        if (cmdFilter.target)           params.target = cmdFilter.target
        if (cmdFilter.tagExpr)          params.tag_expr = cmdFilter.tagExpr
      }
      const res = await api.get('/logs', { params })
      setEntries(res.data.items)
      setTotal(res.data.total)
    } catch { setError('error') }
    finally { setLoading(false) }
  }, [activeTag, activeCategory, activeSource, serverSearchQuery, cmdFilter, pageSize])

  useEffect(() => { fetchEntries(1); setPage(1) }, [activeTag, activeCategory, activeSource, serverSearchQuery, cmdFilter, pageSize])
  useEffect(() => { fetchEntries(page) }, [page])

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    if (!q) return entries
    return entries.filter(e =>
      (e.title || '').toLowerCase().includes(q) ||
      (e.body_excerpt || '').toLowerCase().includes(q) ||
      (e.author_name || '').toLowerCase().includes(q) ||
      (e.category || '').toLowerCase().includes(q) ||
      e.tags?.some(tg => tg.name.toLowerCase().includes(q))
    )
  }, [entries, searchQuery])

  // Make loaded logs searchable by the kit `#` tag command (TagIndex). Any UI
  // that registers taggable items gets the same `#`-search behaviour.
  useTaggables(() => entries.map((e) => ({
    id: `log:${e.id}`,
    label: e.title || `_${e.log_index ?? e.id}`,
    number: e.log_index ?? e.id,   // `_<number>` jumps straight to this log
    // Mirror the tags the card actually shows: real tags + the synthetic ones
    // (auto / run-status / task) + run/beam/target — so `#` finds what's visible.
    tags: [
      ...(e.tags || []).map((tg) => tg.name),
      e.is_auto ? 'auto' : null,
      tagColors.RUN_STATUS_TAG[e.run_type] || null,
      e.parent_log_id != null ? 'task' : null,
      e.run_number != null ? `run${e.run_number}` : null,
      e.beam, e.target,
    ].filter(Boolean),
    kind: 'log',
    run: () => window.dispatchEvent(new CustomEvent('lilak:cmd:open-log', { detail: { id: e.id } })),
  })), [entries])

  // Experiment runs (`>` index): one entry per distinct run number; opening it
  // jumps to the first log of that run.
  useTaggables(() => {
    const seen = new Map()
    for (const e of entries) {
      const rn = e.run_number
      if (rn == null || seen.has(rn)) continue
      seen.set(rn, e)
    }
    return [...seen.entries()].map(([rn, e]) => ({
      id: `run:${rn}`,
      label: `Run ${rn}${e.title ? ' — ' + e.title : ''}`,
      number: rn,
      tags: [e.beam, e.target].filter(Boolean),
      kind: 'run',
      run: () => window.dispatchEvent(new CustomEvent('lilak:cmd:open-log', { detail: { id: e.id } })),
    }))
  }, [entries])

  async function submitComment() {
    const body = commentText.trim()
    if (!body || !expandedId || commentSubmitting) return
    setCommentSubmitting(true)
    try {
      await api.post(`/logs/${expandedId}/comments`, { body, report: reportMode })
      setCommentRefresh(r => r + 1)
      setCommentText('')
      setReportMode(false)
      enterCmdMode()
    } catch { /* silent */ }
    finally { setCommentSubmitting(false) }
  }

  const isFiltered  = activeTag || activeCategory || activeSource
  const isSearching = searchQuery.trim().length > 0

  // Pure "new log" request (no edit / no continue) → show the format picker,
  // then create an empty draft and edit it inline.
  const newLogPicking = logFormReq && !logFormReq.editId && !logFormReq.fromId && !draftId

  async function createDraft(fmt) {
    if (creating) return
    setCreating(true)
    try {
      const res = await api.post('/logs', { format_id: fmt?.id ?? null, title: '', level: 'info' })
      const newId = res.data.id
      setDraftId(newId)
      await fetchEntries(page)
      openNewLog({ editId: newId })   // switch into inline edit mode for the draft
    } catch (e) {
      setError(e.response?.data?.detail || 'failed to create log')
      clearLogForm()
    } finally { setCreating(false) }
  }

  // Cancel from the editor: a draft (newly created empty log) gets deleted.
  async function handleEditorCancel(id) {
    if (id === draftId) {
      try { await api.delete(`/logs/${id}`) } catch { /* ignore */ }
      setDraftId(null)
      clearLogForm()
      fetchEntries(page)
    } else {
      clearLogForm()
    }
  }
  function handleEditorSaved(id) {
    setDraftId(null)
    clearLogForm()
    fetchEntries(page)
    setExpandedId(id)
  }

  return (
    <div className="pb-10">
      {/* New-log format picker → creates an empty draft to edit inline */}
      {newLogPicking && (
        <FormatPicker
          formats={pickFormats}
          t={t}
          onPick={fmt => createDraft(fmt)}
          onClose={() => clearLogForm()}
        />
      )}
      {/* Toolbar — kit LogToolbar (page-size / status chips / group-by #8 / filter / view mode / actions) */}
      <LogToolbar
        pageSize={pageSize} pageSizes={PAGE_SIZES} onPageSize={changePageSize}
        viewMode={viewMode} viewModes={VIEW_MODES} onViewMode={changeViewMode} viewLabel={(m) => t(`view_${m}`)}
        groupBy={groupBy} onGroupBy={changeGroupBy} groupLabel={t('group_by')}
        groupOptions={[
          { value: 'run', label: t('group_run') },
          { value: 'date', label: t('group_date') },
          { value: 'run_type', label: t('group_run_type') },
          { value: 'beam', label: t('group_beam') },
          { value: 'target', label: t('group_target') },
          { value: 'none', label: t('group_none') },
        ]}
        filterActive={showFilter || isFiltered} onToggleFilter={() => setShowFilter(s => !s)} filterLabel={t('filter_title')}
        status={<>
          {isFiltered && (
            <span className="text-xs truncate" style={{ color: 'var(--text-secondary)' }}>
              {t('home_filtered')}
              <button onClick={() => { setActiveTag(''); setActiveCategory(''); setActiveSource('') }}
                className="ml-1 hover:underline" style={{ color: 'var(--text-link)' }}>{t('home_clear')}</button>
            </span>
          )}
          {serverSearchQuery && (
            <span className="text-xs flex items-center gap-1 truncate" style={{ color: 'var(--text-secondary)' }}>
              <span className="font-medium" style={{ color: 'var(--text-primary)' }}>"{serverSearchQuery}"</span>
              <button onClick={() => { setServerSearchQuery(''); setSearchQuery('') }}
                className="ml-0.5 hover:underline shrink-0" style={{ color: 'var(--text-link)' }}>{t('home_clear')}</button>
            </span>
          )}
          {cmdFilter && (
            <span className="text-xs flex items-center gap-1 truncate" style={{ color: 'var(--text-secondary)' }}>
              <span className="font-mono font-medium" style={{ color: 'var(--text-primary)' }}>
                {cmdFilter.logIndex != null ? `_${cmdFilter.logIndex}`
                  : cmdFilter.run != null ? `*${cmdFilter.run}`
                  : cmdFilter.beam ? `>${cmdFilter.beam}`
                  : cmdFilter.target ? `@${cmdFilter.target}`
                  : cmdFilter.tagExpr ? cmdFilter.tagExpr : ''}
              </span>
              <button onClick={() => setCmdFilter(null)}
                className="ml-0.5 hover:underline shrink-0" style={{ color: 'var(--text-link)' }}>{t('home_clear')}</button>
            </span>
          )}
        </>}
        actions={user && <>
          <button onClick={() => openSettings('formats')}
            className="h-8 text-xs px-3 rounded-lg font-medium transition-colors whitespace-nowrap"
            style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--surface-3)'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = 'var(--surface-2)'}
          >Manage Formats</button>
          <button onClick={() => openNewLog()}
            className="h-8 text-xs px-3 rounded-lg font-medium transition-colors whitespace-nowrap"
            style={combo('solidSuccess')}
            {...hoverify(combo('solidSuccess'), { backgroundColor: 'var(--success-bg)', color: 'var(--success-text)' })}
          >{t('home_new')}</button>
        </>}
      />

      {/* ── Inline filter panel — kit ChipGroups + Box (Tailwind-free glue) ───── */}
      {showFilter && (
        <div style={{
          marginBottom: 16, padding: 12, borderRadius: 12,
          display: 'flex', flexWrap: 'wrap', gap: 16,
          backgroundColor: 'var(--surface-2)', border: '1px solid var(--border-default)',
        }}>
          <ChipGroup
            label={t('filter_source')}
            value={activeSource}
            onChange={setActiveSource}
            options={[
              { value: '', label: t('filter_all') },
              { value: 'human', label: t('filter_human') },
              { value: 'auto', label: t('filter_auto') },
            ]}
          />

          {categories.length > 0 && (
            <ChipGroup
              label={t('filter_category')}
              value={activeCategory}
              onChange={setActiveCategory}
              toggle
              options={[{ value: '', label: t('filter_all') }, ...categories.map(c => ({ value: c, label: c }))]}
            />
          )}

          {tags.length > 0 && (
            <ChipGroup
              label={t('filter_tags')}
              value={activeTag}
              onChange={setActiveTag}
              toggle
              round
              options={tags.map(tg => ({ value: tg.name, label: `#${tg.name}` }))}
            />
          )}

          <div>
            <p style={{ fontSize: 'var(--fs-micro, 10px)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', margin: '0 0 6px' }}>
              {t('filter_export')}
            </p>
            <div style={{ display: 'flex', gap: 8 }}>
              {[['json', 'JSON'], ['markdown', 'Markdown'], ['html', 'HTML']].map(([fmt, label]) => (
                <a key={fmt} href={`/api/export/${fmt}`} style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-link)' }}>{label}</a>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Pinned notices — kit Callout (collapsible warning banner) ──────────── */}
      {notices.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <Callout
            tone="warning"
            title={t('notice_title')}
            count={notices.length}
            collapsible
            collapsed={noticesCollapsed}
            onToggleCollapse={() => setNoticesCollapsed(v => !v)}
            labels={{ expand: '펼치기', collapse: '접기' }}
            divided
          >
            {notices.map(n =>
              expandedNoticeId === n.id ? (
                <ErrorBoundary key={`neb-${n.id}`}>
                  <LogCardExpanded
                    entry={n}
                    focused={false}
                    refreshTrigger={commentRefresh}
                    onClose={() => setExpandedNoticeId(null)}
                    onNoticeToggled={() => { fetchNotices(); fetchEntries(page) }}
                    onDeleted={() => { setExpandedNoticeId(null); fetchNotices() }}
                    onComment={(logId) => commentLog(logId)}
                  />
                </ErrorBoundary>
              ) : (
                <LogCard
                  key={n.id}
                  entry={n}
                  viewMode="normal"
                  focused={false}
                  pinBadge={false}
                  onToggle={() => setExpandedNoticeId(prev => prev === n.id ? null : n.id)}
                />
              )
            )}
          </Callout>
        </div>
      )}

      {error && <div className="text-center py-8" style={{ color: 'var(--danger-text)' }}>{error}</div>}

      {!loading && !error && filteredEntries.length === 0 && (
        <div className="text-center py-16" style={{ color: 'var(--text-muted)' }}>
          <p className="text-xs">
            {(isSearching || serverSearchQuery) ? t('home_search_empty') : t('home_empty')}
          </p>
          {!isSearching && user && (
            <button onClick={() => openNewLog()}
              className="hover:underline mt-2 inline-block"
              style={{ color: 'var(--text-link)' }}
            >{t('home_empty_sub')}</button>
          )}
        </div>
      )}

      {/* Continue (이어쓰기) — opens as a draft card at the top of the list. */}
      {logFormReq?.fromId && (
        <div className="rounded-xl border shadow-sm p-4 mb-3"
             style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-focus)' }}>
          <LogForm
            embeddedFromId={logFormReq.fromId}
            onSaved={(newId) => { clearLogForm(); fetchEntries(page); if (newId) setExpandedId(newId) }}
            onCancel={() => clearLogForm()}
          />
        </div>
      )}

      {/* Edit of a log that isn't on the current page — editor card at the top. */}
      {logFormReq?.editId && !filteredEntries.some(e => e.id === logFormReq.editId) && (
        <div className="rounded-xl border shadow-sm p-4 mb-3"
             style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-focus)' }}>
          <LogForm
            embeddedEditId={logFormReq.editId}
            onSaved={() => handleEditorSaved(logFormReq.editId)}
            onCancel={() => handleEditorCancel(logFormReq.editId)}
          />
        </div>
      )}

      {/* Log feed — kit LogList renders entries in (monotonic) array order with
          the configurable group-by divider (#8); renderEntry stays as elog glue
          (inline edit, expanded card, focus). */}
      <LogList
        entries={filteredEntries}
        groupBy={groupBy}
        reverse={false}
        gap={viewMode === 'brief' ? 2 : 12}
        renderItem={(e, idx) => {
          // Inline edit — the open log card turns into an editable form in place.
          const inner = logFormReq?.editId === e.id ? (
            <div className="rounded-xl border-2 shadow-md overflow-hidden"
                 style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-focus)' }}>
              <EditCardHeader entry={e} />
              <div className="p-4">
                <LogForm embeddedEditId={e.id} onSaved={() => handleEditorSaved(e.id)} onCancel={() => handleEditorCancel(e.id)} />
              </div>
            </div>
          ) : expandedId === e.id ? (
            <ErrorBoundary>
              <LogCardExpanded
                entry={e}
                focused={(cmdMode || barMode === BAR_GOTO) && focusedIdx === idx}
                refreshTrigger={commentRefresh}
                onClose={() => setExpandedId(null)}
                onNoticeToggled={() => { fetchEntries(page); fetchNotices() }}
                onDeleted={() => { setExpandedId(null); fetchEntries(page) }}
                onComment={(logId) => commentLog(logId)}
              />
            </ErrorBoundary>
          ) : (
            <LogCard
              entry={e}
              viewMode={viewMode}
              focused={(cmdMode || barMode === BAR_GOTO) && focusedIdx === idx}
              onToggle={() => { setFocusedIdx(idx); setExpandedId(prev => prev === e.id ? null : e.id) }}
            />
          )
          // Stable wrapper carrying the scroll target id (used by focus/open follow).
          return <div key={e.id} id={`log-card-${e.id}`}>{inner}</div>
        }}
      />

      {!isSearching && (
        <Pagination page={page} pageSize={pageSize} total={total}
          onPageChange={p => setPage(p)} loading={loading}
          labels={{ prev: t('page_prev'), next: t('page_next'), info: (p, tp, tot) => t('page_info', p, tp, tot) }} />
      )}

      {/* Tiny `_<n>` goto bubble — opened by a lone `g` (gg jumps to top instead). */}
      {miniGoto !== null && (
        <div style={{ position: 'fixed', left: '50%', bottom: 54, transform: 'translateX(-50%)', zIndex: 50,
          display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', borderRadius: 999,
          backgroundColor: 'var(--nav-bg)', color: 'var(--nav-text)', boxShadow: '0 4px 16px rgba(0,0,0,0.28)' }}>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-small, 12px)', color: 'var(--nav-text-muted)' }}>_</span>
          <input
            ref={miniRef} value={miniGoto} inputMode="numeric" autoFocus
            onChange={(e) => setMiniGoto(e.target.value.replace(/[^0-9]/g, ''))}
            onBlur={() => setMiniGoto(null)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault(); const n = parseInt(miniGoto, 10)
                if (!Number.isNaN(n)) window.dispatchEvent(new CustomEvent('lilak:cmd:find-log', { detail: { logIndex: n } }))
                setMiniGoto(null)
              } else if (e.key === 'Escape') {
                e.preventDefault(); e.stopPropagation(); setMiniGoto(null)
              } else if (e.key === 'g' && miniGoto === '') {
                // a slow gg: a g typed in the still-empty bubble jumps to the top
                e.preventDefault(); setMiniGoto(null)
                if (focusedIdx === 0) window.scrollTo({ top: 0, behavior: 'smooth' })
                else { setFocusedIdx(0); setTimeout(() => scrollToFocused(0), 0) }
              }
            }}
            placeholder={t('mini_goto_ph') || '번호'}
            style={{ width: 54, background: 'transparent', border: 'none', outline: 'none', color: 'var(--nav-text)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-small, 12px)' }} />
        </div>
      )}

    </div>
  )
}
