import { useEffect } from 'react'
import { useLang } from '../context/LangContext'
import { combo } from '../theme/textCombos'
import { modalFrame, modalOverlay } from '../theme/uiStyles'

const SHORTCUT_GROUPS = (t) => [
  {
    title: t('shortcuts_group_tabs'),
    items: [
      { keys: ['[', ']'],             desc: t('shortcuts_tab_switch') },
    ],
  },
  {
    title: t('shortcuts_group_log'),
    items: [
      { keys: ['j', '↓'],             desc: t('shortcuts_log_next') },
      { keys: ['k', '↑'],             desc: t('shortcuts_log_prev') },
      { keys: ['J'],                  desc: t('shortcuts_log_skip_down') },
      { keys: ['K'],                  desc: t('shortcuts_log_skip_up') },
      { keys: ['g'],                  desc: t('shortcuts_log_goto') },
      { keys: ['gg'],                 desc: t('shortcuts_log_top') },
      { keys: ['G'],                  desc: t('shortcuts_log_bottom') },
      { keys: ['o', 'Space'],         desc: t('shortcuts_log_open') },
      { keys: ['r', 'Tab'],           desc: t('shortcuts_log_comment') },
      { keys: ['n', '+'],             desc: t('shortcuts_log_new') },
      { keys: ['t'],                  desc: t('shortcuts_log_theme') },
    ],
  },
  {
    title: t('shortcuts_group_gallery'),
    items: [
      { keys: ['h', '←'],             desc: t('shortcuts_gal_left') },
      { keys: ['l', '→'],             desc: t('shortcuts_gal_right') },
      { keys: ['j', '↓'],             desc: t('shortcuts_gal_down') },
      { keys: ['k', '↑'],             desc: t('shortcuts_gal_up') },
      { keys: ['Space'],              desc: t('shortcuts_gal_zoom') },
    ],
  },
  {
    title: t('shortcuts_group_schedule'),
    items: [
      { keys: ['←'],                  desc: t('shortcuts_sched_prev') },
      { keys: ['→'],                  desc: t('shortcuts_sched_next') },
      { keys: ['t'],                  desc: t('shortcuts_sched_today') },
    ],
  },
  {
    title: t('shortcuts_group_global'),
    items: [
      { keys: ['/'],                  desc: t('shortcuts_search') },
      { keys: ['?'],                  desc: t('shortcuts_help') },
      { keys: ['Esc'],                desc: t('shortcuts_esc') },
    ],
  },
]

function Key({ children }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[1.75rem] h-7 px-1.5 border rounded text-xs font-mono shadow-sm"
         style={{ backgroundColor: 'var(--surface-2)', borderColor: 'var(--border-default)', color: 'var(--text-secondary)' }}>
      {children}
    </kbd>
  )
}

export default function ShortcutsModal({ onClose }) {
  const { t } = useLang()

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={modalOverlay}
      onClick={onClose}
    >
      <div
        className="rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] overflow-y-auto border"
        style={modalFrame}
        onClick={e => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between px-5 py-3 border-b"
             style={{ ...combo('body'), borderColor: 'var(--border-subtle)' }}>
          <h2 className="font-semibold text-sm" style={{ color: 'var(--text-primary)' }}>{t('shortcuts_title')}</h2>
          <button onClick={onClose} className="text-xl leading-none transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
                  onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}>×</button>
        </div>
        <div className="p-4 space-y-4">
          {SHORTCUT_GROUPS(t).map(group => (
            <div key={group.title}>
              <p className="text-[10px] font-semibold uppercase tracking-wider mb-2"
                 style={{ color: 'var(--text-muted)' }}>
                {group.title}
              </p>
              <ul className="space-y-1.5">
                {group.items.map(({ keys, desc }) => (
                  <li key={desc} className="flex items-center justify-between gap-4">
                    <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{desc}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      {keys.map((k, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>/</span>}
                          <Key>{k}</Key>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
