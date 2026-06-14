/**
 * ── Shared UI style presets ────────────────────────────────────────────────
 *
 * Common visual patterns (buttons, modal frames, table chrome) defined once
 * so that semantically-equivalent elements across the app — e.g. "Save",
 * "Login", "Sign in", "Confirm" — pick the same colors automatically.
 *
 * Every value here resolves to a CSS variable from index.css (mirrored in
 * theme/tokens.js), so themes follow without any per-file override.
 *
 * Usage:
 *   import { btnPrimary, btnSecondary, modalFrame, hoverify } from '../theme/uiStyles'
 *   <button style={btnPrimary} {...hoverify(btnPrimary, btnPrimaryHover)}>Save</button>
 *
 * The exported objects are PLAIN — never mutate them.
 */

// ── Buttons ────────────────────────────────────────────────────────────────

/** Primary action: Save, Submit, Login, Sign in, Send, Create, Confirm. */
export const btnPrimary = Object.freeze({
  backgroundColor: 'var(--btn-primary-bg)',
  color:           'var(--btn-primary-text)',
})
export const btnPrimaryHover = Object.freeze({
  backgroundColor: 'var(--btn-primary-hover)',
  color:           'var(--btn-primary-text)',
})

/** Secondary action: Cancel, Back, Close, "no" choice. */
export const btnSecondary = Object.freeze({
  backgroundColor: 'var(--btn-secondary-bg)',
  color:           'var(--btn-secondary-text)',
  borderColor:     'var(--border-default)',
})
export const btnSecondaryHover = Object.freeze({
  backgroundColor: 'var(--surface-2)',
  color:           'var(--text-primary)',
  borderColor:     'var(--border-strong)',
})

/** Danger action: Delete, Remove, Revoke, Deactivate. */
export const btnDanger = Object.freeze({
  backgroundColor: 'var(--btn-danger-bg)',
  color:           'var(--btn-danger-text)',
})
export const btnDangerHover = Object.freeze({
  backgroundColor: 'var(--danger-text)',
  color:           'var(--btn-danger-text)',
})

/** Soft danger: deletes in a list, "remove" inline links — outline of danger. */
export const btnDangerSoft = Object.freeze({
  backgroundColor: 'var(--danger-bg)',
  color:           'var(--danger-text)',
})
export const btnDangerSoftHover = Object.freeze({
  backgroundColor: 'var(--danger-text)',
  color:           'var(--btn-danger-text)',
})

/** Ghost / icon button: transparent body, hover lifts to surface-2. */
export const btnGhost = Object.freeze({
  backgroundColor: 'transparent',
  color:           'var(--text-secondary)',
})
export const btnGhostHover = Object.freeze({
  backgroundColor: 'var(--surface-2)',
  color:           'var(--text-primary)',
})

/** Info / link-like button: blue-tinted, used for Edit / View / Token links. */
export const btnInfo = Object.freeze({
  backgroundColor: 'var(--info-bg)',
  color:           'var(--info-text)',
})
export const btnInfoHover = Object.freeze({
  backgroundColor: 'var(--info-text)',
  color:           'var(--btn-primary-text)',
})

/** Warning accent button: Transfer, "review carefully" actions. Solid amber. */
export const btnWarning = Object.freeze({
  backgroundColor: 'var(--warning-text)',
  color:           'var(--btn-primary-text)',
})
export const btnWarningHover = Object.freeze({
  backgroundColor: 'var(--warning-bg)',
  color:           'var(--warning-text)',
})

/** Success accent button: Restore, Activate. */
export const btnSuccess = Object.freeze({
  backgroundColor: 'var(--success-bg)',
  color:           'var(--success-text)',
})
export const btnSuccessHover = Object.freeze({
  backgroundColor: 'var(--success-text)',
  color:           'var(--btn-primary-text)',
})

// ── Modals ─────────────────────────────────────────────────────────────────

/** Solid-card modal frame (white-on-overlay variants in every theme). */
export const modalFrame = Object.freeze({
  backgroundColor: 'var(--surface)',
  borderColor:     'var(--border-default)',
  color:           'var(--text-primary)',
})
/** Modal header / footer strip (slightly recessed). */
export const modalHeader = Object.freeze({
  backgroundColor: 'var(--surface-2)',
  borderColor:     'var(--border-subtle)',
  color:           'var(--text-primary)',
})
/** Full-screen scrim behind a modal. */
export const modalOverlay = Object.freeze({
  backgroundColor: 'var(--overlay)',
})

// ── Tables ─────────────────────────────────────────────────────────────────

/** Header row (thead). */
export const tableHeader = Object.freeze({
  backgroundColor: 'var(--surface-2)',
  color:           'var(--text-secondary)',
  borderColor:     'var(--border-default)',
})
/** Body row (default). */
export const tableRow = Object.freeze({
  backgroundColor: 'var(--surface)',
  color:           'var(--text-primary)',
  borderColor:     'var(--border-subtle)',
})
/** Body row hover state. */
export const tableRowHover = Object.freeze({
  backgroundColor: 'var(--surface-2)',
})

// ── Inputs ─────────────────────────────────────────────────────────────────

export const inputBase = Object.freeze({
  backgroundColor: 'var(--input-bg)',
  borderColor:     'var(--input-border)',
  color:           'var(--text-primary)',
})

// ── Inline link ────────────────────────────────────────────────────────────

export const inlineLink = Object.freeze({
  color: 'var(--text-link)',
})

// ── Mouse-hover handlers ──────────────────────────────────────────────────

/**
 * Returns onMouseEnter/Leave handlers that swap inline styles between a
 * base and a hover variant. Skips when the element is disabled.
 *
 * Usage:
 *   <button style={btnPrimary} {...hoverify(btnPrimary, btnPrimaryHover)} />
 */
export function hoverify(base, hover) {
  return {
    onMouseEnter: (e) => {
      if (e.currentTarget.disabled) return
      Object.assign(e.currentTarget.style, hover)
    },
    onMouseLeave: (e) => {
      Object.assign(e.currentTarget.style, base)
    },
  }
}
