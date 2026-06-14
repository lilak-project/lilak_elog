# lilak_elog

An **electronic logbook** (elog) for experimental-physics labs. A **self-contained
app**: a FastAPI backend + launcher in `backend/`, and a frontend in `frontend/`
rebuilt **purely from the [`lilak-ui`](../lilak_ui) kit** + thin glue. The frontend
is the proving ground for the kit — every screen is *fetch data → pass to kit
blocks*, so anything reusable gets pushed into `lilak-ui`.

It tracks runs, readouts and tasks; groups them into runs/dates; supports tags,
comments, attachments, infography figures, a team community channel, schedules,
and per-experiment databases via a launcher.

---

## Relationship to the other repos

| Repo | What it is |
|---|---|
| **`lilak_ui`** | The shared UI kit. The frontend consumes it from source via a Vite alias. |
| **`lilak_elog`** (this) | The kit-built, self-contained elog — frontend (kit + glue) **and** backend + launcher. |
| `zzz/lilak_elog` | The previous standalone build, archived locally. The kit was extracted from its frontend; not used at runtime. |

The frontend rebuild goal: instead of styling screens by hand, the app composes
finished kit components, which forces every reusable pattern (shell, theme, log
views, command bar, admin tables) out of the app and into the kit. The
**Schedule** feature is intentionally excluded from the pure-kit rebuild.

---

## Architecture

The **frontend** is three layers (the kit is a separate repo):

1. **Kit (`lilak-ui`)** — all visuals + reusable behaviour (theme, shell,
   components, log/data/CRUD blocks). No elog-specific code; lives in `../lilak_ui`.
2. **Glue (`frontend/`)** — `api.js`, React Router routes, data fetching, and small
   adapters that feed kit components real elog data. Contexts
   (`Auth/Lang/Theme/Density/Size/Tab`) hold app state.
3. **App config (`frontend/`)** — i18n dictionaries (`i18n/ko.js`, `i18n/en.js`),
   the command registry, and which tabs exist.

The **backend** (`backend/`) is a FastAPI app: `main.py` (the per-experiment API)
+ `launcher.py` (the project list + reverse proxy). Run state (SQLite DBs,
uploads) lives under `data/` and `uploads/` — git-ignored.

Every page is *fetch → pass to kit blocks*; a finished page carries **no Tailwind
utility classes and no inline CSS-var styling** — that belongs in a kit component.

```
frontend/src/
  main.jsx, App.jsx        # router + provider stack
  api.js                   # axios instance; experiment-aware baseURL
  components/Shell.jsx     # the chrome: kit TopBar + CommandBar + Drawer + registry wiring
  context/                 # Auth / Lang / Theme / Density / Size / Tab
  i18n/                    # ko.js + en.js dictionaries
  commands/                # command registry definitions
  pages/                   # one file per surface (see below)
  theme/                   # textCombos / uiStyles glue
docs/indexing.md           # the command-bar index-character scheme
```

**Tabs / pages**: 로그 (logs · `Home`), 데이터 (`InfographyPage`), 파일
(`Files` + `Gallery`), 커뮤니티 (`CommunityPage`), 스케줄 (`SchedulePage`),
커넥터 (`ExperimentPage`), 설정 (`SettingsPage`). Plus `ProjectsPage` (the
launcher/home), `LogDetail`, `LogForm`, and the manager-only `Admin*` pages.

---

## Key features

- **Command bar + hotkeys.** A collapsible bottom command line (kit `CommandBar`)
  driven by a command registry. `/` runs commands (`/login`, `/theme`, `/search`,
  …); single-key shortcuts work from anywhere; `?` opens the shortcuts modal.
- **Special-character index.** Type a lead char to find any data component by
  number, name, or `#tag` — `_` logs, `%` modules/services, `^` files/photos,
  `&` infography, `@` users, `~` community, `>` runs, `!` notifications, `*`
  bookmarks, `#` cross-kind tag search. See [`docs/indexing.md`](docs/indexing.md).
  In the logs tab: `G` → newest entry, `g` → open the `_` number search, `g`
  again → close it and jump to the top.
- **Per-experiment databases (launcher).** A project/experiment list page (the
  "elog home") lets you create / enter / stop / delete experiments — each with its
  **own database** — exactly like the original launcher model (see below).
- **Logs.** Brief / normal / rich entry cards, configurable grouping (run number /
  date / run type / beam / target / none), tags with colour management, comments,
  attachments, child-task nesting, notices.
- **Community.** A team chat channel with @mentions, `#123` log links, image paste,
  replies, AI-bot bridges — its composer is portaled into the one shared command
  bar.
- **Themes & i18n.** bright / dark / lowcontrast + Teal preset, density and size
  axes, full Korean / English switch. Tabs render uppercase Latin labels.
- **Admin (manager-gated).** Users, tags, formats, tokens, log management,
  experiments — built on the kit CRUD scaffolding.

---

## Running it

### Prerequisites

Everything lives in this repo now. Two backend services run (defaults shown;
override per machine — see `.env.example`):

| Service | Port | Start (from the repo root) |
|---|---|---|
| elog backend (default experiment) | `8011` | `BACKEND_PORT=8011 ./start_backend.sh` |
| launcher (project list + proxy) | `8010` | `cd backend && LAUNCHER_PORT=8010 ../.venv/bin/python -m uvicorn launcher:app --port 8010` |

First time only, create the Python venv + deps: `python -m venv .venv && .venv/bin/pip install -r requirements.txt` (or run `./elog.sh` once to bootstrap).

The kit (`lilak_ui`) must sit next to this repo (the Vite alias points at
`../../lilak_ui/src`).

### Dev server

```sh
cd frontend
npm install
npm run dev          # http://localhost:5130
```

Vite proxies:

- `/api/*` → the default backend on **:8011**
- `/launcher/*` → the launcher on **:8010** (rewrite strips `/launcher`)

> Changing `vite.config.js` proxies needs a dev-server **restart** (not HMR).

### Build

```sh
npm run build        # static SPA in dist/  (npm run preview to serve it)
```

---

## Per-experiment model (the launcher)

The original elog keeps each experiment ("project") as its **own database**. This
app reproduces that:

- **`/projects`** (the kit-built launcher/home) lists experiments from the
  launcher API. You can **create**, **enter**, **stop**, or **delete** one.
  Clicking the **라일락** brand in the top bar returns here; the current experiment
  shows as a chip next to the brand.
- **Entering** an experiment stores it (`localStorage.elog_experiment`) and
  reloads. `api.js` then routes every call through the launcher's stable reverse
  proxy: `baseURL = /launcher/p/<experiment>/api`. The launcher auto-starts that
  experiment's backend on a free port (8011–8019) on first request.
- With **no** experiment selected, the app falls back to `/api` → :8011 (the
  `default` experiment) and works standalone.

So switching experiments is just: pick on `/projects` → the whole app re-points at
that experiment's database, logs and all.

---

## Pages reference

| Tab (ko) | Page | What it does |
|---|---|---|
| 로그 | `Home` | The log feed — brief/normal/rich cards, grouping, filters, notices. |
| 데이터 | `InfographyPage` | Infography figures + a sheet view (recharts). |
| 파일 | `Files` + `Gallery` | Attachments as data cards; image gallery. |
| 커뮤니티 | `CommunityPage` | Team chat: @mentions, `#123` log links, image paste, replies, AI bridges. |
| 스케줄 | `SchedulePage` | Shift schedule (month / horizontal / vertical). *Excluded from the pure-kit rebuild.* |
| 커넥터 | `ExperimentPage` | Service/system registration + the connector manual. |
| 설정 | `SettingsPage` | Account, theme/palette, language, density, size; admin sections. |
| — | `ProjectsPage` (`/projects`) | The launcher / elog home — per-experiment list. |
| — | `LogDetail` / `LogForm` | View / create / edit a single entry. |
| — | `Admin*` | Manager-gated: users, tags, formats, tokens, log management, experiments. |

## Keyboard & command quick reference

| Key | Action |
|---|---|
| `/` | Open the command bar in command mode (`/login`, `/theme`, `/search`, …) |
| `#` | Tag search across every kind |
| `_ % ^ & @ ~ > ! *` | Index a data kind (log / module / file / infography / user / community / run / notification / bookmark) — then a number or name |
| `\` | Toggle the account + alarms drawer |
| `[` / `]` | Move between tabs |
| `g` / `G` | (logs) open the `_` number search · jump to the newest entry |
| `?` | Open the shortcuts modal |

Full index-character design: [`docs/indexing.md`](docs/indexing.md).

## Troubleshooting

- **Page shows errors / "불러오기 실패", network calls are `500`.** The backend is
  down. The Vite proxy forwards `/api/*` to **:8011**; if nothing is listening
  there you get `ECONNREFUSED` → 500. Start the backend (see *Running it*).
- **`/projects` is empty or "런처에 연결할 수 없습니다".** The launcher (**:8010**)
  isn't running. Start it, then reload.
- **Entering an experiment hangs the first time.** The launcher auto-starts that
  experiment's backend on first request (a second or two); subsequent calls are
  instant.
- **Blank page, no console error.** Usually a bad Phosphor icon import in the kit
  (`icons.jsx`) — see the kit's README gotchas.

## Conventions & gotchas

- **Pure kit + glue.** Pages compose `lilak-ui` blocks; they don't hand-roll
  styling. Layout uses the kit `Box / Stack / Row / Grid / Container` primitives,
  not Tailwind utility classes. (The base `index.css` still uses a little Tailwind
  for legacy Markdown styles; new UI does not.)
- **i18n `t()` returns the key for misses.** `LangContext`'s `t(key, …args)`
  returns the **key string itself** when a key is missing — so the pattern
  `t('foo') || 'fallback'` never falls back (the key is truthy). Always add new
  keys to **both** `i18n/ko.js` and `i18n/en.js`. Function-valued entries are
  called as `t('key', arg)` (not `t('key')(arg)`).
- **Korean IME + Enter.** Submit handlers on text inputs guard
  `e.nativeEvent.isComposing` / `keyCode === 229`, or a Hangul-composing Enter
  both commits and submits → duplicate sends.
- **Auth header at module load.** `api.js` sets the `Authorization` header
  synchronously at import (React runs child effects before parent ones) and only
  treats a `401` from `/auth/me` as a real logout — a stray `401` from another
  endpoint triggers a single re-verify, not a session teardown.
- **Manager account.** A separate `admin` manager login (by convention) is used to
  verify manager-gated UI.

---

## Tech

React 18 + Vite + React Router, `axios`, `react-markdown` + `remark-gfm`,
`recharts` (infography), Phosphor icons — all via the `lilak-ui` kit. License:
internal LILAK project.
