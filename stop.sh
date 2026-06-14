#!/usr/bin/env bash
# LILAK Elog 서버 종료 스크립트
#
# Usage:
#   ./stop.sh          # 기본 포트 8010 (per PORTS.md) 종료
#   ./stop.sh -p 9000  # 커스텀 포트 종료
#   BACKEND_PORT=8080 ./stop.sh
#
# Same port resolution rules as elog.sh: -p > BACKEND_PORT > ELOG_PORT > .env > 8010.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f ".env.local" ]; then
  set -a; . ./.env.local; set +a
elif [ -f ".env" ]; then
  set -a; . ./.env; set +a
fi

PORT="${BACKEND_PORT:-${ELOG_PORT:-8010}}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port) PORT="$2"; shift 2 ;;
    *) echo "사용법: $0 [-p PORT]"; exit 1 ;;
  esac
done

PIDS=$(lsof -ti :"$PORT" 2>/dev/null)

if [ -z "$PIDS" ]; then
  echo "  포트 $PORT 에서 실행 중인 서버가 없습니다."
  exit 0
fi

echo "  포트 $PORT 서버 종료 중 (PID: $PIDS)…"
kill $PIDS 2>/dev/null

# 최대 3초 대기
for i in 1 2 3 4 5 6; do
  sleep 0.5
  STILL=$(lsof -ti :"$PORT" 2>/dev/null)
  [ -z "$STILL" ] && break
done

STILL=$(lsof -ti :"$PORT" 2>/dev/null)
if [ -n "$STILL" ]; then
  echo "  응답 없음 — SIGKILL로 강제 종료합니다…"
  kill -9 $STILL 2>/dev/null
  sleep 0.3
fi

echo "  서버가 종료되었습니다."
