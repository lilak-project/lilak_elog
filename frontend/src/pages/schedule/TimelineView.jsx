/**
 * Horizontal timeline view.
 *
 * Tracks (rows from top to bottom):
 *   ─ 실험        (experiment events)
 *   ─ 런          (runs derived from start/end-of-run logs)
 *   ─ [user row]  (one per registered user) — shift assignments shown as cells
 *   ─ [free user row]
 *
 * Features:
 *   • 4 zoom levels: 1일, 3일, 1주, 2주
 *   • Day boundaries: thick vertical line; hour boundaries: thin lines
 *   • "Today" marker (red line)
 *   • Drag in 실험 track / empty area → create event (snap to hour)
 *   • Click cell in user row → register/unregister own shift slot
 *   • Log markers on shift cells when the user wrote logs during that slot
 */

import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import api from '../../api'
import { useLang } from '../../context/LangContext'
import { useTab } from '../../context/TabContext'
import { roleColorClasses } from './ShiftPatternsManager'
import { combo } from '../../theme/textCombos'

function fire(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

/** Parse pattern.roles into [{name, color}] (supports "name|color" string + object + legacy slot.roles) */
function getPatternRoles(pattern) {
  if (!pattern) return []
  const out = []
  for (const r of (pattern.roles || [])) {
    if (typeof r === 'string') {
      const [name, color] = r.split('|')
      out.push({ name, color: color || 'emerald' })
    } else if (r && typeof r === 'object' && r.name) {
      out.push({ name: r.name, color: r.color || 'emerald' })
    }
  }
  if (out.length === 0) {
    const seen = new Map()
    for (const s of (pattern.slots || [])) {
      for (const r of (s.roles || [])) {
        if (!seen.has(r.name)) seen.set(r.name, { name: r.name, color: r.color || 'emerald' })
      }
    }
    return Array.from(seen.values())
  }
  return out
}

// "zoom" here = number of days visible in the viewport at once.
// Larger zoom → more days fit (each day gets a smaller hour-width).
const ZOOM_MIN = 1
const ZOOM_MAX = 60
const ZOOM_DEFAULT = 7

const TRACK_H   = 36
const HEADER_H  = 44
const LABEL_W   = 144   // left fixed column width

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate()+n); return x }
function sameDay(a, b) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate()
}
function ymd(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`
}

/** Compute slot-time window for date+slot from an active shift pattern. */
function slotWindow(date, slot) {
  const s = new Date(date); s.setHours(slot.start_hour, 0, 0, 0)
  const e = new Date(date); e.setHours(slot.end_hour, 0, 0, 0)
  if (slot.end_hour <= slot.start_hour) e.setDate(e.getDate() + 1)
  return [s, e]
}

export default function TimelineView({
  anchor, events, runs, patterns, colors, currentUser,
  onEventClick, onCreateEvent,
  activePattern, freeUsers, assignments, allUsers, authorLogs,
  onReloadAssignments, onReloadFreeUsers,
}) {
  const { t } = useLang()
  const { activateTab } = useTab()
  const DOW = t('sched_dow')

  function openLogInTab(id) {
    activateTab('logs')
    setTimeout(() => fire('lilak:cmd:open-log', { id }), 100)
  }
  const [daysVisible, setDaysVisible] = useState(ZOOM_DEFAULT)
  const [containerWidth, setContainerWidth] = useState(1200)  // fallback until measured
  const scrollRef = useRef(null)
  const today = new Date()

  // Measure scroll container width so hourWidth can be derived from `daysVisible`
  useEffect(() => {
    if (!scrollRef.current) return
    const el = scrollRef.current
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.max(200, entry.contentRect.width)
        setContainerWidth(w)
      }
    })
    ro.observe(el)
    if (el.clientWidth) setContainerWidth(Math.max(200, el.clientWidth))
    return () => ro.disconnect()
  }, [])

  const hourWidth = containerWidth / (daysVisible * 24)

  // Focused day (for keyboard navigation, ← →) — state declared early so anchor effects work
  const [focusedDay, setFocusedDay] = useState(() => startOfDay(today))

  // Reset focused day to anchor when anchor changes
  useEffect(() => { setFocusedDay(startOfDay(anchor)) }, [+anchor])

  const rangeDays = 60
  const rangeStart = useMemo(() => addDays(startOfDay(anchor), -Math.floor(rangeDays/2)), [anchor])

  const dayWidth  = hourWidth * 24
  const totalWidth = dayWidth * rangeDays

  // Keyboard '=' → +1 day visible; '-' → −1 day visible
  useEffect(() => {
    function onKey(e) {
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      if (inInput) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault()
        setDaysVisible(z => Math.min(ZOOM_MAX, z + 1))
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault()
        setDaysVisible(z => Math.max(ZOOM_MIN, z - 1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ←/→ or h/l: move focused day; space: show day summary
  useEffect(() => {
    function onKey(e) {
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      if (inInput) return
      let delta = 0
      if (e.key === 'ArrowLeft'  || e.key === 'h') delta = -1
      else if (e.key === 'ArrowRight' || e.key === 'l') delta = 1
      else if (e.key === ' ') {
        e.preventDefault()
        window.dispatchEvent(new CustomEvent('lilak:sched:day-summary', { detail: { date: focusedDay } }))
        return
      } else return
      e.preventDefault()
      setFocusedDay(d => addDays(d, delta))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedDay])

  // Auto-scroll horizontally — scroll by exactly one day when the focused day
  // crosses the visible edge (no big jump to viewport 1/3).
  useEffect(() => {
    if (!scrollRef.current) return
    const dayOffset = Math.floor((focusedDay - rangeStart) / 86400000)
    const targetX = dayOffset * dayWidth
    const el = scrollRef.current
    const pad = 4
    if (targetX < el.scrollLeft + pad) {
      el.scrollLeft = targetX - pad                                       // align day to left edge
    } else if (targetX + dayWidth > el.scrollLeft + el.clientWidth - pad) {
      el.scrollLeft = targetX + dayWidth - el.clientWidth + pad           // align day to right edge
    }
  }, [focusedDay, dayWidth, rangeStart])

  useEffect(() => {
    if (!scrollRef.current) return
    const dayOffset = Math.floor((startOfDay(anchor) - rangeStart) / 86400000)
    scrollRef.current.scrollLeft = dayOffset * dayWidth - 80
  }, [anchor, hourWidth, dayWidth, rangeStart])

  // /zoom command → set daysVisible
  useEffect(() => {
    function onSet(e) {
      const d = e.detail?.days
      if (d != null && d >= ZOOM_MIN && d <= ZOOM_MAX) setDaysVisible(d)
    }
    window.addEventListener('lilak:sched:set-zoom', onSet)
    return () => window.removeEventListener('lilak:sched:set-zoom', onSet)
  }, [])

  const timeToX = useCallback((d) => ((new Date(d) - rangeStart) / 3600000) * hourWidth, [rangeStart, hourWidth])
  const xToTime = useCallback((x) => new Date(rangeStart.getTime() + (x / hourWidth) * 3600000), [rangeStart, hourWidth])
  const xToHourSnap = useCallback((x) => {
    const hours = Math.round(x / hourWidth)
    return new Date(rangeStart.getTime() + hours * 3600000)
  }, [rangeStart, hourWidth])

  // ── Drag-to-create + role picker state ────────────────────────────────────
  const [drag, setDrag] = useState(null)
  const [rolePicker, setRolePicker] = useState(null)  // { dateStr, slot, userKey, userName, x, y }

  function trackMouseDown(e, type) {
    if (e.button !== 0) return
    if (!currentUser) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left + e.currentTarget.scrollLeft
    setDrag({ startX: x, endX: x, type })
  }
  function trackMouseMove(e) {
    if (!drag) return
    const rect = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - rect.left + e.currentTarget.scrollLeft
    setDrag(prev => ({ ...prev, endX: x }))
  }
  function trackMouseUp() {
    if (!drag) return
    const a = Math.min(drag.startX, drag.endX)
    const b = Math.max(drag.startX, drag.endX)
    if (b - a < 4) { setDrag(null); return }   // ignore micro-drags
    const start = xToHourSnap(a)
    const end   = xToHourSnap(b)
    if (end <= start) { setDrag(null); return }
    const dragType = drag.type
    setDrag(null)
    onCreateEvent && onCreateEvent({ start_at: start, end_at: end, event_type: dragType })
  }

  // ── Shift assignment helpers ──────────────────────────────────────────────
  function assignmentsAt(date, slot_label, userKey) {
    // userKey: { user_id?, free_user_id? }
    return assignments.filter(a =>
      a.date === date && a.slot_label === slot_label
      && (
        (userKey.user_id != null      && a.user_id      === userKey.user_id) ||
        (userKey.free_user_id != null && a.free_user_id === userKey.free_user_id)
      )
    )
  }

  function slotAssignmentCount(date, slot_label) {
    return assignments.filter(a => a.date === date && a.slot_label === slot_label).length
  }
  function slotAssignmentsByRole(date, slot_label) {
    // Returns { role_name: count, ...} for the cell
    const m = {}
    for (const a of assignments) {
      if (a.date === date && a.slot_label === slot_label) {
        const r = a.role || '(no role)'
        m[r] = (m[r] || 0) + 1
      }
    }
    return m
  }

  function userAssignmentCount(userKey) {
    return assignments.filter(a =>
      (userKey.user_id != null      && a.user_id      === userKey.user_id) ||
      (userKey.free_user_id != null && a.free_user_id === userKey.free_user_id)
    ).length
  }

  async function registerWithRole(date, slot_label, userKey, userName, role) {
    try {
      await api.post('/schedule/assignments', {
        date, slot_label,
        user_id: userKey.user_id || null,
        free_user_id: userKey.free_user_id || null,
        user_name: userName,
        role: role || null,
      })
      onReloadAssignments && onReloadAssignments()
    } catch (e) {
      alert(e.response?.data?.detail || t('sched_fail'))
    }
  }

  async function unregister(assignmentId) {
    try {
      await api.delete(`/schedule/assignments/${assignmentId}`)
      onReloadAssignments && onReloadAssignments()
    } catch (e) {
      alert(e.response?.data?.detail || t('sched_fail'))
    }
  }

  function handleCellClick(date, slot, userKey, userName, clickEvent) {
    const existing = assignmentsAt(date, slot.label, userKey)
    if (existing.length > 0) {
      unregister(existing[0].id); return
    }
    // Use PATTERN-level roles (shared across all slots)
    const roles = patternRoles
    if (roles.length === 0) {
      registerWithRole(date, slot.label, userKey, userName, null)
    } else if (roles.length === 1) {
      registerWithRole(date, slot.label, userKey, userName, roles[0].name)
    } else {
      const rect = clickEvent.currentTarget.getBoundingClientRect()
      setRolePicker({
        dateStr: date, slot, userKey, userName,
        x: rect.left + rect.width / 2,
        y: rect.bottom + 4,
      })
    }
  }

  function canEditSlot(userKey) {
    if (!currentUser) return false
    if (currentUser.role === 'manager') return true
    if (userKey.user_id != null) return userKey.user_id === currentUser.user_id
    // Free user: editable if claimed by current user
    if (userKey.free_user_id != null) {
      const fu = freeUsers.find(f => f.id === userKey.free_user_id)
      return fu?.claimed_by_id === currentUser.user_id
    }
    return false
  }

  // ── User rows ─────────────────────────────────────────────────────────────
  // Build user row list: registered users (active) + free users (sorted by display_order)
  const userRows = useMemo(() => {
    const rows = []
    // Registered users
    for (const u of (allUsers || [])) {
      rows.push({
        key: 'u-' + u.id, userKey: { user_id: u.id }, name: u.username,
        display_name: u.display_name, isFree: false, raw: u,
      })
    }
    // Free users
    for (const f of (freeUsers || [])) {
      // If claimed, don't show as separate row (already in user list)
      if (f.claimed_by_id) continue
      rows.push({
        key: 'f-' + f.id, userKey: { free_user_id: f.id }, name: f.name,
        display_name: null, isFree: true, raw: f,
      })
    }
    return rows
  }, [allUsers, freeUsers])

  // ── Compose all tracks ────────────────────────────────────────────────────
  const tracks = [
    { key: 'exp', label: t('sched_track_experiment'), type: 'experiment',
      items: events.filter(e => e.event_type === 'experiment'),
      isUserRow: false, allowDrag: true },
    { key: 'run', label: t('sched_track_run'), type: 'run', items: runs, isRuns: true,
      isUserRow: false, allowDrag: false },
  ]
  // Helper: check if a date falls inside the active pattern's effective range
  function patternActiveOn(dateStr) {
    if (!activePattern) return false
    if (activePattern.effective_from && dateStr < activePattern.effective_from) return false
    if (activePattern.effective_to   && dateStr > activePattern.effective_to)   return false
    return true
  }

  const patternRoles = getPatternRoles(activePattern)

  if (activePattern) {
    // Summary: one row per ROLE (daq, shift, beam, ...) — first one has thick separator above
    patternRoles.forEach((role, i) => {
      tracks.push({
        key: 'sum-role-' + role.name, label: role.name, type: 'shift',
        isSummary: true, summaryRole: role, allowDrag: false,
        thickBefore: i === 0,   // separator before first summary row
      })
    })
    userRows.forEach((ur, i) => {
      tracks.push({
        key: ur.key, label: ur.name, type: 'shift',
        userRow: ur, isUserRow: true, allowDrag: false,
        thickBefore: i === 0,   // separator before first user row
      })
    })
  }
  const others = events.filter(e => e.event_type === 'other')
  if (others.length) {
    tracks.push({ key: 'other', label: t('sched_track_other'), type: 'other', items: others, isUserRow: false, allowDrag: false })
  }

  // Day cells for header
  const dayCells = []
  for (let i = 0; i < rangeDays; i++) dayCells.push(addDays(rangeStart, i))

  const nowX = timeToX(new Date())

  // ── Per-track drag overlay (only during active drag) ─────────────────────
  const dragRect = drag ? {
    left: Math.min(drag.startX, drag.endX),
    width: Math.abs(drag.endX - drag.startX),
  } : null

  return (
    <div className="border sched-border rounded-lg flex flex-col overflow-y-auto overflow-x-hidden"
      style={{ maxHeight: 'calc(100vh - 12rem)', backgroundColor: 'var(--surface)' }}>
      {/* Zoom toolbar — value = number of days visible at once */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b sched-border-b"
           style={{ backgroundColor: 'var(--surface-2)' }}>
        <span className="text-[10px] mr-1" style={{ color: 'var(--text-muted)' }}>{t('sched_zoom')}</span>
        <button onClick={() => setDaysVisible(z => Math.max(ZOOM_MIN, z - 1))}
          className="h-6 w-6 text-sm rounded transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--surface-3)'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}
          title="keyboard: -">−</button>
        <input type="number" min={ZOOM_MIN} max={ZOOM_MAX} value={daysVisible}
          onChange={e => {
            const v = parseInt(e.target.value, 10)
            if (!isNaN(v)) setDaysVisible(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v)))
          }}
          className="h-6 w-14 text-center text-xs border rounded no-spin focus:outline-none focus:ring-2 focus:ring-[var(--input-focus-border)]"
          style={{ backgroundColor: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--text-primary)' }} />
        <button onClick={() => setDaysVisible(z => Math.min(ZOOM_MAX, z + 1))}
          className="h-6 w-6 text-sm rounded transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--surface-3)'}
          onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}
          title="keyboard: =">+</button>
        <span className="text-[10px] ml-1" style={{ color: 'var(--text-muted)' }}>일</span>
        {activePattern && (
          <span className="ml-3 text-[10px]" style={{ color: 'var(--text-muted)' }}>
            {t('sched_active_pattern')}: <span style={{ color: 'var(--text-secondary)' }}>{activePattern.name}</span>
          </span>
        )}
        {!activePattern && (
          <span className="ml-3 text-[10px]" style={{ color: 'var(--warning-text)' }}>{t('sched_no_active_pattern')}</span>
        )}
      </div>

      <div className="flex" style={{ height: HEADER_H + TRACK_H * tracks.length + 8 }}>
        {/* ── Fixed left column ─────────────────────────────────────────── */}
        <div className="shrink-0 border-r sched-border" style={{ width: LABEL_W, backgroundColor: 'var(--surface-2)' }}>
          <div style={{ height: HEADER_H }} className="border-b sched-border flex items-end px-2 pb-1.5">
          </div>
          {tracks.map(t => {
            const thickTop = t.thickBefore ? 'sched-section-top' : ''
            if (t.isUserRow) {
              const ur = t.userRow
              const count = userAssignmentCount(ur.userKey)
              return (
                <div
                  key={t.key}
                  style={{ height: TRACK_H }}
                  className={`flex items-center px-2 text-[11px] border-b sched-border-b ${thickTop}`}
                >
                  <span className={`truncate flex-1 ${ur.isFree ? 'italic' : ''}`}
                        style={{ color: ur.isFree ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                    {ur.name}
                    {ur.display_name && <span className="ml-1" style={{ color: 'var(--text-muted)' }}>({ur.display_name})</span>}
                  </span>
                  {count > 0 && (
                    <span className="ml-1 text-[10px] px-1.5 rounded-full"
                          style={combo('pillInfo')}>{count}</span>
                  )}
                </div>
              )
            }
            return (
              <div
                key={t.key}
                style={{ height: TRACK_H, color: 'var(--text-primary)' }}
                className={`flex items-center px-2 text-[11px] border-b sched-border-b ${thickTop}`}
              >
                {t.label}
              </div>
            )
          })}
        </div>

        {/* ── Scrollable timeline ───────────────────────────────────────── */}
        <div ref={scrollRef} className="flex-1 overflow-x-auto overflow-y-hidden">
          <div style={{ width: totalWidth, height: HEADER_H + TRACK_H * tracks.length + 8, position: 'relative' }}
               onMouseUp={trackMouseUp}
               onMouseLeave={() => drag && trackMouseUp()}>

            {/* ── Day-boundary + week-boundary vertical separators
                 Rendered ABOVE the header (z-20) so the single line spans header + body
                 and aligns perfectly with itself. Header cells have no border-r. ─── */}
            {dayCells.map((d, i) => {
              const isMonday = d.getDay() === 1
              return (
                <div key={'daysep-' + i}
                  style={{
                    left: Math.round(i * dayWidth),
                    top: 0,
                    width: 1,
                    height: '100%',
                    backgroundColor: isMonday ? '#64748b' : '#cbd5e1',
                  }}
                  className="absolute z-20 pointer-events-none"
                />
              )
            })}

            {/* ── Day header (date only — counts moved to summary track) ─── */}
            <div className="flex sticky top-0 z-10 border-b sched-border" style={{ height: HEADER_H, backgroundColor: 'var(--surface-2)' }}>
              {dayCells.map((d, i) => {
                const isToday   = sameDay(d, today)
                const isFocused = sameDay(d, focusedDay)
                return (
                  <div
                    key={i}
                    className={`shrink-0 px-1 py-1 text-center relative ${
                      isFocused ? 'ring-2 ring-inset' : ''
                    }`}
                    style={{
                      width: dayWidth,
                      ...(isFocused
                        ? { backgroundColor: 'var(--focused-day-bg)', '--tw-ring-color': 'var(--focused-day-ring)' }
                        : isToday
                          ? { backgroundColor: 'var(--info-bg)' }
                          : null),
                    }}
                  >
                    {isToday && (
                      <div
                        style={{
                          left: '50%', top: 0, transform: 'translateX(-50%)',
                          width: 0, height: 0,
                          borderLeft: '6px solid transparent',
                          borderRight: '6px solid transparent',
                          borderTop: '8px solid #ef4444',
                        }}
                        className="absolute z-20 pointer-events-none"
                        title="Today"
                      />
                    )}
                    <div className={`text-[12px] font-medium ${
                      d.getDay() === 0 ? 'sched-sun' : d.getDay() === 6 ? 'sched-sat' : ''
                    }`}
                         style={(d.getDay() !== 0 && d.getDay() !== 6) ? { color: 'var(--text-secondary)' } : undefined}>
                      {d.getMonth()+1}/{d.getDate()} ({DOW[d.getDay()]})
                    </div>
                    {hourWidth >= 40 && (
                      <div className="flex text-[8px] mt-0.5" style={{ color: 'var(--text-muted)' }}>
                        {[0,6,12,18].map(h => (
                          <div key={h} style={{ width: dayWidth/4 }} className="text-center">{h}h</div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Focused-day highlight is now in the header cell only — body strip removed. */}

            {/* Today marker is now a triangle in the day header (above) */}

            {/* ── Section separators: single thin BLUE line (same weight as other lines) ── */}
            {tracks.map((track, trackIdx) => {
              if (!track.thickBefore) return null
              const top = HEADER_H + trackIdx * TRACK_H
              return (
                <div key={'sep-' + track.key}
                  style={{ left: 0, top: top, width: '100%', height: 1, backgroundColor: '#3b82f6' }}
                  className="absolute pointer-events-none z-10" />
              )
            })}

            {/* ── Tracks ─────────────────────────────────────────────────── */}
            {tracks.map((track, trackIdx) => {
              const top = HEADER_H + trackIdx * TRACK_H

              // ── Shift summary row (one per ROLE): cells across each (date×slot) ─
              if (track.isSummary && activePattern && track.summaryRole) {
                const role = track.summaryRole
                const roleCC = roleColorClasses(role.color)
                const cells = []
                for (const day of dayCells) {
                  const dateStr = ymd(day)
                  if (!patternActiveOn(dateStr)) continue
                  for (const slot of activePattern.slots) {
                    const [sStart, sEnd] = slotWindow(day, slot)
                    const x = timeToX(sStart)
                    const w = Math.max(2, timeToX(sEnd) - x)
                    if (x + w < 0 || x > totalWidth) continue
                    // Filter assignments for this date+slot+role
                    const list = assignments.filter(a =>
                      a.date === dateStr && a.slot_label === slot.label && a.role === role.name)
                    cells.push({ x, w, dateStr, slot, list })
                  }
                }
                return (
                  <div key={track.key}
                    style={{ top, height: TRACK_H, left: 0, right: 0 }}
                    className="absolute border-b sched-border-b">
                    {cells.map((c, i) => {
                      const cnt = c.list.length
                      let label, cls
                      const sizeCls = cnt === 0 ? 'text-[12px] leading-none' : 'text-[10px]'
                      if (cnt === 0) {
                        label = '×'
                        cls = 'bg-transparent sched-cell-border text-slate-400'
                      } else if (cnt === 1) {
                        label = c.list[0].user_name
                        cls = `${roleCC.bg} ${roleCC.text}`
                      } else {
                        label = String(cnt)
                        cls = `${roleCC.bg} ${roleCC.text} font-semibold`
                      }
                      return (
                        <div key={i}
                          style={{ left: c.x, width: c.w, top: 0, height: TRACK_H - 1 }}
                          className={`absolute z-20 ${sizeCls} ${cls} flex items-center justify-center truncate px-1`}
                          title={cnt === 0 ? `${c.dateStr} ${c.slot.label} / ${role.name}: empty`
                                            : `${c.dateStr} ${c.slot.label} / ${role.name}: ${c.list.map(a => a.user_name).join(', ')}`}>
                          <span className="truncate">{label}</span>
                        </div>
                      )
                    })}
                  </div>
                )
              }

              if (track.isUserRow) {
                // Build clickable cells for each (day × slot)
                const ur = track.userRow
                const editable = canEditSlot(ur.userKey)
                const cells = []
                if (activePattern) {
                  for (const day of dayCells) {
                    const dateStr = ymd(day)
                    if (!patternActiveOn(dateStr)) continue
                    for (const slot of activePattern.slots) {
                      const [sStart, sEnd] = slotWindow(day, slot)
                      const x = timeToX(sStart)
                      const w = Math.max(2, timeToX(sEnd) - x)
                      if (x + w < 0 || x > totalWidth) continue
                      const assigned = assignmentsAt(dateStr, slot.label, ur.userKey)
                      const isMine = assigned.length > 0
                      // Find author logs by this user within the slot window
                      const authorMarkers = (authorLogs || []).filter(L =>
                        L.user_name === ur.name &&
                        new Date(L.created_at) >= sStart && new Date(L.created_at) < sEnd
                      )
                      cells.push({ x, w, slot, dateStr, isMine, authorMarkers, sStart, sEnd })
                    }
                  }
                }
                return (
                  <div key={track.key}
                    style={{ top, height: TRACK_H, left: 0, right: 0 }}
                    className="absolute border-b sched-border-b">
                    {cells.map((c, i) => {
                      // Grid-cell style: edge-to-edge, left border = slot divider.
                      // Filled cells get role bg color; empty cells are transparent so
                      // the schedule background + grid lines show through.
                      let cellCls
                      let sizeCls = 'text-[10px]'
                      let myRole = null
                      if (c.isMine) {
                        const assigned = assignmentsAt(c.dateStr, c.slot.label, ur.userKey)[0]
                        myRole = assigned?.role
                        const roleSpec = patternRoles.find(r => r.name === myRole)
                        if (roleSpec) {
                          const cc = roleColorClasses(roleSpec.color)
                          cellCls = `${cc.bg} ${cc.text}`
                        } else {
                          cellCls = 'bg-emerald-200 text-emerald-800'
                        }
                      } else if (editable) {
                        cellCls = 'bg-transparent hover:bg-emerald-50 cursor-pointer'
                      } else {
                        cellCls = 'bg-transparent text-slate-300 cursor-not-allowed'
                      }
                      return (
                      <div key={i}
                        style={{ left: c.x, width: c.w, top: 0, height: TRACK_H - 1 }}
                        className={`absolute z-20 ${sizeCls} ${cellCls} flex items-center justify-center transition-colors group`}
                        title={`${c.dateStr} ${c.slot.label} (${c.slot.start_hour}-${c.slot.end_hour})${
                          c.isMine ? ` — ${myRole || t('sched_registered')} (${t('sched_click_cancel')})` : editable ? ` — ${t('sched_click_register')}` : ''
                        }`}
                        onClick={(ev) => editable && handleCellClick(c.dateStr, c.slot, ur.userKey, ur.name, ev)}
                      >
                        {c.isMine && c.w > 18 && (
                          <span className="truncate px-1">{myRole || c.slot.label}</span>
                        )}
                        {/* Author log markers */}
                        {c.authorMarkers.map((m, k) => {
                          const mx = timeToX(m.created_at) - c.x
                          return (
                            <button
                              key={k}
                              style={{ left: mx, top: '50%', transform: 'translate(-50%, -50%)' }}
                              className="absolute w-2 h-2 bg-yellow-400 hover:bg-yellow-500 rounded-full border border-yellow-600 z-10"
                              title={`${t('sched_log')} #${m.log_id} — ${m.title || ''}`}
                              onClick={ev => { ev.stopPropagation(); openLogInTab(m.log_id) }}
                            />
                          )
                        })}
                      </div>
                    )})}
                  </div>
                )
              }

              // Non-user-row track (events / runs / other)
              return (
                <div
                  key={track.key}
                  style={{ top, height: TRACK_H, left: 0, right: 0 }}
                  className={`absolute border-b sched-border-b ${
                    track.allowDrag ? 'cursor-crosshair' : ''
                  }`}
                  onMouseDown={track.allowDrag ? (e => trackMouseDown(e, track.type)) : undefined}
                  onMouseMove={drag ? trackMouseMove : undefined}
                >
                  {(track.items || []).map((item, i) => {
                    const start = new Date(item.start_at || item.start)
                    const end   = (item.end_at != null && item.end_at !== undefined)
                      ? new Date(item.end_at)
                      : (track.isRuns && !item.end_at)
                        ? new Date()
                        : new Date(item.end_at || item.end)
                    const colorCls = colors[track.type] || colors.other

                    if (track.isRuns) {
                      // Render: thin span connector + 1-hour box at start + 1-hour box at end (if exists)
                      const xs = timeToX(start)
                      const xe = timeToX(end)
                      const boxW = Math.max(8, hourWidth)   // 1 hour wide box
                      const spanLeft  = xs + boxW/2
                      const spanRight = xe + boxW/2
                      const elems = []

                      // Span (thin line) between start and end boxes
                      if (xe > xs) {
                        elems.push(
                          <div key="span" style={{ left: spanLeft, width: spanRight - spanLeft, top: TRACK_H/2 - 1, height: 2 }}
                            className={`absolute ${colorCls} pointer-events-none opacity-60`} />
                        )
                      }

                      // Start box (clickable → open start log in app)
                      if (xs + boxW > 0 && xs < totalWidth) {
                        elems.push(
                          <div key="start"
                            onClick={() => openLogInTab(item.start_log_id)}
                            style={{ left: xs, width: boxW, top: 4, height: TRACK_H - 8 }}
                            className={`absolute z-30 ${colorCls} border rounded text-[10px] flex items-center justify-center cursor-pointer hover:opacity-80`}
                            title={`${t('sched_run')} ${item.run_number} start${item.title ? ' — ' + item.title : ''}\n${start.toLocaleString()}`}>
                            <span className="truncate px-0.5">R{item.run_number}</span>
                          </div>
                        )
                      }

                      // End box (clickable → open end log in app) — only if there's an end log
                      if (item.end_log_id && xe + boxW > 0 && xe < totalWidth) {
                        elems.push(
                          <div key="end"
                            onClick={() => openLogInTab(item.end_log_id)}
                            style={{ left: xe, width: boxW, top: 4, height: TRACK_H - 8 }}
                            className={`absolute z-30 ${colorCls} border rounded text-[10px] flex items-center justify-center cursor-pointer hover:opacity-80`}
                            title={`${t('sched_run')} ${item.run_number} end${item.title ? ' — ' + item.title : ''}\n${end.toLocaleString()}`}>
                            <span className="truncate px-0.5">E{item.run_number}</span>
                          </div>
                        )
                      }

                      return <React.Fragment key={i}>{elems}</React.Fragment>
                    }

                    const x = timeToX(start)
                    const w = Math.max(8, timeToX(end) - x)
                    if (x + w < 0 || x > totalWidth) return null

                    return (
                      <div key={i}
                        onClick={ev => { ev.stopPropagation(); onEventClick && onEventClick(item) }}
                        style={{ left: x, width: w, top: 4, height: TRACK_H - 8 }}
                        className={`absolute z-30 ${colorCls} border rounded px-1.5 text-[10px] flex items-center cursor-pointer hover:opacity-80 truncate`}
                        title={`${item.title}\n${start.toLocaleString()} ~ ${end.toLocaleString()}`}>
                        <span className="truncate">{item.title}</span>
                      </div>
                    )
                  })}
                  {/* Drag preview overlay on this track */}
                  {drag && drag.type === track.type && dragRect && (
                    <div style={{ left: dragRect.left, width: dragRect.width, top: 4, height: TRACK_H - 8 }}
                      className="absolute bg-blue-300/60 border-2 border-blue-500 border-dashed rounded pointer-events-none" />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Hint */}
      <div className="px-2 py-1.5 text-[10px] border-t sched-border-t"
           style={{ color: 'var(--text-muted)', backgroundColor: 'var(--surface-2)' }}>
        {t('sched_hint_horizontal')}
      </div>

      {/* Role picker popover */}
      {rolePicker && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setRolePicker(null)} />
          <div
            className="fixed z-50 border rounded-lg shadow-lg p-2 min-w-[120px]"
            style={{
              left: rolePicker.x,
              top: rolePicker.y,
              transform: 'translateX(-50%)',
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border-default)',
            }}
          >
            <div className="text-[10px] mb-1.5 px-1" style={{ color: 'var(--text-muted)' }}>{t('sched_pick_role')}</div>
            <div className="flex flex-col gap-1">
              {patternRoles.map(r => {
                const cls = roleColorClasses(r.color)
                return (
                  <button key={r.name}
                    onClick={() => {
                      registerWithRole(rolePicker.dateStr, rolePicker.slot.label,
                                       rolePicker.userKey, rolePicker.userName, r.name)
                      setRolePicker(null)
                    }}
                    className={`${cls.bg} ${cls.text} text-xs px-2 py-1.5 rounded hover:opacity-80 flex items-center gap-1.5 text-left`}>
                    <span className={`w-2 h-2 rounded-full ${cls.solid}`} />
                    {r.name}
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
