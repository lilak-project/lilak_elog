/**
 * Month calendar view — table grid with strong borders.
 * Keyboard: ← → ↑ ↓ / h j k l = move focus; Space = open summary; Enter = create event.
 */
import { useState, useEffect } from 'react'
import { useLang } from '../../context/LangContext'
import { useTab } from '../../context/TabContext'

function startOfWeek(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - x.getDay())
  return x
}
function addDays(d, n) {
  const x = new Date(d); x.setDate(x.getDate() + n); return x
}
function sameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function dateOverlapsDay(start, end, dayStart, dayEnd) {
  return start < dayEnd && end > dayStart
}

export default function MonthView({ anchor, events, runs, colors, onDayClick, onEventClick, onDaySummary }) {
  const { t } = useLang()
  const { activateTab } = useTab()
  const DOW_LABELS = t('sched_dow')

  function openLogInTab(id) {
    if (!id) return
    activateTab('logs')
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent('lilak:cmd:open-log', { detail: { id: Number(id) } }))
    }, 100)
  }
  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1)
  const gridStart  = startOfWeek(monthStart)
  const today      = new Date()

  // Focused cell index (0..41)
  const [focusedIdx, setFocusedIdx] = useState(() => {
    const todayIdx = Math.floor((today - gridStart) / 86400000)
    return todayIdx >= 0 && todayIdx < 42 ? todayIdx : 0
  })

  // Reset focus when anchor month changes
  useEffect(() => {
    const monthFirstSunday = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1))
    const target = sameDay(new Date(today.getFullYear(), today.getMonth(), today.getDate()),
                            new Date(anchor.getFullYear(), anchor.getMonth(), 1))
    // Snap to 1st of the month
    const firstIdx = Math.floor(
      (new Date(anchor.getFullYear(), anchor.getMonth(), 1) - monthFirstSunday) / 86400000
    )
    setFocusedIdx(firstIdx)
  }, [anchor.getFullYear(), anchor.getMonth()])

  // Keyboard nav
  useEffect(() => {
    function onKey(e) {
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      if (inInput) return
      let delta = 0
      if (e.key === 'ArrowLeft'  || e.key === 'h') delta = -1
      else if (e.key === 'ArrowRight' || e.key === 'l') delta = 1
      else if (e.key === 'ArrowUp'    || e.key === 'k') delta = -7
      else if (e.key === 'ArrowDown'  || e.key === 'j') delta = 7
      else if (e.key === ' ') {
        e.preventDefault()
        onDaySummary && onDaySummary(addDays(gridStart, focusedIdx))
        return
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onDayClick && onDayClick(addDays(gridStart, focusedIdx))
        return
      } else return

      e.preventDefault()
      setFocusedIdx(i => Math.max(0, Math.min(41, i + delta)))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [focusedIdx, gridStart, onDayClick, onDaySummary])

  const items = [
    ...events.map(e => ({
      kind: 'event', id: `e-${e.id}`,
      start: new Date(e.start_at), end: new Date(e.end_at),
      title: e.title, type: e.event_type, raw: e,
    })),
    ...runs.map(r => ({
      kind: 'run', id: `r-${r.run_number}-${r.start_log_id}`,
      start: new Date(r.start_at),
      end: r.end_at ? new Date(r.end_at) : new Date(),
      title: `${r.run_number}${r.title ? ' — ' + r.title : ''}`,
      type: 'run', raw: r, ongoing: !r.end_at,
    })),
  ]

  function itemsOnDay(day) {
    const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0)
    const dayEnd   = new Date(day); dayEnd.setHours(23, 59, 59, 999)
    return items.filter(it => dateOverlapsDay(it.start, it.end, dayStart, dayEnd))
      .sort((a, b) => a.start - b.start)
  }

  const cells = []
  for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i))

  return (
    <div className="border-2 sched-border rounded-lg overflow-hidden"
         style={{ backgroundColor: 'var(--surface)' }}>
      {/* Day-of-week header */}
      <div className="grid grid-cols-7 border-b-2 sched-border"
           style={{ backgroundColor: 'var(--surface-2)' }}>
        {DOW_LABELS.map((d, i) => (
          <div key={d}
            className={`text-center text-xs py-1.5 border-r sched-border-r last:border-r-0 ${
              i === 0 ? 'sched-sun' : i === 6 ? 'sched-sat' : ''
            }`}
            style={(i !== 0 && i !== 6) ? { color: 'var(--text-secondary)' } : undefined}>{d}</div>
        ))}
      </div>

      {/* Cells */}
      <div className="grid grid-cols-7 grid-rows-6" style={{ minHeight: '500px' }}>
        {cells.map((day, idx) => {
          const isThisMonth = day.getMonth() === anchor.getMonth()
          const isToday     = sameDay(day, today)
          const isFocused   = focusedIdx === idx
          const dayItems    = itemsOnDay(day)
          return (
            <div
              key={idx}
              onClick={() => { setFocusedIdx(idx); onDayClick && onDayClick(day) }}
              className={`border-r border-b sched-border-r sched-border-b p-1 cursor-pointer transition-colors ${
                idx % 7 === 6 ? 'border-r-0' : ''
              } ${(idx / 7) >= 5 ? 'border-b-0' : ''} ${
                isFocused ? 'ring-2 ring-inset z-10 relative' : ''
              }`}
              style={
                isFocused        ? { backgroundColor: 'var(--focused-day-bg)', '--tw-ring-color': 'var(--focused-day-ring)' }
                : !isThisMonth   ? { backgroundColor: 'var(--surface-2)', opacity: 0.5 }
                : undefined
              }
              onMouseEnter={e => {
                if (!isFocused && isThisMonth) e.currentTarget.style.backgroundColor = 'var(--surface-2)'
              }}
              onMouseLeave={e => {
                if (!isFocused && isThisMonth) e.currentTarget.style.backgroundColor = ''
              }}
            >
              <div className={`text-xs mb-0.5 ${
                isToday ? 'inline-block rounded-full w-5 h-5 text-center leading-5'
                : day.getDay() === 0 ? 'sched-sun'
                : day.getDay() === 6 ? 'sched-sat'
                : ''
              }`}
              style={
                isToday          ? { backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }
                : !isThisMonth   ? { color: 'var(--text-muted)' }
                : (day.getDay() === 0 || day.getDay() === 6) ? undefined
                : { color: 'var(--text-secondary)' }
              }>
                {day.getDate()}
              </div>
              <div className="space-y-0.5">
                {dayItems.slice(0, 4).map(it => (
                  <div
                    key={it.id}
                    onClick={e => {
                      e.stopPropagation()
                      if (it.kind === 'event') onEventClick && onEventClick(it.raw)
                      else if (it.kind === 'run') openLogInTab(it.raw.start_log_id)
                    }}
                    className={`text-[10px] px-1 py-0.5 rounded border truncate ${colors[it.type] || colors.other} hover:opacity-80`}
                    title={`${it.title}\n${it.start.toLocaleString()} - ${it.end.toLocaleString()}`}
                  >
                    {it.kind === 'run' && it.ongoing && <span className="opacity-60">▶ </span>}
                    {it.title}
                  </div>
                ))}
                {dayItems.length > 4 && (
                  <div className="text-[10px] px-1" style={{ color: 'var(--text-muted)' }}>{t('sched_more', dayItems.length - 4)}</div>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
