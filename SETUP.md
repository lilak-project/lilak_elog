# Setup on a new machine

`lilak_elog` is self-contained (frontend + backend + launcher), **but its
frontend uses the shared UI kit `lilak_ui` from a sibling folder** — so you clone
**two** repos side by side.

## 0. Requirements
- `git`, **Node.js 18+** (`node -v`), **Python 3.10+** (`python3 --version`)

## 1. Clone BOTH repos, side by side
They must share the same parent folder (the frontend's Vite alias points at
`../../lilak_ui/src`). The repos are public, so HTTPS needs no keys:

```sh
mkdir -p ~/ai_projects && cd ~/ai_projects
git clone https://github.com/lilak-project/lilak_ui.git
git clone https://github.com/lilak-project/lilak_elog.git
```
Result: `~/ai_projects/lilak_ui` and `~/ai_projects/lilak_elog` next to each other.
(SSH alternative: `git clone git@github.com:lilak-project/lilak_ui.git`, etc.)

## 2. Backend — Python venv + deps
```sh
cd ~/ai_projects/lilak_elog
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
```

## 3. Frontend — Node deps
```sh
cd ~/ai_projects/lilak_elog/frontend
npm install
```

## 4. Config (optional — defaults work)
Ports/targets have sane defaults; override per machine in `.env.local`:
```sh
cp frontend/.env.example frontend/.env.local     # edit PORT / ELOG_BACKEND / ELOG_LAUNCHER if needed
```
For a real deployment, set a JWT secret (not the dev default):
```sh
export ELOG_SECRET_KEY="something-long-and-random"
```

## 5. Data — start fresh OR reuse
Data is **not** in git (it never came with the clone), so by default you start empty:
- **Fresh start:** nothing to do — the launcher creates experiments on demand (empty logs).
- **Reuse existing logs:** copy the old machine's `data/` (and `uploads/`) folders into
  `~/ai_projects/lilak_elog/`. Same logs, same experiments.

## 6. Run
Three processes (use 3 terminals, or background each with `&`):

```sh
# A) default backend  → port 8011
cd ~/ai_projects/lilak_elog
BACKEND_PORT=8011 ./start_backend.sh

# B) launcher (project/experiment list)  → port 8010
cd ~/ai_projects/lilak_elog/backend
LAUNCHER_PORT=8010 ../.venv/bin/python -m uvicorn launcher:app --host 0.0.0.0 --port 8010

# C) frontend  → port 5130
cd ~/ai_projects/lilak_elog/frontend
npm run dev
```

Open **http://localhost:5130** . Click the **라일락** brand (top-left) → `/projects`
to create or enter an experiment.

## Troubleshooting
- **Kit import error** (`Cannot find module '@phosphor-icons/react'` or `lilak-ui`):
  make sure `lilak_ui` sits next to `lilak_elog`; if it persists, also run
  `npm install` inside `~/ai_projects/lilak_ui`.
- **Page shows errors / `500` / "불러오기 실패":** the backend (8011) or launcher
  (8010) isn't running — start them (step 6 A/B).
- **Different ports needed:** set `PORT` / `ELOG_BACKEND` / `ELOG_LAUNCHER` in
  `frontend/.env.local`, then restart the dev server (proxy changes need a restart).
- **Production (single port):** `./elog.sh` builds the SPA and serves it from the
  backend instead of running the Vite dev server.
