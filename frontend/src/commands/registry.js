/**
 * Command registry — definitions for every `/command` available in the
 * text command palette. Each command has:
 *
 *   name      — the canonical name (without leading slash)
 *   aliases   — alternative names (e.g. 'g' for 'goto')
 *   category  — used for grouping in the suggestions list
 *   argHint   — short hint shown in usage
 *   desc      — { ko, en } description of what the command does
 *   run(ctx, arg) — handler invoked when the user executes the command
 *
 * Handlers receive a `ctx` object with all relevant contexts injected and a
 * raw `arg` string (everything after the command name).
 *
 * Commands that affect a specific page (logs, schedule, community …) typically
 * dispatch a CustomEvent on `window` that the target page listens for.
 * The palette also auto-activates the relevant tab before dispatching so the
 * page is mounted to receive the event.
 */

function fire(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }))
}

const VIEW_MODES   = ['brief', 'normal', 'rich']
const SEV_LEVELS   = ['info', 'warning', 'error', 'critical']
const SCHED_VIEWS  = ['month', 'horizontal', 'vertical']
const SCHED_ZOOMS  = ['5', '10', '15']
const THEME_NAMES  = ['bright', 'dark', 'lowcontrast']
const DENS_NAMES   = ['cozy', 'compact']
const LANG_NAMES   = ['ko', 'en']

export const COMMANDS = [
  // ── System ────────────────────────────────────────────────────────────
  { name: 'help', aliases: ['?'], category: 'system',
    desc: { ko: '단축키 도움말 보기', en: 'Open shortcuts help' },
    run: (ctx) => ctx.openShortcuts() },

  { name: 'clear', category: 'filter',
    desc: { ko: '모든 필터·검색 초기화', en: 'Clear filters and search' },
    run: (ctx) => { ctx.activateTab('logs'); setTimeout(() => fire('lilak:cmd:clear'), 50) } },

  { name: 'login', aliases: ['in'], category: 'system', argHint: '<username>', mode: 'password',
    desc: { ko: '계정 로그인 (사용자 → 비밀번호)', en: 'Log in (username → password)' },
    /* handled by the palette directly, see CommandPalette.handlePasswordSubmit */ },

  { name: 'logout', aliases: ['out'], category: 'system', requiresAuth: true,
    desc: { ko: '로그아웃', en: 'Log out' },
    run: (ctx) => { ctx.logout && ctx.logout(); ctx.toast('Logged out') } },

  // ── Tabs ──────────────────────────────────────────────────────────────
  { name: 'logs', category: 'tab',
    desc: { ko: '로그 탭으로 이동', en: 'Switch to Logs tab' },
    run: (ctx) => ctx.activateTab('logs') },

  { name: 'community', aliases: ['chat'], category: 'tab',
    desc: { ko: '커뮤니티 탭으로 이동', en: 'Switch to Community tab' },
    run: (ctx) => ctx.activateTab('community') },

  { name: 'browse', aliases: ['gallery', 'gal'], category: 'tab',
    desc: { ko: '갤러리/파일 탭으로 이동', en: 'Switch to Browse tab (gallery)' },
    run: (ctx) => ctx.activateTab('browse') },

  { name: 'files', category: 'tab',
    desc: { ko: '파일 탭으로 이동', en: 'Switch to Browse tab (files)' },
    run: (ctx) => { ctx.activateTab('browse'); setTimeout(() => window.dispatchEvent(new CustomEvent('lilak:browse:subtab', { detail: 'files' })), 50) } },

  { name: 'schedule', aliases: ['sch'], category: 'tab',
    desc: { ko: '스케줄 탭으로 이동', en: 'Switch to Schedule tab' },
    run: (ctx) => ctx.activateTab('schedule') },

  { name: 'settings', aliases: ['set'], category: 'tab',
    desc: { ko: '설정 탭으로 이동', en: 'Switch to Settings tab' },
    run: (ctx) => ctx.openSettings('account') },

  { name: 'ids', category: 'tab',
    desc: { ko: '등록된 계정 목록', en: 'Registered accounts list' },
    run: (ctx) => ctx.openSettings('users') },

  // ── Filters (logs) ────────────────────────────────────────────────────
  { name: 'tag', category: 'filter', argHint: '<name>',
    desc: { ko: '태그로 필터', en: 'Filter logs by tag' },
    run: (ctx, arg) => { ctx.activateTab('logs'); setTimeout(() => fire('lilak:cmd:filter', { type: 'tag', value: arg }), 50) } },

  { name: 'author', aliases: ['@'], category: 'filter', argHint: '<name>',
    desc: { ko: '작성자로 필터', en: 'Filter logs by author' },
    run: (ctx, arg) => { ctx.activateTab('logs'); setTimeout(() => fire('lilak:cmd:filter', { type: 'author', value: arg }), 50) } },

  { name: 'run', aliases: ['r'], category: 'filter', argHint: '<number>',
    desc: { ko: 'Run 번호로 필터', en: 'Filter logs by run number' },
    run: (ctx, arg) => { ctx.activateTab('logs'); setTimeout(() => fire('lilak:cmd:filter', { type: 'run', value: arg }), 50) } },

  { name: 'category', aliases: ['cat'], category: 'filter', argHint: '<name>',
    desc: { ko: '카테고리로 필터', en: 'Filter logs by category' },
    run: (ctx, arg) => { ctx.activateTab('logs'); setTimeout(() => fire('lilak:cmd:filter', { type: 'category', value: arg }), 50) } },

  { name: 'level', aliases: ['sev'], category: 'filter', argHint: '<info|warning|error|critical>',
    argChoices: SEV_LEVELS,
    desc: { ko: '심각도로 필터', en: 'Filter logs by level' },
    run: (ctx, arg) => {
      if (!SEV_LEVELS.includes(arg)) { ctx.toast(`level must be one of ${SEV_LEVELS.join(', ')}`); return }
      ctx.activateTab('logs'); setTimeout(() => fire('lilak:cmd:filter', { type: 'level', value: arg }), 50)
    } },

  { name: 'me', category: 'filter', requiresAuth: true,
    desc: { ko: '내가 작성한 로그만 보기', en: 'Filter logs by me' },
    run: (ctx) => {
      ctx.activateTab('logs'); setTimeout(() => fire('lilak:cmd:filter', { type: 'author', value: ctx.user.username }), 50)
    } },

  { name: 'date', category: 'filter', argHint: '<today|7d|YYYY-MM>',
    desc: { ko: '날짜 범위로 필터', en: 'Filter logs by date range' },
    run: (ctx, arg) => { ctx.activateTab('logs'); setTimeout(() => fire('lilak:cmd:filter', { type: 'date', value: arg }), 50) } },

  { name: 'notice', category: 'filter',
    desc: { ko: '공지만 보기 토글', en: 'Toggle notice-only filter' },
    run: (ctx) => { ctx.activateTab('logs'); setTimeout(() => fire('lilak:cmd:filter', { type: 'notice' }), 50) } },

  { name: 'deleted', category: 'filter',
    desc: { ko: '삭제된 로그 포함 (매니저)', en: 'Include deleted logs (manager)' },
    run: (ctx) => { ctx.activateTab('logs'); setTimeout(() => fire('lilak:cmd:filter', { type: 'deleted' }), 50) } },

  // ── Log actions ───────────────────────────────────────────────────────
  { name: 'new', aliases: ['n'], category: 'log', requiresAuth: true,
    desc: { ko: '새 로그 작성', en: 'Create a new log' },
    run: (ctx) => ctx.openNewLog() },

  { name: 'edit', aliases: ['e'], category: 'log', requiresAuth: true,
    desc: { ko: '현재 포커스된 로그 편집', en: 'Edit focused log' },
    run: (ctx) => { ctx.activateTab('logs'); setTimeout(() => fire('lilak:cmd:edit-focused'), 50) } },

  { name: 'comment', aliases: ['c'], category: 'log', argHint: '<text>', requiresAuth: true,
    desc: { ko: '포커스된 로그에 댓글 작성', en: 'Comment on focused log' },
    run: (ctx, arg) => { ctx.activateTab('logs'); setTimeout(() => fire('lilak:cmd:comment', { text: arg }), 50) } },

  { name: 'continue', aliases: ['cont'], category: 'log', requiresAuth: true,
    desc: { ko: '포커스된 로그 이어쓰기', en: 'Continue from focused log' },
    run: (ctx) => { ctx.activateTab('logs'); setTimeout(() => fire('lilak:cmd:continue'), 50) } },

  { name: 'delete', aliases: ['del'], category: 'log', requiresAuth: true,
    desc: { ko: '포커스된 로그 삭제 (매니저)', en: 'Delete focused log (manager)' },
    run: (ctx) => { ctx.activateTab('logs'); setTimeout(() => fire('lilak:cmd:delete-focused'), 50) } },

  { name: 'restore', category: 'log', requiresAuth: true,
    desc: { ko: '포커스된 삭제 로그 복원 (매니저)', en: 'Restore focused deleted log (manager)' },
    run: (ctx) => { ctx.activateTab('logs'); setTimeout(() => fire('lilak:cmd:restore-focused'), 50) } },

  { name: 'open', aliases: ['o'], category: 'log',
    desc: { ko: '포커스된 로그 펼치기/접기', en: 'Toggle expanded view' },
    run: (ctx) => { ctx.activateTab('logs'); setTimeout(() => fire('lilak:cmd:toggle-open'), 50) } },

  { name: 'copy', category: 'log',
    desc: { ko: '포커스된 로그의 링크 복사', en: 'Copy link to focused log' },
    run: (ctx) => { ctx.activateTab('logs'); setTimeout(() => fire('lilak:cmd:copy-link'), 50) } },

  // ── View / theme ──────────────────────────────────────────────────────
  { name: 'theme', category: 'view', argHint: `<${THEME_NAMES.join('|')}>`,
    argChoices: THEME_NAMES,
    desc: { ko: '테마 변경', en: 'Switch theme' },
    run: (ctx, arg) => {
      if (!THEME_NAMES.includes(arg)) { ctx.toast(`theme must be one of ${THEME_NAMES.join(', ')}`); return }
      ctx.setTheme(arg)
    } },

  { name: 'density', category: 'view', argHint: `<${DENS_NAMES.join('|')}>`,
    argChoices: DENS_NAMES,
    desc: { ko: 'UI 밀도 변경', en: 'Switch UI density' },
    run: (ctx, arg) => {
      if (!DENS_NAMES.includes(arg)) { ctx.toast(`density must be one of ${DENS_NAMES.join(', ')}`); return }
      ctx.setDensity(arg)
    } },

  { name: 'lang', category: 'view', argHint: `<${LANG_NAMES.join('|')}>`,
    argChoices: LANG_NAMES,
    desc: { ko: '언어 변경', en: 'Switch language' },
    run: (ctx, arg) => {
      if (!LANG_NAMES.includes(arg)) { ctx.toast(`lang must be one of ${LANG_NAMES.join(', ')}`); return }
      ctx.setLang(arg)
    } },

  { name: 'view', category: 'view', argHint: `<${VIEW_MODES.join('|')}>`,
    argChoices: VIEW_MODES,
    desc: { ko: '로그 카드 밀도 변경', en: 'Switch log card density' },
    run: (ctx, arg) => {
      if (!VIEW_MODES.includes(arg)) { ctx.toast(`view must be one of ${VIEW_MODES.join(', ')}`); return }
      ctx.activateTab('logs'); setTimeout(() => fire('lilak:cmd:view-mode', { mode: arg }), 50)
    } },

  // ── Schedule ──────────────────────────────────────────────────────────
  { name: 'today', category: 'schedule',
    desc: { ko: '스케줄 — 오늘로 이동', en: 'Schedule — jump to today' },
    run: (ctx) => { ctx.activateTab('schedule'); setTimeout(() => fire('lilak:cmd:sched-today'), 50) } },

  { name: 'month', category: 'schedule',
    desc: { ko: '스케줄 — 월간 뷰', en: 'Schedule — month view' },
    run: (ctx) => { ctx.activateTab('schedule'); setTimeout(() => fire('lilak:cmd:sched-mode', { mode: 'month' }), 50) } },

  { name: 'horizontal', category: 'schedule',
    desc: { ko: '스케줄 — 가로 타임라인', en: 'Schedule — horizontal timeline' },
    run: (ctx) => { ctx.activateTab('schedule'); setTimeout(() => fire('lilak:cmd:sched-mode', { mode: 'timeline' }), 50) } },

  { name: 'vertical', category: 'schedule',
    desc: { ko: '스케줄 — 세로 타임라인', en: 'Schedule — vertical timeline' },
    run: (ctx) => { ctx.activateTab('schedule'); setTimeout(() => fire('lilak:cmd:sched-mode', { mode: 'timeline-v' }), 50) } },

  { name: 'zoom', category: 'schedule', argHint: '<days>',
    desc: { ko: '스케줄 — 한 화면에 보일 일 수 (1-60)', en: 'Schedule — days visible at once (1-60)' },
    run: (ctx, arg) => {
      const n = parseInt(arg, 10)
      if (!n || n < 1 || n > 60) { ctx.toast('zoom must be 1-60'); return }
      ctx.activateTab('schedule'); setTimeout(() => fire('lilak:cmd:sched-zoom', { days: n }), 50)
    } },

  { name: 'event', category: 'schedule', argHint: '<title>', requiresAuth: true,
    desc: { ko: '스케줄 — 새 이벤트', en: 'Schedule — new event' },
    run: (ctx, arg) => { ctx.activateTab('schedule'); setTimeout(() => fire('lilak:cmd:sched-new-event', { title: arg || '' }), 50) } },

  { name: 'shift', category: 'schedule', argHint: '<slot>', requiresAuth: true,
    desc: { ko: '오늘 그 슬롯에 본인 등록', en: 'Sign up for today\'s shift slot' },
    run: (ctx, arg) => { ctx.activateTab('schedule'); setTimeout(() => fire('lilak:cmd:sched-shift', { slot: arg }), 50) } },

  // ── Community ─────────────────────────────────────────────────────────
  { name: 'msg', category: 'community', argHint: '<text>', requiresAuth: true,
    desc: { ko: '커뮤니티 메시지 전송', en: 'Send community message' },
    run: (ctx, arg) => {
      if (!arg) { ctx.toast('Usage: /msg <text>'); return }
      ctx.activateTab('community'); setTimeout(() => fire('lilak:cmd:msg-send', { text: arg }), 50)
    } },

  { name: 'ai', category: 'community', argHint: '<bot> <text>', requiresAuth: true,
    desc: { ko: 'AI 봇 호출 (예: /ai gpt 안녕)', en: 'Ping an AI bot (e.g. /ai gpt hello)' },
    run: (ctx, arg) => {
      const [bot, ...rest] = (arg || '').split(/\s+/)
      const text = rest.join(' ').trim()
      if (!bot || !text) { ctx.toast('Usage: /ai <bot> <text>'); return }
      ctx.activateTab('community'); setTimeout(() => fire('lilak:cmd:msg-send', { text: `@${bot} ${text}` }), 50)
    } },

  { name: 'reply', category: 'community', argHint: '<id> <text>', requiresAuth: true,
    desc: { ko: '커뮤니티 답글', en: 'Reply to a community message' },
    run: (ctx, arg) => {
      const m = (arg || '').match(/^(\d+)\s+(.+)$/)
      if (!m) { ctx.toast('Usage: /reply <id> <text>'); return }
      ctx.activateTab('community'); setTimeout(() => fire('lilak:cmd:msg-reply', { id: Number(m[1]), text: m[2] }), 50)
    } },
]

/** Build usage string */
export function usage(cmd) {
  const parts = ['/' + cmd.name]
  if (cmd.argHint) parts.push(cmd.argHint)
  return parts.join(' ')
}

/** All searchable tokens (name + aliases) flattened */
export function tokensFor(cmd) {
  return [cmd.name, ...(cmd.aliases || [])]
}

/** Find a command by exact name or alias */
export function findCommand(token) {
  const t = token.toLowerCase()
  return COMMANDS.find(c => tokensFor(c).map(s => s.toLowerCase()).includes(t))
}

/** Match commands by prefix. Returns sorted by best match. */
export function matchCommands(prefix) {
  const p = prefix.toLowerCase()
  if (!p) return COMMANDS.slice()
  const matches = []
  for (const c of COMMANDS) {
    for (const tok of tokensFor(c)) {
      if (tok.toLowerCase().startsWith(p)) {
        matches.push({ cmd: c, score: tok.length === p.length ? 0 : 1 })
        break
      }
    }
  }
  return matches.sort((a, b) => a.score - b.score).map(m => m.cmd)
}
