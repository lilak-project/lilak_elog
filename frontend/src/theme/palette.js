/**
 * ── Canonical color palette ──────────────────────────────────────────────
 *
 * Every color used in role pickers, level badges, event types, etc.
 * should pick a name from this list. The palette guarantees a consistent
 * visual identity across the three themes (bright, dark, lowcontrast).
 *
 * Each entry exposes:
 *   • name        — stable id ("emerald")
 *   • label       — human label for the picker
 *   • usage       — short description of where this color is used
 *   • tw          — { bg, border, text, solid } Tailwind class names
 *   • theme       — { bright, dark, lowcontrast } hex values for the SOLID color
 *
 * If you add a new color, also add the matching theme overrides in index.css
 * (search for "Color overrides — palette colors" to find the section).
 */

export const PALETTE = {
  emerald: {
    name: 'emerald',
    label: '에메랄드 (Emerald)',
    usage: '등록됨 / shifter / 활성 패턴 / 성공',
    tw: { bg: 'bg-emerald-200', border: 'border-emerald-400', text: 'text-emerald-800', solid: 'bg-emerald-500' },
    theme: { bright: '#10b981', dark: '#10b981', lowcontrast: '#5a7050' },
  },
  blue: {
    name: 'blue',
    label: '파랑 (Blue)',
    usage: '실험 이벤트 / 강조 / 정보',
    tw: { bg: 'bg-blue-200', border: 'border-blue-400', text: 'text-blue-800', solid: 'bg-blue-500' },
    theme: { bright: '#52525b', dark: '#3b82f6', lowcontrast: '#8a6040' },
  },
  amber: {
    name: 'amber',
    label: '호박 (Amber)',
    usage: '경고 / 시간 슬롯 자정 넘김',
    tw: { bg: 'bg-amber-200', border: 'border-amber-400', text: 'text-amber-800', solid: 'bg-amber-500' },
    theme: { bright: '#f59e0b', dark: '#fcd34d', lowcontrast: '#a08040' },
  },
  yellow: {
    name: 'yellow',
    label: '노랑 (Yellow)',
    usage: '강조 / 마커',
    tw: { bg: 'bg-yellow-200', border: 'border-yellow-400', text: 'text-yellow-800', solid: 'bg-yellow-500' },
    theme: { bright: '#facc15', dark: '#facc15', lowcontrast: '#b09040' },
  },
  purple: {
    name: 'purple',
    label: '보라 (Purple)',
    usage: '런 / 특별 역할',
    tw: { bg: 'bg-purple-200', border: 'border-purple-400', text: 'text-purple-800', solid: 'bg-purple-500' },
    theme: { bright: '#a855f7', dark: '#c084fc', lowcontrast: '#7a5878' },
  },
  pink: {
    name: 'pink',
    label: '핑크 (Pink)',
    usage: '강조 2 / 역할',
    tw: { bg: 'bg-pink-200', border: 'border-pink-400', text: 'text-pink-800', solid: 'bg-pink-500' },
    theme: { bright: '#ec4899', dark: '#f472b6', lowcontrast: '#8a5868' },
  },
  teal: {
    name: 'teal',
    label: '청록 (Teal)',
    usage: '보조 / 역할',
    tw: { bg: 'bg-teal-200', border: 'border-teal-400', text: 'text-teal-800', solid: 'bg-teal-500' },
    theme: { bright: '#14b8a6', dark: '#5eead4', lowcontrast: '#508070' },
  },
  orange: {
    name: 'orange',
    label: '주황 (Orange)',
    usage: '활동 / 역할',
    tw: { bg: 'bg-orange-200', border: 'border-orange-400', text: 'text-orange-800', solid: 'bg-orange-500' },
    theme: { bright: '#f97316', dark: '#fb923c', lowcontrast: '#a06040' },
  },
  rose: {
    name: 'rose',
    label: '장미 (Rose)',
    usage: '강조 3 / 역할',
    tw: { bg: 'bg-rose-200', border: 'border-rose-400', text: 'text-rose-800', solid: 'bg-rose-500' },
    theme: { bright: '#f43f5e', dark: '#fb7185', lowcontrast: '#a05868' },
  },
  red: {
    name: 'red',
    label: '빨강 (Red)',
    usage: '위험 / 오늘 표시 / 일요일 / 삭제',
    tw: { bg: 'bg-red-200', border: 'border-red-400', text: 'text-red-800', solid: 'bg-red-500' },
    theme: { bright: '#ef4444', dark: '#f87171', lowcontrast: '#a04040' },
  },
  slate: {
    name: 'slate',
    label: '슬레이트 (Slate)',
    usage: '중립 / 기본 / 비활성',
    tw: { bg: 'bg-slate-200', border: 'border-slate-400', text: 'text-slate-800', solid: 'bg-slate-500' },
    theme: { bright: '#64748b', dark: '#94a3b8', lowcontrast: '#7a6a50' },
  },
  sky: {
    name: 'sky',
    label: '하늘 (Sky)',
    usage: '태그 / 보조 정보',
    tw: { bg: 'bg-sky-200', border: 'border-sky-400', text: 'text-sky-800', solid: 'bg-sky-500' },
    theme: { bright: '#52525b', dark: '#0369a1', lowcontrast: '#9a7050' },
  },
}

/** Ordered list of palette names (use for pickers, etc). */
export const PALETTE_KEYS = Object.keys(PALETTE)

/** Look up a palette entry by name; falls back to emerald. */
export function paletteEntry(name) {
  return PALETTE[name] || PALETTE.emerald
}

/** Tailwind classes for a palette name (back-compat wrapper). */
export function paletteClasses(name) {
  return paletteEntry(name).tw
}
