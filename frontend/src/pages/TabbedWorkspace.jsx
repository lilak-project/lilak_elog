import { useEffect, useState } from 'react'
import { useTab } from '../context/TabContext'
import { useLang } from '../context/LangContext'
import Home from './Home'
import CommunityPage from './CommunityPage'
import Files from './Files'
import Gallery from './Gallery'
import SettingsPage from './SettingsPage'
import SchedulePage from './SchedulePage'
import ExperimentPage from './ExperimentPage'
import InfographyPage from './InfographyPage'
import ErrorBoundary from '../components/ErrorBoundary'
import { SubTabs } from 'lilak-ui'

const BROWSE_SUBTABS = ['gallery', 'files']

// Tabs + tab navigation now live in the kit TopBar (see Shell). This component
// just renders the active tab's content based on the shared TabContext.
export default function TabbedWorkspace() {
  const { activeTab } = useTab()
  const { t } = useLang()
  const [browseSubtab, setBrowseSubtab] = useState('gallery')

  useEffect(() => {
    function onSubtab(e) { setBrowseSubtab(e.detail) }
    window.addEventListener('lilak:browse:subtab', onSubtab)
    return () => window.removeEventListener('lilak:browse:subtab', onSubtab)
  }, [])

  // `{` / `}` switch the browse sub-tab while the browse tab is active.
  useEffect(() => {
    function onKey(e) {
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      if (inInput) return
      if ((e.key === '{' || e.key === '}') && activeTab.type === 'browse') {
        e.preventDefault()
        const idx = BROWSE_SUBTABS.indexOf(browseSubtab)
        const next = BROWSE_SUBTABS[idx + (e.key === '{' ? -1 : 1)]
        if (next) setBrowseSubtab(next)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeTab, browseSubtab])

  const isLogs = activeTab.type === 'logs'

  return (
    <div className="min-w-0">
      <div className="mt-2">
        {isLogs && <Home />}
        {activeTab.type === 'community' && <CommunityPage />}
        {activeTab.type === 'browse' && (
          <div style={{ maxWidth: 1100, margin: '0 auto', padding: '0 16px' }}>
            <SubTabs
              tabs={[['gallery', t('tab_gallery')], ['files', t('tab_files')]]}
              active={browseSubtab} onChange={setBrowseSubtab}
            />
            <div className="mt-3">
              {browseSubtab === 'gallery' && <Gallery />}
              {browseSubtab === 'files' && <Files />}
            </div>
          </div>
        )}
        {activeTab.type === 'infography' && <ErrorBoundary><InfographyPage /></ErrorBoundary>}
        {activeTab.type === 'schedule' && <SchedulePage />}
        {activeTab.type === 'experiment' && <ErrorBoundary><ExperimentPage /></ErrorBoundary>}
        {activeTab.type === 'settings' && <SettingsPage />}
      </div>
    </div>
  )
}
