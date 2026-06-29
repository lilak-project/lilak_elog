# LILAK Portal — 요구사항 · 현재 상태 · 계획 (세션 인계 문서)

> 새 Claude Code 세션은 이 파일을 먼저 읽고 이어서 작업하세요.
> 목표: 맥 로컬에서 시작한 "여러 elog 서버 관리 포털"을, **다른 서버·다른 종류의 서비스**까지
> 관리하는 일반화된 웹서비스 포털로 키운다.

---

## 0. 한 줄 요약
launcher(:8010)가 **LILAK 포털**이다 — 중앙 계정으로 로그인/가입하고, 서비스(현재는 elog 프로젝트)를
**가시성 3단계 + 계정별 권한**으로 게이팅하며, "Enter" 시 포털 계정이 elog 안으로 그대로 이어진다.
이제 이 포털을 **서비스 계약(manifest) 표준화 + 외부 서비스 등록 + 서버 배포**로 일반화하는 단계.

## 1. 레포 / 위치 (중요)
- 앱(작업 대상): `~/ai_projects/lilak_elog` (backend + frontend + launcher)
- 공유 UI 키트: `~/ai_projects/lilak_ui` (source 배포, Vite alias `lilak-ui` → `../../lilak_ui/src`)
- **건드리면 안 되는 것**:
  - `~/ai_projects/zzz/lilak_elog` (아카이브, 절대 수정 금지)
  - `~/lilak_clone_test/lilak_elog` (다른 클론 — stop.sh 등에서 경로로 구분해 제외함)
- 키트 규약: 인라인 style + CSS 변수 토큰, **Tailwind 없음**. 컴포넌트는 `index.js`에서 re-export.

## 2. 실행 / 검증 방법
- 포털 기동: 레포 루트에서 `./start.sh` → 프론트엔드 빌드 후 **런처 :8010** 시작 + `http://localhost:8010/projects` 오픈.
  - `./start.sh`는 `elog.sh`의 래퍼. 런처만 직접 재시작하려면:
    `cd backend && LAUNCHER_PORT=8010 ELOG_DATA_ROOT=$PWD/../data ../.venv/bin/uvicorn launcher:app --host 0.0.0.0 --port 8010 --workers 1`
- 종료: `./stop.sh` — **이 레포의** 런처 + 모든 프로젝트 서버 종료(다른 클론은 경로로 구분해 제외).
- 프로젝트(서비스) 서버: 포트 **8011–8019**에 동적 배정, launcher가 `uvicorn main:app`로 spawn, `data/<name>/.port`로 추적.
- 포털 DB 초기화(테스트 후 깨끗이): `rm data/_portal/portal.db` 후 런처 재시작 → 첫 가입이 admin.
- venv 파이썬: `~/ai_projects/lilak_elog/.venv/bin/python` (fastapi 있음, httpx 없음 → TestClient 대신 직접 호출/curl).
- 검증 패턴: 백엔드 `python -c "import ast; ast.parse(open(f).read())"`, 프론트 `npm run build`(Vite가 전체 컴파일 = 문법 검증).
- 프리뷰(Claude_Preview, `lilakelognew` = vite dev :5130)로 `:8010/projects`를 띄워 확인.
  - **주의**: localStorage는 origin별. 프리뷰는 origin 5130 → :8010으로 navigate한 뒤 *그 8010 페이지에서* 토큰을 set해야 함(5130에서 set하면 8010으로 안 넘어감).

## 3. 사용자 요구사항 (이 세션에서 확정된 것)
- 포털 커버는 **React `ProjectsPage`**여야 하고(런처 인라인 HTML 아님), `./start.sh`가 그걸 연다. 인라인 HTML 커버는 제거함.
- 제목 **LILAK**, 설명 "Cover page for LILAK projects.".
- **로그인/가입 우선**: 로그인 전엔 목록 대신 로그인·가입 카드. **첫 가입 계정 = admin(manager)**, 이후 = user.
- 가입 시 **display_name = username**(이름 칸 없음).
- 일반 계정 로그인 시: New/Import 줄 숨김, 카드엔 **Enter만**(관리자만 Stop/Export/Delete + 툴바).
- **가시성 3단계**(서비스별): `1` 비공개(권한자만 보임) · `2` 보호(모두 보이고 권한자만 입장+권한요청 버튼) · `3` 관리자전용(숨김). 신규 기본 = `2`.
- **계정별 서비스 권한**: 로그인하면 "허용된 것만" 보인다. tier2 무권한엔 **권한 요청** 버튼.
- **관리자 권한관리 UI**: 서비스별 가시성 설정, 사용자×서비스 권한 토글, 대기 요청 승인/거절.
- **서비스 종류 표시**: 지금은 모두 `elog`. 나중에 `asset_manager` 등 다른 타입도 목록에 종류와 함께.
- **중앙 계정(런처 레벨)**: 포털 계정이 **elog 계정 속성을 전부 포함**(상위집합), 같은 secret이라 토큰 호환.
- **elog 입장 연동(하위호환)**: Enter 시 포털 계정이 그대로 elog로. **이메일 매칭**으로 기존 elog 사용자와 연동(= import로 만든 elog 시나리오), 없으면 자동 생성.
- 미래: **다른 서버에서도 같은 역할** + **서비스 룰/사용법** 일반화 (이 문서의 §6 계획).
- 버그/디테일: stop 안 되던 것 → SIGKILL 폴백으로 수정. 비밀번호 변경은 포털 엔드포인트가 없어 UI에서 일단 제거(나중에 추가 가능).
- 코너 둥글기: **버튼은 현재 상태 유지**. (옵션으로 입력칸/카드만 "왼쪽 위만 각지게 `0 R R R`" 적용 검토 중 — 보류.)

## 4. 현재까지 구현 (Phase 1~4 + 입장연동, 전부 동작 검증 완료)
**백엔드 (`backend/`)**
- `launcher.py`:
  - 인라인 커버 HTML 제거 → **빌드된 React SPA 서빙**(`/`, `/projects` 등 → index.html, assets 정적).
  - `_strip_launcher_prefix` 미들웨어: 앱이 부르는 `/launcher/api/*`·`/launcher/p/<name>/*`를 `/api/*`·`/p/*`로(dev=vite, prod=런처 공용).
  - `/api/*` → 기본 백엔드(`ELOG_BACKEND`, 기본 `:8011`) 프록시(실험 미선택 시 로그인 등).
  - `portal_auth` + `portal_services` 라우터 include(제네릭 `/api` 프록시보다 먼저 등록).
  - `_list_projects`가 `_`로 시작하는 내부 디렉터리 제외(예: `_portal`).
  - `api_stop`에 SIGTERM→대기→**SIGKILL 폴백**(elog 백그라운드 루프 때문에 포트 안 풀리던 문제).
- `portal_auth.py` (신규): 중앙 계정. `data/_portal/portal.db`(별도 SQLite), elog `models.User` + `auth`(해시/JWT) 재사용.
  - `/api/auth/register|login|me|logout`. 첫 계정=manager. `_portal_token()`이 토큰에 `portal:true, email, name, color, shape, prole` 클레임 포함.
- `portal_services.py` (신규): 서비스 레지스트리 + 권한 + 요청.
  - 모델: `Service(name,kind,visibility)`, `ServicePermission(user_id,service_name)`, `AccessRequest(...)`. 기본 가시성=2.
  - `GET /api/services`(계정별 필터+플래그 `can_enter/can_request/requested/kind/visibility`),
    `POST /api/access-requests`,
    `/api/admin/services`(GET/PUT), `/api/admin/users`, `/api/admin/permissions`(GET/POST/DELETE),
    `/api/admin/access-requests`(GET), `POST /api/admin/access-requests/{id}` (approve/reject).
- `auth.py`:
  - `create_access_token(..., extra=None)` 클레임 병합.
  - `get_current_user_optional`: 토큰에 `portal:true`면 `_resolve_portal_user()` — **이메일로 로컬 elog 사용자 연동, 없으면 포털 속성으로 자동 생성**(password_hash="portal" = 비번 로그인 불가).

**프론트엔드 (`frontend/src/`)**
- `pages/ProjectsPage.jsx`: 로그인/가입 우선(`AuthCard`), 포털 인증은 **`launcher` axios(`/launcher/api/auth/*`)**, 목록은 `/services`,
  tier2 무권한엔 권한요청, admin엔 **⚙ Manage** 버튼. `enter(name)`은 포털 토큰을 `localStorage['elog_token']`로 인계 + `elog_user` 제거 후 `/`로 이동.
- `pages/portal/AdminPanel.jsx` (신규): kit `Modal` 기반 관리 패널(대기요청 승인/거절, 서비스별 가시성 select, 사용자 권한 칩 토글).
- `context/AuthContext.jsx`: **토큰만으로도 세션 복원**(elog_user 없어도 /auth/me로 해결) — 입장 연동에 필요.
- `i18n/en.js`·`ko.js`: `projects_*`, `portal_*`, `service_kind_elog` 등 키 추가.

**키트 (`~/ai_projects/lilak_ui/src/`)**
- `components/CoverPage.jsx` (신규): `CoverPage`(bright 셸 + 헤더 + actions 슬롯) + `CoverCard`(아이콘·타이틀·배지·상태·actions). `index.js`에서 export.

**스크립트**: `elog.sh`(런처가 `:8010/projects` 오픈), `stop.sh`(이 레포 전체 종료).

## 5. 알아둘 제약 / 함정
- **보안(외부 서버로 갈 때 필수)**: `ELOG_SECRET_KEY`를 env로 반드시 설정(포털 토큰을 elog가 신뢰). `auth.hash_password`는 현재 sha256 → 운영은 bcrypt/argon2로 교체(함수만 바꾸면 됨).
- `/p/<name>` 프록시는 **외부 서비스 푸시(elog API 토큰)의 안정 진입점**이기도 함 → 여기에 포털 권한을 하드 강제하면 외부 연동이 깨짐. 접근 제어는 목록/버튼 레벨 + elog 자체 인증으로.
- 가시성 기본 2라 Phase 2 적용 후 비admin은 권한 없으면 입장 불가(관리자가 부여). 프레시 상태(첫 admin만 존재)면 정상.
- elog 입장 시 포털 admin(prole=manager)은 그 elog에서 manager로 **생성**됨(설계대로). 이메일로 기존 사용자와 연동될 땐 그 사용자의 기존 role 유지.

## 6. 계획 (다음 단계, 우선순위)
일반화의 핵심: **① 서비스 계약 표준화** + **② managed vs external 구분**.

### Phase A — 서비스 매니페스트 + kind 어댑터 (가장 먼저)
지금 launcher.py에 박힌 elog 가정(포트 8011–8019, `uvicorn main:app`, `/api/auth/*`, `_pick_format_id`)을
서비스별 선언으로 분리. `data/<name>/service.json` 예:
```jsonc
{
  "kind": "elog",
  "mode": "managed",                 // managed | external
  "start": { "cmd": "uvicorn main:app", "cwd": "...", "env": {} },
  "health": "/api/projects",
  "data_dir": "data/<name>",         // export/import(zip) 대상
  "entry": "/",
  "identity": { "accepts_portal_token": true, "link_by": "email" }
}
```
- launcher는 `kind`별 어댑터만 알면 새 서비스 타입을 꽂을 수 있게. export/import·헬스체크·포트배정은 이미 일반적이라 이전 쉬움.
- 목록의 `kind` 배지는 이미 있음(`service_kind_elog`). 다른 kind의 i18n/아이콘 추가.

### Phase B — 외부(external) 서비스 등록
- 포털 레벨 service registry에 `mode:"external"` 추가: **URL + 토큰**만 등록, 포털은 가시성/권한/프록시만.
- → "다른 서버에서도 같은 역할": 한 포털이 여러 호스트의 서비스를 한 화면에서 게이팅.
- elog의 connector/서비스(외부 URL + 연결테스트) 개념을 포털 레지스트리로 승격해 재사용.

### Phase C — 호스트 이식성 + 배포
- 설정 주도: `PORTAL_DATA_ROOT`, 포트 범위, `PORTAL_BASE_URL`(외부 등록용 공개 주소), `ELOG_SECRET_KEY`.
- 백업/이전 단위 = `data/` + `data/_portal/portal.db`.
- 프로세스 관리: 맥 nohup → 서버는 **systemd 또는 컨테이너**로 launcher 기동. managed 서비스는 자식 프로세스(또는 kind별 컨테이너).
- **HTTPS + 리버스 프록시**(nginx/caddy), CORS `allow_origins` 좁히기, bcrypt 전환, 외부 등록 토큰은 서비스별 스코프.

### Phase D — 신원(identity) 전략
- 지금: 호스트별 포털 계정 + 공유 secret 토큰(단순, 충분). 
- 여러 호스트 단일 로그인이 필요해지면: 한 포털을 신원 제공자로, 또는 **OIDC** 표준 외부화(현재 이메일/토큰 모델이 토대). 당장은 불필요.

## 7. 남은 자잘한 것 / TODO
- **커밋 필요**: 이번 작업 전부 미커밋. 레포 2개(`lilak_elog`, `lilak_ui`)에 걸침. 기능별로 분류해 커밋 권장.
  - 분류 예: (kit) CoverPage; (portal) auth/services/launcher/AdminPanel/ProjectsPage; (fix) stop SIGKILL·i18n·display_name; (infra) elog.sh/stop.sh.
- 포털 **비밀번호 변경** 엔드포인트(`/api/auth/me/password`) 추가 → 커버에 변경 UI 복구.
- 코너 둥글기 토큰화(보류): 버튼은 유지, 필요 시 입력칸/카드만 `--radius-*` 토큰 + "왼쪽 위만 각" 패턴.
- (선택) 입장 시 포털 권한을 한 번 더 확인하는 안전장치는 외부 푸시 경로(`/p`)를 깨지 않는 선에서만.

## 8. 새 세션 시작 프롬프트(예시)
> "PORTAL_PLAN.md 읽고 이어서 작업. 먼저 Phase A(서비스 매니페스트 + kind 어댑터)부터.
>  현 구현/제약은 그 문서 기준. 작업 전 launcher(:8010) 동작 확인하고, 변경은 단계별로 검증."
