#!/usr/bin/env bash
# LILAK Elog 서버 종료 스크립트
#
# 기본 동작: 이 레포(ai_projects/lilak_elog)가 띄운 모든 것을 종료한다 —
#   • 런처 (LAUNCHER_PORT, 기본 8010)
#   • 런처가 spawn한 모든 프로젝트 서버 (data/*/.port 로 추적, 8020+)
#   • .port 파일 없이 수동으로 띄운 떠돌이 elog 백엔드 (명령줄에 이 레포
#     경로가 박힌 `uvicorn main:app` / `uvicorn launcher:app`)
#
# 다른 레포(예: lilak_clone_test/lilak_elog)의 인스턴스는 건드리지 않는다 —
# 프로세스 명령줄이 이 레포의 절대경로를 포함하는 것만 고른다.
#
# Usage:
#   ./stop.sh           # 이 레포의 런처 + 모든 프로젝트 서버 종료
#   ./stop.sh -p 9000   # 특정 포트 하나만 종료 (구버전 호환)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [ -f ".env.local" ]; then
  set -a; . ./.env.local; set +a
elif [ -f ".env" ]; then
  set -a; . ./.env; set +a
fi

LAUNCHER_PORT_RESOLVED="${LAUNCHER_PORT:-${BACKEND_PORT:-${ELOG_PORT:-8010}}}"
DATA_ROOT="$SCRIPT_DIR/data"

# ── 옵션 파싱 ────────────────────────────────────────────────────────────────
SINGLE_PORT=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    -p|--port) SINGLE_PORT="$2"; shift 2 ;;
    *) echo "사용법: $0 [-p PORT]"; exit 1 ;;
  esac
done

# ── 헬퍼: 포트 하나 종료 (SIGTERM → 대기 → SIGKILL) ──────────────────────────
kill_port() {
  local port="$1" label="$2"
  local pids
  pids=$(lsof -ti :"$port" -sTCP:LISTEN 2>/dev/null)
  [ -z "$pids" ] && return 1
  echo "  ${label:-port $port} 종료 중 (PID: $pids)…"
  kill $pids 2>/dev/null
  for _ in 1 2 3 4 5 6; do
    sleep 0.5
    [ -z "$(lsof -ti :"$port" -sTCP:LISTEN 2>/dev/null)" ] && return 0
  done
  local still
  still=$(lsof -ti :"$port" -sTCP:LISTEN 2>/dev/null)
  if [ -n "$still" ]; then
    echo "    응답 없음 — SIGKILL…"
    kill -9 $still 2>/dev/null
  fi
  return 0
}

# 이 레포의 elog(런처/프로젝트) PID 목록 — 다른 레포는 경로가 달라 매칭 안 됨.
repo_elog_pids() {
  ps -eo pid=,command= \
    | grep -F "$SCRIPT_DIR/" \
    | grep -E "uvicorn (main|launcher):app" \
    | grep -v grep \
    | awk '{print $1}'
}

# ── 구버전 호환: -p 로 포트 하나만 종료 ──────────────────────────────────────
if [ -n "$SINGLE_PORT" ]; then
  if kill_port "$SINGLE_PORT"; then
    echo "  서버가 종료되었습니다."
  else
    echo "  포트 $SINGLE_PORT 에서 실행 중인 서버가 없습니다."
  fi
  exit 0
fi

KILLED_ANY=0

# ── 1) data/*/.port 로 추적되는 프로젝트 서버 종료 ───────────────────────────
if [ -d "$DATA_ROOT" ]; then
  for pf in "$DATA_ROOT"/*/.port; do
    [ -f "$pf" ] || continue
    name=$(basename "$(dirname "$pf")")
    pport=$(tr -dc '0-9' < "$pf")
    if [ -n "$pport" ] && kill_port "$pport" "프로젝트 '$name' (port $pport)"; then
      KILLED_ANY=1
    fi
    rm -f "$pf"   # 런타임 전용 — 항상 정리
  done
fi

# ── 2) 이 레포의 떠돌이 elog 백엔드 / 런처 (.port 없이 띄운 것 포함) ──────────
STRAY_PIDS=$(repo_elog_pids)
if [ -n "$STRAY_PIDS" ]; then
  echo "  이 레포 elog 프로세스 종료 (PID: $(echo $STRAY_PIDS))…"
  kill $STRAY_PIDS 2>/dev/null
  for _ in 1 2 3 4 5 6; do
    sleep 0.5
    [ -z "$(repo_elog_pids)" ] && break
  done
  STILL=$(repo_elog_pids)
  if [ -n "$STILL" ]; then
    echo "    응답 없음 — SIGKILL (PID: $(echo $STILL))…"
    kill -9 $STILL 2>/dev/null
  fi
  KILLED_ANY=1
fi

# ── 3) 런처 포트(기본 8010)가 혹시 남아있으면 정리 ───────────────────────────
if kill_port "$LAUNCHER_PORT_RESOLVED" "런처 (port $LAUNCHER_PORT_RESOLVED)"; then
  KILLED_ANY=1
fi

if [ "$KILLED_ANY" -eq 1 ]; then
  echo "  모든 프로젝트/런처가 종료되었습니다."
else
  echo "  실행 중인 elog 서버가 없습니다."
fi
