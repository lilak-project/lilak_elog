/**
 * ── Semantic design tokens ────────────────────────────────────────────────
 *
 * Every color used across the app — backgrounds, text, borders, bubbles,
 * buttons, inputs, status badges — is enumerated here with the value for
 * each theme (bright / dark / lowcontrast).
 *
 * These are exposed as CSS custom properties in index.css under the
 * matching `[data-theme="..."]` selector, so components can reference them
 * via `var(--token-name)` or via the Tailwind classes that get remapped
 * in index.css.
 *
 * Categories are presentation-only (used by the Settings viewer).
 */

export const TOKEN_GROUPS = [
  // ── Surface (배경) ──────────────────────────────────────────────────────
  {
    id: 'surface',
    label: '배경 / 표면',
    tokens: {
      'app-bg':       { label: '앱 배경',         usage: '페이지 전체 배경',
                        bright: '#f8fafc', dark: '#0f172a', lowcontrast: '#ede8dc' },
      'surface':      { label: '표면',            usage: '카드, 모달, 메인 컨텐츠 패널',
                        bright: '#ffffff', dark: '#1e293b', lowcontrast: '#f5f0e6' },
      'surface-2':    { label: '보조 표면',        usage: '사이드바, 입력 그룹 배경 등',
                        bright: '#f1f5f9', dark: '#162032', lowcontrast: '#e8e0ce' },
      'surface-3':    { label: '강조 표면',        usage: '버튼 hover, 활성 행',
                        bright: '#e2e8f0', dark: '#334155', lowcontrast: '#dac9a0' },
      'overlay':      { label: '오버레이',         usage: '모달 백드롭',
                        bright: 'rgba(15,23,42,0.40)', dark: 'rgba(0,0,0,0.55)', lowcontrast: 'rgba(60,40,20,0.40)' },
    },
  },

  // ── Border (테두리) ─────────────────────────────────────────────────────
  {
    id: 'border',
    label: '테두리',
    tokens: {
      'border-default': { label: '기본 테두리',    usage: '카드, 버튼, 입력의 일반 테두리',
                          bright: '#e2e8f0', dark: '#334155', lowcontrast: '#cec5af' },
      'border-subtle':  { label: '약한 테두리',    usage: '구분선, 보조 구분',
                          bright: '#f1f5f9', dark: '#243347', lowcontrast: '#dfd8c8' },
      'border-strong':  { label: '진한 테두리',    usage: '하이라이트 카드, 강조 영역',
                          bright: '#cbd5e1', dark: '#475569', lowcontrast: '#b9a98e' },
      'border-focus':   { label: '포커스 테두리',  usage: '포커스/선택 강조 (ring)',
                          bright: '#3b82f6', dark: '#60a5fa', lowcontrast: '#8a6040' },
    },
  },

  // ── Text (글씨) ─────────────────────────────────────────────────────────
  {
    id: 'text',
    label: '글씨',
    tokens: {
      'text-primary':   { label: '본문',          usage: '제목, 본문, 진한 글씨',
                          bright: '#1e293b', dark: '#e2e8f0', lowcontrast: '#2c2618' },
      'text-secondary': { label: '보조 본문',      usage: '레이블, 설명',
                          bright: '#475569', dark: '#94a3b8', lowcontrast: '#5a5040' },
      'text-muted':     { label: '흐린 글씨',      usage: 'placeholder, 보조 메타',
                          bright: '#94a3b8', dark: '#64748b', lowcontrast: '#998c78' },
      'text-emphasis':  { label: '강조 글씨',      usage: '강조하고 싶은 키워드',
                          bright: '#0f172a', dark: '#f8fafc', lowcontrast: '#1a1408' },
      'text-inverse':   { label: '역상 글씨',      usage: '어두운 버튼 위 흰 글씨',
                          bright: '#ffffff', dark: '#ffffff', lowcontrast: '#fdf8f0' },
      'text-link':      { label: '링크',          usage: '하이퍼링크',
                          bright: '#2563eb', dark: '#60a5fa', lowcontrast: '#7a5020' },
      'text-link-hover':{ label: '링크 hover',     usage: '하이퍼링크 hover',
                          bright: '#1d4ed8', dark: '#93c5fd', lowcontrast: '#5a3810' },
    },
  },

  // ── Status (상태) ───────────────────────────────────────────────────────
  {
    id: 'status',
    label: '상태',
    tokens: {
      'success-bg':     { label: '성공 배경',      usage: '성공 배지/알림 배경',
                          bright: '#d1fae5', dark: 'rgba(16,185,129,0.18)', lowcontrast: '#cce0c0' },
      'success-text':   { label: '성공 글씨',      usage: '성공 메시지 텍스트',
                          bright: '#065f46', dark: '#34d399', lowcontrast: '#3a5028' },
      'warning-bg':     { label: '경고 배경',      usage: '경고 배지/알림 배경',
                          bright: '#fef3c7', dark: 'rgba(120,53,15,0.35)', lowcontrast: '#e8d8a8' },
      'warning-text':   { label: '경고 글씨',      usage: '경고 메시지 텍스트',
                          bright: '#92400e', dark: '#fcd34d', lowcontrast: '#7a5a10' },
      'danger-bg':      { label: '오류 배경',      usage: '오류 배지/삭제 확인 배경',
                          bright: '#fee2e2', dark: 'rgba(127,29,29,0.35)', lowcontrast: '#e8c8c0' },
      'danger-text':    { label: '오류 글씨',      usage: '오류 메시지 텍스트',
                          bright: '#b91c1c', dark: '#fca5a5', lowcontrast: '#8a3020' },
      'info-bg':        { label: '정보 배경',      usage: '정보 배지/알림 배경',
                          bright: '#dbeafe', dark: '#1e3a5a', lowcontrast: '#e8d8c0' },
      'info-text':      { label: '정보 글씨',      usage: '정보 메시지 텍스트',
                          bright: '#1d4ed8', dark: '#93c5fd', lowcontrast: '#7a5020' },
    },
  },

  // ── Bubble (커뮤니티 말풍선) ────────────────────────────────────────────
  {
    id: 'bubble',
    label: '말풍선 (커뮤니티)',
    tokens: {
      'bubble-mine-bg':     { label: '내 말풍선 배경',    usage: '내가 보낸 메시지',
                              bright: '#dbeafe', dark: '#1e2e4a', lowcontrast: '#e8d8c0' },
      'bubble-mine-border': { label: '내 말풍선 테두리',  usage: '내 메시지 보더',
                              bright: '#bfdbfe', dark: '#2a4068', lowcontrast: '#c9b89a' },
      'bubble-mine-text':   { label: '내 말풍선 글씨',    usage: '내 메시지 본문',
                              bright: '#1e293b', dark: '#e2e8f0', lowcontrast: '#2c2618' },
      'bubble-other-bg':    { label: '상대 말풍선 배경',  usage: '상대가 보낸 메시지',
                              bright: '#ffffff', dark: '#1e293b', lowcontrast: '#f5f0e6' },
      'bubble-other-border':{ label: '상대 말풍선 테두리',usage: '상대 메시지 보더',
                              bright: '#e2e8f0', dark: '#334155', lowcontrast: '#cec5af' },
      'bubble-other-text':  { label: '상대 말풍선 글씨',  usage: '상대 메시지 본문',
                              bright: '#1e293b', dark: '#e2e8f0', lowcontrast: '#2c2618' },
      'bubble-system-bg':   { label: '시스템 메시지 배경',usage: '시스템 알림 영역',
                              bright: '#f1f5f9', dark: '#162032', lowcontrast: '#e8e0ce' },
      'bubble-system-text': { label: '시스템 메시지 글씨',usage: '시스템 알림 텍스트',
                              bright: '#64748b', dark: '#94a3b8', lowcontrast: '#7a6a50' },
      'bubble-ai-bg':       { label: 'AI 말풍선 배경',    usage: 'AI(GPT/Claude) 응답',
                              bright: '#ede9fe', dark: 'rgba(139,92,246,0.20)', lowcontrast: '#e0d4d8' },
      'bubble-ai-border':   { label: 'AI 말풍선 테두리',  usage: 'AI 응답 보더',
                              bright: '#c4b5fd', dark: '#7c3aed', lowcontrast: '#b09498' },
      'bubble-ai-text':     { label: 'AI 말풍선 글씨',    usage: 'AI 응답 본문',
                              bright: '#5b21b6', dark: '#c4b5fd', lowcontrast: '#5a3858' },
    },
  },

  // ── Button (버튼) ───────────────────────────────────────────────────────
  {
    id: 'button',
    label: '버튼',
    tokens: {
      'btn-primary-bg':    { label: '주요 버튼 배경',     usage: '저장/확인/제출',
                             bright: '#2563eb', dark: '#3b82f6', lowcontrast: '#8a6040' },
      'btn-primary-hover': { label: '주요 버튼 hover',     usage: '',
                             bright: '#1d4ed8', dark: '#2563eb', lowcontrast: '#7a5030' },
      'btn-primary-text':  { label: '주요 버튼 글씨',     usage: '',
                             bright: '#ffffff', dark: '#ffffff', lowcontrast: '#fdf8f0' },
      'btn-secondary-bg':  { label: '보조 버튼 배경',     usage: '취소/뒤로',
                             bright: '#ffffff', dark: '#1e293b', lowcontrast: '#f5f0e6' },
      'btn-secondary-text':{ label: '보조 버튼 글씨',     usage: '',
                             bright: '#475569', dark: '#cbd5e1', lowcontrast: '#5a5040' },
      'btn-danger-bg':     { label: '위험 버튼 배경',     usage: '삭제',
                             bright: '#dc2626', dark: '#dc2626', lowcontrast: '#a04040' },
      'btn-danger-text':   { label: '위험 버튼 글씨',     usage: '',
                             bright: '#ffffff', dark: '#ffffff', lowcontrast: '#fdf8f0' },
    },
  },

  // ── Input (입력) ────────────────────────────────────────────────────────
  {
    id: 'input',
    label: '입력 필드',
    tokens: {
      'input-bg':           { label: '입력 배경',         usage: 'input/textarea/select',
                              bright: '#ffffff', dark: '#1e293b', lowcontrast: '#f5f0e6' },
      'input-border':       { label: '입력 테두리',       usage: '',
                              bright: '#cbd5e1', dark: '#334155', lowcontrast: '#cec5af' },
      'input-focus-border': { label: '입력 포커스 테두리',usage: '포커스 시',
                              bright: '#3b82f6', dark: '#60a5fa', lowcontrast: '#8a6040' },
      'input-placeholder':  { label: '입력 placeholder',  usage: '',
                              bright: '#94a3b8', dark: '#64748b', lowcontrast: '#998c78' },
    },
  },

  // ── Schedule (스케줄 전용) ──────────────────────────────────────────────
  {
    id: 'schedule',
    label: '스케줄',
    tokens: {
      'today-marker':     { label: '오늘 마커',          usage: '빨간 세모',
                            bright: '#ef4444', dark: '#f87171', lowcontrast: '#a04040' },
      'focused-day-bg':   { label: '선택 날짜 배경',     usage: '키보드 포커스 날짜',
                            bright: '#bfdbfe', dark: '#1e3a5a', lowcontrast: '#dac9a0' },
      'focused-day-ring': { label: '선택 날짜 ring',      usage: '키보드 포커스 ring',
                            bright: '#3b82f6', dark: '#60a5fa', lowcontrast: '#8a6040' },
      'day-separator':    { label: '날짜 구분선',         usage: '일별 세로/가로선',
                            bright: '#cbd5e1', dark: '#334155', lowcontrast: '#cec5af' },
      'week-separator':   { label: '주 구분선 (월요일)',  usage: '월요일 굵은 선',
                            bright: '#64748b', dark: '#94a3b8', lowcontrast: '#7a6a50' },
      'section-divider':  { label: '섹션 구분선',         usage: '런/요약/유저 사이',
                            bright: '#3b82f6', dark: '#60a5fa', lowcontrast: '#8a6040' },
    },
  },

  // ── Nav / Command bars (상단 타이틀 + 하단 명령 바) ──────────────────────
  {
    id: 'nav',
    label: '내비 / 명령 바',
    tokens: {
      'nav-bg':         { label: '내비 배경',         usage: '상단 navbar, 하단 명령/검색/댓글 바',
                          bright: '#18181b', dark: '#070d1a', lowcontrast: '#6b5040' },
      'nav-border':     { label: '내비 보더',         usage: 'navbar/bottom-bar 상하 보더',
                          bright: '#27272a', dark: '#1a2440', lowcontrast: '#5a4030' },
      'nav-text':       { label: '내비 본문 글씨',     usage: 'navbar 흰 글씨 / bottom-bar 입력 글씨',
                          bright: '#f4f4f5', dark: '#e2e8f0', lowcontrast: '#fdf8f0' },
      'nav-text-muted': { label: '내비 보조 글씨',     usage: 'navbar/bottom-bar 힌트, placeholder',
                          bright: '#a1a1aa', dark: '#64748b', lowcontrast: '#c0a070' },
      'nav-accent':     { label: '내비 강조',         usage: 'navbar 활성/hover 버튼 배경',
                          bright: '#3f3f46', dark: '#1e3a5a', lowcontrast: '#7a5a38' },
    },
  },

  // ── Misc ────────────────────────────────────────────────────────────────
  {
    id: 'misc',
    label: '기타',
    tokens: {
      'highlight-bg':    { label: '하이라이트 배경',     usage: '검색 결과 등',
                           bright: '#fef9c3', dark: 'rgba(250,204,21,0.25)', lowcontrast: '#ead8a8' },
      'selection-bg':    { label: '선택 영역 배경',      usage: '드래그/range selection',
                           bright: 'rgba(59,130,246,0.30)', dark: 'rgba(96,165,250,0.30)', lowcontrast: 'rgba(138,96,64,0.30)' },
      'scrollbar-thumb': { label: '스크롤바',             usage: '',
                           bright: '#cbd5e1', dark: '#475569', lowcontrast: '#b9a98e' },
    },
  },
]

/** Flat lookup table keyed by token name (e.g. 'bubble-mine-bg'). */
export const TOKENS = (() => {
  const out = {}
  for (const g of TOKEN_GROUPS) {
    for (const [name, def] of Object.entries(g.tokens)) {
      out[name] = { ...def, group: g.id }
    }
  }
  return out
})()

/** Theme ids in display order. */
export const THEMES = [
  { id: 'bright',      label: 'Bright' },
  { id: 'dark',        label: 'Dark' },
  { id: 'lowcontrast', label: 'Low contrast' },
]
