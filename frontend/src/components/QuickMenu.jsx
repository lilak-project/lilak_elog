import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { useTheme } from '../context/ThemeContext'
import { useTab } from '../context/TabContext'
import { combo } from '../theme/textCombos'
import { btnPrimary, btnPrimaryHover, hoverify } from '../theme/uiStyles'

export default function QuickMenu({ open, onToggle }) {
  const { user, logout } = useAuth()
  const { lang, toggle: toggleLang, t } = useLang()
  const { cycle: cycleTheme, icon: themeIcon, theme } = useTheme()
  const { activateTab, openSettings } = useTab()

  function handleLogout() { logout(); activateTab('logs') }

  const chipCls = 'flex-1 flex items-center justify-center gap-1.5 text-xs px-2 py-1.5 rounded-lg transition-colors'
  const chipStyle = { backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)' }
  function onChipEnter(e) {
    e.currentTarget.style.backgroundColor = 'var(--surface-3)'
    e.currentTarget.style.color = 'var(--text-primary)'
  }
  function onChipLeave(e) {
    e.currentTarget.style.backgroundColor = 'var(--surface-2)'
    e.currentTarget.style.color = 'var(--text-secondary)'
  }

  return (
    <div className="rounded-xl border mb-3 overflow-hidden"
         style={{ ...combo('body'), borderColor: 'var(--border-default)' }}>
      {/* Header — click to toggle */}
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between px-4 py-2.5 transition-colors"
        onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--surface-2)'}
        onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}
      >
        <span className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-secondary)' }}>
          {t('menu_title')}
        </span>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-180' : ''}`}
          style={{ color: 'var(--text-muted)' }}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="border-t" style={{ borderColor: 'var(--border-subtle)' }}>
          {/* ── Account ── */}
          <div className="px-3 py-2.5">
            {user ? (
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="text-sm font-semibold truncate" style={{ color: 'var(--text-primary)' }}>{user.username}</span>
                  {user.role === 'manager' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0"
                          style={{ backgroundColor: 'var(--warning-text)', color: 'var(--btn-primary-text)' }}>
                      {t('nav_mgr')}
                    </span>
                  )}
                </div>
                <button
                  onClick={handleLogout}
                  className="text-xs transition-colors shrink-0"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--danger-text)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                >
                  {t('nav_logout')}
                </button>
              </div>
            ) : (
              <button
                onClick={() => openSettings('account')}
                className="block w-full text-center text-sm px-3 py-1.5 rounded-lg transition-colors font-medium"
                style={btnPrimary}
                {...hoverify(btnPrimary, btnPrimaryHover)}
              >
                {t('nav_login')}
              </button>
            )}
          </div>

          {/* ── Theme + Language ── */}
          <div className="px-3 pb-3 pt-1 border-t flex gap-1.5" style={{ borderColor: 'var(--border-subtle)' }}>
            <button
              onClick={cycleTheme}
              className={chipCls} style={chipStyle}
              onMouseEnter={onChipEnter} onMouseLeave={onChipLeave}
              title={t(`theme_${theme}`)}
            >
              <span>{themeIcon}</span>
              <span>{t(`theme_${theme}`)}</span>
            </button>
            <button
              onClick={toggleLang}
              className={chipCls} style={chipStyle}
              onMouseEnter={onChipEnter} onMouseLeave={onChipLeave}
              title={lang === 'ko' ? 'Switch to English' : '한국어로 전환'}
            >
              {lang === 'ko' ? 'EN' : '한국어'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
