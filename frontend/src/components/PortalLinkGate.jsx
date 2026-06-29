import { useEffect, useState } from 'react'
import api, { PORTAL_BASE } from '../api'

/**
 * PortalLinkGate — shown once when a portal user enters an experiment that already
 * has an INDEPENDENT local account with the same email. The backend refuses to
 * silently take it over (409 PORTAL_LINK_REQUIRED); the user confirms ownership
 * with that account's local password, which links them. Future entries are then
 * seamless (the account is `portal_linked`). Only relevant under the portal.
 */
export default function PortalLinkGate() {
  const [info, setInfo] = useState(null)     // {email, username} or null
  const [pw, setPw] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    if (!PORTAL_BASE) return
    const onReq = (e) => { setInfo(e.detail || {}); setErr('') }
    window.addEventListener('lilak:portal-link-required', onReq)
    return () => window.removeEventListener('lilak:portal-link-required', onReq)
  }, [])

  if (!info) return null

  async function link() {
    setBusy(true); setErr('')
    try {
      await api.post('/auth/portal-link', { password: pw })
      window.location.reload()                // now linked → re-resolve succeeds
    } catch (e) {
      setErr(e?.response?.data?.detail || '연동에 실패했습니다.')
      setBusy(false)
    }
  }

  const overlay = { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }
  const box = { width: 'min(420px, 92vw)', background: 'var(--surface, #fff)', color: 'var(--text-primary, #111)', borderRadius: 12, padding: 22, boxShadow: '0 16px 48px rgba(0,0,0,0.3)', fontFamily: 'var(--font-sans, system-ui)' }
  const input = { width: '100%', height: 38, borderRadius: 8, padding: '0 12px', marginTop: 8, boxSizing: 'border-box', border: '1px solid var(--border-default, #ccc)', background: 'var(--input-bg, #fff)', color: 'var(--text-primary, #111)' }
  const btn = (primary) => ({ height: 36, padding: '0 16px', borderRadius: 8, cursor: 'pointer', border: primary ? 'none' : '1px solid var(--border-default, #ccc)', background: primary ? 'var(--btn-primary-bg, #4c6ef5)' : 'transparent', color: primary ? '#fff' : 'var(--text-primary, #111)', fontWeight: 600 })

  return (
    <div style={overlay}>
      <div style={box}>
        <h3 style={{ margin: '0 0 6px' }}>기존 계정 연동</h3>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary, #555)' }}>
          이 실험에 같은 이메일(<b>{info.email}</b>)의 기존 계정
          {info.username ? <> <b>{info.username}</b></> : null}이 있습니다.
          본인 계정이 맞다면 그 계정의 <b>비밀번호</b>로 한 번만 연동하세요.
          이후에는 포탈 로그인만으로 바로 들어옵니다.
        </p>
        <input type="password" value={pw} autoFocus placeholder="기존 elog 계정 비밀번호" style={input}
          onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && pw && link()} />
        {err && <div style={{ color: 'var(--danger-text, #e03131)', fontSize: 12, marginTop: 8 }}>{String(err)}</div>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button style={btn(false)} onClick={() => (window.location.href = '/projects')}>취소</button>
          <button style={btn(true)} disabled={busy || !pw} onClick={link}>{busy ? '연동 중…' : '연동하기'}</button>
        </div>
      </div>
    </div>
  )
}
