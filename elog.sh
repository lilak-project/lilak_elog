#!/usr/bin/env bash
# LILAK Elog — standalone dev 시작 스크립트 (단일 실험)
#
# Usage:
#   ./elog.sh               # 'default' 실험을 8010에서 시작
#   ./elog.sh -e ko2421     # 특정 실험을 직접 시작
#   ./elog.sh -p 9010       # 포트 변경
#
# 다중 실험(프로젝트 목록·전환·중앙 계정)은 이제 포털 service_manager가 담당한다.
# 예전의 standalone launcher(:8010 프로젝트 목록 + 역프록시 + 자체 계정 DB)는
# 포털로 대체되어 제거됐다 — standalone은 한 번에 한 실험을 직접 띄운다.

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
      DIRECT_EXP="$2"; shift 2 ;;
    *)
      echo "사용법: $0 [-p PORT] [-e EXPERIMENT]"
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

EXP="${DIRECT_EXP:-default}"

echo ""
echo "  ╔══════════════════════════════════════════╗"
echo "  ║         🔬 LILAK Elog (standalone)       ║"
echo "  ╠══════════════════════════════════════════╣"
printf  "  ║  실험:    %-32s║\n" "${EXP}"
printf  "  ║  로컬:    http://localhost:%-15s║\n" "${PORT}"
printf  "  ║  네트워크: http://%-24s║\n" "${LOCAL_IP}:${PORT}"
echo "  ╚══════════════════════════════════════════╝"
echo ""
echo "  다중 실험은 포털(service_manager)을 사용하세요."
echo "  종료: Ctrl+C"
echo ""

SERVER_PID=""
cleanup() {
  echo ""
  echo "  종료합니다…"
  wait "$SERVER_PID" 2>/dev/null
  exit 0
}
trap cleanup INT TERM

cd backend

# --workers 1 필수: main.py lifespan이 워커마다 모듈 러너를 시작하므로
# 멀티 워커면 자동 로그가 중복 생성되고 SQLite 락 경합이 발생한다.
ELOG_EXPERIMENT="$EXP" ELOG_DATA_ROOT="$SCRIPT_DIR/data" \
  ../.venv/bin/uvicorn main:app --host 0.0.0.0 --port "$PORT" --workers 1 &
SERVER_PID=$!
for i in $(seq 1 30); do
  sleep 0.3
  curl -s "http://localhost:${PORT}/api/tags" > /dev/null 2>&1 && { open "http://localhost:${PORT}"; break; }
done

wait $SERVER_PID
