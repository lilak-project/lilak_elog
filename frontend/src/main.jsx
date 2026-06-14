import React from 'react'
import ReactDOM from 'react-dom/client'
import { loadFonts, FONT_DEFAULTS } from 'lilak-ui'
import App from './App.jsx'
import './index.css'

// Load the kit fonts (Pretendard / IBM Plex Sans / D2Coding) and define the
// --font-sans / --font-mono vars the kit components use. Theme colours stay
// driven by elog's data-theme + index.css (same tokens), so we only add fonts.
loadFonts()
for (const [k, v] of Object.entries(FONT_DEFAULTS)) document.documentElement.style.setProperty(k, v)

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
