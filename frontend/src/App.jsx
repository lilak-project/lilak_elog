import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { CommandRegistryProvider, TagIndexProvider } from 'lilak-ui'
import { AuthProvider } from './context/AuthContext'
import { LangProvider } from './context/LangContext'
import { ThemeProvider } from './context/ThemeContext'
import { DensityProvider } from './context/DensityContext'
import { SizeProvider } from './context/SizeContext'
import { TabProvider } from './context/TabContext'
import Shell from './components/Shell'
import PortalLinkGate from './components/PortalLinkGate'
import TabbedWorkspace from './pages/TabbedWorkspace'
import LogDetail from './pages/LogDetail'
import LogForm from './pages/LogForm'
import ProjectsPage from './pages/ProjectsPage'

// The shell (top bar + command bar + drawer), keyboard shortcuts, and command
// palette are now provided by the lilak-ui kit via Shell + the command registry
// connector. Pages render inside the Shell's <Outlet/>.
function AppShell() {
  return (
    <Routes>
      <Route path="/projects" element={<ProjectsPage />} />
      <Route path="/" element={<Shell />}>
        <Route index element={<TabbedWorkspace />} />
        <Route path="logs/new" element={<LogForm />} />
        <Route path="logs/:id/edit" element={<LogForm />} />
        <Route path="logs/:id" element={<LogDetail />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <ThemeProvider>
      <DensityProvider>
        <SizeProvider>
          <LangProvider>
            <AuthProvider>
              <PortalLinkGate />
              {/* Under the portal proxy (/pp/<svc>/<proj>/), route relative to that
                  prefix so client-side navigation stays inside the proxied app. */}
              <BrowserRouter basename={(typeof window !== 'undefined' && window.__PORTAL_BASE__) || undefined}>
                <TabProvider>
                  <CommandRegistryProvider>
                    <TagIndexProvider>
                      <AppShell />
                    </TagIndexProvider>
                  </CommandRegistryProvider>
                </TabProvider>
              </BrowserRouter>
            </AuthProvider>
          </LangProvider>
        </SizeProvider>
      </DensityProvider>
    </ThemeProvider>
  )
}
