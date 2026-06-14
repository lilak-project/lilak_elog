# 데이터 컴포넌트 인덱싱 (특수문자 체계)

라일락(elog)의 모든 **데이터 컴포넌트**(데이터를 담은 컴포넌트)는 명령바에서 한 글자
**인덱스 문자**로 찾을 수 있다. 문자를 누르면 명령바가 그 종류로 좁혀져 열리고,
**번호**를 입력하면 바로 그 항목으로, 이름이나 `#태그`를 입력하면 검색으로 점프한다.

> 구현: kit `lilak-ui/src/data/` (`DataCard` · `DataGrid` · `dataFindModes` · `bookmarks`),
> 등록은 각 화면의 `useTaggables(...)`, 배선은 [`Shell.jsx`](../frontend/src/components/Shell.jsx).

---

## 1. 명령바 lead 문자 한눈에

| 문자 | 역할 | 분류 |
|---|---|---|
| `/` | 커맨드 실행 (`/login`, `/theme` …) | 실행 |
| `#` | 태그 검색 — **모든 종류 횡단** | 검색 |
| `%` | 모듈·서비스 | 데이터 인덱스 |
| `_` | 로그 | 데이터 인덱스 |
| `^` | 파일·사진 | 데이터 인덱스 |
| `&` | 인포그래피 그림 | 데이터 인덱스 |
| `@` | 사용자·계정 | 데이터 인덱스 |
| `~` | 커뮤니티 글·댓글 | 데이터 인덱스 |
| `>` | 실험 런(run) | 데이터 인덱스 |
| `!` | 알림 | 데이터 인덱스 |
| `*` | **북마크** — 별표한 항목을 종류 상관없이 모음 | 데이터 인덱스(횡단) |

데이터 인덱스 문자 9개는 kit `DATA_INDEX` + `INDEX_CHARS`(여기에 `*` 포함)에 정의돼 있고,
[`Shell.jsx`](../frontend/src/components/Shell.jsx)가 이 배열로 단축키와 `findModes`를 자동 생성한다.

---

## 2. 데이터 종류 ↔ 문자 ↔ 화면

| 문자 | 종류(`kind`) | 등록 화면 | 열기(run) 동작 | 상태 |
|---|---|---|---|---|
| `%` | `service` `module` | [ExperimentPage](../frontend/src/pages/ExperimentPage.jsx) | 서비스: 상세 펼침+스크롤 / 모듈: 스크롤 | ✅ |
| `_` | `log` | [Home](../frontend/src/pages/Home.jsx) | `open-log` 이벤트로 펼침 | ✅ |
| `^` | `file` `photo` | [Files](../frontend/src/pages/Files.jsx) | DataCard 인라인 오픈(사진/텍스트) | ✅ (DataGrid 레퍼런스) |
| `&` | `infograph` | [InfographyPage](../frontend/src/pages/InfographyPage.jsx) | `find-infograph` 이벤트로 펼침+스크롤 | ✅ |
| `@` | `user` | [AdminUsers](../frontend/src/pages/AdminUsers.jsx) | 설정→사용자 관리 열기 | ✅ |
| `~` | `post` `comment` | [CommunityPage](../frontend/src/pages/CommunityPage.jsx) | `scrollToMsg`로 해당 메시지로 | ✅ |
| `>` | `run` | [Home](../frontend/src/pages/Home.jsx) | 그 런의 첫 로그 열기 | ✅ |
| `!` | `notification` | [SystemPanel](../frontend/src/components/SystemPanel.jsx) | 관련 로그/커뮤니티로 | ✅ |
| `*` | (전 종류) | kit `bookmarks` | 별표한 항목의 원래 run | ✅ |

**주의 — "현재 로드된 것"만 인덱싱된다.** 각 항목은 해당 화면이 마운트돼 있을 때만
태그 인덱스에 등록된다(`useTaggables`). 즉 `~`(커뮤니티)는 커뮤니티 탭이 떠 있을 때,
`!`(알림)은 시스템 drawer가 열려 있을 때 채워진다. 이는 의도된 한계이며, 추후
"종류별 전역 인덱스"가 필요하면 등록을 페이지 밖(컨텍스트)으로 올리면 된다.

---

## 3. 이미 점유된 키 (인덱스로 쓰지 말 것)

| 문자 | 점유 용도 |
|---|---|
| `[` `]` | 탭 이동 |
| `{` `}` | 브라우즈 서브탭(갤러리/파일) |
| `\` | 시스템 drawer |
| `?` | 단축키 도움말 |
| `$` | 인포그래피 템플릿 변수 (`$tag` `$run`) |

---

## 4. 새 인덱스 채널 추가하는 법 (3단계)

1. **kit** `data/dataFindModes.js`의 `DATA_INDEX`에 `'문자': { kinds:[...], label:'…' }` 추가.
   (`INDEX_CHARS`는 자동 포함 → Shell 단축키/findMode 자동 생성)
2. **화면**에서 `useTaggables(() => 항목.map(x => ({ id, label, number, tags, kind, run })), [deps])` 등록.
   `run()`은 그 항목을 여는 동작(이벤트 dispatch / setState / scrollIntoView).
3. (선택) 그 화면을 `DataGrid` + `DataCard`로 바꾸면 그리드 포커스 내비(방향키+hjkl),
   스페이스 토글, 태그/댓글/북마크(★ `*`) 어포던스를 그대로 얻는다.

`number`는 `문자<번호>` 직행 점프용 식별자(로그 인덱스, 서비스 순번 등).

---

## 5. 설계 원칙

- **인덱스 1개 = 데이터 종류 1개** (동작/필터는 `/` 커맨드로).
- shift-숫자열(`! @ # $ % ^ & *`)에 데이터 패밀리를 모아 한 손에 들어오게 함.
- `$` `{}` `[]` 등 이미 의미가 있는 키는 피한다.
- 같은 항목 id 규칙: `종류:백엔드ID` (예: `log:5`, `file:12`, `service:3`). 북마크(`*`)가 이 id로 매칭한다.
