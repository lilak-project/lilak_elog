import React from 'react'
import ReactDOM from 'react-dom/client'
import { loadFonts, setBookmarkScope } from 'lilak-ui'
import App from './App.jsx'
import './index.css'

// Namespace DataCard bookmarks to THIS elog instance. All portal services share one
// origin, so the kit's default global bookmark key would let a star on `file:12`
// here appear starred in every other service. Under the portal __PORTAL_BASE__ is
// `/pp/elog/<experiment>` → per-experiment isolation; standalone falls back to 'elog'.
setBookmarkScope((typeof window !== 'undefined' && window.__PORTAL_BASE__) || 'elog')

// Load the kit fonts (Pretendard / IBM Plex Sans / D2Coding), define the
// --font-sans / --font-mono vars the kit components use, and make the sans stack
// the document-wide default font. Theme colours stay driven by elog's
// data-theme + index.css (same tokens), so we only add fonts here.
loadFonts()

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
