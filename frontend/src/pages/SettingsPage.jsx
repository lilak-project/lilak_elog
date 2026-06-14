import { useEffect } from 'react'
import { SideNav } from 'lilak-ui'
import { useAuth } from '../context/AuthContext'
import { useTab } from '../context/TabContext'
import { useLang } from '../context/LangContext'
import AdminUsers from './AdminUsers'
import AdminTokens from './AdminTokens'
import AdminTags from './AdminTags'
import AdminFormats from './AdminFormats'
import AdminLogManagement from './AdminLogManagement'
import AdminAudit from './AdminAudit'
import AdminTabs from './AdminTabs'
import AdminProfileTypes from './AdminProfileTypes'
import AccountSection from './settings/AccountSection'
import AdminWebhooks from './settings/AdminWebhooks'
import AdminAiBots from './settings/AdminAiBots'
import AdminCommunityBridges from './settings/AdminCommunityBridges'
import ColorPaletteSection from './settings/ColorPaletteSection'

export default function SettingsPage() {
  const { user } = useAuth()
  const { settingsSection, openSettings } = useTab()
  const { t } = useLang()

  const sections = !user ? [
    { id: 'account', label: t('nav_login'), icon: 'user', group: 'me' },
    { id: 'users',   label: t('admin_users_title'), icon: 'users', group: 'people' },   // viewable for all
  ] : user.role === 'manager' ? [
    { id: 'account',     label: t('settings_account'),      icon: 'user',     group: 'me' },
    { id: 'users',       label: t('admin_users_title'),     icon: 'users',    group: 'people' },
    { id: 'tokens',      label: t('tokens_title'),          icon: 'key',      group: 'people' },
    { id: 'audit',       label: t('audit_title'),           icon: 'system',   group: 'people' },
    { id: 'formats',     label: t('admin_fmt_title'),       icon: 'table',    group: 'data' },
    { id: 'logs',        label: t('admin_logmgmt_title'),   icon: 'logs',     group: 'data' },
    { id: 'tags',        label: t('admin_tags_title'),      icon: 'tag',      group: 'data' },
    { id: 'webhooks',    label: t('webhook_title'),         icon: 'plug',     group: 'integrations' },
    { id: 'bridges',     label: t('settings_bridges'),      icon: 'chats',    group: 'integrations' },
    { id: 'ai-bots',     label: t('settings_ai_bots'),      icon: 'robot',    group: 'integrations' },
    { id: 'palette',     label: t('settings_palette'),      icon: 'palette',  group: 'appearance' },
    { id: 'tabs',        label: t('set_tabs'),              icon: 'browse',   group: 'appearance' },
    { id: 'profiles',    label: t('profile_types_title'),   icon: 'user',     group: 'appearance' },
  ] : [
    { id: 'account', label: t('settings_account'),      icon: 'user',  group: 'me' },
    { id: 'users',   label: t('admin_users_title'),     icon: 'users', group: 'people' },
  ]

  // Sections that require manager (users is now viewable by all)
  useEffect(() => {
    const adminOnly = ['tokens', 'audit', 'tags', 'formats', 'logs', 'webhooks', 'ai-bots', 'bridges', 'palette', 'tabs', 'profiles']
    if (adminOnly.includes(settingsSection) && user?.role !== 'manager') {
      openSettings('account')
    }
  }, [user, settingsSection])

  const activeSection = sections.find(s => s.id === settingsSection)?.id || sections[0].id

  return (
    <div style={{ display: 'flex', minHeight: 500 }}>
      {/* ── Left sidebar — kit SideNav ──────────────────────────────────── */}
      <SideNav
        title={t('tab_settings')}
        sections={sections}
        active={activeSection}
        onSelect={openSettings}
      />

      {/* ── Content ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {activeSection === 'account'     && <AccountSection />}
        {activeSection === 'users'       && <AdminUsers />}
        {activeSection === 'tokens'      && <AdminTokens />}
        {activeSection === 'audit'       && <AdminAudit />}
        {activeSection === 'tags'        && <AdminTags />}
        {activeSection === 'formats'     && <AdminFormats />}
        {activeSection === 'logs'        && <AdminLogManagement />}
        {activeSection === 'webhooks'    && <AdminWebhooks />}
        {activeSection === 'ai-bots'    && <AdminAiBots />}
        {activeSection === 'bridges'    && <AdminCommunityBridges />}
        {activeSection === 'palette'    && <ColorPaletteSection />}
        {activeSection === 'tabs'       && <AdminTabs />}
        {activeSection === 'profiles'   && <AdminProfileTypes />}
      </div>
    </div>
  )
}
