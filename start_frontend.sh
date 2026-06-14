#!/usr/bin/env bash
# Dev-mode frontend — runs the Vite dev server with hot reload.
# Requires the backend to be running separately (see start_backend.sh).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f ".env.local" ]; then
  set -a; . ./.env.local; set +a
elif [ -f ".env" ]; then
  set -a; . ./.env; set +a
fi

HOST="${FRONTEND_HOST:-0.0.0.0}"
PORT="${FRONTEND_PORT:-5010}"

cd frontend
[ -d "node_modules" ] || npm install

echo "lilak_elog frontend (dev) → http://${HOST}:${PORT}"
exec npx vite --host "$HOST" --port "$PORT"
