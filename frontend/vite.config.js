import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// lilak_elog_v2 — a copy of lilak_elog rebuilt with the lilak-ui kit.
// All host/port settings come from the environment (with sane defaults), so the
// same code runs on any machine by editing `.env.local` — never the code.
// See `.env.example` for the variables, and ../../CONVENTIONS.md for the why.
export default defineConfig(({ mode }) => {
  // loadEnv('', cwd, '') merges every var from .env / .env.local (any prefix)
  // on top of the real shell environment, so a `.env.local` actually takes
  // effect here in the config (plain `process.env` would NOT read .env files).
  const env = { ...process.env, ...loadEnv(mode, process.cwd(), '') }

  const PORT     = Number(env.PORT) || 5130                       // dev server port
  const BACKEND  = env.ELOG_BACKEND  || 'http://localhost:8011'   // default elog backend
  const LAUNCHER = env.ELOG_LAUNCHER || 'http://localhost:8010'   // project launcher + /p proxy
  // Shared UI kit location — env-overridable so the deploy layout is portable
  // (default = the sibling checkout). `build-all.sh` sets LILAK_UI_PATH.
  const UI = env.LILAK_UI_PATH ? resolve(env.LILAK_UI_PATH) : resolve(__dirname, '../../lilak_ui')

  return {
    // Relative asset URLs so the build also works when served behind a portal
    // proxy under a path prefix (/pp/<svc>/<proj>/) — resolved against the <base>
    // href. At site root (launcher/dev) it's equivalent to absolute.
    base: './',
    plugins: [react()],
    resolve: {
      alias: {
        'lilak-ui': resolve(UI, 'src'),
      },
    },
    // Pre-bundle the kit's runtime deps at startup so adding them mid-session
    // doesn't trigger an on-demand re-optimize + reload loop.
    optimizeDeps: {
      include: ['@phosphor-icons/react', 'react-markdown', 'remark-gfm'],
    },
    server: {
      port: PORT,
      // Bind to 0.0.0.0 so the dev server is reachable from other devices on the
      // LAN (e.g. a phone) at http://<this-machine-LAN-IP>:PORT. The /api and
      // /launcher proxies still run on this machine, so the phone only needs the
      // frontend to be reachable.
      host: true,
      fs: { allow: [resolve(__dirname), UI] },
      proxy: {
        // `/launcher/*` -> the launcher root (project list + per-experiment proxy)
        '/launcher': { target: LAUNCHER, changeOrigin: true, rewrite: (p) => p.replace(/^\/launcher/, '') },
        // `/api/*` -> the default backend
        '/api': BACKEND,
      },
    },
  }
})
