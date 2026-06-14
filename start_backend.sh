#!/usr/bin/env bash
# Dev-mode backend — runs uvicorn with auto-reload, no frontend build.
# For production use, prefer ./elog.sh which builds the SPA and serves it.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f ".env.local" ]; then
  set -a; . ./.env.local; set +a
elif [ -f ".env" ]; then
  set -a; . ./.env; set +a
fi

HOST="${BACKEND_HOST:-0.0.0.0}"
PORT="${BACKEND_PORT:-${ELOG_PORT:-8010}}"
EXPERIMENT="${ELOG_EXPERIMENT:-experiment}"

[ -f ".venv/bin/uvicorn" ] || { echo "uvicorn not found — run ./elog.sh once to bootstrap the venv."; exit 1; }

mkdir -p "$SCRIPT_DIR/data/$EXPERIMENT"
echo "$PORT" > "$SCRIPT_DIR/data/$EXPERIMENT/.port"

echo "lilak_elog backend (dev) → http://${HOST}:${PORT}  experiment=${EXPERIMENT}"
cd backend
ELOG_EXPERIMENT="$EXPERIMENT" exec ../.venv/bin/uvicorn main:app \
  --host "$HOST" --port "$PORT" --reload
