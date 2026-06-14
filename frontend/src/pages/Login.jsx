import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import api from '../api'
import Logo from '../components/Logo'
import {
  btnPrimary, btnPrimaryHover,
  modalFrame, inputBase, inlineLink,
  hoverify,
} from '../theme/uiStyles'

/** Eye-toggle password input */
function PwField({ value, onChange, placeholder, required, autoFocus, className }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        required={required}
        autoFocus={autoFocus}
        className={`w-full border rounded-lg px-3 py-2 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--input-focus-border)] ${className || ''}`}
        style={inputBase}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 transition-colors"
        style={{ color: 'var(--text-muted)' }}
        onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
        onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
        tabIndex={-1}
        aria-label={show ? '비밀번호 숨기기' : '비밀번호 보기'}
      >
        {show
          ? /* eye-off */
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 4.411m0 0L21 21" />
            </svg>
          : /* eye */
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
        }
      </button>
    </div>
  )
}

// Common form input class used in the auth forms — paired with `inputBase` inline style.
const fieldInputCls = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--input-focus-border)]'
const labelCls = 'block text-sm font-medium mb-1'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const { t } = useLang()
  const [tab, setTab] = useState('login')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [members, setMembers] = useState([])

  const [loginForm, setLoginForm] = useState({ username: '', password: '' })
  const [regForm, setRegForm] = useState({
    username: '', email: '', password: '', passwordConfirm: '',
  })

  useEffect(() => {
    api.get('/users/public').then(r => setMembers(r.data)).catch(() => {})
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    setLoading(true); setError(null)
    try {
      await login(loginForm.username, loginForm.password)
      navigate('/')
    } catch {
      setError(t('login_error'))
    } finally {
      setLoading(false)
    }
  }

  async function handleRegister(e) {
    e.preventDefault()
    setError(null)

    if (regForm.password !== regForm.passwordConfirm) {
      setError(t('reg_mismatch')); return
    }
    if (regForm.password.length < 4) {
      setError(t('reg_pw_invalid')); return
    }
    if (!/^[A-Za-z0-9_-]{3,32}$/.test(regForm.username)) {
      setError(t('reg_id_invalid')); return
    }
    if (!regForm.email) {
      setError(t('reg_email_required')); return
    }

    setLoading(true)
    try {
      await api.post('/auth/register', {
        username: regForm.username,
        email: regForm.email,
        password: regForm.password,
      })
      await login(regForm.username, regForm.password)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.detail || t('reg_fail'))
    } finally {
      setLoading(false)
    }
  }

  // Tab pill: primary button for the active tab, ghost button for the inactive one.
  function tabBtnStyle(active) {
    return active
      ? { ...btnPrimary }
      : { backgroundColor: 'var(--surface)', color: 'var(--text-secondary)' }
  }

  return (
    <div className="max-w-sm mx-auto mt-10">
      <div className="text-center mb-8">
        <div className="flex justify-center mb-3">
          <Logo className="h-14 w-14" style={{ color: 'var(--text-link)' }} />
        </div>
        <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>LILAK Elog</h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>{t('login_subtitle')}</p>
      </div>

      {/* Tab */}
      <div className="flex rounded-lg border overflow-hidden mb-5" style={{ borderColor: 'var(--border-default)' }}>
        <button
          onClick={() => { setTab('login'); setError(null) }}
          className="flex-1 py-2 text-sm font-medium transition-colors"
          style={tabBtnStyle(tab === 'login')}
        >
          {t('login_tab')}
        </button>
        <button
          onClick={() => { setTab('register'); setError(null) }}
          className="flex-1 py-2 text-sm font-medium transition-colors"
          style={tabBtnStyle(tab === 'register')}
        >
          {t('register_tab')}
        </button>
      </div>

      <div className="rounded-xl border shadow-sm p-6" style={modalFrame}>
        {error && (
          <div className="mb-4 border text-sm px-4 py-3 rounded-lg"
               style={{ backgroundColor: 'var(--danger-bg)', borderColor: 'var(--danger-text)', color: 'var(--danger-text)' }}>
            {error}
          </div>
        )}

        {/* Login form */}
        {tab === 'login' && (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label className={labelCls} style={{ color: 'var(--text-secondary)' }}>{t('login_username')}</label>
              <input
                type="text"
                value={loginForm.username}
                onChange={e => setLoginForm(p => ({ ...p, username: e.target.value }))}
                required autoFocus
                className={fieldInputCls}
                style={inputBase}
              />
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--text-secondary)' }}>{t('login_password')}</label>
              <PwField
                value={loginForm.password}
                onChange={e => setLoginForm(p => ({ ...p, password: e.target.value }))}
                required
              />
            </div>
            <button
              type="submit" disabled={loading}
              className="w-full disabled:opacity-50 py-2.5 rounded-lg text-sm font-medium transition-colors"
              style={btnPrimary}
              {...hoverify(btnPrimary, btnPrimaryHover)}
            >
              {loading ? t('login_loading') : t('login_btn')}
            </button>
          </form>
        )}

        {/* Register form */}
        {tab === 'register' && (
          <form onSubmit={handleRegister} className="space-y-3">
            <div>
              <label className={labelCls} style={{ color: 'var(--text-secondary)' }}>
                {t('reg_username')} <span style={{ color: 'var(--danger-text)' }}>*</span>
                <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>({t('reg_username_hint')})</span>
              </label>
              <input
                type="text"
                value={regForm.username}
                onChange={e => setRegForm(p => ({ ...p, username: e.target.value }))}
                required autoFocus
                className={fieldInputCls}
                style={inputBase}
              />
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--text-secondary)' }}>
                {t('reg_email')} <span style={{ color: 'var(--danger-text)' }}>*</span>
              </label>
              <input
                type="email"
                value={regForm.email}
                onChange={e => setRegForm(p => ({ ...p, email: e.target.value }))}
                required
                placeholder="name@example.com"
                className={fieldInputCls}
                style={inputBase}
              />
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--text-secondary)' }}>
                {t('reg_password')} <span style={{ color: 'var(--danger-text)' }}>*</span>
                <span className="text-xs ml-1" style={{ color: 'var(--text-muted)' }}>({t('reg_password_hint')})</span>
              </label>
              <PwField
                value={regForm.password}
                onChange={e => setRegForm(p => ({ ...p, password: e.target.value }))}
                required
                placeholder={t('reg_password_placeholder')}
              />
            </div>
            <div>
              <label className={labelCls} style={{ color: 'var(--text-secondary)' }}>{t('reg_confirm')}</label>
              <PwField
                value={regForm.passwordConfirm}
                onChange={e => setRegForm(p => ({ ...p, passwordConfirm: e.target.value }))}
                required
              />
            </div>
            <button
              type="submit" disabled={loading}
              className="w-full disabled:opacity-50 py-2.5 rounded-lg text-sm font-medium transition-colors"
              style={btnPrimary}
              {...hoverify(btnPrimary, btnPrimaryHover)}
            >
              {loading ? t('reg_loading') : t('reg_btn')}
            </button>
          </form>
        )}
      </div>

      {/* Registered members */}
      {members.length > 0 && (
        <div className="mt-5 rounded-xl border shadow-sm overflow-hidden" style={modalFrame}>
          <div className="px-4 py-2.5 border-b text-xs font-semibold uppercase tracking-wide"
               style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }}>
            {t('login_members')}
          </div>
          <ul className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {members.map(m => (
              <li
                key={m.username}
                className="px-4 py-2.5 flex items-center gap-3 cursor-pointer transition-colors"
                onClick={() => {
                  setTab('login')
                  setLoginForm(p => ({ ...p, username: m.username }))
                  document.querySelector('input[type=password]')?.focus()
                }}
                onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--info-bg)'}
                onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}
              >
                <div className="h-7 w-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                     style={{ backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' }}>
                  {m.username[0].toUpperCase()}
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight" style={{ color: 'var(--text-primary)' }}>
                    {m.username}
                  </p>
                  {m.email && (
                    <p className="text-xs truncate" style={{ color: 'var(--text-muted)' }}>{m.email}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-center text-xs mt-4" style={{ color: 'var(--text-muted)' }}>
        {t('login_read_only')}{' '}
        <Link to="/" className="hover:underline" style={inlineLink}>{t('login_go_home')}</Link>
      </p>
    </div>
  )
}
