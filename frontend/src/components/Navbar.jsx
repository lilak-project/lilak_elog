import { useState, useEffect, useRef } from 'react'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { useTheme } from '../context/ThemeContext'
import { useDensity } from '../context/DensityContext'
import { useSize } from '../context/SizeContext'
import { useTab } from '../context/TabContext'
import api from '../api'
import Logo from './Logo'
import NotificationBell from './NotificationBell'
import {
  btnPrimary, btnPrimaryHover,
  inputBase, hoverify,
} from '../theme/uiStyles'

export default function Navbar() {
  const { user, logout } = useAuth()
  const { t, lang, toggle: toggleLang } = useLang()
  const { cycle: cycleTheme, icon: themeIcon, theme } = useTheme()
  const { density, toggle: toggleDensity, isCompact } = useDensity()
  const { size, toggle: toggleSize } = useSize()
  const { activateTab, openSettings } = useTab()
  const [experiment, setExperiment] = useState(null)
  const [launcherPort, setLauncherPort] = useState(8010)

  // User dropdown
  const [showUserMenu, setShowUserMenu] = useState(false)
  const userMenuRef = useRef(null)

  useEffect(() => {
    api.get('/info').then(r => {
      setExperiment(r.data.experiment)
      if (r.data.launcher_port) setLauncherPort(r.data.launcher_port)
    }).catch(() => {})
  }, [])

  useEffect(() => {
    function handleClick(e) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target)) setShowUserMenu(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleBackToProjects() {
    window.location.href = `http://${window.location.hostname}:${launcherPort}`
  }

  function handleLogout() { logout(); activateTab('logs'); setShowUserMenu(false) }

  // Dropdown menu item — inside a white popover surface.
  const menuItemCls = 'block w-full text-left text-xs h-8 flex items-center px-3 rounded-lg transition-colors'
  function onMenuItemEnter(e) {
    e.currentTarget.style.backgroundColor = 'var(--surface-2)'
    e.currentTarget.style.color = 'var(--text-primary)'
  }
  function onMenuItemLeave(e) {
    e.currentTarget.style.backgroundColor = ''
    e.currentTarget.style.color = 'var(--text-secondary)'
  }
  const menuItemStyle = { color: 'var(--text-secondary)' }

  // Pill button inside the nav bar — accent surface over nav-bg.
  const navPillStyle = { backgroundColor: 'var(--nav-accent)', color: 'var(--nav-text)' }
  const navPillHover = { backgroundColor: 'var(--nav-text-muted)', color: 'var(--nav-bg)' }

  // Small "settings" button inside the dropdown (theme/density/size/lang).
  const dropdownChip = 'h-8 flex items-center justify-center text-xs rounded-lg transition-colors'
  const dropdownChipStyle = { backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)' }
  function onChipEnter(e) {
    e.currentTarget.style.backgroundColor = 'var(--surface-3)'
    e.currentTarget.style.color = 'var(--text-primary)'
  }
  function onChipLeave(e) {
    e.currentTarget.style.backgroundColor = 'var(--surface-2)'
    e.currentTarget.style.color = 'var(--text-secondary)'
  }

  // Popover frame (used by both dropdowns).
  const popoverStyle = {
    backgroundColor: 'var(--surface)',
    borderColor:     'var(--border-default)',
    color:           'var(--text-primary)',
  }

  return (
    <nav className="shadow-md relative z-50"
         style={{ backgroundColor: 'var(--nav-bg)' }}>
      <div className="max-w-7xl mx-auto px-3 flex items-center gap-2 h-10">

        {/* Logo */}
        <div className="font-bold text-sm flex items-center gap-2 shrink-0 mr-1"
             style={{ color: 'var(--nav-text)' }}>
          <Logo className="h-5 w-5" style={{ color: 'var(--nav-text)' }} />
          <span className="hidden sm:inline">LILAK Elog</span>
        </div>

        {/* Back to projects (launcher) */}
        <button
          onClick={handleBackToProjects}
          className="h-7 flex items-center gap-1.5 text-xs px-2.5 rounded transition-colors shrink-0"
          style={navPillStyle}
          {...hoverify(navPillStyle, navPillHover)}
          title="프로젝트 목록으로 돌아가기"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          <span className="font-mono">{experiment || 'default'}</span>
        </button>

        <div className="flex-1 min-w-0" />

        {/* Notification bell */}
        {user && <NotificationBell />}

        {/* ── User area / dropdown ──────────────────────────────────────────── */}
        {user ? (
          <div className="relative shrink-0" ref={userMenuRef}>
            <button
              onClick={() => setShowUserMenu(s => !s)}
              className="flex items-center gap-1.5 h-7 px-2.5 rounded transition-colors"
              style={{ color: 'var(--nav-text)' }}
              onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--nav-accent)'}
              onMouseLeave={e => e.currentTarget.style.backgroundColor = 'transparent'}
            >
              <span className="text-xs font-medium">{user.username}</span>
              {user.role === 'manager' && (
                <span className="text-xs px-1.5 py-0.5 rounded"
                      style={{ backgroundColor: 'var(--warning-text)', color: 'var(--btn-primary-text)' }}>{t('nav_mgr')}</span>
              )}
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
                   style={{ color: 'var(--nav-text-muted)' }}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {showUserMenu && (
              <div className="absolute top-full right-0 mt-1 w-52 border rounded-xl shadow-lg z-50 overflow-hidden py-1"
                   style={popoverStyle}>
                {/* Account info */}
                <div className="px-3 py-2 border-b flex items-center justify-between"
                     style={{ borderColor: 'var(--border-subtle)' }}>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{user.username}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{user.role}</p>
                  </div>
                  <button onClick={handleLogout}
                    className="text-xs transition-colors"
                    style={{ color: 'var(--danger-text)' }}
                    onMouseEnter={e => e.currentTarget.style.opacity = 0.7}
                    onMouseLeave={e => e.currentTarget.style.opacity = 1}>
                    {t('nav_logout')}
                  </button>
                </div>

                {/* Admin links */}
                {user.role === 'manager' && (
                  <div className="px-2 py-1 border-b" style={{ borderColor: 'var(--border-subtle)' }}>
                    <p className="text-[10px] uppercase tracking-wide px-2 pt-1 pb-0.5"
                       style={{ color: 'var(--text-muted)' }}>Admin</p>
                    <button onClick={() => { openSettings('users');       setShowUserMenu(false) }}
                            className={menuItemCls} style={menuItemStyle}
                            onMouseEnter={onMenuItemEnter} onMouseLeave={onMenuItemLeave}>{t('nav_users')}</button>
                    <button onClick={() => { openSettings('tokens');      setShowUserMenu(false) }}
                            className={menuItemCls} style={menuItemStyle}
                            onMouseEnter={onMenuItemEnter} onMouseLeave={onMenuItemLeave}>{t('nav_tokens')}</button>
                    <button onClick={() => { openSettings('tags');        setShowUserMenu(false) }}
                            className={menuItemCls} style={menuItemStyle}
                            onMouseEnter={onMenuItemEnter} onMouseLeave={onMenuItemLeave}>{t('nav_tags')}</button>
                    <button onClick={() => { openSettings('experiments'); setShowUserMenu(false) }}
                            className={menuItemCls} style={menuItemStyle}
                            onMouseEnter={onMenuItemEnter} onMouseLeave={onMenuItemLeave}>{t('nav_experiments')}</button>
                    <button onClick={() => { openSettings('formats');     setShowUserMenu(false) }}
                            className={menuItemCls} style={menuItemStyle}
                            onMouseEnter={onMenuItemEnter} onMouseLeave={onMenuItemLeave}>{t('nav_formats')}</button>
                  </div>
                )}

                {/* Theme + Density + Size + Language chips */}
                <div className="px-2 py-2 grid grid-cols-2 gap-1.5">
                  <button onClick={cycleTheme}
                    className={dropdownChip} style={dropdownChipStyle}
                    onMouseEnter={onChipEnter} onMouseLeave={onChipLeave}>
                    {t(`theme_${theme}`)}
                  </button>
                  <button onClick={toggleDensity}
                    title={isCompact ? '투박 → 부드럽게' : '부드러움 → 투박하게'}
                    className={dropdownChip} style={dropdownChipStyle}
                    onMouseEnter={onChipEnter} onMouseLeave={onChipLeave}>
                    {isCompact ? 'compact' : 'cozy'}
                  </button>
                  <button onClick={toggleSize}
                    title="UI 크기 전환"
                    className={dropdownChip} style={dropdownChipStyle}
                    onMouseEnter={onChipEnter} onMouseLeave={onChipLeave}>
                    {size === 'large' ? 'large' : 'normal'}
                  </button>
                  <button onClick={toggleLang}
                    className={dropdownChip} style={dropdownChipStyle}
                    onMouseEnter={onChipEnter} onMouseLeave={onChipLeave}>
                    {lang === 'ko' ? 'EN' : '한국어'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <button
            onClick={() => openSettings('account')}
            className="h-7 inline-flex items-center text-xs border px-2.5 rounded transition-colors shrink-0"
            style={{ color: 'var(--nav-text-muted)', borderColor: 'var(--nav-accent)' }}
            onMouseEnter={e => { e.currentTarget.style.backgroundColor = 'var(--nav-accent)'; e.currentTarget.style.color = 'var(--nav-text)' }}
            onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent';        e.currentTarget.style.color = 'var(--nav-text-muted)' }}
          >
            {t('nav_login')}
          </button>
        )}
      </div>
    </nav>
  )
}
