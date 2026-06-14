import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'

const inputCls = 'border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--input-focus-border)]'
const inputStyle = { backgroundColor: 'var(--input-bg)', borderColor: 'var(--input-border)', color: 'var(--text-primary)', width: 120 }

function StatCard({ label, value }) {
  return (
    <div className="rounded-xl border px-4 py-3"
         style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-default)' }}>
      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</div>
      <div className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{value ?? '—'}</div>
    </div>
  )
}

export default function AdminLogManagement() {
  const { user } = useAuth()
  const { lang } = useLang()
  const navigate = useNavigate()
  const ko = lang === 'ko'

  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)

  const [start, setStart] = useState('')
  const [end, setEnd] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    api.get('/logs/management/summary')
      .then(r => setSummary(r.data))
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!user || user.role !== 'manager') { navigate('/', { replace: true }); return }
    load()
  }, [user, load, navigate])

  function buildPayload() {
    const s = start.trim() === '' ? null : Number(start)
    const e = end.trim() === '' ? null : Number(end)
    return { start: s, end: e }
  }

  async function doDelete() {
    const { start: s, end: e } = buildPayload()
    if (s === null && e === null) { setErr(ko ? '범위를 입력하세요.' : 'Enter a range.'); return }
    const rangeText = `${s ?? '처음'} ~ ${e ?? '끝'}`
    if (!window.confirm(ko
      ? `로그 #${rangeText} 범위를 삭제할까요? (복구 가능)`
      : `Delete logs in #${rangeText}? (restorable)`)) return
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await api.post('/logs/management/bulk-delete', buildPayload())
      setMsg(ko ? `${r.data.deleted}개 로그를 삭제했습니다.` : `Deleted ${r.data.deleted} log(s).`)
      load()
    } catch (e2) {
      setErr(e2.response?.data?.detail || e2.message || 'failed')
    } finally { setBusy(false) }
  }

  async function doRestore() {
    const { start: s, end: e } = buildPayload()
    if (s === null && e === null) { setErr(ko ? '범위를 입력하세요.' : 'Enter a range.'); return }
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await api.post('/logs/management/bulk-restore', buildPayload())
      setMsg(ko ? `${r.data.restored}개 로그를 복구했습니다.` : `Restored ${r.data.restored} log(s).`)
      load()
    } catch (e2) {
      setErr(e2.response?.data?.detail || e2.message || 'failed')
    } finally { setBusy(false) }
  }

  if (loading && !summary) {
    return <div className="text-center py-12" style={{ color: 'var(--text-muted)' }}>{ko ? '불러오는 중…' : 'Loading…'}</div>
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Summary */}
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-secondary)' }}>
          {ko ? '로그 요약' : 'Log Summary'}
        </h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <StatCard label={ko ? '활성 로그' : 'Active logs'} value={summary?.total_active} />
          <StatCard label={ko ? '삭제됨' : 'Deleted'} value={summary?.total_deleted} />
          <StatCard label={ko ? '로그 번호 범위' : 'Log # range'}
                    value={summary ? `${summary.min_log_index ?? '—'}–${summary.max_log_index ?? '—'}` : '—'} />
          <StatCard label={ko ? '태스크 로그' : 'Task logs'} value={summary?.task_count} />
          <StatCard label={ko ? '수동(사람)' : 'Human'} value={summary?.human_count} />
          <StatCard label={ko ? '자동' : 'Auto'} value={summary?.auto_count} />
        </div>

        {summary?.by_level && Object.keys(summary.by_level).length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(summary.by_level).map(([lvl, c]) => (
              <span key={lvl} className="text-xs px-2 py-1 rounded-full border"
                    style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>
                {lvl}: <b>{c}</b>
              </span>
            ))}
          </div>
        )}

        {summary?.by_source?.length > 0 && (
          <div className="mt-3">
            <div className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{ko ? '소스별 (상위 10)' : 'By source (top 10)'}</div>
            <div className="flex flex-wrap gap-2">
              {summary.by_source.map(s => (
                <span key={s.source} className="text-xs px-2 py-1 rounded-full"
                      style={{ backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
                  {s.source}: <b>{s.count}</b>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Bulk delete by range */}
      <div className="rounded-xl border p-4 space-y-3"
           style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border-default)' }}>
        <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          {ko ? '로그 번호 범위로 삭제' : 'Delete by log # range'}
        </h2>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {ko
            ? '범위(포함)에 해당하는 로그를 삭제합니다. 한쪽만 비워두면 처음/끝까지 적용됩니다. 삭제는 복구 가능합니다.'
            : 'Soft-deletes logs in the inclusive range. Leave one side blank for open-ended. Deletion is restorable.'}
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{ko ? '시작 #' : 'Start #'}</label>
            <input type="number" value={start} onChange={e => setStart(e.target.value)}
                   placeholder={summary?.min_log_index ?? '0'} className={inputCls} style={inputStyle} />
          </div>
          <div>
            <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{ko ? '끝 #' : 'End #'}</label>
            <input type="number" value={end} onChange={e => setEnd(e.target.value)}
                   placeholder={summary?.max_log_index ?? '∞'} className={inputCls} style={inputStyle} />
          </div>
          <button onClick={doDelete} disabled={busy}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-50"
                  style={{ backgroundColor: 'var(--danger-text)', color: '#ffffff' }}>
            {ko ? '삭제' : 'Delete'}
          </button>
          <button onClick={doRestore} disabled={busy}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium border disabled:opacity-50"
                  style={{ borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>
            {ko ? '복구' : 'Restore'}
          </button>
        </div>
        {msg && <div className="text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success-text)' }}>{msg}</div>}
        {err && <div className="text-xs px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)' }}>{err}</div>}
      </div>
    </div>
  )
}
