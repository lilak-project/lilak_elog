/**
 * Shared tag chip styling. Tags can have a background color, a border color, or
 * both. With no background, the chip uses the theme-variable sky palette
 * (bg-sky-100 / text-sky-700, overridden per theme in index.css).
 *
 * The system-tag color map (from /tags/colors) has the shape
 *   { name: { color: hex|null, border: hex|null } }
 * Real tags carry `color` and `border_color` on the entry's tag object.
 */
import { useState, useEffect } from 'react'
import api from '../api'

// Default backgrounds for synthetic system tags (overridable via /tags/system).
export const DEFAULT_TAG_COLORS = {
  pending: '#2563eb',   // blue
  init:    '#ffe375',   // yellow
  start:   '#ffe375',
  running: '#ffe375',
  end:     '#ffe375',
  idle:    '#e5e7eb',   // very light gray
}

// Default border colors for synthetic tags (none by default).
export const BORDER_TAGS = {}

// Run-type letter → status tag name.
export const RUN_STATUS_TAG = { I: 'init', S: 'start', R: 'running', E: 'end', IDLE: 'idle', A: 'idle' }

/** Pick readable text (#111 or #fff) for a hex background. */
export function textOn(hex) {
  if (!hex || hex[0] !== '#' || hex.length < 7) return '#ffffff'
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16)
  return (0.299 * r + 0.587 * g + 0.114 * b) > 160 ? '#111827' : '#ffffff'
}

/** Returns { className, style } for a tag chip given its bg/border/text colors.
 *  `name` lets synthetic tags fall back to their defaults. */
export function chipProps(name, color, border, text) {
  // color 'theme' = force the themed sky background (overrides any default).
  const bg = color === 'theme' ? null : (color || DEFAULT_TAG_COLORS[name] || null)
  // border 'none' = explicitly no border (overrides the synthetic default).
  let bd = border === 'none' ? null : (border || BORDER_TAGS[name] || null)
  const style = {}
  let className = ''
  if (bg) {
    style.backgroundColor = bg
    style.color = text || textOn(bg)
    if (bg.toLowerCase() === '#ffffff' && !bd) bd = 'var(--border-default)'
  } else if (text) {
    className = 'bg-sky-100'   // themed sky bg, custom text color
    style.color = text
  } else {
    className = 'bg-sky-100 text-sky-700'   // themed sky default
  }
  if (bd) style.border = `1.5px solid ${bd}`
  return { className, style }
}

/** chipProps for a synthetic tag using the /tags/colors map. */
export function synthChipProps(name, colorMap) {
  const c = colorMap && colorMap[name]
  return chipProps(name, c && c.color, c && c.border, c && c.text)
}

let _map = {}
let _loaded = false
const listeners = new Set()

export function refreshTagColors() {
  return api.get('/tags/colors')
    .then(r => {
      _map = r.data || {}
      _loaded = true
      listeners.forEach(fn => fn(_map))
      return _map
    })
    .catch(() => _map)
}

export function useTagColors() {
  const [map, setMap] = useState(_map)
  useEffect(() => {
    listeners.add(setMap)
    if (!_loaded) refreshTagColors()
    return () => { listeners.delete(setMap) }
  }, [])
  return map
}
