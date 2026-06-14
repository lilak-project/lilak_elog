import { createContext, useContext, useState, useCallback, useEffect } from 'react'

const ACTIVE_TAB_KEY = 'elog_active_tab'
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
    const saved = localStorage.getItem(ACTIVE_TAB_KEY)
    return VALID_TAB_IDS.includes(saved) ? saved : 'logs'
  })
  // Persist the active tab so a page refresh stays on the same tab.
  useEffect(() => {
    if (VALID_TAB_IDS.includes(activeId)) localStorage.setItem(ACTIVE_TAB_KEY, activeId)
  }, [activeId])
  const [settingsSection, setSettingsSection] = useState('account')
  const [pendingLogId, setPendingLogId] = useState(null)  // log to open after switching to logs tab
  // Inline log form request, consumed by the logs tab (Home). When set, the
  // logs tab shows an embedded LogForm instead of opening a separate tab.
  //   null | { editId } | { fromId } | {} (new log)
  const [logFormReq, setLogFormReq] = useState(null)

  const tabs = [...FIXED_TABS, ...dynamicTabs]

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
    }}>
      {children}
    </TabContext.Provider>
  )
}

export function useTab() {
  return useContext(TabContext)
}
