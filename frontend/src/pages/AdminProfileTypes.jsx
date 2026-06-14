import { Avatar, AVATAR_ICONS, AVATAR_COLORS, Stack } from 'lilak-ui'
import { useLang } from '../context/LangContext'

// Profile types (managers): a reference gallery of every avatar icon and colour
// available to user profiles. Read-only — just shows what's on offer.
export default function AdminProfileTypes() {
  const { t } = useLang()
  return (
    <div style={{ maxWidth: 760 }}>
      <Stack gap={6}>
        <h3 style={{ margin: '0 0 2px', fontSize: 'var(--fs-medium, 14px)', fontWeight: 600, color: 'var(--text-primary)' }}>{t('profile_types_title') || '프로필 종류'}</h3>
        <p style={{ margin: '0 0 16px', fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>
          {t('profile_types_hint') || '사용자 프로필에 쓸 수 있는 아이콘과 색상 목록입니다.'}
        </p>

        {/* Icons */}
        <div style={{ fontSize: 'var(--fs-tiny, 11px)', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-muted)', marginBottom: 8 }}>
          {t('profile_types_icons') || '아이콘'} ({AVATAR_ICONS.length})
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(72px, 1fr))', gap: 8, marginBottom: 24 }}>
          {AVATAR_ICONS.map(ic => (
            <div key={ic} title={ic}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '8px 4px', borderRadius: 10, border: '1px solid var(--border-default)', backgroundColor: 'var(--surface)' }}>
              <Avatar icon={ic} color="var(--text-secondary)" size={30} />
              <span style={{ fontSize: 'var(--fs-micro, 10px)', color: 'var(--text-muted)', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ic}</span>
            </div>
          ))}
        </div>

        {/* Colours */}
        <div style={{ fontSize: 'var(--fs-tiny, 11px)', textTransform: 'uppercase', letterSpacing: '.05em', color: 'var(--text-muted)', marginBottom: 8 }}>
          {t('profile_types_colors') || '색상'} ({AVATAR_COLORS.length})
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {AVATAR_COLORS.map(c => (
            <div key={c} title={c} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
              <span style={{ width: 30, height: 30, borderRadius: '50%', backgroundColor: c, border: '1px solid var(--border-default)' }} />
              <span style={{ fontSize: 'var(--fs-micro, 10px)', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>{c}</span>
            </div>
          ))}
        </div>
      </Stack>
    </div>
  )
}
