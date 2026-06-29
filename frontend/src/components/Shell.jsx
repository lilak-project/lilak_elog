/**
 * Shell — the application chrome, rebuilt entirely from lilak-ui kit blocks.
 *
 * Replaces the old Tailwind Layout + Navbar + TabBar. Tabs live IN the top bar
 * (kit TopBar); the bottom bar is the kit collapsible CommandBar; the old
 * navbar dropdown is now a kit Drawer (system panel, up to 3/4). elog's app
 * state still comes from its contexts — this file is glue that feeds kit
 * components and registers every action into the command/hotkey connector.
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { Outlet, useNavigate } from 'react-router-dom'
import {
  TopBar, CommandBar, Drawer, ShortcutsModal,
  Container, Row, Stack, Button, Icon,
  useCommands, useShortcut, useCommandRegistry, useTagIndex,
  makeDataFindModes, INDEX_CHARS, subscribeBarInput, subscribeBarLead, openBarInput, closeBarInput,
  subscribeBarSlotActive,
} from 'lilak-ui'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { useTheme } from '../context/ThemeContext'
import { useDensity } from '../context/DensityContext'
import { useSize } from '../context/SizeContext'
import { useTab } from '../context/TabContext'
import api, { getExperiment } from '../api'
import SystemPanel from './SystemPanel'

export default function Shell() {
  const navigate = useNavigate()
  const { user, login, logout } = useAuth()
  const { t, lang, set: setLang } = useLang()
  const { themes, set: setTheme } = useTheme()
  const { tabs, activeTab, activateTab, openSettings, openNewLog } = useTab()
  const reg = useCommandRegistry()
  const tagIndex = useTagIndex()

  const [barOpen, setBarOpen] = useState(false)
  const [barLead, setBarLead] = useState('/')
  const [barInput, setBarInput] = useState(null)   // free-text input mode for the one bottom bar
  const [barSlot, setBarSlot] = useState(false)    // slot mode (community portals its composer in)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [runStatus, setRunStatus] = useState({ state: 'idle', run_number: null })

  // unread notification count (poll) — data glue, rendered by kit NotificationBell
  useEffect(() => {
    let alive = true
    const fetchCount = () => api.get('/notifications/unread-count')
      .then((r) => { if (alive) setUnread(r.data.count || 0) }).catch(() => {})
    fetchCount()
    const id = setInterval(fetchCount, 30_000)
    return () => { alive = false; clearInterval(id) }
  }, [user])

  // current run status (idle / run#N) — poll
  useEffect(() => {
    let alive = true
    const load = () => api.get('/runs/current')
      .then((r) => { if (alive) setRunStatus(r.data || { state: 'idle', run_number: null }) }).catch(() => {})
    load()
    const id = setInterval(load, 15_000)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const openDrawer = useCallback(() => setDrawerOpen(true), [])
  // The account button toggles the drawer (open if closed, close if open) — same
  // as `\`. Outside-click and tab switches still close it.
  const toggleDrawer = useCallback(() => setDrawerOpen((o) => !o), [])
  const openBar = useCallback((lead = '/') => { setBarLead(lead); setBarOpen(true) }, [])

  // The one bottom bar is driven from anywhere via barController: pages open it
  // as a labelled text input (comments / chat / infograph comments) or pop it
  // open at a lead char (e.g. `g` → `_` goto). No second fixed bottom bar.
  useEffect(() => subscribeBarInput((req) => { setBarInput(req); setBarOpen(!!req) }), [])
  useEffect(() => subscribeBarLead((lead) => { if (lead) { setBarInput(null); setBarLead(lead); setBarOpen(true) } }), [])
  useEffect(() => subscribeBarSlotActive(setBarSlot), [])

  // The drawer drops down from the top bar; any tab change (click or `[`/`]`) or
  // opening the bottom command bar slides it back up.
  useEffect(() => { setDrawerOpen(false) }, [activeTab.id])
  useEffect(() => { if (barOpen) setDrawerOpen(false) }, [barOpen])

  // Tag find-mode (#): the rest after `#` is treated as space-separated tags,
  // AND-combined, queried against the live tag index. A lone `#` lists all.
  const findModes = useMemo(() => ({
    '#': {
      placeholder: t('cmd_tag_placeholder') || '#tag …  (search tagged items)',
      help: t('cmd_tag_help') || 'Type tag names separated by spaces to AND-combine (e.g. #start #auto). Enter opens the selected item.',
      hint: '#tag',
      search: (value) => {
        const rest = String(value).replace(/^#/, '').trim()
        const q = rest ? rest.split(/\s+/).map((w) => (w.startsWith('#') ? w : '#' + w)).join(' ') : ''
        return tagIndex?.search(q) || []
      },
    },
    // data-component index: % modules/services · _ logs · ^ files/photos · & infography
    ...(() => {
      const dm = makeDataFindModes(tagIndex?.store)
      // `_` log goto: a number opens that entry by index (works even if it isn't
      // on the loaded page — server-filters to it); a second `g` jumps to top.
      if (dm['_']) {
        const base = dm['_']
        dm['_'] = {
          ...base,
          placeholder: '_<번호> 로 로그 엔트리 열기 (예: _20) · 이름·#태그 검색도 가능',
          help: '_<번호>로 그 번호의 로그를 엽니다. 이름이나 #태그로도 검색하세요.',
          search: (value) => {
            const rest = String(value).replace(/^_/, '').trim()
            if (/^\d+$/.test(rest)) {
              const n = Number(rest)
              return [{ id: `log-goto-${n}`, label: `_${n}  로그 엔트리 열기`,
                run: () => window.dispatchEvent(new CustomEvent('lilak:cmd:find-log', { detail: { logIndex: n } })) }]
            }
            return base.search(value)
          },
          onKey: (e, { value, close }) => {
            if (e.key === 'g' && value === '_') {
              e.preventDefault()
              // stop the `g` from bubbling to the window handler, which would
              // immediately re-open the `_` bar after we close it.
              e.stopPropagation(); e.nativeEvent?.stopImmediatePropagation?.()
              close()
              window.dispatchEvent(new CustomEvent('lilak:cmd:goto-top'))
            }
          },
        }
      }
      return dm
    })(),
  }), [tagIndex, t])

  // ── tab navigation (clamped, no loop) ────────────────────────────────────
  const moveTab = useCallback((dir) => {
    const idx = tabs.findIndex((tb) => tb.id === activeTab.id)
    const next = tabs[Math.min(tabs.length - 1, Math.max(0, idx + dir))]
    if (next) activateTab(next.id)
  }, [tabs, activeTab, activateTab])

  useShortcut('[', () => moveTab(-1), [moveTab], 'prev tab')
  useShortcut(']', () => moveTab(1), [moveTab], 'next tab')
  // `/` toggles the command bar; pressing it again closes it.
  useShortcut('/', () => { setBarOpen((o) => { if (!o) setBarLead('/'); return !o }) }, [], 'command bar')
  // `#` opens the bar in tag-search mode (toggles closed if already in that mode).
  useShortcut('#', () => { setBarOpen((o) => (o && barLead === '#' ? false : (setBarLead('#'), true))) }, [barLead], 'tag search')
  // data-component index chars open the bar scoped to that kind:
  // % modules/services · _ logs · ^ files/photos · & infography ·
  // @ users · ~ community · > runs · ! notifications · * bookmarks.
  // One stable listener (not N hooks) so the char set can grow without
  // tripping the rules-of-hooks count.
  useEffect(() => {
    const chars = new Set(INDEX_CHARS)
    function onKey(e) {
      if (!chars.has(e.key) || e.metaKey || e.ctrlKey || e.altKey) return
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      setBarOpen((o) => (o && barLead === e.key ? false : (setBarLead(e.key), true)))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [barLead])
  useShortcut('?', () => setShortcutsOpen((s) => !s), [], 'shortcuts help')
  // `\` toggles the system drawer.
  useShortcut('\\', () => setDrawerOpen((o) => !o), [], 'system panel')

  // `/account [id]` → create an account through the command bar (#6). `/account`
  // alone prompts id → email → password; `/account <id>` skips the id step. Each
  // step re-prompts with an error hint on bad input; the last step registers.
  const startAccountFlow = useCallback((presetId = '') => {
    const data = { username: (presetId || '').trim(), email: '', password: '' }
    let seq = 0
    const ask = (opts) => openBarInput({ key: 'acct-' + (seq++), onCancel: closeBarInput, ...opts })
    const askId = (err) => ask({
      label: t('acct_id'), placeholder: t('acct_id_ph'), hint: err, initialValue: data.username,
      onSubmit: (v) => { v = v.trim(); if (!/^[A-Za-z0-9_-]{3,32}$/.test(v)) return askId(t('reg_id_invalid')); data.username = v; askEmail() },
    })
    const askEmail = (err) => ask({
      label: t('acct_email'), placeholder: t('acct_email_ph'), hint: err, initialValue: data.email, inputMode: 'email',
      onSubmit: (v) => { v = v.trim(); if (!v) return askEmail(t('reg_email_required')); data.email = v; askPassword() },
    })
    const askPassword = (err) => ask({
      label: t('acct_password'), placeholder: t('acct_password_ph'), hint: err, secure: true, inputMode: 'numeric',
      onSubmit: async (v) => {
        if (!/^[0-9]{4,20}$/.test(v)) return askPassword(t('reg_pw_invalid'))
        data.password = v
        try {
          const res = await api.post('/auth/register', { username: data.username, email: data.email, password: data.password })
          closeBarInput()
          window.alert(res.data?.pending ? t('reg_pending') : t('acct_created', data.username))
        } catch (e) { askPassword(e?.response?.data?.detail || t('reg_fail')) }
      },
    })
    if (data.username && /^[A-Za-z0-9_-]{3,32}$/.test(data.username)) askEmail()
    else askId()
  }, [t])

  // ── register the core commands into the connector ────────────────────────
  useCommands(() => {
    const list = [
      { id: 'help', title: t('cmd_help') || 'Shortcuts help', category: 'system', run: () => setShortcutsOpen(true) },
      { id: 'system', title: t('cmd_system') || 'System panel', category: 'system', run: () => openDrawer('system') },
      { id: 'new', title: t('cmd_new') || 'New log', category: 'log', keywords: 'compose write', run: () => openNewLog?.() },
      { id: 'settings', title: t('cmd_settings') || 'Settings', category: 'tab', run: () => openSettings('account') },
      // `/search <query>` runs a full-text log search (replaces the old in-page
      // search bar). `/search` with no text clears it.
      { id: 'search', title: t('cmd_search') || 'Search logs', category: 'log', keywords: 'find query filter', freeArg: true,
        run: (q) => { activateTab('logs'); setTimeout(() => window.dispatchEvent(new CustomEvent('lilak:cmd:log-search', { detail: { q: q || '' } })), 60) } },
      // `/login <user>` / `/in <user>` flip the command bar to a masked password
      // prompt, then sign in. `/logout` / `/out` sign out. `in`/`out` are full
      // commands (not just aliases) so they autocomplete and run on their own.
      ...[['login', 'in'], ['in', 'login']].map(([id, alias]) => ({
        id, aliases: [alias], title: t('cmd_login') || 'Log in', category: 'system',
        keywords: 'in login signin sign-in account', mode: 'password',
        securePrompt: (u) => (t('cmd_login_password') || 'Password for') + ' ' + u,
        run: async ({ username, password }) => {
          try { await login(username, password) }
          catch (e) { window.alert(e?.response?.data?.detail || t('cmd_login_failed') || 'Login failed') }
        },
      })),
      ...[['logout', 'out'], ['out', 'logout']].map(([id, alias]) => ({
        id, aliases: [alias], title: t('cmd_logout') || 'Log out', category: 'system',
        keywords: 'out logout signout sign-out', run: () => logout(),
      })),
      // `/account [id]` → create an account (prompted id → email → password).
      { id: 'account', aliases: ['signup'], title: t('cmd_account') || 'Create account', category: 'system',
        keywords: 'account signup register new user create 계정 가입 회원', freeArg: true,
        run: (arg) => startAccountFlow(arg) },
      // commands with OPTIONS: choosing them lists the choices (no auto-fill)
      { id: 'theme', title: t('cmd_theme') || 'Theme', category: 'view', keywords: 'color',
        args: (themes || ['bright', 'dark', 'lowcontrast']).map((th) => ({ value: th, label: t(`theme_${th}`) || th })),
        run: (arg) => arg && setTheme(arg) },
      { id: 'lang', title: t('cmd_lang') || 'Language', category: 'view',
        args: [{ value: 'ko', label: '한국어' }, { value: 'en', label: 'English' }],
        run: (arg) => arg && setLang(arg) },
    ]
    for (const tb of tabs) {
      list.push({ id: tb.id, title: t('tab_' + tb.type) || tb.label, category: 'tab', keywords: tb.type, run: () => activateTab(tb.id) })
    }
    return list
  }, [tabs, lang, themes, openNewLog, openSettings, activateTab, openDrawer, setTheme, setLang, startAccountFlow])

  // Command-mode indicator (#8): only the lilak *logo mark* dims — and only while
  // a bar/input is open (keyboard commands are suspended). Tab switches keep
  // command mode, so the logo stays bright. The "lilak" wordmark never changes.
  const logoColor = barOpen ? 'var(--nav-text-muted)' : 'var(--nav-text)'

  // Brand wordmark: "lilak"/"라일락" (top-left) over "elog" (bottom-right), two lines.
  const brand = (
    <span style={{ display: 'inline-flex', flexDirection: 'column', lineHeight: 1.0, minWidth: 46, letterSpacing: '0.01em' }}>
      <span style={{ textAlign: 'left', fontWeight: 700, color: 'var(--nav-text)' }}>{lang === 'ko' ? '라일락' : 'lilak'}</span>
      <span style={{ textAlign: 'right', fontWeight: 500, fontSize: '0.78em', letterSpacing: '0.06em', color: 'var(--nav-text-muted)' }}>elog</span>
    </span>
  )
  const experiment = getExperiment()
  // The experiment chip is the ONLY way to the project list (logo/brand click is
  // not — per design). Clicking it goes to the list: elog's own cover when
  // standalone, but BACK TO THE LILAK PORTAL when served under the portal proxy
  // (escape the /pp/<svc>/<proj>/ basename with a full navigation).
  const goToList = () => {
    if (typeof window !== 'undefined' && window.__PORTAL_BASE__) window.location.assign('/projects')
    else navigate('/projects')
  }
  const brandSuffix = experiment ? (
    <span role="button" tabIndex={0} title={t('projects_title')}
      onClick={(e) => { e.stopPropagation(); goToList() }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goToList() } }}
      style={{ marginLeft: 2, padding: '3px 8px', borderRadius: 999, fontFamily: 'var(--font-mono)', fontWeight: 500, cursor: 'pointer',
      fontSize: 'var(--fs-micro, 10px)', lineHeight: 1.2, backgroundColor: 'var(--nav-accent)', color: 'var(--nav-text-muted)' }}>{experiment}</span>
  ) : null
  const TAB_ICONS = { experiment: 'plug', logs: 'logs', browse: 'browse', community: 'community', infography: 'infography', schedule: 'schedule', settings: 'settings' }
  const tabItems = tabs.map((tb) => ({ id: tb.id, label: t('tab_' + tb.type) || tb.label, icon: TAB_ICONS[tb.type] }))

  // Run status (idle / run#N) — shown left of the account button. Same text
  // colour as the rest of the top bar for now (refine the colours later).
  const statusEl = (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-tiny, 11px)', color: 'var(--nav-text)' }}>
      <span style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: 'var(--nav-text-muted)' }} />
      {runStatus.state === 'running' && runStatus.run_number != null ? `run#${runStatus.run_number}` : 'idle'}
    </span>
  )

  // Single right-slot button: account + alarms live in one drawer now (no bell).
  // Unread notifications show as a small dot on this button. `\` also opens it.
  const systemBtn = (
    <button
      onClick={toggleDrawer}
      style={{
        position: 'relative', display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px',
        borderRadius: 8, background: 'transparent', border: 'none', cursor: 'pointer',
        color: 'var(--nav-text)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-tiny, 11px)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--nav-accent)' }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
      title={`${t('nav_system') || 'System'}  ( \\ )`}
    >
      <Icon name="user" size={15} />
      <span>{user ? user.username : 'login'}</span>
      {unread > 0 && (
        <span style={{ position: 'absolute', top: 2, right: 4, minWidth: 14, height: 14, padding: '0 3px', borderRadius: 999,
          backgroundColor: 'var(--danger-text)', color: '#fff', fontSize: 'var(--fs-micro, 10px)', fontWeight: 700, lineHeight: '14px', textAlign: 'center' }}>{unread > 9 ? '9+' : unread}</span>
      )}
    </button>
  )

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', backgroundColor: 'var(--surface)' }}>
      <TopBar
        brand={brand}
        brandIcon={<Icon name="lilak" size={30} color={logoColor} style={{ height: 30, width: 'auto', display: 'block', transition: 'color .15s' }} />}
        brandSuffix={brandSuffix}
        tabs={tabItems}
        active={activeTab.id}
        onTab={activateTab}
        right={<>{statusEl}{systemBtn}</>}
      />

      <main style={{ flex: 1, paddingBottom: 56 }}>
        <Container max={1180}><Outlet /></Container>
      </main>

      <CommandBar
        collapsible
        commands={reg?.commands || []}
        open={barOpen}
        onOpenChange={setBarOpen}
        openWith={barLead}
        findModes={findModes}
        input={barInput}
        slot={barSlot}
        onRun={(cmd, raw) => { if (!cmd && raw) reg?.run(raw) }}
        placeholder={t('cmd_placeholder') || 'Type a command…'}
      />

      <Drawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        height="half"
      >
        <SystemPanel onClose={() => setDrawerOpen(false)} />
      </Drawer>

      <ShortcutsModal
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
        title={t('shortcuts_title') || 'Keyboard shortcuts'}
      />
    </div>
  )
}
