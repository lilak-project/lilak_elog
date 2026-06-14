import { useState, useEffect, useRef } from 'react'
import {
  Avatar, randomAvatar, Input, Button, Icon, Stack, Row, Grid,
} from 'lilak-ui'
import { useAuth } from '../../context/AuthContext'
import { useTab } from '../../context/TabContext'
import { useLang } from '../../context/LangContext'
import api from '../../api'

/* ── Small glue helpers (pure kit primitives, no Tailwind) ─────────────────── */
function Field({ label, children }) {
  return (
    <label style={{ display: 'block' }}>
      <span style={{ display: 'block', fontSize: 'var(--fs-tiny, 11px)', fontWeight: 500, color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  )
}

function PwField({ value, onChange, placeholder, required, autoFocus, inputRef }) {
  const [show, setShow] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <Input ref={inputRef} type={show ? 'text' : 'password'} value={value} onChange={onChange}
        placeholder={placeholder} required={required} autoFocus={autoFocus} size="md" style={{ paddingRight: 34 }} />
      <button type="button" tabIndex={-1} onClick={() => setShow(s => !s)}
        style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'inline-flex' }}>
        <Icon name={show ? 'eye-off' : 'eye'} size={16} />
      </button>
    </div>
  )
}

function ErrorBanner({ children }) {
  return (
    <div style={{ border: '1px solid var(--danger-text)', backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)', fontSize: 'var(--fs-body, 13px)', padding: '8px 12px', borderRadius: 8 }}>{children}</div>
  )
}

const card = { border: '1px solid var(--border-default)', backgroundColor: 'var(--surface)', borderRadius: 12, boxShadow: '0 1px 2px rgba(0,0,0,.04)', padding: 20 }

/* ── Avatar preview + randomize button (now rolls a random Phosphor icon) ───── */
function ProfilePicker({ shape, color, username, onRoll, busy, label }) {
  return (
    <Row gap={12} align="center">
      <Avatar icon={shape} color={color} seed={username} size={48} />
      <div style={{ flex: 1, minWidth: 0 }}>
        {label && <div style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)', marginBottom: 4 }}>{label}</div>}
        <Button variant="secondary" type="button" onClick={onRoll} disabled={busy} icon={false}>
          <Row gap={5} align="center" as="span"><Icon name="refresh" size={13} />{busy ? '…' : '랜덤'}</Row>
        </Button>
      </div>
    </Row>
  )
}

/* ── Login form ─────────────────────────────────────────────────────────────── */
function LoginForm({ onSuccess }) {
  const { login } = useAuth()
  const { t } = useLang()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [form, setForm] = useState({ username: '', password: '' })
  const [members, setMembers] = useState([])
  const pwRef = useRef(null)

  useEffect(() => { api.get('/users/public').then(r => setMembers(r.data)).catch(() => {}) }, [])

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true); setError(null)
    try { await login(form.username, form.password); onSuccess?.() }
    catch { setError(t('login_error')) }
    finally { setLoading(false) }
  }

  return (
    <Stack gap={16} style={{ maxWidth: 384 }}>
      {error && <ErrorBanner>{error}</ErrorBanner>}
      <form onSubmit={handleSubmit} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); document.activeElement?.blur() } }}>
        <Stack gap={14} style={card}>
          <h3 style={{ margin: 0, fontWeight: 600, color: 'var(--text-secondary)' }}>{t('login_tab')}</h3>
          <Field label={t('login_username')}>
            <Input value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))} required size="md" />
          </Field>
          <Field label={t('login_password')}>
            <PwField inputRef={pwRef} value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} required />
          </Field>
          <Button type="submit" disabled={loading} style={{ width: '100%', padding: '9px 0' }}>
            {loading ? t('login_loading') : t('login_btn')}
          </Button>
        </Stack>
      </form>

      {/* Members quick-select */}
      {members.length > 0 && (
        <div style={{ ...card, padding: 0, overflow: 'hidden' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-2)', fontSize: 'var(--fs-tiny, 11px)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-secondary)' }}>
            {t('login_members')}
          </div>
          <div>
            {members.map(m => (
              <Row key={m.username} gap={12} align="center"
                onClick={() => { setForm(p => ({ ...p, username: m.username })); requestAnimationFrame(() => pwRef.current?.focus()) }}
                style={{ padding: '8px 16px', cursor: 'pointer', borderTop: '1px solid var(--border-subtle)' }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--info-bg)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}>
                <Avatar icon={m.profile_shape} color={m.profile_color} seed={m.username} size={28} />
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 'var(--fs-medium, 14px)', fontWeight: 500, color: 'var(--text-primary)' }}>{m.username}</p>
                  {m.email && <p style={{ margin: 0, fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</p>}
                </div>
              </Row>
            ))}
          </div>
        </div>
      )}
    </Stack>
  )
}

/* ── Register form ──────────────────────────────────────────────────────────── */
function RegisterForm({ onSuccess }) {
  const { login } = useAuth()
  const { t } = useLang()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  // Roll a random Phosphor-icon profile up front; the 랜덤 button re-rolls.
  const [form, setForm] = useState(() => {
    const { profile_shape, profile_color } = randomAvatar()
    return {
      username: '', email: '', password: '', passwordConfirm: '',
      phone: '', experiment_role: '', participation_from: '', participation_to: '',
      profile_shape, profile_color,
    }
  })

  function rollProfile() {
    const { profile_shape, profile_color } = randomAvatar()
    setForm(p => ({ ...p, profile_shape, profile_color }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setError(null)
    if (form.password !== form.passwordConfirm) { setError(t('reg_mismatch')); return }
    if (form.password.length < 4) { setError(t('reg_pw_invalid')); return }
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(form.username)) { setError(t('reg_id_invalid')); return }
    if (!form.email) { setError(t('reg_email_required')); return }
    setLoading(true)
    try {
      await api.post('/auth/register', {
        username: form.username, email: form.email, password: form.password,
        phone: form.phone || null, experiment_role: form.experiment_role || null,
        participation_from: form.participation_from || null, participation_to: form.participation_to || null,
        profile_color: form.profile_color || null, profile_shape: form.profile_shape || null,
      })
      await login(form.username, form.password)
      onSuccess?.()
    } catch (err) {
      setError(err.response?.data?.detail || t('reg_fail'))
    } finally { setLoading(false) }
  }

  const req = <span style={{ color: 'var(--danger-text)' }}>*</span>
  const hint = (text) => <span style={{ marginLeft: 4, color: 'var(--text-muted)' }}>({text})</span>

  return (
    <div style={{ maxWidth: 384 }}>
      {error && <div style={{ marginBottom: 12 }}><ErrorBanner>{error}</ErrorBanner></div>}
      <form onSubmit={handleSubmit} onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); document.activeElement?.blur() } }}>
        <Stack gap={12} style={card}>
          <h3 style={{ margin: 0, fontWeight: 600, color: 'var(--text-secondary)' }}>{t('register_tab')}</h3>

          <div style={{ paddingBottom: 12, borderBottom: '1px solid var(--border-subtle)' }}>
            <ProfilePicker shape={form.profile_shape} color={form.profile_color} username={form.username} onRoll={rollProfile} label={t('reg_profile')} />
          </div>

          <Field label={<>{t('reg_username')} {req}{hint(t('reg_username_hint'))}</>}>
            <Input value={form.username} onChange={e => setForm(p => ({ ...p, username: e.target.value }))} required size="md" />
          </Field>
          <Field label={<>{t('reg_email')} {req}</>}>
            <Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} required placeholder="name@example.com" size="md" />
          </Field>
          <Field label={<>{t('reg_password')} {req}{hint(t('reg_password_hint'))}</>}>
            <PwField value={form.password} onChange={e => setForm(p => ({ ...p, password: e.target.value }))} required placeholder={t('reg_password_placeholder')} />
          </Field>
          <Field label={t('reg_confirm')}>
            <PwField value={form.passwordConfirm} onChange={e => setForm(p => ({ ...p, passwordConfirm: e.target.value }))} required />
          </Field>

          <div style={{ paddingTop: 8, borderTop: '1px solid var(--border-subtle)' }}>
            <p style={{ margin: '0 0 8px', fontSize: 'var(--fs-tiny, 11px)', color: 'var(--text-muted)' }}>선택 항목 — 가능하면 입력해 주세요</p>
            <Stack gap={8}>
              <Field label="전화번호">
                <Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="010-1234-5678" size="md" />
              </Field>
              <Field label="실험에서의 역할">
                <Input value={form.experiment_role} onChange={e => setForm(p => ({ ...p, experiment_role: e.target.value }))} placeholder="shifter / operator / analyst / ..." size="md" />
              </Field>
              <Grid cols={2} gap={8}>
                <Field label="참여 시작">
                  <Input type="date" value={form.participation_from} onChange={e => setForm(p => ({ ...p, participation_from: e.target.value }))} size="md" />
                </Field>
                <Field label="참여 종료">
                  <Input type="date" value={form.participation_to} onChange={e => setForm(p => ({ ...p, participation_to: e.target.value }))} size="md" />
                </Field>
              </Grid>
            </Stack>
          </div>

          <Button type="submit" disabled={loading} style={{ width: '100%', padding: '9px 0' }}>
            {loading ? t('reg_loading') : t('reg_btn')}
          </Button>
        </Stack>
      </form>
    </div>
  )
}

/* ── Logged-in account info / edit form ────────────────────────────────────── */
function AccountInfo() {
  const { user, logout, refreshUser } = useAuth()
  const { activateTab } = useTab()
  const { t } = useLang()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [savedMsg, setSavedMsg] = useState(null)

  const initial = () => ({
    profile_shape: user.profile_shape || null,
    profile_color: user.profile_color || null,
    email: user.email || '', phone: user.phone || '',
    experiment_role: user.experiment_role || '',
    participation_from: user.participation_from || '',
    participation_to: user.participation_to || '',
  })
  const [form, setForm] = useState(initial)

  useEffect(() => {
    setForm(initial())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id, user.email, user.phone, user.experiment_role, user.participation_from, user.participation_to, user.profile_shape, user.profile_color])

  function handleLogout() { logout(); activateTab('logs') }

  function rollProfile() {
    const next = randomAvatar()
    setForm(p => ({ ...p, ...next }))
    setSavedMsg(null)
  }

  const dirty = (
    form.profile_shape !== (user.profile_shape || null) ||
    form.profile_color !== (user.profile_color || null) ||
    form.email !== (user.email || '') || form.phone !== (user.phone || '') ||
    form.experiment_role !== (user.experiment_role || '') ||
    form.participation_from !== (user.participation_from || '') ||
    form.participation_to !== (user.participation_to || '')
  )

  async function save() {
    if (!dirty || saving) return
    setSaving(true); setError(null); setSavedMsg(null)
    try {
      await api.patch('/auth/me', {
        profile_shape: form.profile_shape, profile_color: form.profile_color,
        email: form.email, phone: form.phone, experiment_role: form.experiment_role,
        participation_from: form.participation_from, participation_to: form.participation_to,
      })
      if (refreshUser) await refreshUser()
      setSavedMsg(t('settings_saved'))
      setTimeout(() => setSavedMsg(null), 2000)
    } catch (e) {
      setError(e.response?.data?.detail || t('settings_save_failed'))
    } finally { setSaving(false) }
  }

  // ── Change my password (self-service; verifies the current one) ──
  const [pw, setPw] = useState({ current: '', next: '' })
  const [pwBusy, setPwBusy] = useState(false)
  const [pwErr, setPwErr] = useState(null)
  const [pwMsg, setPwMsg] = useState(null)
  async function changePassword() {
    if (pwBusy || !pw.current || !pw.next) return
    setPwBusy(true); setPwErr(null); setPwMsg(null)
    try {
      await api.patch('/auth/me/password', { current_password: pw.current, new_password: pw.next })
      setPw({ current: '', next: '' }); setPwMsg(t('projects_pw_ok'))
      setTimeout(() => setPwMsg(null), 2500)
    } catch (e) {
      setPwErr(e.response?.data?.detail || t('projects_pw_fail'))
    } finally { setPwBusy(false) }
  }

  return (
    <Stack gap={16} style={{ maxWidth: 384 }}>
      <Stack gap={16} style={card}>
        {/* Header — live avatar preview + username + role + roll */}
        <Row gap={12} align="center">
          <Avatar icon={form.profile_shape} color={form.profile_color} seed={user.username} size={56} />
          <div>
            <p style={{ margin: 0, fontWeight: 600, fontSize: 'var(--fs-large, 16px)', color: 'var(--text-primary)' }}>{user.username}</p>
            <span style={{ fontSize: 'var(--fs-small, 12px)', padding: '1px 8px', borderRadius: 999, fontWeight: 500,
              ...(user.role === 'manager'
                ? { backgroundColor: 'var(--warning-bg)', color: 'var(--warning-text)' }
                : { backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)' }) }}>
              {user.role}
            </span>
          </div>
          <Button variant="secondary" type="button" onClick={rollProfile} style={{ marginLeft: 'auto' }}>
            <Row gap={5} align="center" as="span"><Icon name="refresh" size={13} />{t('settings_roll_profile')}</Row>
          </Button>
        </Row>

        {/* Editable fields */}
        <Stack gap={12} style={{ paddingTop: 12, borderTop: '1px solid var(--border-subtle)' }}>
          <Field label={t('reg_email')}>
            <Input type="email" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="name@example.com" size="md" />
          </Field>
          <Field label="전화번호">
            <Input value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="010-1234-5678" size="md" />
          </Field>
          <Field label="실험에서의 역할">
            <Input value={form.experiment_role} onChange={e => setForm(p => ({ ...p, experiment_role: e.target.value }))} placeholder="shifter / operator / analyst / ..." size="md" />
          </Field>
          <Grid cols={2} gap={8}>
            <Field label="참여 시작">
              <Input type="date" value={form.participation_from} onChange={e => setForm(p => ({ ...p, participation_from: e.target.value }))} size="md" />
            </Field>
            <Field label="참여 종료">
              <Input type="date" value={form.participation_to} onChange={e => setForm(p => ({ ...p, participation_to: e.target.value }))} size="md" />
            </Field>
          </Grid>
        </Stack>

        {error && <ErrorBanner>{error}</ErrorBanner>}
        {savedMsg && <div style={{ fontSize: 'var(--fs-small, 12px)', textAlign: 'center', color: 'var(--info-text)' }}>{savedMsg}</div>}

        <Button type="button" onClick={save} disabled={!dirty || saving} style={{ width: '100%', padding: '9px 0', opacity: (!dirty || saving) ? 0.5 : 1 }}>
          {saving ? t('settings_saving') : t('settings_save')}
        </Button>
        <Button variant="dangerSoft" type="button" onClick={handleLogout} style={{ width: '100%', padding: '8px 0' }}>
          {t('nav_logout')}
        </Button>
      </Stack>

      {/* Change password */}
      <Stack gap={12} style={card}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: 'var(--fs-body, 13px)', color: 'var(--text-primary)' }}>{t('projects_change_pw')}</p>
        <Field label={t('projects_pw_current')}>
          <PwField value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} />
        </Field>
        <Field label={t('projects_pw_new')}>
          <PwField value={pw.next} onChange={e => setPw(p => ({ ...p, next: e.target.value }))} />
        </Field>
        {pwErr && <ErrorBanner>{pwErr}</ErrorBanner>}
        {pwMsg && <div style={{ fontSize: 'var(--fs-small, 12px)', textAlign: 'center', color: 'var(--info-text)' }}>{pwMsg}</div>}
        <Button type="button" onClick={changePassword} disabled={pwBusy || !pw.current || !pw.next}
          style={{ width: '100%', padding: '9px 0', opacity: (pwBusy || !pw.current || !pw.next) ? 0.5 : 1 }}>
          {t('projects_pw_submit')}
        </Button>
      </Stack>
    </Stack>
  )
}

/* ── Main export ────────────────────────────────────────────────────────────── */
export default function AccountSection() {
  const { user } = useAuth()
  const { activateTab } = useTab()
  const { t } = useLang()
  const [subTab, setSubTab] = useState('login')

  function onLoginSuccess() { activateTab('logs') }

  if (user) return <AccountInfo />

  return (
    <Stack gap={16}>
      <Row gap={4} style={{ width: 192 }}>
        <Button variant={subTab === 'login' ? 'primary' : 'secondary'} onClick={() => setSubTab('login')} style={{ flex: 1, padding: '6px 0' }}>{t('login_tab')}</Button>
        <Button variant={subTab === 'register' ? 'primary' : 'secondary'} onClick={() => setSubTab('register')} style={{ flex: 1, padding: '6px 0' }}>{t('register_tab')}</Button>
      </Row>
      {subTab === 'login' && <LoginForm onSuccess={onLoginSuccess} />}
      {subTab === 'register' && <RegisterForm onSuccess={onLoginSuccess} />}
    </Stack>
  )
}
