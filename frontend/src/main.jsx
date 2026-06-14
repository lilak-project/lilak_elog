import React from 'react'
import ReactDOM from 'react-dom/client'
import { loadFonts } from 'lilak-ui'
import App from './App.jsx'
import './index.css'

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
