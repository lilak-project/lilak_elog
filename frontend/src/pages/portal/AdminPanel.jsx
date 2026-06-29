import { useEffect, useState } from 'react'
import { Modal, Button, Icon } from 'lilak-ui'
import { launcher } from '../../api'
import { useLang } from '../../context/LangContext'

/**
 * AdminPanel — the portal admin's access-management surface (admins only).
 *
 * One place to: resolve pending access requests, set each service's visibility
 * tier, and toggle per-account permissions. Drives the `/api/admin/*` endpoints.
 */

const VIS_OPTS = [
  { v: 1, key: 'portal_vis_private' },
  { v: 2, key: 'portal_vis_protected' },
  { v: 3, key: 'portal_vis_admin' },
]

const sectionHdr = { fontSize: 'var(--fs-small, 12px)', fontWeight: 600, color: 'var(--text-secondary)', margin: '4px 0 8px' }
const reqRow = { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }
const kindBadge = { fontSize: 'var(--fs-micro, 10px)', padding: '1px 6px', borderRadius: 999, backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }
const selectStyle = { height: 28, borderRadius: 6, fontSize: 'var(--fs-small, 12px)', padding: '0 6px', backgroundColor: 'var(--input-bg)', color: 'var(--text-primary)', border: '1px solid var(--input-border)' }
const chip = { display: 'inline-flex', alignItems: 'center', gap: 3, fontSize: 'var(--fs-micro, 10px)', padding: '3px 8px', borderRadius: 999, cursor: 'pointer', border: '1px solid var(--border-default)', background: 'var(--surface)', color: 'var(--text-secondary)' }
const chipOn = { background: 'var(--btn-primary-bg)', color: '#fff', borderColor: 'var(--btn-primary-bg)' }

export default function AdminPanel({ onClose, onChanged }) {
  const { t } = useLang()
  const [services, setServices] = useState([])
  const [users, setUsers] = useState([])
  const [perms, setPerms] = useState(new Set())   // `${user_id}:${service}`
  const [requests, setRequests] = useState([])
  const [err, setErr] = useState('')

  async function load() {
    try {
      const [s, u, p, r] = await Promise.all([
        launcher.get('/admin/services'),
        launcher.get('/admin/users'),
        launcher.get('/admin/permissions'),
        launcher.get('/admin/access-requests'),
      ])
      setServices(s.data); setUsers(u.data)
      setPerms(new Set(p.data.map((x) => `${x.user_id}:${x.service}`)))
      setRequests(r.data)
    } catch (e) {
      setErr(e?.response?.data?.detail || t('portal_admin_load_fail'))
    }
  }
  useEffect(() => { load() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  async function setVis(name, v) {
    await launcher.put(`/admin/services/${name}`, { visibility: Number(v) })
    setServices((s) => s.map((x) => (x.name === name ? { ...x, visibility: Number(v) } : x)))
    onChanged?.()
  }

  async function togglePerm(uid, name) {
    const key = `${uid}:${name}`
    const has = perms.has(key)
    if (has) await launcher.delete('/admin/permissions', { data: { user_id: uid, service: name } })
    else await launcher.post('/admin/permissions', { user_id: uid, service: name })
    setPerms((s) => { const n = new Set(s); has ? n.delete(key) : n.add(key); return n })
    onChanged?.()
  }

  async function resolve(rid, action) {
    await launcher.post(`/admin/access-requests/${rid}`, { action })
    await load(); onChanged?.()
  }

  const normalUsers = users.filter((u) => u.role !== 'manager')

  return (
    <Modal title={t('portal_admin_title')} width={600} onClose={onClose}>
      {err && <div style={{ color: 'var(--danger-text)', fontSize: 'var(--fs-small, 12px)', marginBottom: 10 }}>{err}</div>}

      {requests.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={sectionHdr}>{t('portal_admin_requests')}</div>
          {requests.map((r) => (
            <div key={r.id} style={reqRow}>
              <span style={{ flex: 1, fontSize: 'var(--fs-small, 12px)', color: 'var(--text-primary)' }}>
                <b>{r.username}</b> → <span style={{ fontFamily: 'var(--font-mono)' }}>{r.service}</span>
              </span>
              <Button size="sm" variant="primary" onClick={() => resolve(r.id, 'approve')}>{t('portal_admin_approve')}</Button>
              <Button size="sm" variant="ghost" onClick={() => resolve(r.id, 'reject')}>{t('portal_admin_reject')}</Button>
            </div>
          ))}
        </div>
      )}

      <div style={sectionHdr}>{t('portal_admin_services')}</div>
      {services.map((svc) => (
        <div key={svc.name} style={{ border: '1px solid var(--border-default)', borderRadius: 8, padding: 10, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 600, fontSize: 'var(--fs-body, 13px)', color: 'var(--text-primary)' }}>{svc.name}</span>
            <span style={kindBadge}>{svc.kind}</span>
            <div style={{ flex: 1 }} />
            <select value={svc.visibility} onChange={(e) => setVis(svc.name, e.target.value)} style={selectStyle}>
              {VIS_OPTS.map((o) => <option key={o.v} value={o.v}>{t(o.key)}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {normalUsers.length === 0 ? (
              <span style={{ fontSize: 'var(--fs-micro, 10px)', color: 'var(--text-muted)' }}>{t('portal_admin_no_users')}</span>
            ) : normalUsers.map((u) => {
              const on = perms.has(`${u.id}:${svc.name}`)
              return (
                <button key={u.id} type="button" onClick={() => togglePerm(u.id, svc.name)}
                  style={{ ...chip, ...(on ? chipOn : {}) }} title={u.email || u.username}>
                  {on && <Icon name="check" size={11} />} {u.username}
                </button>
              )
            })}
          </div>
        </div>
      ))}
    </Modal>
  )
}
