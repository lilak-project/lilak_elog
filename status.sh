#!/usr/bin/env bash
# LILAK Elog status — reports listen state of both assigned ports.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f ".env.local" ]; then
  set -a; . ./.env.local; set +a
elif [ -f ".env" ]; then
  set -a; . ./.env; set +a
fi

FRONTEND_PORT="${FRONTEND_PORT:-5010}"
BACKEND_PORT="${BACKEND_PORT:-${ELOG_PORT:-8010}}"

echo "lilak_elog service status"
for spec in "frontend ${FRONTEND_PORT}" "backend ${BACKEND_PORT}"; do
  role="${spec% *}"
  port="${spec#* }"
  if lsof -i tcp:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    pid=$(lsof -ti tcp:"$port" -sTCP:LISTEN 2>/dev/null | head -1)
    echo "  ${role}: listening on ${port} (pid ${pid})"
  else
    echo "  ${role}: free (${port})"
  fi
done
