import { useTab } from '../context/TabContext'
import { useLang } from '../context/LangContext'

// Translation keys for fixed tabs
const TAB_LABEL_KEYS = {
  notice:     'tab_notice',
  logs:       'tab_logs',
  community:  'tab_community',
  browse:     'tab_browse',
  infography: 'tab_infography',
  schedule:   'tab_schedule',
  experiment: 'tab_experiment',
  settings:   'tab_settings',
}

export default function TabBar() {
  const { tabs, activeTab, activateTab, closeTab } = useTab()
  const { t } = useLang()

  return (
    <div data-tab-bar className="flex items-center h-10 border-b" style={{ borderColor: 'var(--border-default)' }}>
      {tabs.map(tab => {
        const isActive = tab.id === activeTab.id
        const label = TAB_LABEL_KEYS[tab.type] ? t(TAB_LABEL_KEYS[tab.type]) : tab.label
        return (
          <div key={tab.id} className="relative flex items-center h-full shrink-0">
            <button
              onClick={() => activateTab(tab.id)}
              className="h-full px-3 text-sm border-b-2 -mb-px transition-colors whitespace-nowrap"
              style={isActive
                ? { borderColor: 'var(--btn-primary-bg)', color: 'var(--text-link)' }
                : { borderColor: 'transparent', color: 'var(--text-secondary)' }}
              onMouseEnter={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-primary)' }}
              onMouseLeave={e => { if (!isActive) e.currentTarget.style.color = 'var(--text-secondary)' }}
            >
              {label}
            </button>
            {tab.closeable && (
              <button
                onClick={e => { e.stopPropagation(); closeTab(tab.id) }}
                className="w-4 h-4 mr-1 flex items-center justify-center text-xs leading-none transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--danger-text)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                title="탭 닫기"
              >
                ×
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
