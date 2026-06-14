import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CrudTable, Modal, Button, Avatar, Row, Stack, useTaggables } from 'lilak-ui'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { useTab } from '../context/TabContext'
import { displayAvatar } from './settings/AccountSection'
import { inputBase } from '../theme/uiStyles'

// Users — rebuilt on the kit CrudTable. The transfer-logs and delete-all-logs
// flows stay as their own modals (they're not row CRUD).
export default function AdminUsers() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { t } = useLang()
  const { openSettings } = useTab()
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const isManager = user?.role === 'manager'

  // require-approval setting (new registrations land inactive until approved)
  const [requireApproval, setRequireApproval] = useState(false)
  useEffect(() => { api.get('/settings').then(r => setRequireApproval(!!r.data.require_approval)).catch(() => {}) }, [])
  async function toggleApproval() {
    const next = !requireApproval
    try { await api.put('/settings', { require_approval: next }); setRequireApproval(next) } catch (e) { setError(e.response?.data?.detail || 'failed') }
  }
  // transfer modal
  const [transferModal, setTransferModal] = useState(false)
  const [transferFrom, setTransferFrom] = useState('')
  const [transferTo, setTransferTo] = useState('')
  const [transferMsg, setTransferMsg] = useState(null)
  const [transferError, setTransferError] = useState(null)
  const [transferring, setTransferring] = useState(false)
  // Manager-password gate for destructive actions (deactivate / delete logs / delete account)
  const [pwGate, setPwGate] = useState(null)   // { title, run } | null
  const [pwVal, setPwVal] = useState('')
  const [pwErr, setPwErr] = useState(null)
  const [pwBusy, setPwBusy] = useState(false)

  function gate(title, runFn) { setPwGate({ title, run: runFn }); setPwVal(''); setPwErr(null) }
  async function confirmGate() {
    if (!pwGate || pwBusy) return
    if (!pwVal) { setPwErr(t('admin_pw_required') || '비밀번호를 입력하세요.'); return }
    setPwBusy(true); setPwErr(null)
    try {
      await api.post('/auth/login', { username: user.username, password: pwVal })   // re-verify the manager
      const runFn = pwGate.run
      setPwGate(null); setPwVal('')
      await runFn()
    } catch (e) {
      setPwErr(e.response?.status === 401 ? (t('admin_pw_wrong') || '비밀번호가 올바르지 않습니다.') : (e.response?.data?.detail || t('admin_save')))
    } finally { setPwBusy(false) }
  }

  // The three gated actions (each opens the password prompt first).
  function askDeactivate(row) {
    gate(`${row.username} ${row.is_active ? t('admin_deactivate') : t('admin_activate')}`,
      async () => { await api.put(`/users/${row.id}`, { is_active: !row.is_active }); await fetchUsers() })
  }
  function askDeleteLogs(row) {
    gate(t('admin_delete_logs_confirm', row.username, row.log_count ?? 0),
      async () => { await api.delete(`/users/${encodeURIComponent(row.username)}/logs`); await fetchUsers() })
  }
  function askDeleteAccount(row, close) {
    gate(t('admin_delete_user_confirm', row.username),
      async () => { await api.delete(`/users/${row.id}`); await fetchUsers(); close?.() })
  }

  useEffect(() => { if (user) fetchUsers() }, [user])

  // Register accounts into the data index (`@<n>` / `@name`).
  useTaggables(() => users.map((u, i) => ({
    id: `user:${u.id}`,
    label: u.username,
    number: i + 1,
    tags: [u.role, u.experiment_role].filter(Boolean),
    keywords: u.email || '',
    kind: 'user',
    run: () => openSettings('users'),
  })), [users, openSettings])
  async function fetchUsers() {
    setLoading(true)
    try { const res = await api.get('/users'); setUsers(res.data) } finally { setLoading(false) }
  }

  async function run(fn) {
    setBusy(true); setError(null)
    try { await fn() } catch (e) { setError(e.response?.data?.detail || t('admin_save')); throw e } finally { setBusy(false) }
  }

  async function handleTransfer(e) {
    e?.preventDefault()
    if (!transferFrom || !transferTo || transferFrom === transferTo) { setTransferError('원본과 대상 계정이 동일합니다.'); return }
    setTransferring(true); setTransferError(null); setTransferMsg(null)
    try {
      const res = await api.post('/users/transfer-logs-admin', { from_username: transferFrom, to_username: transferTo })
      setTransferMsg(t('admin_transfer_ok', res.data.from, res.data.to, res.data.transferred))
      setTransferFrom(''); setTransferTo(''); fetchUsers()
    } catch (err) { setTransferError(err.response?.data?.detail || t('admin_transfer_run')) }
    finally { setTransferring(false) }
  }
  if (!user) return <div style={{ textAlign: 'center', padding: '64px 0', fontSize: 'var(--fs-body, 13px)', color: 'var(--text-muted)' }}>로그인 후 등록된 계정 목록을 볼 수 있습니다.</div>

  const badge = (text, tone) => (
    <span style={{ fontSize: 'var(--fs-micro, 10px)', padding: '1px 8px', borderRadius: 999, whiteSpace: 'nowrap', ...tone }}>{text}</span>
  )
  const roleTone = (r) => r === 'manager' ? { backgroundColor: 'var(--warning-bg)', color: 'var(--warning-text)' } : { backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)' }
  const statusTone = (a) => a ? { backgroundColor: 'var(--success-bg)', color: 'var(--success-text)' } : { backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)' }
  const banner = (tone) => ({ border: `1px solid ${tone === 'ok' ? 'var(--success-text)' : 'var(--danger-text)'}`, backgroundColor: tone === 'ok' ? 'var(--success-bg)' : 'var(--danger-bg)', color: tone === 'ok' ? 'var(--success-text)' : 'var(--danger-text)', fontSize: 'var(--fs-body, 13px)', padding: '8px 12px', borderRadius: 8 })
  const selectStyle = { ...inputBase, width: '100%', border: '1px solid var(--input-border)', borderRadius: 8, padding: '8px 12px', fontSize: 'var(--fs-body, 13px)', outline: 'none' }

  return (
    <div style={{ maxWidth: 1024, margin: '0 auto' }}>
      <CrudTable
        rows={users}
        rowKey={(r) => r.id}
        loading={loading}
        busy={busy}
        error={error}
        headerActions={isManager ? (
          <Row gap={8} align="center" as="span">
            <Button variant={requireApproval ? 'primary' : 'secondary'} onClick={toggleApproval}
              title={t('admin_approval_hint')}>
              {t('admin_approval_toggle')}: {requireApproval ? 'ON' : 'OFF'}
            </Button>
            <Button variant="warning" onClick={() => { setTransferFrom(''); setTransferTo(''); setTransferMsg(null); setTransferError(null); setTransferModal(true) }}>
              {t('admin_transfer_btn')}
            </Button>
          </Row>
        ) : undefined}
        columns={[
          { key: 'username', header: t('admin_col_username'), render: (u) => (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Avatar {...displayAvatar(u)} seed={u.username} size={22} />
              <span style={{ fontFamily: 'var(--font-mono)' }}>{u.username}</span>
              {u.id === user.user_id && <span style={{ fontSize: 'var(--fs-micro, 10px)', color: 'var(--text-link)' }}>{t('admin_me')}</span>}
            </span>
          ) },
          { key: 'email', header: t('admin_col_email'), muted: true, render: (u) => u.email || '—' },
          { key: 'role', header: t('admin_col_role'), fit: true, render: (u) => badge(u.role, roleTone(u.role)) },
          { key: 'status', header: t('admin_col_status'), fit: true, render: (u) => badge(u.is_active ? t('admin_active') : t('admin_inactive'), statusTone(u.is_active)) },
          { key: 'logs', header: '로그', mono: true, fit: true, align: 'right', render: (u) => u.log_count ?? 0 },
        ]}
        formFields={[
          { key: 'username', label: t('admin_col_username'), requiredOnCreate: true, disabledOnEdit: true, placeholder: '3~32 chars' },
          { key: 'email', label: t('admin_col_email'), type: 'email', full: true, placeholder: 'name@example.com' },
          { key: 'password', label: t('reg_password'), type: 'password', requiredOnCreate: true, placeholder: t('reg_password_placeholder') },
          { key: 'role', label: t('admin_col_role'), type: 'select', required: true, options: ['user', 'manager'] },
          { key: 'phone', label: '전화번호', placeholder: '010-1234-5678' },
          { key: 'experiment_role', label: '실험 역할', placeholder: 'shifter / operator / analyst ...' },
          { key: 'participation_from', label: '참여 시작', type: 'date' },
          { key: 'participation_to', label: '참여 종료', type: 'date' },
        ]}
        onCreate={isManager ? (v) => run(async () => { await api.post('/users', v); await fetchUsers() }) : undefined}
        onUpdate={isManager ? (row, v) => run(async () => {
          const p = { email: v.email, phone: v.phone, role: v.role, experiment_role: v.experiment_role, participation_from: v.participation_from, participation_to: v.participation_to }
          if (v.password) p.password = v.password
          await api.put(`/users/${row.id}`, p); await fetchUsers()
        }) : undefined}
        onDelete={isManager ? async (row) => { try { await api.delete(`/users/${row.id}`); await fetchUsers() } catch (e) { alert(e.response?.data?.detail || t('admin_delete')) } } : undefined}
        canEdit={() => false}
        canDelete={() => false}
        extraActions={isManager ? (row, { openEdit }) => (
          <Button variant="secondary" size="sm" onClick={openEdit}>{t('admin_manage') || '관리'}</Button>
        ) : undefined}
        formExtra={isManager ? (row, { close }) => {
          const isSelf = row.id === user.user_id
          return (
            <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
              <span style={{ width: '100%', fontSize: 'var(--fs-tiny, 11px)', color: 'var(--text-muted)' }}>{t('admin_danger_zone') || '관리 작업 — 매니저 비밀번호 확인이 필요합니다.'}</span>
              {!isSelf && (
                <Button variant="warning" size="sm" type="button" onClick={() => askDeactivate(row)}>
                  {row.is_active ? t('admin_deactivate') : t('admin_activate')}
                </Button>
              )}
              {(row.log_count ?? 0) > 0 && (
                <Button variant="dangerSoft" size="sm" type="button" onClick={() => askDeleteLogs(row)}>{t('admin_delete_logs')}</Button>
              )}
              {!isSelf && (
                <Button variant="danger" size="sm" type="button" onClick={() => askDeleteAccount(row, close)}>{t('admin_delete_user')}</Button>
              )}
            </div>
          )
        } : undefined}
        labels={{
          add: t('admin_new_user'), edit: t('admin_save') || '저장', delete: t('admin_delete'),
          newTitle: t('admin_create_title'), editTitle: t('admin_users_title'),
          confirmDelete: (u) => t('admin_delete_user_confirm', u.username),
          empty: t('admin_loading'), loading: t('admin_loading'),
        }}
      />

      {/* Transfer modal */}
      {transferModal && (
        <Modal title={t('admin_transfer_title')} width={460} onClose={() => setTransferModal(false)} onSubmit={() => handleTransfer()}
          footer={<>
            <Button variant="ghost" onClick={() => setTransferModal(false)}>{t('admin_cancel')}</Button>
            <Button variant="warning" disabled={transferring || !transferFrom || !transferTo || transferFrom === transferTo} onClick={() => handleTransfer()}>{transferring ? t('admin_transferring') : t('admin_transfer_run')}</Button>
          </>}>
          <Stack gap={12}>
            <p style={{ margin: 0, fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)' }}>선택한 계정의 모든 로그를 다른 계정으로 이전합니다.</p>
            {transferMsg && <div style={banner('ok')}>{transferMsg}</div>}
            {transferError && <div style={banner('err')}>{transferError}</div>}
            <Row gap={12}>
              {[['from', transferFrom, setTransferFrom, transferTo], ['to', transferTo, setTransferTo, transferFrom]].map(([k, val, setv, other]) => (
                <div key={k} style={{ flex: 1 }}>
                  <label style={{ display: 'block', fontSize: 'var(--fs-tiny, 11px)', fontWeight: 500, marginBottom: 4, color: 'var(--text-secondary)' }}>{k === 'from' ? t('admin_from_id') : t('admin_to_id')}</label>
                  <select value={val} onChange={e => setv(e.target.value)} required style={selectStyle}>
                    <option value="">-- 선택 --</option>
                    {users.map(u => <option key={u.id} value={u.username} disabled={u.username === other}>{u.username} ({u.log_count ?? 0}건)</option>)}
                  </select>
                </div>
              ))}
            </Row>
          </Stack>
        </Modal>
      )}

      {/* Manager-password gate for destructive actions */}
      {pwGate && (
        <Modal title={t('admin_pw_confirm_title') || '매니저 비밀번호 확인'} width={400}
          onClose={() => setPwGate(null)} onSubmit={confirmGate}
          footer={<>
            <Button variant="ghost" onClick={() => setPwGate(null)}>{t('admin_cancel')}</Button>
            <Button variant="danger" disabled={pwBusy || !pwVal} onClick={confirmGate}>{pwBusy ? '…' : (t('admin_confirm') || '확인')}</Button>
          </>}>
          <Stack gap={10}>
            <p style={{ margin: 0, fontSize: 'var(--fs-body, 13px)', color: 'var(--text-primary)' }}>{pwGate.title}</p>
            <p style={{ margin: 0, fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>{t('admin_pw_confirm_hint') || '계속하려면 본인(매니저) 비밀번호를 입력하세요.'}</p>
            <input type="password" autoFocus value={pwVal} onChange={e => setPwVal(e.target.value)} placeholder={t('reg_password')} style={selectStyle}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); confirmGate() } }} />
            {pwErr && <div style={banner('err')}>{pwErr}</div>}
          </Stack>
        </Modal>
      )}
    </div>
  )
}
