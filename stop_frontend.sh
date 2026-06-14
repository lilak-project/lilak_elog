#!/usr/bin/env bash
# Stop the Vite dev server (if running).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f ".env.local" ]; then
  set -a; . ./.env.local; set +a
elif [ -f ".env" ]; then
  set -a; . ./.env; set +a
fi

PORT="${FRONTEND_PORT:-5010}"
PIDS=$(lsof -ti :"$PORT" -sTCP:LISTEN 2>/dev/null)
if [ -z "$PIDS" ]; then
  echo "lilak_elog frontend: no listener on ${PORT}"
  exit 0
fi
kill $PIDS 2>/dev/null
for _ in 1 2 3 4 5 6; do
  sleep 0.5
  STILL=$(lsof -ti :"$PORT" -sTCP:LISTEN 2>/dev/null)
  [ -z "$STILL" ] && break
done
STILL=$(lsof -ti :"$PORT" -sTCP:LISTEN 2>/dev/null)
[ -n "$STILL" ] && kill -9 $STILL 2>/dev/null
echo "lilak_elog frontend on ${PORT} stopped."
