import { Stack } from 'lilak-ui'
import { useLang } from '../context/LangContext'
import { useTab } from '../context/TabContext'

// Tab visibility (managers): turn workspace tabs on/off. Lives in the Settings
// tab; the always-on tabs (logs, settings) are not listed.
export default function AdminTabs() {
  const { t } = useLang()
  const { allFixedTabs, alwaysOnTabs, tabsDisabled, setTabDisabled } = useTab()

  const toggleable = (allFixedTabs || []).filter(tb => !alwaysOnTabs.includes(tb.type))

  return (
    <div style={{ maxWidth: 720 }}>
      <Stack gap={6}>
        <h3 style={{ margin: '0 0 2px', fontSize: 'var(--fs-medium, 14px)', fontWeight: 600, color: 'var(--text-primary)' }}>{t('set_tabs') || 'Tabs'}</h3>
        <p style={{ margin: '0 0 12px', fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>{t('set_tabs_hint') || '워크스페이스 상단 탭의 표시 여부를 관리합니다.'}</p>
        <Stack gap={8}>
          {toggleable.map(tb => {
            const enabled = !tabsDisabled.includes(tb.type)
            return (
              <label key={tb.type} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', borderRadius: 10, border: '1px solid var(--border-default)', backgroundColor: 'var(--surface)', cursor: 'pointer' }}>
                <span style={{ fontSize: 'var(--fs-body, 13px)', color: 'var(--text-primary)' }}>{t('tab_' + tb.type) || tb.label}</span>
                <input type="checkbox" checked={enabled} onChange={() => setTabDisabled(tb.type, enabled)}
                  style={{ width: 16, height: 16, cursor: 'pointer', accentColor: 'var(--btn-primary-bg)' }} />
              </label>
            )
          })}
        </Stack>
      </Stack>
    </div>
  )
}
