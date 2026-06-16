import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { LogToolbar, LogList, Pagination, useTaggables, tagColors, Icon, ChipGroup, Callout, Button, openBarInput, closeBarInput } from 'lilak-ui'
import api, { getExperiment } from '../api'
import LogCard from '../components/LogCard'
import LogCardExpanded from '../components/LogCardExpanded'
import { RunGroupExpanded } from '../components/RunGroupCard'
import LogForm, { FormatPicker } from './LogForm'
import ErrorBoundary from '../components/ErrorBoundary'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { useTab } from '../context/TabContext'
import { useTheme } from '../context/ThemeContext'
import { severityStyle } from '../components/EntryShared'

const VIEW_MODES = ['normal', 'run_group']
// Run-group view fetches this many newest logs in one go (the backend's
// max page_size), then paginates the resulting RUN groups client-side so a
// page shows pageSize runs, not logs.
const RUN_GROUP_FETCH = 200

// The header bar shown above the inline editor — keeps "#1004 INFO AUTO"
// visible while editing.
// Just the identity chips (log #, level, category, auto). Rendered inside the
// LogForm top action bar as its `headerBadge`, so the inline editor is one box.
function EditCardHeader({ entry }) {
  const level = entry.level || 'info'
  return (
    <>
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
    </>
  )
}

// Feed-display prefs are per-experiment — they must not bleed across projects
// (all projects share one browser origin). Keys are suffixed with the current
// experiment; the legacy un-suffixed value is used as a one-time fallback so a
// user's existing choice carries over the first time.
const expLS = {
  get(base, fallback) {
    return localStorage.getItem(`${base}:${getExperiment()}`)
        ?? localStorage.getItem(base)
        ?? fallback
  },
  set(base, v) { localStorage.setItem(`${base}:${getExperiment()}`, v) },
}

function getSavedViewMode() {
  const saved = expLS.get('elog_view_mode', null)
  // Only Normal + Run group exist now — fold any other stored value to Normal.
  if (saved && !VIEW_MODES.includes(saved)) return 'normal'
  return saved || 'normal'
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
  const [pageSize, setPageSize] = useState(() => Number(expLS.get('elog_page_size', 20)) || 20)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [viewMode, setViewMode] = useState(getSavedViewMode)
  const [groupBy, setGroupBy] = useState(() => expLS.get('elog_group_by', 'run'))
  function changeGroupBy(g) { setGroupBy(g); expLS.set('elog_group_by', g) }

  // ── Multi-open feed state ────────────────────────────────────────────────────
  // Any number of entries can be open at once (both Normal and Run-group views).
  // `openAll` is ONE shared master default (not per-mode) — switching between
  // Normal and Run group must not change it. `seenRef` lets new entries follow
  // that default while manual toggles persist.
  const [openIds, setOpenIds] = useState(() => new Set())
  const seenRef = useRef(new Set())
  const [openAll, setOpenAll] = useState(() => expLS.get('elog_open_all', 'false') !== 'false')
  const [commentTargetId, setCommentTargetId] = useState(null)   // log the bottom comment bar targets
  const [formats, setFormats] = useState([])
  const isOpen = (id) => openIds.has(id)
  const openOne = useCallback((id) => setOpenIds(p => { if (p.has(id)) return p; const n = new Set(p); n.add(id); return n }), [])
  const closeOne = useCallback((id) => setOpenIds(p => { if (!p.has(id)) return p; const n = new Set(p); n.delete(id); return n }), [])
  const toggleOpen = useCallback((id) => setOpenIds(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n }), [])

  // ── Command mode ─────────────────────────────────────────────────────────────
  const [cmdMode, setCmdMode] = useState(true)
  const [focusedIdx, setFocusedIdx] = useState(0)
  // `g` gesture: a quick double-tap (gg) jumps to the top; a single `g` opens the
  // bottom bar's circle into a tiny `_<n>` goto bubble (compact CommandBar mode).
  const gTapRef = useRef(0)
  const gTimerRef = useRef(null)

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
    expLS.set('elog_view_mode', m)
    // Switching modes must NOT change the open/close setting (openAll). Just
    // reset which specific entries are open; the default-open effect re-applies
    // the (unchanged) openAll to the new mode's entries.
    seenRef.current = new Set()
    setOpenIds(new Set())
    setFocusedIdx(0)
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

  // ── Feed entries (computed up here so the nav/effects below can use them) ────
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

  // Run-group view: merge logs sharing a run number into ONE synthetic entry,
  // shaped exactly like a log so the SAME LogCard / LogCardExpanded kit renders
  // it. Title "Run #N", run badges from the run, author = every author; the
  // per-log content lives in `_runLogs` and is shown in the expanded body.
  const runEntriesAll = useMemo(() => {
    if (viewMode !== 'run_group') return []
    const byKey = new Map()
    for (const e of filteredEntries) {
      const key = e.run_number != null ? `run:${e.run_number}` : `log:${e.id}`
      if (!byKey.has(key)) byKey.set(key, [])
      byKey.get(key).push(e)
    }
    const out = []
    for (const [key, logs] of byKey) {
      logs.sort((a, b) => new Date(a.created_at) - new Date(b.created_at))   // oldest → newest
      const run = logs[0].run_number
      const authors = [...new Set(logs.map(l => l.author_name).filter(Boolean))].join(', ')
      const latest = Math.max(...logs.map(l => new Date(l.created_at).getTime() || 0))
      out.push({
        id: key, _runLogs: logs,
        log_index: run,
        title: run != null ? `Run #${run}` : (logs[0].title || `_${logs[0].log_index ?? logs[0].id}`),
        run_number: run, run_number_type: 'single',
        beam: logs.find(l => l.beam)?.beam || '', target: logs.find(l => l.target)?.target || '',
        level: 'info', author_name: authors || logs[0].author_name,
        created_at: new Date(latest).toISOString(),
        tags: [], attachment_count: logs.reduce((s, l) => s + (l.attachment_count || 0), 0),
        _latest: latest,
      })
    }
    out.sort((a, b) => b._latest - a._latest)   // newest activity first
    return out
  }, [filteredEntries, viewMode])

  // Paginate the runs themselves: a page shows `pageSize` run groups.
  const runEntries = useMemo(() => {
    const start = (page - 1) * pageSize
    return runEntriesAll.slice(start, start + pageSize)
  }, [runEntriesAll, page, pageSize])

  const feedEntries = viewMode === 'run_group' ? runEntries : filteredEntries
  const feedTotal = viewMode === 'run_group' ? runEntriesAll.length : total

  // Format defs (field labels) — fetched once when the run-group view is active.
  useEffect(() => {
    if (viewMode === 'run_group' && formats.length === 0) {
      api.get('/formats').then(r => setFormats(r.data || [])).catch(() => {})
    }
  }, [viewMode, formats.length])

  // Default-open new entries per the per-mode master toggle (pure updater so it
  // stays correct under StrictMode); manual toggles persist.
  useEffect(() => {
    const unseen = feedEntries.filter(e => !seenRef.current.has(e.id))
    if (!unseen.length) return
    unseen.forEach(e => seenRef.current.add(e.id))
    if (openAll) setOpenIds(prev => { const n = new Set(prev); unseen.forEach(e => n.add(e.id)); return n })
  }, [feedEntries, openAll])

  // Master Open/Close: flip the shared default AND apply it to all at once.
  // Mark every current entry "seen" so the default-open effect can't re-open
  // them after a close (the toggle is authoritative).
  function toggleOpenAll() {
    const next = !openAll
    setOpenAll(next); expLS.set('elog_open_all', String(next))
    seenRef.current = new Set(feedEntries.map(e => e.id))
    setOpenIds(next ? new Set(feedEntries.map(e => e.id)) : new Set())
  }

  function clamp(idx) { return Math.max(0, Math.min(feedEntries.length - 1, idx)) }

  // Open mode (openAll): multi-open — moving focus leaves open entries open.
  // Close mode: a SINGLE open entry follows focus — the newly-focused one opens
  // and the previous one closes (the classic single-expand behaviour).
  function moveFocus(delta) {
    setFocusedIdx(prev => {
      const next = clamp(prev + delta)
      if (!openAll) {
        setOpenIds(cur => cur.size === 0 ? cur : (feedEntries[next] ? new Set([feedEntries[next].id]) : new Set()))
      }
      return next
    })
  }

  function jumpFocus(idx) {
    if (!feedEntries[idx]) return
    setFocusedIdx(idx)
    if (!openAll) setOpenIds(cur => cur.size === 0 ? cur : new Set([feedEntries[idx].id]))
    setTimeout(() => scrollToFocused(idx), 0)
  }

  // A lone `g` opens the bottom bar's collapsed circle into a tiny `_<n>` goto
  // bubble (compact mode), same colour as the circle. Enter opens that log #; a
  // `g` typed while it's still empty is a slow `gg` → jump to the top.
  function openGotoBubble() {
    // Closing the bubble (Enter / Esc / blur) returns straight to command mode so
    // a single Esc resumes arrow-key navigation (no second press needed).
    const resume = () => { closeBarInput(); enterCmdMode() }
    openBarInput({
      key: `goto-${Date.now()}`, compact: true, label: '_', placeholder: '', inputMode: 'numeric',
      onSubmit: (v) => {
        const n = parseInt(String(v).replace(/[^0-9]/g, ''), 10)
        if (!Number.isNaN(n)) window.dispatchEvent(new CustomEvent('lilak:cmd:find-log', { detail: { logIndex: n } }))
        resume()
      },
      onCancel: resume,
      onKeyDown: (e, val) => {
        if (e.key === 'g' && !val) {
          e.preventDefault()
          if (focusedIdx === 0) { resume(); window.scrollTo({ top: 0, behavior: 'smooth' }) }
          else { resume(); jumpFocus(0) }
        }
      },
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
        { const f = feedEntries[focusedIdx]; if (f && openIds.has(f.id)) { e.preventDefault(); closeOne(f.id); return } }
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
          { const last = feedEntries.length - 1; if (last < 0) break
            if (focusedIdx === last) window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
            else jumpFocus(last) }
          break
        case 'Home':
          // Home → newest = index 0 (top). Two-step: second Home scrolls to the very top.
          e.preventDefault()
          if (focusedIdx === 0) window.scrollTo({ top: 0, behavior: 'smooth' })
          else jumpFocus(0)
          break
        case '{':
          e.preventDefault()
          if (page > 1) { setPage(p => p - 1); setFocusedIdx(0) }
          break
        case '}':
          e.preventDefault()
          { const totalPages = Math.ceil(feedTotal / pageSize); if (page < totalPages) { setPage(p => p + 1); setFocusedIdx(0) } }
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
          // gg (quick double-tap) → jump to the top, no bubble. A lone g opens the
          // bottom bar's circle into a tiny `_<n>` goto bubble.
          e.preventDefault()
          const now = Date.now()
          if (now - gTapRef.current < 350) {
            gTapRef.current = 0
            if (gTimerRef.current) { clearTimeout(gTimerRef.current); gTimerRef.current = null }
            // two-step: first jump to the top entry; a second gg goes to the very top.
            if (focusedIdx === 0) window.scrollTo({ top: 0, behavior: 'smooth' })
            else jumpFocus(0)
          } else {
            gTapRef.current = now
            if (gTimerRef.current) clearTimeout(gTimerRef.current)
            gTimerRef.current = setTimeout(() => {
              gTapRef.current = 0; gTimerRef.current = null
              openGotoBubble()
            }, 320)
          }
          break
        }
        case 'o':
        case ' ': {
          e.preventDefault()
          const f = feedEntries[focusedIdx]
          if (!f) break
          // Open mode → toggle this one (others stay). Close mode → single open.
          if (openAll) toggleOpen(f.id)
          else setOpenIds(cur => cur.has(f.id) ? new Set() : new Set([f.id]))
          break
        }
        case 'r':
        case ',':
        case 'Tab': {
          e.preventDefault()
          const f = feedEntries[focusedIdx]; if (!f || typeof f.id !== 'number') break
          // Open the focused log + comment via the collapsible bottom bar.
          if (openAll) openOne(f.id); else setOpenIds(new Set([f.id]))
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
  }, [cmdMode, focusedIdx, openIds, feedEntries, openAll, user, openNewLog, cycleTheme])

  // New page / refetch / mode switch: reset focus + open state; the default-open
  // effect below repopulates per the (per-mode) master toggle.
  // New data → reset focus to the top. Open state persists across refetch; the
  // default-open effect adds any genuinely-new entry ids. Mode switches reset
  // open state in changeViewMode (so it doesn't clobber the default-open pass).
  useEffect(() => { setFocusedIdx(0) }, [entries])

  // The comment bar belongs to an open log — if nothing is open, close it so it
  // can't get stuck after the entry is collapsed/closed. Also close on unmount
  // (leaving the logs tab).
  useEffect(() => { if (openIds.size === 0 && expandedNoticeId == null) closeBarInput() }, [openIds, expandedNoticeId])
  useEffect(() => () => closeBarInput(), [])

  // Keep the focused entry on screen. On tab-entry / new data this scrolls to
  // the focused (newest, index 0 = top of the feed); on arrow nav it
  // follows the cursor; when an entry is open it scrolls that entry into view —
  // top-aligned if it's taller than the viewport so its start is visible.
  useEffect(() => {
    const targetId = feedEntries[focusedIdx]?.id
    if (targetId == null) return
    const id = setTimeout(() => {
      const el = document.getElementById(`log-card-${targetId}`)
      if (!el) return
      const avail = window.innerHeight - 110   // minus fixed top + command bars
      const tall = el.getBoundingClientRect().height > avail
      // a focused entry that's open and taller than the viewport is top-aligned
      // so its start shows; otherwise just nudge it fully into view.
      el.scrollIntoView({ behavior: 'auto', block: (openIds.has(targetId) && tall) ? 'start' : 'nearest' })
    }, 60)
    return () => clearTimeout(id)
  }, [focusedIdx, openIds, feedEntries])
  useEffect(() => { if (openIds.size === 0 && barMode === BAR_COMMENT) enterCmdMode() }, [openIds])

  // Command palette → Home dispatch handlers
  useEffect(() => {
    function onGoto(e) {
      const n = e.detail?.number; if (!n) return
      gotoById(String(n))
    }
    function onOpenLog(e) {
      const id = e.detail?.id; if (!id) return
      // Find the feed entry to open: the log itself (Normal) or the run group
      // that contains it (Run-group view).
      const idx = feedEntries.findIndex(en => en.id === id || (en._runLogs && en._runLogs.some(l => l.id === id)))
      if (idx >= 0) {
        const target = feedEntries[idx]
        setFocusedIdx(idx)
        openOne(target.id)
        setTimeout(() => {
          document.getElementById(`log-card-${target.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        }, 50)
      } else {
        // Log not on the current page — narrow the list to that log and expand
        // it. Filter by log_index (exact match); '#id' as a q= search would be
        // an FTS syntax error and wouldn't match the log anyway.
        api.get(`/logs/${id}`).then((res) => {
          const logIndex = res.data?.log_index
          if (logIndex != null) { setServerSearchQuery(''); setCmdFilter({ logIndex }) }
          openOne(Number(id))
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
      const f = feedEntries[focusedIdx]; if (f && typeof f.id === 'number') openNewLog({ editId: f.id })
    }
    function onContinue() {
      const f = feedEntries[focusedIdx]; if (f && typeof f.id === 'number') openNewLog({ fromId: f.id })
    }
    function onComment(e) {
      const f = feedEntries[focusedIdx]; if (!f || typeof f.id !== 'number') return
      openOne(f.id)
      commentLog(f.id, { text: e.detail?.text || '' })
    }
    function onReport(e) {
      const id = e.detail?.id; if (id == null) return
      openOne(id)
      commentLog(id, { report: true })
    }
    // `/search <q>` from the kit command bar → full-text log search (empty = clear).
    function onLogSearch(e) {
      const q = (e.detail?.q || '').trim()
      setSearchQuery(''); setCmdFilter(null); setServerSearchQuery(q); setPage(1)
    }
    function onToggleOpen() {
      const f = feedEntries[focusedIdx]; if (!f) return
      toggleOpen(f.id)
    }
    function onCopy() {
      const f = feedEntries[focusedIdx]; if (!f || typeof f.id !== 'number') return
      navigator.clipboard?.writeText(`${location.origin}/logs/${f.id}`)
    }
    function onViewMode(e) {
      const m = e.detail?.mode; if (m) changeViewMode(m)
    }
    function onDeleteFocused() {
      const f = feedEntries[focusedIdx]; if (!f || typeof f.id !== 'number') return
      if (!window.confirm(`Delete log #${f.id}?`)) return
      api.delete(`/logs/${f.id}`).then(() => fetchEntries(page))
    }
    function onRestoreFocused() {
      const f = feedEntries[focusedIdx]; if (!f || typeof f.id !== 'number') return
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
      jumpFocus(0)
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
  }, [feedEntries, focusedIdx, page]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── Pending log from another tab (e.g. "view" after Request Log) ────────────
  useEffect(() => {
    if (!pendingLogId || loading) return
    const entry = entries.find(e => e.id === pendingLogId)
    if (entry) {
      openOne(pendingLogId)
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

  const PAGE_SIZES = [10, 20, 50]

  function changePageSize(n) {
    setPageSize(n)
    expLS.set('elog_page_size', n)
    setPage(1)
    setFocusedIdx(0)
  }

  const fetchEntries = useCallback(async (p = 1) => {
    setLoading(true); setError(null)
    try {
      // Run-group view paginates by RUN, not by log. Fetch a big batch of logs
      // (newest first) so grouping yields enough runs to fill the page; runs are
      // then sliced client-side. Normal view paginates by log as usual.
      const rg = viewMode === 'run_group'
      const params = rg ? { page: 1, page_size: RUN_GROUP_FETCH } : { page: p, page_size: pageSize }
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
  }, [activeTag, activeCategory, activeSource, serverSearchQuery, cmdFilter, pageSize, viewMode])

  useEffect(() => { fetchEntries(1); setPage(1) }, [activeTag, activeCategory, activeSource, serverSearchQuery, cmdFilter, pageSize, viewMode])
  // Page change refetches only in Normal view; Run group paginates runs client-side.
  useEffect(() => { if (viewMode !== 'run_group') fetchEntries(page) }, [page])

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
    if (!body || !commentTargetId || commentSubmitting) return
    setCommentSubmitting(true)
    try {
      await api.post(`/logs/${commentTargetId}/comments`, { body, report: reportMode })
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
    openOne(id)
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
        actions={<>
          <Button variant={openAll ? 'info' : 'secondary'} size="md" onClick={toggleOpenAll}
            title={openAll ? '모두 닫기 (close 모드로)' : '모두 열기 (open 모드로)'}>{openAll ? 'Close' : 'Open'}</Button>
          {user && <>
            <Button variant="secondary" size="md" onClick={() => openSettings('formats')}>Manage Formats</Button>
            <Button variant="success" size="md" onClick={() => openNewLog()}>{t('home_new')}</Button>
          </>}
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
            onSaved={(newId) => { clearLogForm(); fetchEntries(page); if (newId) openOne(newId) }}
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

      {/* One feed for BOTH modes — same kit (LogCard collapsed / LogCardExpanded
          expanded). Run-group entries are synthetic (e._runLogs); only their
          content differs, rendered via RunGroupExpanded (kit LogDetail). */}
      {feedEntries.length === 0 && !loading && (
        <p style={{ textAlign: 'center', padding: '40px 0', fontSize: 'var(--fs-body, 13px)', color: 'var(--text-muted)' }}>{t('home_empty')}</p>
      )}
      <LogList
        entries={feedEntries}
        groupBy={viewMode === 'run_group' ? 'none' : groupBy}
        reverse={false}
        gap={2}
        renderItem={(e, idx) => {
          const focused = (cmdMode || barMode === BAR_GOTO) && focusedIdx === idx
          let inner
          if (e._runLogs) {
            // Run-group synthetic entry — same kit, merged content.
            inner = isOpen(e.id)
              ? <RunGroupExpanded entry={e} formats={formats} focused={focused} onClose={() => closeOne(e.id)} />
              : <LogCard entry={e} viewMode="brief" showIndex={false} focused={focused} onToggle={() => { setFocusedIdx(idx); toggleOpen(e.id) }} />
          } else if (logFormReq?.editId === e.id) {
            // Inline edit — ONE box: the form renders flat (no inner box), with the
            // log # in its top action bar and Cancel/Save in both the top and footer.
            inner = (
              <div className="rounded-xl border-2 shadow-md overflow-hidden"
                   style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-focus)' }}>
                <LogForm embeddedEditId={e.id} flat headerBadge={<EditCardHeader entry={e} />}
                  onSaved={() => handleEditorSaved(e.id)} onCancel={() => handleEditorCancel(e.id)} />
              </div>
            )
          } else if (isOpen(e.id)) {
            inner = (
              <ErrorBoundary>
                <LogCardExpanded
                  entry={e}
                  focused={focused}
                  refreshTrigger={commentRefresh}
                  onClose={() => closeOne(e.id)}
                  onNoticeToggled={() => { fetchEntries(page); fetchNotices() }}
                  onDeleted={() => { closeOne(e.id); fetchEntries(page) }}
                  onComment={(logId) => commentLog(logId)}
                />
              </ErrorBoundary>
            )
          } else {
            inner = (
              <LogCard
                entry={e}
                viewMode="brief"
                focused={focused}
                onToggle={() => { setFocusedIdx(idx); toggleOpen(e.id) }}
              />
            )
          }
          // Stable wrapper carrying the scroll target id (used by focus/open follow).
          return <div key={e.id} id={`log-card-${e.id}`}>{inner}</div>
        }}
      />

      {!isSearching && (
        <Pagination page={page} pageSize={pageSize} total={feedTotal}
          onPageChange={p => setPage(p)} loading={loading}
          labels={{ prev: t('page_prev'), next: t('page_next'), info: (p, tp, tot) => t('page_info', p, tp, tot) }} />
      )}

    </div>
  )
}
