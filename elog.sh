#!/usr/bin/env bash
# LILAK Elog — 런처 시작 스크립트
#
# Usage:
#   ./elog.sh               # 런처를 8010에서 시작, 커버 페이지 열기
#   ./elog.sh -p 9010       # 런처 포트 변경
#   LAUNCHER_PORT=9010 ./elog.sh
#
# 각 프로젝트 서버는 커버 페이지(http://localhost:8010)에서 시작/종료합니다.
# 프로젝트 서버는 8020+ 포트에 자동 할당됩니다.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# env 파일 로드
if [ -f ".env.local" ]; then
  set -a; . ./.env.local; set +a
elif [ -f ".env" ]; then
  set -a; . ./.env; set +a
fi

PORT="${LAUNCHER_PORT:-${BACKEND_PORT:-${ELOG_PORT:-8010}}}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port) PORT="$2"; shift 2 ;;
    -e|--experiment)
      # 하위 호환 — 직접 특정 프로젝트를 시작하고 싶을 때
      DIRECT_EXP="$2"; shift 2 ;;
    *)
      echo "사용법: $0 [-p PORT] [-e EXPERIMENT(직접시작)]"
      exit 1 ;;
  esac
done

# ── 가상환경 ──────────────────────────────────────────────────────────────────
if [ ! -f ".venv/bin/uvicorn" ]; then
  echo "  가상환경 생성 중..."
  if command -v uv &>/dev/null; then
    uv venv --python 3.12 && uv pip install -r requirements.txt
  else
    python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
  fi
fi

# ── 프론트엔드 빌드 ───────────────────────────────────────────────────────────
echo "  프론트엔드 빌드 중..."
cd frontend
[ ! -d "node_modules" ] && npm install
npm run build
cd ..

LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo "unknown")

# ── 포트 충돌 정리 ────────────────────────────────────────────────────────────
PIDS=$(lsof -ti :"$PORT" 2>/dev/null)
if [ -n "$PIDS" ]; then
  echo "  포트 $PORT 충돌 — 기존 프로세스 종료 (PID: $PIDS)…"
  kill $PIDS 2>/dev/null
  for i in $(seq 1 6); do
    sleep 0.5
    [ -z "$(lsof -ti :"$PORT" 2>/dev/null)" ] && break
  done
fi

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║         🔬 LILAK Elog 런처               ║"
echo "  ╠══════════════════════════════════════════╣"
printf  "  ║  커버 페이지: http://localhost:%-10s║\n" "${PORT}"
printf  "  ║  네트워크:    http://%-21s║\n" "${LOCAL_IP}:${PORT}"
echo "  ║  프로젝트 서버: 8020+ 자동 할당          ║"
echo "  ╚══════════════════════════════════════════╝"
echo ""
echo "  커버 페이지에서 프로젝트를 시작·종료·관리하세요."
echo "  종료: Ctrl+C (프로젝트 서버는 별도로 종료)"
echo ""

SERVER_PID=""
cleanup() {
  echo ""
  echo "  런처를 종료합니다…"
  wait "$SERVER_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

cd backend

if [ -n "$DIRECT_EXP" ]; then
  # -e 플래그: 특정 프로젝트를 직접 시작 (이전 호환)
  echo "  직접 시작: $DIRECT_EXP"
  # --workers 1 필수: main.py lifespan이 워커마다 모듈 러너를 시작하므로
  # 멀티 워커면 자동 로그가 중복 생성되고 SQLite 락 경합이 발생한다.
  ELOG_EXPERIMENT="$DIRECT_EXP" LAUNCHER_PORT="$PORT" \
    ../.venv/bin/uvicorn main:app --host 0.0.0.0 --port "$PORT" --workers 1 &
  SERVER_PID=$!
  for i in $(seq 1 30); do
    sleep 0.3
    curl -s "http://localhost:${PORT}/api/tags" > /dev/null 2>&1 && { open "http://localhost:${PORT}"; break; }
  done
else
  # 런처 시작
  LAUNCHER_PORT="$PORT" ELOG_DATA_ROOT="$SCRIPT_DIR/data" \
    ../.venv/bin/uvicorn launcher:app --host 0.0.0.0 --port "$PORT" --workers 1 &
  SERVER_PID=$!
  for i in $(seq 1 30); do
    sleep 0.3
    curl -s "http://localhost:${PORT}/api/projects" > /dev/null 2>&1 && { open "http://localhost:${PORT}"; break; }
  done
fi

wait $SERVER_PID
