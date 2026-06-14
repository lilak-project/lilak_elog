/**
 * Vertical timeline view — time flows top→bottom, tracks are columns.
 *
 * Columns (left to right):
 *   ─ Time axis (sticky)
 *   ─ 실험
 *   ─ 런
 *   ─ 쉬프트 요약 (per-slot count, role colors)
 *   ─ [user 1] [user 2] ... [free user ...]
 */

import { useState, useMemo, useRef, useEffect, useCallback } from 'react'
import api from '../../api'
import { useLang } from '../../context/LangContext'
import { useTab } from '../../context/TabContext'
import { roleColorClasses } from './ShiftPatternsManager'
import { combo } from '../../theme/textCombos'

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

const ZOOM_MIN = 1
const ZOOM_MAX = 60
const ZOOM_DEFAULT = 7

const HEADER_H   = 36
const TIME_COL_W = 56
const COL_W      = {
  exp:     130,
  run:     130,
  summary: 70,
  user:    70,
}

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate()+n); return x }
function sameDay(a, b) {
  return a.getFullYear()===b.getFullYear() && a.getMonth()===b.getMonth() && a.getDate()===b.getDate()
}
function ymd(d) {
  const x = new Date(d)
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`
}
function slotWindow(date, slot) {
  const s = new Date(date); s.setHours(slot.start_hour, 0, 0, 0)
  const e = new Date(date); e.setHours(slot.end_hour, 0, 0, 0)
  if (slot.end_hour <= slot.start_hour) e.setDate(e.getDate() + 1)
  return [s, e]
}

export default function TimelineVerticalView({
  anchor, events, runs, colors, currentUser,
  onEventClick, onCreateEvent,
  activePattern, freeUsers, assignments, allUsers, authorLogs,
  onReloadAssignments,
}) {
  const { t } = useLang()
  const { activateTab } = useTab()
  const DOW = t('sched_dow')

  function openLogInTab(id) {
    if (!id) return
    activateTab('logs')
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('lilak:cmd:open-log', { detail: { id: Number(id) } }))
    }, 100)
  }
  const [daysVisible, setDaysVisible] = useState(ZOOM_DEFAULT)
  const [containerHeight, setContainerHeight] = useState(700)
  const scrollRef = useRef(null)
  const today = new Date()

  useEffect(() => {
    if (!scrollRef.current) return
    const el = scrollRef.current
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const h = Math.max(200, entry.contentRect.height)
        setContainerHeight(h)
      }
    })
    ro.observe(el)
    if (el.clientHeight) setContainerHeight(Math.max(200, el.clientHeight))
    return () => ro.disconnect()
  }, [])

  const hourHeight = containerHeight / (daysVisible * 24)

  const [focusedDay, setFocusedDay] = useState(() => startOfDay(today))
  useEffect(() => { setFocusedDay(startOfDay(anchor)) }, [+anchor])

  const rangeDays = 60
  const rangeStart = useMemo(() => addDays(startOfDay(anchor), -Math.floor(rangeDays/2)), [anchor])

  const dayHeight  = hourHeight * 24
  const totalHeight = dayHeight * rangeDays

  // Keyboard: =/+ → +1 day, -/_ → −1 day
  useEffect(() => {
    function onKey(e) {
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      if (inInput) return
      if (e.key === '=' || e.key === '+') {
        e.preventDefault(); setDaysVisible(z => Math.min(ZOOM_MAX, z + 1)); return
      } else if (e.key === '-' || e.key === '_') {
        e.preventDefault(); setDaysVisible(z => Math.max(ZOOM_MIN, z - 1)); return
      }
      let delta = 0
      if (e.key === 'ArrowUp'   || e.key === 'k') delta = -1
      else if (e.key === 'ArrowDown' || e.key === 'j') delta = 1
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

  useEffect(() => {
    if (!scrollRef.current) return
    const dayOffset = Math.floor((focusedDay - rangeStart) / 86400000)
    const targetY = dayOffset * dayHeight
    const el = scrollRef.current
    const pad = 4
    if (targetY < el.scrollTop + pad) {
      el.scrollTop = targetY - pad
    } else if (targetY + dayHeight > el.scrollTop + el.clientHeight - pad) {
      el.scrollTop = targetY + dayHeight - el.clientHeight + pad
    }
  }, [focusedDay, dayHeight, rangeStart])

  useEffect(() => {
    if (!scrollRef.current) return
    const dayOffset = Math.floor((startOfDay(anchor) - rangeStart) / 86400000)
    scrollRef.current.scrollTop = dayOffset * dayHeight - 40
  }, [anchor, daysVisible, dayHeight, rangeStart])

  useEffect(() => {
    function onSet(e) {
      const d = e.detail?.days
      if (d != null && d >= ZOOM_MIN && d <= ZOOM_MAX) setDaysVisible(d)
    }
    window.addEventListener('lilak:sched:set-zoom', onSet)
    return () => window.removeEventListener('lilak:sched:set-zoom', onSet)
  }, [])

  const timeToY = useCallback((d) => ((new Date(d) - rangeStart) / 3600000) * hourHeight, [rangeStart, hourHeight])
  const yToHourSnap = useCallback((y) => {
    const hours = Math.round(y / hourHeight)
    return new Date(rangeStart.getTime() + hours * 3600000)
  }, [rangeStart, hourHeight])

  // ── Drag-to-create (vertical) ─────────────────────────────────────────────
  const [drag, setDrag] = useState(null)
  function expMouseDown(e) {
    if (e.button !== 0 || !currentUser) return
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top + e.currentTarget.scrollTop
    setDrag({ startY: y, endY: y })
  }
  function expMouseMove(e) {
    if (!drag) return
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top + e.currentTarget.scrollTop
    setDrag(prev => ({ ...prev, endY: y }))
  }
  function expMouseUp() {
    if (!drag) return
    const a = Math.min(drag.startY, drag.endY)
    const b = Math.max(drag.startY, drag.endY)
    if (b - a < 4) { setDrag(null); return }
    const start = yToHourSnap(a)
    const end   = yToHourSnap(b)
    setDrag(null)
    if (end > start) onCreateEvent && onCreateEvent({ start_at: start, end_at: end, event_type: 'experiment' })
  }

  // ── Role picker popover ───────────────────────────────────────────────────
  const [rolePicker, setRolePicker] = useState(null)

  function assignmentsAt(date, slot_label, userKey) {
    return assignments.filter(a =>
      a.date === date && a.slot_label === slot_label &&
      ((userKey.user_id != null      && a.user_id      === userKey.user_id) ||
       (userKey.free_user_id != null && a.free_user_id === userKey.free_user_id))
    )
  }
  function userAssignmentCount(userKey) {
    return assignments.filter(a =>
      (userKey.user_id != null      && a.user_id      === userKey.user_id) ||
      (userKey.free_user_id != null && a.free_user_id === userKey.free_user_id)
    ).length
  }
  function slotByRole(date, slot_label) {
    const m = {}
    for (const a of assignments) {
      if (a.date === date && a.slot_label === slot_label) {
        const r = a.role || '(no role)'
        m[r] = (m[r] || 0) + 1
      }
    }
    return m
  }
  function canEdit(userKey) {
    if (!currentUser) return false
    if (currentUser.role === 'manager') return true
    if (userKey.user_id != null) return userKey.user_id === currentUser.user_id
    if (userKey.free_user_id != null) {
      const fu = freeUsers.find(f => f.id === userKey.free_user_id)
      return fu?.claimed_by_id === currentUser.user_id
    }
    return false
  }
  async function registerRole(date, slot_label, userKey, userName, role) {
    try {
      await api.post('/schedule/assignments', {
        date, slot_label,
        user_id: userKey.user_id || null,
        free_user_id: userKey.free_user_id || null,
        user_name: userName, role: role || null,
      })
      onReloadAssignments && onReloadAssignments()
    } catch (e) { alert(e.response?.data?.detail || t('sched_fail')) }
  }
  async function unregister(aid) {
    try { await api.delete(`/schedule/assignments/${aid}`); onReloadAssignments && onReloadAssignments() }
    catch (e) { alert(e.response?.data?.detail || t('sched_fail')) }
  }
  const patternRoles = getPatternRoles(activePattern)

  function handleCellClick(date, slot, userKey, userName, clickEvent) {
    const existing = assignmentsAt(date, slot.label, userKey)
    if (existing.length > 0) { unregister(existing[0].id); return }
    const roles = patternRoles
    if (roles.length === 0)       registerRole(date, slot.label, userKey, userName, null)
    else if (roles.length === 1)  registerRole(date, slot.label, userKey, userName, roles[0].name)
    else {
      const rect = clickEvent.currentTarget.getBoundingClientRect()
      setRolePicker({
        dateStr: date, slot, userKey, userName,
        x: rect.right + 4, y: rect.top,
      })
    }
  }

  // ── User rows (columns here) ─────────────────────────────────────────────
  const userCols = useMemo(() => {
    const rows = []
    for (const u of (allUsers || [])) {
      rows.push({
        key: 'u-' + u.id, userKey: { user_id: u.id }, name: u.username,
        display_name: u.display_name, isFree: false,
      })
    }
    for (const f of (freeUsers || [])) {
      if (f.claimed_by_id) continue
      rows.push({
        key: 'f-' + f.id, userKey: { free_user_id: f.id }, name: f.name,
        display_name: null, isFree: true,
      })
    }
    return rows
  }, [allUsers, freeUsers])

  // ── Build columns ────────────────────────────────────────────────────────
  const columns = [
    { key: 'exp',     label: t('sched_track_experiment'),     width: COL_W.exp, type: 'experiment', items: events.filter(e => e.event_type === 'experiment'), allowDrag: true },
    { key: 'run',     label: t('sched_track_run'),       width: COL_W.run, type: 'run', items: runs, isRuns: true },
  ]
  if (activePattern) {
    // One summary column per ROLE
    for (const role of patternRoles) {
      columns.push({ key: 'sum-role-' + role.name, label: role.name, width: COL_W.summary, type: 'shift', isSummary: true, summaryRole: role })
    }
    for (const ur of userCols) {
      columns.push({ key: ur.key, label: ur.name, width: COL_W.user, type: 'shift', userCol: ur })
    }
  }
  const others = events.filter(e => e.event_type === 'other')
  if (others.length) columns.push({ key: 'other', label: t('sched_track_other'), width: COL_W.exp, type: 'other', items: others })

  // Day cells for time axis
  const dayCells = []
  for (let i = 0; i < rangeDays; i++) dayCells.push(addDays(rangeStart, i))

  const nowY = timeToY(new Date())
  const totalContentW = TIME_COL_W + columns.reduce((s, c) => s + c.width, 0)

  return (
    <div className="border sched-border rounded-lg overflow-hidden" style={{ backgroundColor: 'var(--surface)' }}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b sched-border-b" style={{ backgroundColor: 'var(--surface-2)' }}>
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

      <div className="overflow-auto" style={{ maxHeight: 'calc(100vh - 14rem)' }} ref={scrollRef}
           onMouseUp={expMouseUp} onMouseLeave={() => drag && expMouseUp()}>
        <div style={{ width: totalContentW, position: 'relative' }}>
          {/* Sticky column header */}
          <div className="flex sticky top-0 z-30 border-b-2 sched-border" style={{ height: HEADER_H, backgroundColor: 'var(--surface-2)' }}>
            <div className="shrink-0 border-r-2 sched-border" style={{ width: TIME_COL_W }} />
            {columns.map(col => (
              <div key={col.key} style={{ width: col.width, color: 'var(--text-primary)' }}
                className="shrink-0 border-r sched-border-r flex items-center justify-center text-[11px] px-1">
                <span className="truncate">{col.label}</span>
                {col.userCol && (
                  <span className="ml-1 text-[9px] px-1 rounded-full" style={combo('pillInfo')}>
                    {userAssignmentCount(col.userCol.userKey)}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Body */}
          <div className="flex" style={{ height: totalHeight + 8 }}>
            {/* Sticky time axis */}
            <div className="shrink-0 sticky left-0 z-20 border-r-2 sched-border" style={{ width: TIME_COL_W, backgroundColor: 'var(--surface-2)' }}>
              {dayCells.map((d, i) => {
                const isToday   = sameDay(d, today)
                const isFocused = sameDay(d, focusedDay)
                const dayY = i * dayHeight
                return (
                  <div key={i}
                    style={{
                      position: 'absolute', top: dayY, height: dayHeight, width: '100%',
                      ...(isFocused ? { backgroundColor: 'var(--focused-day-bg)', boxShadow: 'inset 0 0 0 2px var(--focused-day-ring)' }
                          : isToday ? { backgroundColor: 'var(--info-bg)' } : {})
                    }}
                    className="border-b sched-border-b">
                    <div className={`px-1.5 py-0.5 text-[10px] ${
                      d.getDay() === 0 ? 'sched-sun' : d.getDay() === 6 ? 'sched-sat' : ''
                    }`}
                         style={(d.getDay() !== 0 && d.getDay() !== 6) ? { color: 'var(--text-secondary)' } : undefined}>
                      {d.getMonth()+1}/{d.getDate()}
                      <div style={{ color: 'var(--text-muted)' }}>{DOW[d.getDay()]}</div>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* Track columns area */}
            <div className="relative" style={{ width: totalContentW - TIME_COL_W, height: totalHeight }}>
              {/* Grid lines removed */}

              {/* Day-boundary + week-boundary horizontal lines */}
              {dayCells.map((d, i) => {
                const isMonday = d.getDay() === 1
                return (
                  <div key={'daysep-' + i}
                    style={{
                      top: Math.round(i * dayHeight),
                      left: 0,
                      width: '100%',
                      height: 1,
                      backgroundColor: isMonday ? '#64748b' : '#cbd5e1',
                    }}
                    className="absolute z-0 pointer-events-none"
                  />
                )
              })}

              {/* Today horizontal line */}
              {nowY >= 0 && nowY <= totalHeight && (
                <div style={{ top: nowY, left: 0, width: '100%', height: 2 }}
                  className="absolute bg-red-400 z-20 pointer-events-none">
                  <div className="absolute -left-1 -top-1 w-2 h-2 bg-red-400 rounded-full" />
                </div>
              )}

              {/* Render each column */}
              {(() => {
                let xOffset = 0
                return columns.map(col => {
                  const left = xOffset
                  xOffset += col.width

                  // Vertical column separator
                  const colSeparator = (
                    <div key={'sep-'+col.key}
                      style={{ left: left + col.width, top: 0, width: 1, height: '100%' }}
                      className="absolute sched-grid-col pointer-events-none" />
                  )

                  // ── Shift summary column (per ROLE) ────────────────────
                  if (col.isSummary && activePattern && col.summaryRole) {
                    const role = col.summaryRole
                    const roleCC = roleColorClasses(role.color)
                    const cells = []
                    for (const day of dayCells) {
                      const dateStr = ymd(day)
                      for (const slot of activePattern.slots) {
                        const [sStart, sEnd] = slotWindow(day, slot)
                        const y = timeToY(sStart)
                        const h = Math.max(2, timeToY(sEnd) - y)
                        if (y + h < 0 || y > totalHeight) continue
                        const list = assignments.filter(a =>
                          a.date === dateStr && a.slot_label === slot.label && a.role === role.name)
                        cells.push({ y, h, slot, dateStr, list })
                      }
                    }
                    return (
                      <div key={col.key} style={{ left, top: 0, width: col.width, height: '100%' }}
                        className="absolute">
                        {/* Column separator drawn FIRST so it sits behind the cells (grid feel). */}
                        {colSeparator}
                        {cells.map((c, i) => {
                          const cnt = c.list.length
                          let label, cls
                          if (cnt === 0) {
                            // Empty: transparent so the schedule background shows through.
                            // Top border alone acts as a slot-divider grid line.
                            label = '×'; cls = 'bg-transparent sched-cell-border text-slate-400'
                          } else if (cnt === 1) {
                            label = c.list[0].user_name
                            cls = `${roleCC.bg} ${roleCC.text}`
                          } else {
                            label = String(cnt)
                            cls = `${roleCC.bg} ${roleCC.text} font-semibold`
                          }
                          return (
                            <div key={i}
                              style={{ left: 0, width: col.width, top: c.y, height: c.h }}
                              className={`absolute text-[10px] ${cls} flex items-center justify-center truncate px-1`}
                              title={cnt === 0 ? `${c.dateStr} ${c.slot.label} / ${role.name}: empty`
                                                : `${c.dateStr} ${c.slot.label} / ${role.name}: ${c.list.map(a => a.user_name).join(', ')}`}>
                              <span className="truncate">{label}</span>
                            </div>
                          )
                        })}
                      </div>
                    )
                  }

                  // ── User column ────────────────────────────────────────
                  if (col.userCol && activePattern) {
                    const ur = col.userCol
                    const editable = canEdit(ur.userKey)
                    const cells = []
                    for (const day of dayCells) {
                      const dateStr = ymd(day)
                      for (const slot of activePattern.slots) {
                        const [sStart, sEnd] = slotWindow(day, slot)
                        const y = timeToY(sStart)
                        const h = Math.max(2, timeToY(sEnd) - y)
                        if (y + h < 0 || y > totalHeight) continue
                        const assigned = assignmentsAt(dateStr, slot.label, ur.userKey)
                        const isMine = assigned.length > 0
                        const myRole = isMine ? assigned[0].role : null
                        const markers = (authorLogs || []).filter(L =>
                          L.user_name === ur.name &&
                          new Date(L.created_at) >= sStart && new Date(L.created_at) < sEnd
                        )
                        cells.push({ y, h, slot, dateStr, isMine, myRole, markers, sStart })
                      }
                    }
                    return (
                      <div key={col.key} style={{ left, top: 0, width: col.width, height: '100%' }}
                        className="absolute">
                        {/* Column separator drawn FIRST so it sits behind the cells (grid feel). */}
                        {colSeparator}
                        {cells.map((c, i) => {
                          // Grid-cell style: edge-to-edge, top border = slot divider.
                          // Filled cells get role bg color; empty cells are transparent
                          // so the schedule background + grid lines show through.
                          let cls
                          if (c.isMine) {
                            const roleSpec = patternRoles.find(r => r.name === c.myRole)
                            const cc = roleSpec ? roleColorClasses(roleSpec.color) : roleColorClasses('emerald')
                            cls = `${cc.bg} ${cc.text}`
                          } else if (editable) {
                            cls = 'bg-transparent hover:bg-emerald-50 cursor-pointer'
                          } else {
                            cls = 'bg-transparent text-slate-300 cursor-not-allowed'
                          }
                          return (
                            <div key={i}
                              style={{ left: 0, width: col.width, top: c.y, height: c.h }}
                              className={`absolute text-[10px] ${cls} flex items-center justify-center transition-colors`}
                              title={`${c.dateStr} ${c.slot.label}${c.isMine ? ` — ${c.myRole || t('sched_registered')} (${t('sched_click_cancel')})` : editable ? ` — ${t('sched_click_register')}` : ''}`}
                              onClick={(ev) => editable && handleCellClick(c.dateStr, c.slot, ur.userKey, ur.name, ev)}>
                              {c.isMine && c.h > 12 && <span className="truncate px-1">{c.myRole || c.slot.label}</span>}
                              {c.markers.map((m, k) => {
                                const my = timeToY(m.created_at) - c.y
                                return (
                                  <button key={k}
                                    style={{ top: my, left: '50%', transform: 'translate(-50%, -50%)' }}
                                    className="absolute w-2 h-2 bg-yellow-400 hover:bg-yellow-500 rounded-full border border-yellow-600 z-10"
                                    title={`${t('sched_log')} #${m.log_id} — ${m.title || ''}`}
                                    onClick={ev => { ev.stopPropagation(); openLogInTab(m.log_id) }} />
                                )
                              })}
                            </div>
                          )
                        })}
                      </div>
                    )
                  }

                  // ── Generic event/run column ──────────────────────────
                  const isRuns = !!col.isRuns
                  const allowDrag = col.allowDrag
                  return (
                    <div key={col.key} style={{ left, top: 0, width: col.width, height: '100%' }}
                      className={`absolute ${allowDrag ? 'cursor-crosshair' : ''}`}
                      onMouseDown={allowDrag ? expMouseDown : undefined}
                      onMouseMove={drag ? expMouseMove : undefined}>
                      {/* Column separator drawn FIRST so it sits behind the events. */}
                      {colSeparator}
                      {(col.items || []).map((item, i) => {
                        const start = new Date(item.start_at || item.start)
                        const end = (item.end_at != null && item.end_at !== undefined)
                          ? new Date(item.end_at)
                          : (isRuns && !item.end_at) ? new Date() : new Date(item.end_at || item.end)
                        const y = timeToY(start)
                        const h = Math.max(8, timeToY(end) - y)
                        if (y + h < 0 || y > totalHeight) return null
                        const colorCls = colors[col.type] || colors.other

                        if (isRuns) {
                          return (
                            <div key={i}
                              onClick={() => openLogInTab(item.start_log_id)}
                              style={{ left: 4, width: col.width - 8, top: y + 2, height: h - 4 }}
                              className={`absolute ${colorCls} border rounded px-1 text-[10px] flex items-center justify-center cursor-pointer hover:opacity-80 truncate`}
                              title={`${t('sched_run')} ${item.run_number}${item.title ? ' — ' + item.title : ''}`}>
                              <span className="truncate">R{item.run_number}{!item.end_at && ' ▶'}</span>
                            </div>
                          )
                        }
                        return (
                          <div key={i}
                            onClick={ev => { ev.stopPropagation(); onEventClick && onEventClick(item) }}
                            style={{ left: 4, width: col.width - 8, top: y + 2, height: h - 4 }}
                            className={`absolute ${colorCls} border rounded px-1 text-[10px] flex items-center justify-center cursor-pointer hover:opacity-80 overflow-hidden`}
                            title={`${item.title}\n${start.toLocaleString()} ~ ${end.toLocaleString()}`}>
                            <span className="truncate">{item.title}</span>
                          </div>
                        )
                      })}
                      {/* drag preview */}
                      {drag && allowDrag && (
                        <div style={{
                          left: 4, width: col.width - 8,
                          top: Math.min(drag.startY, drag.endY),
                          height: Math.abs(drag.endY - drag.startY),
                        }}
                          className="absolute bg-blue-300/60 border-2 border-blue-500 border-dashed rounded pointer-events-none" />
                      )}
                    </div>
                  )
                })
              })()}
            </div>
          </div>
        </div>
      </div>

      <div className="px-2 py-1.5 text-[10px] border-t"
           style={{ color: 'var(--text-muted)', borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-2)' }}>
        {t('sched_hint_vertical')}
      </div>

      {rolePicker && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setRolePicker(null)} />
          <div
            className="fixed z-50 border rounded-lg shadow-lg p-2 min-w-[120px]"
            style={{
              left: rolePicker.x, top: rolePicker.y,
              backgroundColor: 'var(--surface)', borderColor: 'var(--border-default)',
            }}>
            <div className="text-[10px] mb-1.5 px-1" style={{ color: 'var(--text-muted)' }}>{t('sched_pick_role')}</div>
            <div className="flex flex-col gap-1">
              {patternRoles.map(r => {
                const cls = roleColorClasses(r.color)
                return (
                  <button key={r.name}
                    onClick={() => {
                      registerRole(rolePicker.dateStr, rolePicker.slot.label,
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
