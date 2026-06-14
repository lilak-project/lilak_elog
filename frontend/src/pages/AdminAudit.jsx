import { useEffect, useState } from 'react'
import api from '../api'
import { useLang } from '../context/LangContext'

// Friendly labels for the recorded actions.
const ACTION_LABELS = {
  ko: { login: '로그인', logout: '로그아웃', login_failed: '로그인 실패', register: '가입',
    activate: '활성화', deactivate: '비활성화', export: '내보내기', create: '생성',
    update: '수정', delete: '삭제', restore: '복원', confirm: '확인' },
  en: { login: 'login', logout: 'logout', login_failed: 'login failed', register: 'register',
    activate: 'activate', deactivate: 'deactivate', export: 'export', create: 'create',
    update: 'update', delete: 'delete', restore: 'restore', confirm: 'confirm' },
}
const ENTITY_LABELS = {
  ko: { user: '사용자', service: '서비스', webhook: '웹훅', community_bridge: '커뮤니티 브릿지', log_entry: '로그', logs: '로그' },
  en: { user: 'user', service: 'service', webhook: 'webhook', community_bridge: 'bridge', log_entry: 'log', logs: 'logs' },
}
const DANGER = new Set(['login_failed', 'delete', 'deactivate'])
const GOOD = new Set(['login', 'register', 'activate', 'restore', 'confirm'])
const FILTERS = ['', 'login', 'logout', 'login_failed', 'register', 'activate', 'deactivate', 'export', 'create', 'update', 'delete']
const LIMIT = 100

export default function AdminAudit() {
  const { t, lang } = useLang()
  const [events, setEvents] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('')
  const [offset, setOffset] = useState(0)

  async function load() {
    setLoading(true)
    try {
      const params = { limit: LIMIT, offset }
      if (filter) params.action = filter
      const r = await api.get('/audit', { params })
      setEvents(r.data.events || []); setTotal(r.data.total || 0)
    } catch { setEvents([]); setTotal(0) } finally { setLoading(false) }
  }
  useEffect(() => { load() }, [filter, offset])  // eslint-disable-line react-hooks/exhaustive-deps

  const actionLabel = (a) => (ACTION_LABELS[lang] || ACTION_LABELS.en)[a] || a
  const entityLabel = (e) => (ENTITY_LABELS[lang] || ENTITY_LABELS.en)[e] || e
  const tone = (a) => DANGER.has(a) ? 'var(--danger-text)' : GOOD.has(a) ? 'var(--success-text)' : 'var(--text-secondary)'
  const fmtTime = (iso) => { try { return new Date(iso).toLocaleString() } catch { return iso || '' } }

  const th = { textAlign: 'left', padding: '6px 10px', fontSize: 'var(--fs-tiny, 11px)', textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-default)', whiteSpace: 'nowrap' }
  const td = { padding: '6px 10px', fontSize: 'var(--fs-small, 12px)', borderBottom: '1px solid var(--border-subtle)', whiteSpace: 'nowrap' }

  return (
    <div style={{ maxWidth: 1024, margin: '0 auto' }}>
      {/* Action filter */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {FILTERS.map((f) => (
          <button key={f || 'all'} onClick={() => { setOffset(0); setFilter(f) }}
            style={{ fontSize: 'var(--fs-small, 12px)', padding: '3px 10px', borderRadius: 999, cursor: 'pointer',
              border: '1px solid var(--border-default)',
              backgroundColor: filter === f ? 'var(--btn-primary-bg)' : 'var(--surface)',
              color: filter === f ? '#fff' : 'var(--text-secondary)' }}>
            {f ? actionLabel(f) : t('audit_all')}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>{t('admin_loading')}</div>
      ) : events.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)', fontSize: 'var(--fs-small, 12px)' }}>{t('audit_empty')}</div>
      ) : (
        <div style={{ border: '1px solid var(--border-default)', borderRadius: 10, overflow: 'hidden', backgroundColor: 'var(--surface)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>{t('audit_time')}</th>
                <th style={th}>{t('audit_action')}</th>
                <th style={th}>{t('audit_target')}</th>
                <th style={th}>{t('audit_actor')}</th>
                <th style={th}>{t('audit_detail')}</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td style={{ ...td, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>{fmtTime(e.created_at)}</td>
                  <td style={{ ...td, fontWeight: 600, color: tone(e.action) }}>{actionLabel(e.action)}</td>
                  <td style={td}>{entityLabel(e.entity_type)}{e.entity_id != null ? ` #${e.entity_id}` : ''}</td>
                  <td style={{ ...td, fontFamily: 'var(--font-mono)' }}>{e.actor || '—'}</td>
                  <td style={{ ...td, color: 'var(--text-muted)', whiteSpace: 'normal' }}>{e.details || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {total > LIMIT && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginTop: 12, fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)' }}>
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - LIMIT))}
            style={{ background: 'none', border: 'none', cursor: offset === 0 ? 'default' : 'pointer', color: offset === 0 ? 'var(--text-muted)' : 'var(--text-link)' }}>← {t('admin_prev') || 'Prev'}</button>
          <span>{offset + 1}–{Math.min(offset + LIMIT, total)} / {total}</span>
          <button disabled={offset + LIMIT >= total} onClick={() => setOffset(offset + LIMIT)}
            style={{ background: 'none', border: 'none', cursor: offset + LIMIT >= total ? 'default' : 'pointer', color: offset + LIMIT >= total ? 'var(--text-muted)' : 'var(--text-link)' }}>{t('admin_next') || 'Next'} →</button>
        </div>
      )}
    </div>
  )
}
