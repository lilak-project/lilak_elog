/**
 * SystemPanel — content of the system Drawer. Holds the lightweight settings
 * (theme / density / size / language), admin shortcuts, the account area, and
 * the notifications list. Composed from kit blocks + elog contexts (glue).
 */
import { useEffect, useState } from 'react'
import { Row, Stack, Button, useTaggables } from 'lilak-ui'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { useTheme } from '../context/ThemeContext'
import { useTab } from '../context/TabContext'
import api from '../api'

// The drawer uses the dark nav-* palette (it reads as the top bar dropping
// down), so the panel content is styled for a dark surface.
function Chip({ active, onClick, children, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        height: 30, padding: '0 12px', borderRadius: 8, cursor: 'pointer', fontSize: 'var(--fs-small, 12px)',
        borderWidth: 1, borderStyle: 'solid',
        borderColor: active ? 'var(--nav-text-muted)' : 'var(--nav-border)',
        backgroundColor: active ? 'var(--nav-text)' : 'var(--nav-accent)',
        color: active ? 'var(--nav-bg)' : 'var(--nav-text)',
        transition: 'background-color .12s, border-color .12s, color .12s',
      }}
    >{children}</button>
  )
}

function Section({ label, children }) {
  return (
    <Stack gap={8}>
      <div style={{ fontSize: 'var(--fs-micro, 10px)', textTransform: 'uppercase', letterSpacing: '.06em', color: 'var(--nav-text-muted)' }}>{label}</div>
      {children}
    </Stack>
  )
}

function NotificationsView({ onClose }) {
  const { t } = useLang()
  const { activateTab } = useTab()
  const [notifs, setNotifs] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    api.get('/notifications').then((r) => { if (alive) setNotifs(r.data || []) })
      .catch(() => {}).finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [])

  async function markAllRead() {
    try { await api.post('/notifications/read-all'); setNotifs((p) => p.map((n) => ({ ...n, is_read: true }))) } catch {}
  }
  function click(n) {
    if (n.log_id) { activateTab('logs'); setTimeout(() => window.dispatchEvent(new CustomEvent('lilak:cmd:open-log', { detail: { id: Number(n.log_id) } })), 100) }
    else if (n.notif_type === 'mention') activateTab('community')
    onClose?.()
  }

  // Register notifications into the data index (`!<n>` / `!name`).
  useTaggables(() => notifs.map((n, i) => ({
    id: `notif:${n.id}`,
    label: `${n.from_user_name || ''} · ${n.notif_type === 'mention' ? '멘션' : '댓글'}${n.log_id ? ' #' + n.log_id : ''}`,
    number: i + 1,
    tags: [n.notif_type, n.is_read ? null : 'unread'].filter(Boolean),
    kind: 'notification',
    run: () => click(n),
  })), [notifs])

  if (loading) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--nav-text-muted)', fontSize: 'var(--fs-body, 13px)' }}>{t('home_loading') || 'Loading…'}</div>
  if (!notifs.length) return <div style={{ padding: 24, textAlign: 'center', color: 'var(--nav-text-muted)', fontSize: 'var(--fs-body, 13px)' }}>{t('notif_empty') || 'No notifications'}</div>

  return (
    <Stack gap={6}>
      <Row justify="end"><Chip onClick={markAllRead}>{t('notif_read_all') || 'Mark all read'}</Chip></Row>
      {notifs.map((n) => (
        <button key={n.id} onClick={() => click(n)} style={{
          textAlign: 'left', padding: '10px 12px', borderRadius: 8, cursor: 'pointer',
          borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--nav-border)',
          backgroundColor: n.is_read ? 'transparent' : 'var(--nav-accent)', color: 'var(--nav-text)',
        }}>
          <div style={{ fontSize: 'var(--fs-small, 12px)' }}>
            <span style={{ fontWeight: 600 }}>{n.from_user_name}</span>{' '}
            {n.notif_type === 'mention' ? (t('notif_mentioned_you') || 'mentioned you')
              : <>{t('notif_commented_on') || 'commented on'} <span>#{n.log_id}</span> {n.log_title}</>}
          </div>
          {n.comment_excerpt && <div style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--nav-text-muted)', marginTop: 2 }}>"{n.comment_excerpt}"</div>}
          <div style={{ fontSize: 'var(--fs-micro, 10px)', color: 'var(--nav-text-muted)', marginTop: 4 }}>{new Date(n.created_at).toLocaleString()}</div>
        </button>
      ))}
    </Stack>
  )
}

export default function SystemPanel({ onClose }) {
  const { user, logout } = useAuth()
  const { t, lang, set: setLang } = useLang()
  const { theme, set: setTheme, themes } = useTheme()
  const { openSettings } = useTab()

  const go = (section) => { openSettings(section); onClose?.() }

  // Two-column drawer: left 2/3 = notices, right 1/3 = account + settings.
  return (
    <div style={{ display: 'flex', gap: 0, alignItems: 'stretch', minHeight: '100%' }}>
      {/* ── Left 2/3 — notices ─────────────────────────────────────────────── */}
      <div style={{ flex: 2, minWidth: 0, paddingRight: 18 }}>
        <Section label={t('notif_title') || 'Notifications'}>
          {user
            ? <NotificationsView onClose={onClose} />
            : <div style={{ padding: 24, textAlign: 'center', color: 'var(--nav-text-muted)', fontSize: 'var(--fs-body, 13px)' }}>{t('login_read_only') || 'Log in to see notifications.'}</div>}
        </Section>
      </div>

      {/* ── Right 1/3 — account + the two lightweight settings (theme/language) ── */}
      <div style={{ flex: 1, minWidth: 0, paddingLeft: 18, borderLeft: '1px solid var(--nav-border)' }}>
        <Stack gap={14}>
          {/* Account */}
          <Section label={t('nav_account') || 'Account'}>
            {user ? (
              <Stack gap={8}>
                <Stack gap={2}>
                  <span style={{ fontSize: 'var(--fs-medium, 14px)', fontWeight: 600, color: 'var(--nav-text)' }}>{user.username}</span>
                  <span style={{ fontSize: 'var(--fs-tiny, 11px)', color: 'var(--nav-text-muted)' }}>{user.role}</span>
                </Stack>
                <Row gap={6} wrap>
                  <Chip onClick={() => go('account')}>{t('settings_account') || '계정 설정'}</Chip>
                  <Chip onClick={() => { logout(); onClose?.() }}>{t('nav_logout') || 'Log out'}</Chip>
                </Row>
              </Stack>
            ) : (
              <Button variant="primary" size="sm" onClick={() => go('account')}>{t('nav_login') || 'Log in'}</Button>
            )}
          </Section>

          {/* Theme */}
          <Section label={t('set_theme') || 'Theme'}>
            <Row gap={6} wrap>
              {themes.map((th) => <Chip key={th} active={theme === th} onClick={() => setTheme(th)}>{t(`theme_${th}`) || th}</Chip>)}
            </Row>
          </Section>

          {/* Language */}
          <Section label={t('set_lang') || 'Language'}>
            <Row gap={6}>
              {['ko', 'en'].map((l) => <Chip key={l} active={lang === l} onClick={() => setLang(l)}>{l === 'ko' ? '한국어' : 'EN'}</Chip>)}
            </Row>
          </Section>
        </Stack>
      </div>
    </div>
  )
}
