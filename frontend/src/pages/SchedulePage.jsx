import { useState, useEffect, useCallback, useRef } from 'react'
import { SubTabs } from 'lilak-ui'
import { btnPrimary, btnPrimaryHover, modalFrame, modalOverlay, hoverify } from '../theme/uiStyles'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import MonthView from './schedule/MonthView'
import TimelineView from './schedule/TimelineView'
import TimelineVerticalView from './schedule/TimelineVerticalView'
import EventModal from './schedule/EventModal'
import ShiftPatternsManager from './schedule/ShiftPatternsManager'
import FreeUsersManager from './schedule/FreeUsersManager'

const EVENT_TYPE_COLORS = {
  experiment: 'bg-blue-100 text-blue-700 border-blue-200',
  shift:      'bg-emerald-100 text-emerald-700 border-emerald-200',
  other:      'bg-slate-100 text-slate-700 border-slate-200',
  run:        'bg-purple-100 text-purple-700 border-purple-200',
}

export default function SchedulePage() {
  const { user } = useAuth()
  const { t } = useLang()
  const [mode, setMode]       = useState('timeline')
  const [filter, setFilter]   = useState('all')
  const [events, setEvents]   = useState([])
  const [runs, setRuns]       = useState([])
  const [patterns, setPatterns]     = useState([])
  const [activePattern, setActive]  = useState(null)
  const [freeUsers, setFreeUsers]   = useState([])
  const [assignments, setAssignments] = useState([])
  const [allUsers, setAllUsers]     = useState([])
  const [authorLogs, setAuthorLogs] = useState([])
  const [modal, setModal]     = useState(null)
  const [anchor, setAnchor]   = useState(() => new Date())
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const start = new Date(anchor); start.setDate(1); start.setMonth(start.getMonth() - 1)
    const end   = new Date(anchor); end.setDate(1);   end.setMonth(end.getMonth() + 2)
    const startISO = start.toISOString()
    const endISO   = end.toISOString()
    const dFrom    = startISO.slice(0, 10)
    const dTo      = endISO.slice(0, 10)
    try {
      const [eRes, rRes, pRes, apRes, fuRes, asRes, uRes, alRes] = await Promise.all([
        api.get('/schedule/events',     { params: { start: startISO, end: endISO } }),
        api.get('/schedule/runs',       { params: { start: startISO, end: endISO } }),
        api.get('/schedule/shift-patterns'),
        api.get('/schedule/active-pattern'),
        api.get('/schedule/free-users'),
        api.get('/schedule/assignments',{ params: { date_from: dFrom, date_to: dTo } }),
        api.get('/users/public'),
        api.get('/schedule/author-logs',{ params: { date_from: startISO, date_to: endISO } }),
      ])
      setEvents(eRes.data)
      setRuns(rRes.data)
      setPatterns(pRes.data)
      setActive(apRes.data)
      setFreeUsers(fuRes.data)
      setAssignments(asRes.data)
      setAllUsers(uRes.data)
      setAuthorLogs(alRes.data)
    } catch (e) { /* silent */ }
    finally { setLoading(false) }
  }, [anchor])

  useEffect(() => { load() }, [load])

  const reloadAssignments = useCallback(async () => {
    const start = new Date(anchor); start.setDate(1); start.setMonth(start.getMonth() - 1)
    const end   = new Date(anchor); end.setDate(1);   end.setMonth(end.getMonth() + 2)
    const r = await api.get('/schedule/assignments', {
      params: { date_from: start.toISOString().slice(0,10), date_to: end.toISOString().slice(0,10) }
    })
    setAssignments(r.data)
  }, [anchor])

  function openCreate(opts = {}) {
    setModal({ create: true, ...opts })
  }
  function closeModal() { setModal(null); load() }

  function shiftAnchor(delta) {
    const next = new Date(anchor)
    if (mode === 'month') next.setMonth(next.getMonth() + delta)
    else                  next.setDate(next.getDate() + delta * 10)   // 10일 단위
    setAnchor(next)
  }
  function todayAnchor() { setAnchor(new Date()) }

  // ── Keyboard: T for today, {/} for subtab cycling ───────────────────────
  const SCHED_MODES = ['month', 'timeline', 'timeline-v']
  useEffect(() => {
    function onKey(e) {
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      if (inInput || modal) return
      if (e.key === 't' || e.key === 'T') { e.preventDefault(); todayAnchor(); return }
      if (e.key === '{' || e.key === '}') {
        e.preventDefault()
        setMode(prev => {
          const idx = SCHED_MODES.indexOf(prev)
          const next = SCHED_MODES[idx + (e.key === '{' ? -1 : 1)]
          return next ?? prev
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [anchor, mode, modal])

  // Day-summary modal (placeholder for now)
  const [summaryDate, setSummaryDate] = useState(null)
  useEffect(() => {
    function onSummary(e) { if (e.detail?.date) setSummaryDate(new Date(e.detail.date)) }
    window.addEventListener('lilak:sched:day-summary', onSummary)
    return () => window.removeEventListener('lilak:sched:day-summary', onSummary)
  }, [])

  // ── Command palette dispatch handlers ────────────────────────────────────
  useEffect(() => {
    function onToday() { setAnchor(new Date()) }
    function onMode(e) { if (e.detail?.mode) setMode(e.detail.mode) }
    function onZoom(e) {
      const d = e.detail?.days
      if (!d) return
      // Forward `days` directly to the active timeline view
      window.dispatchEvent(new CustomEvent('lilak:sched:set-zoom', { detail: { days: d } }))
    }
    function onNewEvent(e) { openCreate({ defaultDate: new Date(), title: e.detail?.title || '' }) }
    function onShift(e) {
      // Simple stub: open create modal with shift type + slot label
      openCreate({ defaultDate: new Date(), event_type: 'shift', slot: e.detail?.slot })
    }
    window.addEventListener('lilak:cmd:sched-today',     onToday)
    window.addEventListener('lilak:cmd:sched-mode',      onMode)
    window.addEventListener('lilak:cmd:sched-zoom',      onZoom)
    window.addEventListener('lilak:cmd:sched-new-event', onNewEvent)
    window.addEventListener('lilak:cmd:sched-shift',     onShift)
    return () => {
      window.removeEventListener('lilak:cmd:sched-today',     onToday)
      window.removeEventListener('lilak:cmd:sched-mode',      onMode)
      window.removeEventListener('lilak:cmd:sched-zoom',      onZoom)
      window.removeEventListener('lilak:cmd:sched-new-event', onNewEvent)
      window.removeEventListener('lilak:cmd:sched-shift',     onShift)
    }
  }, [])

  const filtered = filter === 'all'
    ? events
    : filter === 'run' ? []
    : filter === 'shift' ? events.filter(e => e.event_type === 'shift')   // legacy shift events
    : events.filter(e => e.event_type === filter)
  const filteredRuns = (filter === 'all' || filter === 'run') ? runs : []

  return (
    <div className="max-w-7xl mx-auto">
      {/* View sub-tabs — shared kit SubTabs (Month / Horizontal / Vertical) */}
      <SubTabs
        tabs={[['month', t('sched_month')], ['timeline', t('sched_horizontal')], ['timeline-v', t('sched_vertical')]]}
        active={mode} onChange={setMode}
      />
      {/* Toolbar */}
      <div className="flex items-center gap-2 gap-y-2 min-h-10 mb-3 mt-3 px-1 flex-wrap">
        <div className="flex items-center gap-1">
          <button onClick={() => shiftAnchor(-1)}
            className="h-8 w-8 rounded transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = 'var(--text-secondary)' }}>←</button>
          <button onClick={todayAnchor}
            className="h-8 px-3 text-xs rounded transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--surface-2)'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}>{t('sched_today')}</button>
          <button onClick={() => shiftAnchor(1)}
            className="h-8 w-8 rounded transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--surface-2)'; e.currentTarget.style.color = 'var(--text-primary)' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = ''; e.currentTarget.style.color = 'var(--text-secondary)' }}>→</button>
          <span className="ml-3 text-sm" style={{ color: 'var(--text-primary)' }}>
            {mode === 'month'
              ? t('sched_year_month', { year: anchor.getFullYear(), month: anchor.getMonth() + 1 })
              : t('sched_year_month_day', { year: anchor.getFullYear(), month: anchor.getMonth() + 1, day: anchor.getDate() })}
          </span>
        </div>

        <div className="flex items-center gap-1 ml-auto">
          {[
            { id: 'all',        label: t('sched_filter_all') },
            { id: 'experiment', label: t('sched_filter_experiment') },
            { id: 'shift',      label: t('sched_filter_shift') },
            { id: 'run',        label: t('sched_filter_run') },
          ].map(f => (
            <button key={f.id} onClick={() => setFilter(f.id)}
              className="h-8 px-2.5 text-xs rounded transition-colors"
              style={filter === f.id
                ? { backgroundColor: 'var(--surface-3)', color: 'var(--text-primary)' }
                : { color: 'var(--text-secondary)' }}
              onMouseEnter={e => { if (filter !== f.id) e.currentTarget.style.backgroundColor = 'var(--surface-2)' }}
              onMouseLeave={e => { if (filter !== f.id) e.currentTarget.style.backgroundColor = '' }}
            >{f.label}</button>
          ))}
        </div>

        {user?.role === 'manager' && (
          <ManageMenu
            onPatterns={() => setModal('patterns')}
            onUsers={() => setModal('free-users')}
            onClearAll={async () => {
              if (!window.confirm('정말 모든 쉬프트 등록을 삭제하시겠습니까? 되돌릴 수 없습니다.')) return
              try {
                const r = await api.delete('/schedule/assignments')
                await reloadAssignments()
                window.alert(`${r.data?.deleted ?? 0}건의 쉬프트 등록을 삭제했습니다.`)
              } catch (e) {
                window.alert('삭제 실패: ' + (e.response?.data?.detail || e.message))
              }
            }}
            label={t('sched_btn_manage') || 'Manage'}
          />
        )}
        {user && (
          <button onClick={() => openCreate()}
            className="h-8 px-3 rounded-lg text-xs transition-colors"
            style={btnPrimary}
            {...hoverify(btnPrimary, btnPrimaryHover)}>{t('sched_btn_new_event')}</button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-16 text-xs" style={{ color: 'var(--text-muted)' }}>{t('sched_loading')}</div>
      ) : mode === 'month' ? (
        <MonthView
          anchor={anchor} events={filtered} runs={filteredRuns}
          colors={EVENT_TYPE_COLORS}
          onDayClick={(d) => openCreate({ defaultDate: d })}
          onEventClick={(ev) => setModal({ create: false, event: ev })}
          onDaySummary={(d) => setSummaryDate(d)}
        />
      ) : mode === 'timeline-v' ? (
        <TimelineVerticalView
          anchor={anchor} events={filtered} runs={filteredRuns}
          colors={EVENT_TYPE_COLORS}
          currentUser={user}
          activePattern={activePattern}
          freeUsers={freeUsers}
          assignments={assignments}
          allUsers={allUsers}
          authorLogs={authorLogs}
          onEventClick={(ev) => setModal({ create: false, event: ev })}
          onCreateEvent={(opts) => openCreate(opts)}
          onReloadAssignments={reloadAssignments}
        />
      ) : (
        <TimelineView
          anchor={anchor} events={filtered} runs={filteredRuns}
          patterns={patterns} colors={EVENT_TYPE_COLORS}
          currentUser={user}
          activePattern={activePattern}
          freeUsers={freeUsers}
          assignments={assignments}
          allUsers={allUsers}
          authorLogs={authorLogs}
          onEventClick={(ev) => setModal({ create: false, event: ev })}
          onCreateEvent={(opts) => openCreate(opts)}
          onReloadAssignments={reloadAssignments}
          onReloadFreeUsers={() => api.get('/schedule/free-users').then(r => setFreeUsers(r.data))}
        />
      )}

      {modal && modal.create !== undefined && (
        <EventModal
          initial={modal.event || null}
          defaultDate={modal.defaultDate || null}
          defaultStart={modal.start_at || null}
          defaultEnd={modal.end_at || null}
          defaultType={modal.event_type || null}
          patterns={patterns}
          users={allUsers}
          onSave={closeModal}
          onClose={() => setModal(null)}
          onDelete={closeModal}
        />
      )}
      {modal === 'patterns' && (
        <ShiftPatternsManager
          patterns={patterns} activePattern={activePattern}
          onClose={() => { setModal(null); load() }}
        />
      )}
      {modal === 'free-users' && (
        <FreeUsersManager
          freeUsers={freeUsers}
          onClose={() => { setModal(null); load() }}
        />
      )}

      {/* Day summary modal — placeholder, just shows the date for now */}
      {summaryDate && (
        <DaySummaryModal date={summaryDate} onClose={() => setSummaryDate(null)} />
      )}
    </div>
  )
}

function ManageMenu({ onPatterns, onUsers, onClearAll, label }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    function onDoc(e) { if (open && ref.current && !ref.current.contains(e.target)) setOpen(false) }
    function onKey(e) { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        className="h-8 px-3 text-xs border rounded inline-flex items-center gap-1 transition-colors"
        style={{ borderColor: 'var(--border-default)', color: 'var(--text-primary)' }}
        onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--surface-2)'}
        onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}>
        {label} <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>▾</span>
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-48 border rounded-lg shadow-lg z-30 py-1"
             style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-default)' }}>
          <button onClick={() => { setOpen(false); onPatterns() }}
            className="w-full text-left px-3 py-1.5 text-xs transition-colors"
            style={{ color: 'var(--text-primary)' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--surface-2)'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}>Patterns</button>
          <button onClick={() => { setOpen(false); onUsers() }}
            className="w-full text-left px-3 py-1.5 text-xs transition-colors"
            style={{ color: 'var(--text-primary)' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--surface-2)'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}>Users</button>
          <div className="h-px my-1" style={{ backgroundColor: 'var(--border-subtle)' }} />
          <button onClick={() => { setOpen(false); onClearAll() }}
            className="w-full text-left px-3 py-1.5 text-xs transition-colors"
            style={{ color: 'var(--danger-text)' }}
            onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--danger-bg)'}
            onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}>Clear all shift registrations</button>
        </div>
      )}
    </div>
  )
}

function DaySummaryModal({ date, onClose }) {
  useEffect(() => {
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const ds = `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4" style={modalOverlay} onClick={onClose}>
      <div className="rounded-2xl shadow-2xl w-full max-w-md mt-20 border" style={modalFrame} onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>날짜 써머리</h2>
          <button onClick={onClose} className="text-xl transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>×</button>
        </div>
        <div className="p-6 space-y-3">
          <div className="text-3xl font-mono" style={{ color: 'var(--text-primary)' }}>{ds}</div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>(써머리 내용은 추후 채워질 예정)</p>
        </div>
      </div>
    </div>
  )
}
