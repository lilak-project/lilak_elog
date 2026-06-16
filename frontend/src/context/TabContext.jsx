import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import api, { getExperiment } from '../api'

// Active tab is per-project (scoped by experiment) so switching projects doesn't
// drag the last-viewed tab across.
const activeTabKey = () => `elog_active_tab:${getExperiment()}`
// These can never be hidden — you need settings to re-enable tabs, and logs is core.
const ALWAYS_ON = ['logs', 'settings']
const VALID_TAB_IDS = ['experiment', 'logs', 'browse', 'community', 'infography', 'schedule', 'settings']

const TabContext = createContext(null)

// Order shown in the top bar. Labels are resolved from i18n (tab_<type>) by the
// Shell, so they switch language; the `label` here is only a dev fallback.
const FIXED_TABS = [
  { id: 'logs',        type: 'logs',        label: '로그',     closeable: false },
  { id: 'infography',  type: 'infography',  label: '데이터',   closeable: false },
  { id: 'browse',      type: 'browse',      label: '파일',     closeable: false },
  { id: 'community',   type: 'community',   label: '커뮤니티', closeable: false },
  { id: 'schedule',    type: 'schedule',    label: '스케줄',   closeable: false },
  { id: 'experiment',  type: 'experiment',  label: '커넥터',   closeable: false },
  { id: 'settings',    type: 'settings',    label: '설정',     closeable: false },
]

let _dynCounter = 0

export function TabProvider({ children }) {
  const [dynamicTabs, setDynamicTabs] = useState([])
  const [activeId, setActiveId] = useState(() => {
    const saved = localStorage.getItem(activeTabKey())
    return VALID_TAB_IDS.includes(saved) ? saved : 'logs'
  })
  // Persist the active tab so a page refresh stays on the same tab.
  useEffect(() => {
    if (VALID_TAB_IDS.includes(activeId)) localStorage.setItem(activeTabKey(), activeId)
  }, [activeId])
  const [settingsSection, setSettingsSection] = useState('account')
  const [pendingLogId, setPendingLogId] = useState(null)  // log to open after switching to logs tab
  // Inline log form request, consumed by the logs tab (Home). When set, the
  // logs tab shows an embedded LogForm instead of opening a separate tab.
  //   null | { editId } | { fromId } | {} (new log)
  const [logFormReq, setLogFormReq] = useState(null)

  // Manager-controlled tab visibility (per-experiment, stored in /settings).
  const [tabsDisabled, setTabsDisabled] = useState([])
  useEffect(() => {
    api.get('/settings')
      .then(r => setTabsDisabled(Array.isArray(r.data?.tabs_disabled) ? r.data.tabs_disabled : []))
      .catch(() => {})
  }, [])
  const setTabDisabled = useCallback((type, disabled) => {
    setTabsDisabled(prev => {
      const next = disabled
        ? [...new Set([...prev, type])]
        : prev.filter(x => x !== type)
      api.put('/settings', { tabs_disabled: next }).catch(() => {})
      return next
    })
  }, [])

  const visibleFixed = FIXED_TABS.filter(t => ALWAYS_ON.includes(t.type) || !tabsDisabled.includes(t.type))
  const tabs = [...visibleFixed, ...dynamicTabs]

  const activateTab = useCallback((id) => setActiveId(id), [])

  /** Open the settings tab, optionally jumping to a specific section. */
  const openSettings = useCallback((section = 'account') => {
    setSettingsSection(section)
    setActiveId('settings')
  }, [])

  /** Open the inline log editor in the logs tab (edit / continue / new). */
  const openNewLog = useCallback((opts = {}) => {
    setLogFormReq({ editId: opts.editId || null, fromId: opts.fromId || null })
    setActiveId('logs')
  }, [])

  /** Called by Home.jsx after the inline form is closed/saved. */
  const clearLogForm = useCallback(() => setLogFormReq(null), [])

  const closeTab = useCallback((id) => {
    setDynamicTabs(prev => prev.filter(t => t.id !== id))
    setActiveId(cur => cur === id ? 'logs' : cur)
  }, [])

  /** Switch to the logs tab and open a specific log entry. */
  const openLog = useCallback((logId) => {
    setPendingLogId(logId)
    setActiveId('logs')
  }, [])

  /** Called by Home.jsx after it has consumed the pending log id. */
  const clearPendingLog = useCallback(() => setPendingLogId(null), [])

  const activeTab = tabs.find(t => t.id === activeId) || tabs[1]

  return (
    <TabContext.Provider value={{
      tabs, activeTab, activateTab,
      openNewLog, closeTab,
      openSettings, settingsSection,
      openLog, pendingLogId, clearPendingLog,
      logFormReq, clearLogForm,
      allFixedTabs: FIXED_TABS, alwaysOnTabs: ALWAYS_ON, tabsDisabled, setTabDisabled,
    }}>
      {children}
    </TabContext.Provider>
  )
}

export function useTab() {
  return useContext(TabContext)
}
