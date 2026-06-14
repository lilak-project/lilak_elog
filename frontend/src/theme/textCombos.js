/**
 * ── Text-on-Background combos ────────────────────────────────────────────
 *
 * Every legible text needs a known background. Rather than picking a text
 * token and a background token separately (and risking a bad contrast pair),
 * pick one of these *named pairs* — the foreground and background are
 * locked together, so they stay in sync whenever a theme value changes.
 *
 *   import { combo, comboFg, comboBg, COMBOS } from '../theme/textCombos'
 *
 *   <p     style={combo('body')}>...</p>           // bg + color from the pair
 *   <span  style={comboFg('pillSuccess')}>...</span> // only color (bg inherited)
 *   <div   style={comboBg('navPill')}>...</div>      // only bg
 *
 * Adding a new visual surface? Add the combo here AND make sure both tokens
 * already exist in theme/tokens.js + index.css. Don't introduce a new color
 * inline — that defeats the whole point.
 */

export const COMBO_GROUPS = [
  {
    id: 'surface',
    label: '카드 / 모달 위 본문',
    items: {
      body: {
        label: '본문',
        usage: '카드/모달 안의 기본 본문 텍스트',
        bg: 'var(--surface)',
        fg: 'var(--text-primary)',
      },
      bodyEmphasis: {
        label: '강조 본문',
        usage: '제목 / 강조 키워드',
        bg: 'var(--surface)',
        fg: 'var(--text-emphasis)',
      },
      bodySecondary: {
        label: '보조 본문',
        usage: '레이블 / 설명',
        bg: 'var(--surface)',
        fg: 'var(--text-secondary)',
      },
      bodyMuted: {
        label: '흐린 본문',
        usage: 'placeholder / 보조 메타',
        bg: 'var(--surface)',
        fg: 'var(--text-muted)',
      },
    },
  },

  {
    id: 'app-bg',
    label: '페이지 배경 위',
    items: {
      bodyOnApp: {
        label: '페이지 본문',
        usage: '카드 바깥 영역의 글씨',
        bg: 'var(--app-bg)',
        fg: 'var(--text-primary)',
      },
      bodyMutedOnApp: {
        label: '페이지 흐린 본문',
        usage: '빵부스러기, 작은 안내',
        bg: 'var(--app-bg)',
        fg: 'var(--text-muted)',
      },
    },
  },

  {
    id: 'surface-2',
    label: '보조 표면 위',
    items: {
      onSurface2: {
        label: '보조 표면 본문',
        usage: '사이드바, footer, 보조 패널',
        bg: 'var(--surface-2)',
        fg: 'var(--text-primary)',
      },
      onSurface2Secondary: {
        label: '보조 표면 보조 본문',
        usage: '테이블 헤더, label',
        bg: 'var(--surface-2)',
        fg: 'var(--text-secondary)',
      },
      onSurface2Muted: {
        label: '보조 표면 흐린 본문',
        usage: '메타 정보 / "no data" 안내',
        bg: 'var(--surface-2)',
        fg: 'var(--text-muted)',
      },
    },
  },

  {
    id: 'status',
    label: '상태 배지 (soft 배경)',
    items: {
      pillSuccess: {
        label: '성공 배지',
        usage: 'active, 등록됨, ok',
        bg: 'var(--success-bg)',
        fg: 'var(--success-text)',
      },
      pillWarning: {
        label: '경고 배지',
        usage: 'manager 역할, notice, default',
        bg: 'var(--warning-bg)',
        fg: 'var(--warning-text)',
      },
      pillDanger: {
        label: '오류 배지',
        usage: 'deleted, inactive, revoked',
        bg: 'var(--danger-bg)',
        fg: 'var(--danger-text)',
      },
      pillInfo: {
        label: '정보 배지',
        usage: 'auto-log, current experiment, builtin field',
        bg: 'var(--info-bg)',
        fg: 'var(--info-text)',
      },
    },
  },

  {
    id: 'solid',
    label: '솔리드 버튼 (강한 대비)',
    items: {
      solidPrimary: {
        label: '주요 버튼',
        usage: 'Save / Login / Create / Send / Submit',
        bg: 'var(--btn-primary-bg)',
        fg: 'var(--btn-primary-text)',
      },
      solidDanger: {
        label: '위험 버튼',
        usage: 'Delete / Remove (확정형)',
        bg: 'var(--btn-danger-bg)',
        fg: 'var(--btn-danger-text)',
      },
      solidWarning: {
        label: '경고 버튼',
        usage: 'Transfer / Merge (review-carefully)',
        bg: 'var(--warning-text)',
        fg: 'var(--btn-primary-text)',
      },
      solidSuccess: {
        label: '성공 강조 버튼',
        usage: 'Activate / Open (online)',
        bg: 'var(--success-text)',
        fg: 'var(--btn-primary-text)',
      },
    },
  },

  {
    id: 'bubble',
    label: '커뮤니티 말풍선',
    items: {
      bubbleMine: {
        label: '내 말풍선',
        usage: '내가 보낸 메시지',
        bg: 'var(--bubble-mine-bg)',
        fg: 'var(--bubble-mine-text)',
      },
      bubbleOther: {
        label: '상대 말풍선',
        usage: '상대가 보낸 메시지',
        bg: 'var(--bubble-other-bg)',
        fg: 'var(--bubble-other-text)',
      },
      bubbleAi: {
        label: 'AI 말풍선',
        usage: 'GPT / Claude 응답',
        bg: 'var(--bubble-ai-bg)',
        fg: 'var(--bubble-ai-text)',
      },
      bubbleSystem: {
        label: '시스템 메시지',
        usage: '로그 등록 등 시스템 알림',
        bg: 'var(--bubble-system-bg)',
        fg: 'var(--bubble-system-text)',
      },
    },
  },

  {
    id: 'nav',
    label: '내비 / 명령 바',
    items: {
      navBody: {
        label: '내비 본문',
        usage: '상단 navbar / 하단 명령 바 본문 글씨',
        bg: 'var(--nav-bg)',
        fg: 'var(--nav-text)',
      },
      navMuted: {
        label: '내비 보조',
        usage: '힌트 / placeholder',
        bg: 'var(--nav-bg)',
        fg: 'var(--nav-text-muted)',
      },
      navPill: {
        label: '내비 강조 칩',
        usage: 'experiment 셀렉터 / 활성 메뉴',
        bg: 'var(--nav-accent)',
        fg: 'var(--nav-text)',
      },
    },
  },

  {
    id: 'link',
    label: '링크 / 인라인 강조',
    items: {
      link: {
        label: '링크',
        usage: '하이퍼링크 (배경은 부모로부터 상속)',
        bg: null,
        fg: 'var(--text-link)',
      },
      linkHover: {
        label: '링크 hover',
        usage: '하이퍼링크 hover',
        bg: null,
        fg: 'var(--text-link-hover)',
      },
    },
  },
]

/** Flat lookup table keyed by combo name. */
export const COMBOS = (() => {
  const out = {}
  for (const g of COMBO_GROUPS) {
    for (const [name, def] of Object.entries(g.items)) {
      out[name] = { ...def, group: g.id }
    }
  }
  return out
})()

/**
 * Returns { backgroundColor, color } for a combo. Throws (in dev) if the
 * combo name is unknown, so typos surface immediately.
 */
export function combo(name) {
  const c = COMBOS[name]
  if (!c) {
    // eslint-disable-next-line no-console
    console.warn(`[textCombos] Unknown combo "${name}". Add it to theme/textCombos.js.`)
    return {}
  }
  const out = { color: c.fg }
  if (c.bg) out.backgroundColor = c.bg
  return out
}

/** Color-only (background inherited from parent). */
export function comboFg(name) {
  const c = COMBOS[name]
  return c ? { color: c.fg } : {}
}

/** Background-only (text color inherited). */
export function comboBg(name) {
  const c = COMBOS[name]
  return c?.bg ? { backgroundColor: c.bg } : {}
}
