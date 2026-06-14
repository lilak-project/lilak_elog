/**
 * Logbook logo.
 *
 * To use a custom logo: place /public/logo.svg or /public/logo.png in the
 * frontend/public/ directory and it will be used automatically.
 * Otherwise the default pencil-on-notebook SVG is shown.
 */
import { useState } from 'react'

function DefaultLogo({ className }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {/* Notebook */}
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
      <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
      {/* Pencil line */}
      <line x1="9" y1="9" x2="15" y2="9" />
      <line x1="9" y1="13" x2="15" y2="13" />
      <line x1="9" y1="17" x2="12" y2="17" />
    </svg>
  )
}

export default function Logo({ className = 'h-7 w-7' }) {
  const [useSvg, setUseSvg] = useState(true)
  const [usePng, setUsePng] = useState(false)

  if (useSvg) {
    return (
      <img
        src="/logo.svg"
        className={className}
        alt="logo"
        onError={() => { setUseSvg(false); setUsePng(true) }}
      />
    )
  }
  if (usePng) {
    return (
      <img
        src="/logo.png"
        className={className}
        alt="logo"
        onError={() => setUsePng(false)}
      />
    )
  }
  return <DefaultLogo className={className} />
}
