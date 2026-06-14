import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// Research/lilak/elog — a copy of lilak_elog rebuilt with the lilak-ui kit.
// Talks to a running elog project backend (default :8011) and aliases lilak-ui.
const BACKEND = process.env.ELOG_BACKEND || 'http://localhost:8011'
// The launcher (:8010) serves the project list + per-project reverse proxy
// (`/p/<name>/...`). `/launcher/*` is rewritten to the launcher root so the
// kit project-list page and experiment-scoped API both reach it.
const LAUNCHER = process.env.ELOG_LAUNCHER || 'http://localhost:8010'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // frontend -> elog -> lilak -> Research -> home, then ai_projects
      'lilak-ui': resolve(__dirname, '../../../../ai_projects/lilak_ui/src'),
    },
  },
  // Pre-bundle the kit's runtime deps at startup so adding them mid-session
  // doesn't trigger an on-demand re-optimize + reload loop.
  optimizeDeps: {
    include: ['@phosphor-icons/react', 'react-markdown', 'remark-gfm'],
  },
  server: {
    port: 5130,
    fs: { allow: [resolve(__dirname), resolve(__dirname, '../../../../ai_projects/lilak_ui')] },
    proxy: {
      '/launcher': { target: LAUNCHER, changeOrigin: true, rewrite: (p) => p.replace(/^\/launcher/, '') },
      '/api': BACKEND,
    },
  },
})
