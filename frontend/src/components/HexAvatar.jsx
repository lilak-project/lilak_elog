/**
 * HexAvatar — hexagonal triangle-grid profile avatar.
 *
 * Renders one of 60 hand-designed shapes (24-triangle hex tessellation, n=2)
 * filled with one of 20 preset colors. Used for:
 *   • Chat bubbles in the Community tab
 *   • Account / settings profile preview
 *   • (Future) anywhere a small user identifier helps
 *
 * Props:
 *   shape:    shape key from HEX_SHAPES (e.g. 'lotus', 'comet')
 *   color:    hex color string (e.g. '#3b82f6')
 *   username: used as deterministic fallback when shape/color are missing
 *             (so pre-existing users still get a stable avatar)
 *   isAi:     for AI bot messages — overrides shape/color with bot defaults
 *   size:     pixel size of the SVG (default 24 to match chat row height)
 *
 * Helpers:
 *   randomProfile()         → { profile_shape, profile_color } — fully random
 *   deterministicProfile(u) → stable random based on hash of username
 *   HEX_SHAPE_KEYS          → array of all 60 keys
 *   PROFILE_COLORS          → array of all 20 hex colors
 */

// ── Bit-pattern helpers ──────────────────────────────────────────────────────
//   Each shape is a 24-element bitmap: bits[wedge*4 + position] = 0/1.
//   wedge 0..5, position 0..3 within wedge.  See _preview_hex_v2.html for the
//   visual derivation of these patterns.

function setBits(idxs) {
  const a = new Array(24).fill(0)
  for (const i of idxs) a[i] = 1
  return a
}
function f6(a, b, c, d) { return Array(6).fill([a, b, c, d]).flat() }
function f3(w0, w1) { return [...w0, ...w1, ...w0, ...w1, ...w0, ...w1] }
function mir(w0, w1, w2) {
  const mw = w => [w[0], w[1], w[3], w[2]]
  return [...w0, ...w1, ...w2, ...mw(w2), ...mw(w1), ...mw(w0)]
}

// ── 60-shape registry ────────────────────────────────────────────────────────
export const HEX_SHAPES = {
  // ── Flowers (12) ──
  bud:         f6(1,0,0,0),
  lotus:       f6(0,1,0,0),
  daisy:       f6(0,0,1,1),
  rose:        f6(1,1,0,0),
  bloom:       f6(0,1,1,1),
  mandala:     f6(1,0,1,1),
  sunflower:   f6(1,1,1,0),
  pinwheel:    f6(0,0,0,1),
  starflower:  f6(0,1,0,1),
  clover:      f3([1,1,0,0], [0,0,0,0]),
  petal:       f3([0,0,1,1], [0,0,0,0]),
  cosmos:      f3([0,1,1,0], [0,0,0,1]),

  // ── Faces / masks (12) ──
  smile:       mir([0,0,0,1], [0,0,1,0], [1,1,0,0]),
  eyes:        mir([0,0,0,1], [0,0,1,0], [0,0,0,0]),
  crown:       mir([1,0,1,1], [0,0,0,0], [0,0,0,0]),
  visor:       mir([0,0,0,0], [1,1,1,1], [0,0,0,0]),
  beard:       mir([0,0,0,0], [0,1,0,0], [1,1,1,0]),
  hood:        mir([1,1,1,0], [0,1,0,0], [0,0,0,0]),
  wink:        setBits([3, 6, 22, 5, 17, 11, 9, 13]),
  sad:         mir([0,0,0,1], [0,0,1,0], [0,1,1,1]),
  surprised:   mir([0,0,0,1], [0,0,1,1], [1,0,0,0]),
  venetian:    mir([1,1,1,1], [0,1,0,1], [0,0,0,0]),
  cat:         mir([1,0,1,0], [0,0,0,0], [1,0,0,1]),
  robot:       mir([0,0,1,0], [1,1,0,0], [0,1,0,0]),

  // ── Science / tech (12) ──
  atom:          f3([1,0,0,0], [0,0,0,0]),
  benzene:       f3([0,0,1,1], [0,0,1,0]),
  crystal:       f3([1,1,1,0], [0,0,0,0]),
  spiral:        f3([0,0,1,0], [1,0,0,0]),
  circuit:       setBits([0,4,8,12,16,20, 5,17, 2,11]),
  antenna:       setBits([2,23, 0,20, 8,12, 1,21]),
  gear:          f6(0,1,1,0),
  constellation: setBits([2, 8, 19, 14, 6, 22]),
  chip:          setBits([0,4,8,12,16,20, 2,11, 14, 18]),
  quartz:        f3([0,0,1,1], [0,0,0,1]),
  magnet:        mir([1,1,1,1], [0,0,1,0], [0,0,0,0]),
  radar:         setBits([0,4,8,12,16,20, 5,9,13]),

  // ── Stars / moons (12) ──
  star6:         f6(0,0,1,0),
  star12:        f6(1,0,1,0),
  ray:           f6(1,1,0,1),
  polestar:      f3([0,0,1,0], [0,0,0,0]),
  crescent:      setBits([2,23, 21,20,17,13,12,14, 11]),
  fullmoon:      f6(1,1,1,1),
  firework:      f6(1,0,0,1),
  comet:         setBits([2, 1, 5, 9, 14, 13]),
  eclipse:       setBits([0,1,2,3,4,5,6,7,8,9,10,11]),
  shootingstar:  setBits([22,21, 1,5,9, 11]),
  galaxy:        f3([0,1,1,1], [1,0,0,0]),
  planet:        setBits([0,4,8,12,16,20, 9,11]),

  // ── Symbols (12) ──
  heart:       mir([0,1,1,0], [1,0,0,0], [1,1,0,0]),
  diamond:     setBits([2,23, 5,17, 11,14]),
  infinity:    setBits([4,5, 16,17, 0,12, 8,20]),
  lightning:   setBits([2,23, 1, 5, 13, 14]),
  knot:        f3([0,1,0,1], [1,0,0,0]),
  palm:        setBits([0,4,8,12,16,20, 2,23, 21,1]),
  cross:       setBits([0,1,2, 5, 8,11,12,13,14, 17, 20,23]),
  plus:        setBits([0,5, 8,12, 17,20]),
  check:       setBits([3,5,6, 9,13,15]),
  shield:      setBits([0,2,3, 5,6, 9, 11,13,14, 17, 19,20, 22,23]),
  umbrella:    setBits([0,1,2,3, 6, 8, 12, 19,20,21,22,23]),
  arrow:       setBits([0,2, 8,9,11, 12,13,14, 20,23]),
}

export const HEX_SHAPE_KEYS = Object.keys(HEX_SHAPES)

// ── 20-color palette ─────────────────────────────────────────────────────────
//   Picked from Tailwind 500-ish hues so every color reads well on both light
//   and dark theme backgrounds.
export const PROFILE_COLORS = [
  '#ef4444', // red
  '#f97316', // orange
  '#f59e0b', // amber
  '#eab308', // yellow
  '#84cc16', // lime
  '#22c55e', // green
  '#10b981', // emerald
  '#14b8a6', // teal
  '#06b6d4', // cyan
  '#0ea5e9', // sky
  '#3b82f6', // blue
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#a855f7', // purple
  '#d946ef', // fuchsia
  '#ec4899', // pink
  '#f43f5e', // rose
  '#64748b', // slate
  '#a16207', // brown
  '#0f766e', // dark teal
]

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Pick a random (shape, color) pair. */
export function randomProfile() {
  return {
    profile_shape: HEX_SHAPE_KEYS[Math.floor(Math.random() * HEX_SHAPE_KEYS.length)],
    profile_color: PROFILE_COLORS[Math.floor(Math.random() * PROFILE_COLORS.length)],
  }
}

/** Pick a stable (shape, color) pair derived from a string (usually username).
 *  Used as a fallback for users without an explicit profile yet. */
export function deterministicProfile(seed) {
  let x = 2166136261 >>> 0
  for (const c of (seed || '')) {
    x ^= c.charCodeAt(0)
    x = Math.imul(x, 16777619) >>> 0
  }
  return {
    profile_shape: HEX_SHAPE_KEYS[x % HEX_SHAPE_KEYS.length],
    profile_color: PROFILE_COLORS[(x >>> 8) % PROFILE_COLORS.length],
  }
}

// ── SVG geometry (n=2 pointy-top hex tessellation) ───────────────────────────
const SQ3 = Math.sqrt(3)
const R = 45, CX = 50, CY = 50
const TRI_CORNERS = {
  0: [[0,0], [1,0], [0,1]],
  1: [[1,0], [1,1], [0,1]],
  2: [[1,0], [2,0], [1,1]],
  3: [[0,1], [1,1], [0,2]],
}
function _gridXY(i, j) {
  return [i * R / 2 + j * R / 4, j * R * SQ3 / 4]
}
function _triPts(k, p) {
  const theta = -Math.PI / 2 + k * Math.PI / 3
  const ct = Math.cos(theta), st = Math.sin(theta)
  return TRI_CORNERS[p].map(([i, j]) => {
    const [lx, ly] = _gridXY(i, j)
    return `${(CX + lx * ct - ly * st).toFixed(2)},${(CY + lx * st + ly * ct).toFixed(2)}`
  }).join(' ')
}

// Cache: shape key → array of <polygon points> strings.
const _polyCache = {}
function _polysFor(shapeKey) {
  if (_polyCache[shapeKey]) return _polyCache[shapeKey]
  const bits = HEX_SHAPES[shapeKey] || HEX_SHAPES.bud
  const pts = []
  for (let i = 0; i < 24; i++) {
    if (bits[i]) {
      const k = (i / 4) | 0
      const p = i % 4
      pts.push(_triPts(k, p))
    }
  }
  _polyCache[shapeKey] = pts
  return pts
}

// ── AI bot defaults (used when isAi=true) ────────────────────────────────────
const AI_DEFAULTS = {
  gpt:     { shape: 'atom',    color: '#10b981' },
  claude:  { shape: 'crystal', color: '#8b5cf6' },
  default: { shape: 'spiral',  color: '#3b82f6' },
}
function _aiDefaults(name) {
  const lower = (name || '').toLowerCase()
  for (const key of Object.keys(AI_DEFAULTS)) {
    if (key !== 'default' && lower.includes(key)) return AI_DEFAULTS[key]
  }
  return AI_DEFAULTS.default
}

// ── Component ────────────────────────────────────────────────────────────────

export default function HexAvatar({
  shape,
  color,
  username,
  isAi = false,
  size = 24,
  className = '',
  title,
}) {
  let resolvedShape = shape && HEX_SHAPES[shape] ? shape : null
  let resolvedColor = color || null

  if (isAi) {
    const def = _aiDefaults(username)
    if (!resolvedShape) resolvedShape = def.shape
    if (!resolvedColor) resolvedColor = def.color
  }

  if (!resolvedShape || !resolvedColor) {
    const det = deterministicProfile(username || '')
    if (!resolvedShape) resolvedShape = det.profile_shape
    if (!resolvedColor) resolvedColor = det.profile_color
  }

  const polys = _polysFor(resolvedShape)

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 100 100"
      style={{ display: 'block', flexShrink: 0 }}
      aria-label={title}
    >
      {title && <title>{title}</title>}
      {polys.map((pts, i) => (
        <polygon
          key={i}
          points={pts}
          fill={resolvedColor}
          stroke={resolvedColor}
          strokeWidth="0.6"
        />
      ))}
    </svg>
  )
}
