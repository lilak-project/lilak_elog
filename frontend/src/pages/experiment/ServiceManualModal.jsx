/**
 * ServiceManualModal — Service / System 별 탭으로 분리된 메뉴얼.
 * Bilingual: ko / en 언어 설정 따름.
 */

import { useState } from 'react'
import { Icon, Modal, Row, Stack } from 'lilak-ui'
import { useLang } from '../../context/LangContext'

// ── Canonical elog_service_setup.sh reference script ─────────────────────────
// Interactive registration helper. Talks ONLY to the launcher's single stable
// port, so individual project ports can change without breaking anything. It:
//   1. lists projects (experiments) from the launcher; the user picks one
//   2. logs in to that project
//   3. lets the user choose service / system / main-system
//   4. previews the formats (what will be logged) before registering
//   5. registers via the API, receives the token (systems), and saves
//      elog_config.json with the STABLE proxy URL  http://host:8010/p/<project>
export function buildSetupScript() {
  return `#!/bin/bash
# elog_service_setup.sh  —  interactive elog registration helper
# NOTE: elog does NOT provide this file. Create it and run it from your dir.
set -euo pipefail

# Single stable entry point = the launcher. Everything is routed by project.
ELOG_LAUNCHER="\${ELOG_LAUNCHER:-http://localhost:8010}"

command -v python3 >/dev/null || { echo "python3 is required."; exit 1; }

# Write the interactive client to a temp file so prompts read the terminal
# (a stdin heredoc would be consumed and break input()).
TMP="$(mktemp -t elog_setup.XXXXXX).py"
trap 'rm -f "$TMP"' EXIT
cat >"$TMP" <<'PY'
import sys, os, json, getpass, urllib.request, urllib.error

LAUNCHER = sys.argv[1].rstrip("/")
G="\\033[32m"; Y="\\033[33m"; C="\\033[36m"; B="\\033[1m"; R="\\033[0m"
RED="\\033[31m"; DIM="\\033[2m"; BLU="\\033[34m"
def hr(): print(DIM + "-"*52 + R)
def ask(p, d=None):
    s = input(f"{p}" + (f" [{d}]" if d else "") + ": ").strip()
    return s or (d or "")
def yes(p, d="N"):
    return ask(p + " (y/N)", d).lower().startswith("y")

def api(method, url, token=None, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    if token: req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            raw = r.read()
            return r.status, (json.loads(raw) if raw else None)
    except urllib.error.HTTPError as e:
        raw = e.read()
        try: return e.code, json.loads(raw)
        except Exception: return e.code, {"detail": raw.decode("utf-8", "replace")}
    except Exception as e:
        return 0, {"detail": str(e)}

print(f"{B}  elog service / system registration{R}")
hr()

# 1) choose a project (experiment)
st, projects = api("GET", f"{LAUNCHER}/api/projects")
if st != 200 or not isinstance(projects, list) or not projects:
    print(f"{RED}No projects, or cannot reach launcher at {LAUNCHER}{R}"); sys.exit(1)
print(f"{B}Projects:{R}")
for i, p in enumerate(projects):
    flag = f"{G}running{R}" if p.get("running") else f"{DIM}stopped{R}"
    print(f"  {B}{i+1}{R}) {p['name']}  [{flag}]")
while True:
    try:
        proj = projects[int(ask("Choose project number")) - 1]["name"]; break
    except (ValueError, IndexError):
        print(f"{Y}invalid choice{R}")
BASE = f"{LAUNCHER}/p/{proj}"
print(f"{C}-> {proj}   elog_url = {BASE}{R}")
hr()

# 2) log in to that project
token = None
for _ in range(3):
    u = ask("elog username"); pw = getpass.getpass("elog password: ")
    st, res = api("POST", f"{BASE}/api/auth/login", body={"username": u, "password": pw})
    if st == 200 and res and res.get("access_token"):
        token = res["access_token"]; print(f"{G}OK logged in as {u}{R}"); break
    print(f"{RED}login failed ({st}){R}")
if not token: sys.exit(1)
hr()

# 3) choose type
print(f"{B}Register as:{R}")
print(f"  {B}1{R}) service  {DIM}- elog requests data FROM your program{R}")
print(f"  {B}2{R}) system   {DIM}- your program PUSHES logs to elog (runs, DAQ, ...){R}")
while True:
    choice = ask("Choose 1 or 2", "1").lower()
    if choice in ("1", "service", "s"):
        is_system = False; break
    if choice in ("2", "system", "sy"):
        is_system = True; break
    print(f"{Y}please enter 1 or 2{R}")
is_main = yes("Is this the MAIN system?") if is_system else False
url_label = "Command URL" if is_system else "Request URL"
svc_url = ask(f"{url_label} (your program's elog endpoint)", "")
if not is_system and not svc_url:
    print(f"{RED}A service needs a URL — elog must reach it for the handshake.{R}"); sys.exit(1)
hr()

# 4) MANDATORY handshake — the service declares its fields via elog's Discover.
#    elog POSTs {"event":"elog_handshake"} to svc_url; the program replies with
#    name/description/log_fields. Fields flagged "metric" become Infography vars.
log_fields = []
name = ""; desc = ""
if svc_url:
    print(f"{B}Handshaking {svc_url} ...{R}")
    st, disc = api("POST", f"{BASE}/api/services/discover", token=token,
                   body={"url": svc_url, "elog_url": BASE})
    if st == 200 and isinstance(disc, dict) and disc.get("ok"):
        data = disc.get("data") or {}
        name = data.get("name") or ""
        desc = data.get("description") or ""
        log_fields = data.get("log_fields") or []
        print(f"{G}OK handshake — declared fields:{R}")
        for f in log_fields:
            m = f"{G} [metric]{R}" if f.get("metric") else ""
            u = f" ({f['unit']})" if f.get("unit") else ""
            print(f"  {C}{f.get('key')}{R} : {f.get('type')}{u}{m}  {DIM}{f.get('label','')}{R}")
        if not log_fields:
            print(f"{Y}  (no log_fields declared){R}")
    else:
        err = disc.get("error") if isinstance(disc, dict) else disc
        print(f"{RED}Handshake failed: {err}{R}")
        if not is_system:
            print(f"{RED}Handshake is REQUIRED for a service. Make {svc_url} answer "
                  f"POST {{'event':'elog_handshake'}} with name/description/log_fields.{R}")
            sys.exit(1)
        print(f"{Y}Push-only system: continuing without declared fields.{R}")
else:
    print(f"{Y}Push-only system (no URL): no handshake, no service fields.{R}")
hr()

# allow overriding the handshake-provided name/description
name = ask("Name", name or (proj if is_system else "MyService"))
desc = ask("Description", desc)
hr()

if not yes("Proceed with registration?"):
    print("aborted."); sys.exit(0)

# 5) register via the API (carry the handshake-declared fields incl. metric)
payload = {"name": name, "description": desc, "is_system": is_system,
           "is_main_system": is_main, "elog_url": BASE}
if log_fields: payload["log_fields"] = log_fields
if svc_url:
    payload["command_url" if is_system else "request_url"] = svc_url
st, res = api("POST", f"{BASE}/api/services", token=token, body=payload)
if st not in (200, 201):
    detail = res.get("detail") if isinstance(res, dict) else res
    print(f"{RED}registration failed ({st}): {detail}{R}"); sys.exit(1)
print(f"{G}{B}OK registered '{name}' on {proj}{R}")

# 6) systems get a push token -> save config with the STABLE proxy URL
tok = res.get("token") if isinstance(res, dict) else None
if tok:
    with open("elog_config.json", "w") as fp:
        json.dump({"elog_url": BASE, "elog_token": tok}, fp, indent=2); fp.write("\\n")
    with open("elog_env.sh", "w") as fp:
        fp.write("export ELOG_URL='" + BASE + "'\\n")
        fp.write("export ELOG_TOKEN='" + tok + "'\\n")
    print(f"{G}OK saved elog_config.json + elog_env.sh{R}")
    print(f"{DIM}  push logs to {BASE}/api/logs  (Authorization: Bearer <token>){R}")
else:
    print(f"{Y}Plain service: no token. elog will request data from {svc_url or url_label}.{R}")
print(f"{C}elog_url is the launcher proxy URL — project port changes won't break it.{R}")
PY

python3 "$TMP" "$ELOG_LAUNCHER"`
}

// ── Shared block components ──────────────────────────────────────────────────

function Code({ children }) {
  return (
    <pre style={{ margin: 0, fontSize: 'var(--fs-tiny, 11px)', lineHeight: 1.6, borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border-default)', borderRadius: 8, padding: '8px 12px', overflowX: 'auto', fontFamily: 'var(--font-mono)', backgroundColor: 'var(--surface-2)', color: 'var(--text-primary)' }}>
      {children}
    </pre>
  )
}

function Inline({ children }) {
  return (
    <code style={{ fontSize: 'var(--fs-tiny, 11px)', padding: '2px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', backgroundColor: 'var(--surface-2)', color: 'var(--text-primary)' }}>
      {children}
    </code>
  )
}

function Section({ title, children }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0, fontSize: 'var(--fs-body, 13px)', fontWeight: 600, paddingTop: 12, borderTopWidth: 1, borderTopStyle: 'solid', borderTopColor: 'var(--border-subtle)', color: 'var(--text-primary)' }}>
        {title}
      </h3>
      <div style={{ fontSize: 'var(--fs-small, 12px)', display: 'flex', flexDirection: 'column', gap: 8, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
        {children}
      </div>
    </section>
  )
}

function Note({ children }) {
  return (
    <div style={{ borderRadius: 8, padding: '8px 12px', fontSize: 'var(--fs-small, 12px)', borderLeftWidth: 2, borderLeftStyle: 'solid', borderLeftColor: 'var(--warning-text)', backgroundColor: 'var(--warning-bg)', color: 'var(--warning-text)' }}>
      {children}
    </div>
  )
}

// ── SERVICE manual ────────────────────────────────────────────────────────────

function ServiceManualKo({ origin }) {
  return (
    <>
      <Section title="① 개념">
        <p>
          <strong>Service</strong>는 elog가 데이터를 <em>요청</em>하는 외부 프로그램입니다.
          task 로그가 생성되거나 사용자가 [Request Now]를 누르면, 등록된 <Inline>Request URL</Inline>로 elog가 POST를 보내고,
          서비스는 현재 상태(측정값 등)를 응답합니다. elog가 그 데이터로 로그를 채워 씁니다.
        </p>
        <table style={{ fontSize: 'var(--fs-tiny, 11px)', width:'100%', borderCollapse:'collapse' }}>
          <tbody style={{ color: 'var(--text-secondary)' }}>
            <tr style={{ borderTopWidth:1, borderTopStyle:'solid', borderColor: 'var(--border-subtle)' }}>
              <td style={{ paddingTop:4, paddingBottom:4, paddingRight:12, fontWeight:600 }}>예시</td>
              <td style={{ paddingTop:4, paddingBottom:4 }}>진공 게이지, HV 모듈, Actuator 위치, 온도 센서</td>
            </tr>
            <tr style={{ borderTopWidth:1, borderTopStyle:'solid', borderColor: 'var(--border-subtle)' }}>
              <td style={{ paddingTop:4, paddingBottom:4, paddingRight:12, fontWeight:600 }}>필수 항목</td>
              <td style={{ paddingTop:4, paddingBottom:4 }}>Name, Request URL (elog가 호출할 endpoint)</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="② HTTP webhook 컨트랙트">
        <p style={{ fontWeight:600 }}>요청 본문 (elog → service):</p>
        <Code>{`{
  "format_id": 12,
  "format_name": "Vacuum readout",
  "task_log_id": 9382,
  "requested_at": "2026-05-29T13:42:11Z",
  "mode": "task" | "snapshot" | "realtime"
}`}</Code>

        <p style={{ fontWeight:600 }}>응답 본문 (service → elog):</p>
        <Code>{`{
  "fields": {
    "pressure_ch1": { "value": 1.2e-6, "error": 0.1e-6 },
    "title": "Vacuum readout",
    "body": "All chambers nominal."
  }
}`}</Code>
        <p>
          <Inline>fields</Inline>의 key는 연결된 log format의 field key와 일치해야 합니다.<br />
          <strong>타임아웃:</strong> 5초. 실패 시 manual task로 변환, 에러 댓글 자동 추가.
        </p>
      </Section>

      <Section title="③ Handshake — 서비스 등록 (필수)">
        <Note>
          <strong>서비스는 handshake가 필수입니다.</strong> 서비스가 <Inline>handshake endpoint</Inline>에서
          <Inline>log_fields</Inline>를 선언해야 하고, 등록 시 elog가 그 필드로 <strong>{'"<이름> log"'} 포맷을 항상 자동 생성</strong>합니다.
          이 포맷이 있어야 값이 편집 가능하고, <Inline>metric</Inline> 필드는 Infography(그래프/시트) 변수로 등록됩니다.
          handshake/log_fields 없이 값만 push하면 포맷이 없어 편집·그래프가 안 됩니다.
        </Note>
        <p>
          New Service 폼에서 URL만 입력하고 [Discover]를 누르면 elog가 아래 요청을 보내고,
          응답의 서비스 정보 + log field 목록으로 폼을 채우고 log format을 자동 생성합니다.
        </p>
        <p style={{ fontWeight:600 }}>Handshake 요청 (elog → service):</p>
        <Code>{`POST <your-request-url>
{
  "event": "elog_handshake",
  "elog_url": "http://elog-server:8000"
}`}</Code>
        <p style={{ fontWeight:600 }}>Handshake 응답 (service → elog):</p>
        <Code>{`{
  "name": "Vacuum Monitor",
  "description": "RGA + ion gauge readout",
  "hostname": "vacuum01.lab.local",
  "directory": "/opt/vacuum",
  "is_system": false,
  "log_fields": [
    { "key": "pressure_ch1", "label": "Pressure Ch1 (Torr)", "type": "number_entry" },
    { "key": "pressure_ch2", "label": "Pressure Ch2 (Torr)", "type": "number_entry" },
    { "key": "body",         "label": "Summary",             "type": "body"         }
  ]
}`}</Code>
        <p>
          <Inline>log_fields</Inline>의 <Inline>type</Inline>은{' '}
          <Inline>number_entry</Inline> · <Inline>text</Inline> · <Inline>body</Inline> ·{' '}
          <Inline>title</Inline> · <Inline>tags</Inline> · <Inline>level</Inline> 중 하나입니다.
          같은 type을 여러 개 선언할 수 있으며, key로 구분됩니다.
        </p>
        <p style={{ fontWeight:600, paddingTop:4 }}>FastAPI 구현 예제 (handshake 포함):</p>
        <Code>{`# pip install fastapi uvicorn
from fastapi import FastAPI
from pydantic import BaseModel

app = FastAPI()

# ── Handshake 응답용 ─────────────────────────────────────────────
@app.post("/status")
def endpoint(body: dict):
    # Handshake 처리
    if body.get("event") == "elog_handshake":
        return {
            "name":        "Vacuum Monitor",
            "description": "RGA + ion gauge readout",
            "hostname":    "vacuum01.lab.local",
            "directory":   "/opt/vacuum",
            "is_system":   False,
            "log_fields": [
                {"key": "pressure_ch1", "label": "Pressure Ch1 (Torr)", "type": "number_entry"},
                {"key": "pressure_ch2", "label": "Pressure Ch2 (Torr)", "type": "number_entry"},
                {"key": "body",         "label": "Summary",             "type": "body"},
            ],
        }

    # 일반 데이터 요청 처리
    p1, p2 = read_pressure()
    return {
        "fields": {
            "pressure_ch1": {"value": p1, "error": 0},
            "pressure_ch2": {"value": p2, "error": 0},
            "body": f"Ch1: {p1:.2e}  Ch2: {p2:.2e} Torr",
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)`}</Code>
      </Section>

      <Section title="④ number_entry 필드 모양">
        <p><Inline>number_entry</Inline> 필드는 항상 <Inline>{`{value, error}`}</Inline> 형태로 응답하세요.</p>
        <Code>{`단일값:  { "value": 1.23, "error": 0 }
범위:    { "value": (min+max)/2, "error": (max-min)/2 }
여러값:  { "value": mean, "error": stddev }

// 또는 raw 형태 (elog가 자동 변환):
{ "single": 1.23 }
{ "min": 1.0, "max": 1.5 }
{ "values": [1.1, 1.2, 1.3] }`}</Code>
      </Section>

      <Section title="⑤ 수동 등록 — elog_service_setup.sh">
        <Note>
          <strong>이 스크립트는 elog가 제공하는 파일이 아닙니다.</strong><br />
          Handshake를 구현하지 않은 경우 아래 스크립트를 서비스 디렉토리에 만들어두세요.
          실행 결과를 New Service 폼 상단 "스크립트 출력 붙여넣기"에 붙여넣으면 필드가 채워집니다.
        </Note>
        <Code>{buildSetupScript(false)}</Code>
      </Section>

      <Section title="⑥ 서비스에서 직접 push하기 (선택)">
        <p>
          서비스도 필요하면 API token으로 elog에 직접 로그를 push할 수 있습니다.
          이 경우 <Inline>log_type: 0</Inline>을 사용하면 handshake로 자동 생성된 포맷이 연결됩니다.
        </p>
        <Code>{`import requests

ELOG_URL   = "<여기에 붙여넣기>"
ELOG_TOKEN = "<여기에 붙여넣기>"

requests.post(
    f"{ELOG_URL}/api/logs",
    headers={"Authorization": f"Bearer {ELOG_TOKEN}"},
    json={
        "title":    "Vacuum alert",
        "log_type": 0,          # handshake로 생성된 서비스 포맷 자동 연결
        "is_auto":  True,
        "format_fields": {
            "pressure_ch1": {"value": 9.9e-4, "error": 0},
            "body": "Ch1 pressure exceeds threshold",
        },
    }
)`}</Code>
      </Section>
    </>
  )
}

function ServiceManualEn({ origin }) {
  return (
    <>
      <Section title="① Concept">
        <p>
          A <strong>Service</strong> is an external program that elog <em>requests</em> data from.
          When a task log is created or a user clicks [Request Now], elog sends a POST to the registered <Inline>Request URL</Inline>.
          The service responds with current readings; elog fills the log with that data.
        </p>
        <table style={{ fontSize: 'var(--fs-tiny, 11px)', width:'100%', borderCollapse:'collapse' }}>
          <tbody style={{ color: 'var(--text-secondary)' }}>
            <tr style={{ borderTopWidth:1, borderTopStyle:'solid', borderColor: 'var(--border-subtle)' }}>
              <td style={{ paddingTop:4, paddingBottom:4, paddingRight:12, fontWeight:600 }}>Examples</td>
              <td style={{ paddingTop:4, paddingBottom:4 }}>Vacuum gauges, HV modules, actuator positions, temperature sensors</td>
            </tr>
            <tr style={{ borderTopWidth:1, borderTopStyle:'solid', borderColor: 'var(--border-subtle)' }}>
              <td style={{ paddingTop:4, paddingBottom:4, paddingRight:12, fontWeight:600 }}>Required</td>
              <td style={{ paddingTop:4, paddingBottom:4 }}>Name, Request URL (the endpoint elog will call)</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="② HTTP webhook contract">
        <p style={{ fontWeight:600 }}>Request body (elog → service):</p>
        <Code>{`{
  "format_id": 12,
  "format_name": "Vacuum readout",
  "task_log_id": 9382,
  "requested_at": "2026-05-29T13:42:11Z",
  "mode": "task" | "snapshot" | "realtime"
}`}</Code>

        <p style={{ fontWeight:600 }}>Response body (service → elog):</p>
        <Code>{`{
  "fields": {
    "pressure_ch1": { "value": 1.2e-6, "error": 0.1e-6 },
    "title": "Vacuum readout",
    "body": "All chambers nominal."
  }
}`}</Code>
        <p>
          Keys in <Inline>fields</Inline> must match the field keys defined on the linked log format.<br />
          <strong>Timeout:</strong> 5 seconds. On failure, elog converts to a manual task and auto-comments the error.
        </p>
      </Section>

      <Section title="③ Handshake — service registration (required)">
        <Note>
          <strong>Handshake is required for a service.</strong> The service must declare its
          <Inline>log_fields</Inline> at the handshake endpoint; on registration elog <strong>always creates a {'"<name> log"'} format</strong> from them.
          That format is what makes values editable, and <Inline>metric</Inline> fields become Infography (graph/sheet) variables.
          If you push values without handshake/log_fields, there is no format — values can't be edited or plotted.
        </Note>
        <p>
          Enter the URL in the New Service form and click [Discover]: elog sends a handshake request,
          reads back the service info + log field list, auto-fills the form, and creates the log format.
        </p>
        <p style={{ fontWeight:600 }}>Handshake request (elog → service):</p>
        <Code>{`POST <your-request-url>
{
  "event": "elog_handshake",
  "elog_url": "http://elog-server:8000"
}`}</Code>
        <p style={{ fontWeight:600 }}>Handshake response (service → elog):</p>
        <Code>{`{
  "name": "Vacuum Monitor",
  "description": "RGA + ion gauge readout",
  "hostname": "vacuum01.lab.local",
  "directory": "/opt/vacuum",
  "is_system": false,
  "log_fields": [
    { "key": "pressure_ch1", "label": "Pressure Ch1 (Torr)", "type": "number_entry" },
    { "key": "pressure_ch2", "label": "Pressure Ch2 (Torr)", "type": "number_entry" },
    { "key": "body",         "label": "Summary",             "type": "body"         }
  ]
}`}</Code>
        <p>
          <Inline>type</Inline> is one of{' '}
          <Inline>number_entry</Inline>, <Inline>text</Inline>, <Inline>body</Inline>,{' '}
          <Inline>title</Inline>, <Inline>tags</Inline>, <Inline>level</Inline>.
          Multiple fields of the same type are allowed — distinguish them by <Inline>key</Inline>.
        </p>
        <p style={{ fontWeight:600, paddingTop:4 }}>FastAPI example (with handshake):</p>
        <Code>{`# pip install fastapi uvicorn
from fastapi import FastAPI

app = FastAPI()

# ── Single endpoint handles both handshake and data requests ──
@app.post("/status")
def endpoint(body: dict):
    # Handle handshake
    if body.get("event") == "elog_handshake":
        return {
            "name":        "Vacuum Monitor",
            "description": "RGA + ion gauge readout",
            "hostname":    "vacuum01.lab.local",
            "directory":   "/opt/vacuum",
            "is_system":   False,
            "log_fields": [
                {"key": "pressure_ch1", "label": "Pressure Ch1 (Torr)", "type": "number_entry"},
                {"key": "pressure_ch2", "label": "Pressure Ch2 (Torr)", "type": "number_entry"},
                {"key": "body",         "label": "Summary",             "type": "body"},
            ],
        }

    # Handle data request
    p1, p2 = read_pressure()
    return {
        "fields": {
            "pressure_ch1": {"value": p1, "error": 0},
            "pressure_ch2": {"value": p2, "error": 0},
            "body": f"Ch1: {p1:.2e}  Ch2: {p2:.2e} Torr",
        }
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)`}</Code>
      </Section>

      <Section title="④ number_entry field shape">
        <p>The <Inline>number_entry</Inline> field always expects <Inline>{`{value, error}`}</Inline>.</p>
        <Code>{`single:   { "value": 1.23, "error": 0 }
range:    { "value": (min+max)/2, "error": (max-min)/2 }
multiple: { "value": mean, "error": stddev }

// or raw form (elog auto-converts):
{ "single": 1.23 }
{ "min": 1.0, "max": 1.5 }
{ "values": [1.1, 1.2, 1.3] }`}</Code>
      </Section>

      <Section title="⑤ Manual registration — elog_service_setup.sh">
        <Note>
          <strong>elog does not provide this script.</strong><br />
          Use this if you cannot implement the handshake endpoint.
          Run it and paste the output into "Register from script" in the New Service form.
        </Note>
        <Code>{buildSetupScript(false)}</Code>
      </Section>

      <Section title="⑥ Pushing logs directly (optional)">
        <p>
          Services can also push logs directly to elog via API token.
          Use <Inline>log_type: 0</Inline> to automatically link the format created during handshake.
        </p>
        <Code>{`import requests

ELOG_URL   = "<paste here>"
ELOG_TOKEN = "<paste here>"

requests.post(
    f"{ELOG_URL}/api/logs",
    headers={"Authorization": f"Bearer {ELOG_TOKEN}"},
    json={
        "title":    "Vacuum alert",
        "log_type": 0,          # auto-links the handshake-created format
        "is_auto":  True,
        "format_fields": {
            "pressure_ch1": {"value": 9.9e-4, "error": 0},
            "body": "Ch1 pressure exceeds threshold",
        },
    }
)`}</Code>
      </Section>
    </>
  )
}

// ── SYSTEM manual ─────────────────────────────────────────────────────────────

function SystemManualKo({ origin }) {
  return (
    <>
      <Section title="① 개념">
        <p>
          <strong>System</strong>은 run을 자율적으로 관리하며 elog에 직접 로그를 push하는 외부 프로그램입니다.
          Service와 달리 elog가 데이터를 요청하는 것이 아니라, System이 스스로 run 시작/중지 시점에 elog로 로그를 보냅니다.
          선택적으로 <Inline>Command URL</Inline>을 등록하면 elog가 run 명령을 이 시스템에 보낼 수 있습니다.
        </p>
        <table style={{ fontSize: 'var(--fs-tiny, 11px)', width:'100%', borderCollapse:'collapse' }}>
          <tbody style={{ color: 'var(--text-secondary)' }}>
            <tr style={{ borderTopWidth:1, borderTopStyle:'solid', borderColor: 'var(--border-subtle)' }}>
              <td style={{ paddingTop:4, paddingBottom:4, paddingRight:12, fontWeight:600 }}>예시</td>
              <td style={{ paddingTop:4, paddingBottom:4 }}>Detector DAQ, Beam Counting DAQ, Trigger System</td>
            </tr>
            <tr style={{ borderTopWidth:1, borderTopStyle:'solid', borderColor: 'var(--border-subtle)' }}>
              <td style={{ paddingTop:4, paddingBottom:4, paddingRight:12, fontWeight:600 }}>필수 항목</td>
              <td style={{ paddingTop:4, paddingBottom:4 }}>Name, API Token (폼에서 발급)</td>
            </tr>
            <tr style={{ borderTopWidth:1, borderTopStyle:'solid', borderColor: 'var(--border-subtle)' }}>
              <td style={{ paddingTop:4, paddingBottom:4, paddingRight:12, fontWeight:600 }}>선택 항목</td>
              <td style={{ paddingTop:4, paddingBottom:4 }}>Command URL (elog → 시스템 run 명령)</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="② 자동 생성 포맷">
        <p>시스템 등록 시 다음 4개의 포맷이 자동으로 만들어지고 연결됩니다:</p>
        <table style={{ fontSize: 'var(--fs-tiny, 11px)', width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th style={{ textAlign:'left', paddingTop:4, paddingBottom:4, paddingRight:12 }}>포맷 이름</th>
              <th style={{ textAlign:'left', paddingTop:4, paddingBottom:4, paddingRight:12 }}>task_type</th>
              <th style={{ textAlign:'left', paddingTop:4, paddingBottom:4 }}>run_type</th>
            </tr>
          </thead>
          <tbody style={{ color: 'var(--text-secondary)' }}>
            {[
              ['Init of {Name} run',       'init_of_run',    'I'],
              ['Start of {Name} run',      'start_of_run',   'S'],
              ['End of {Name} run',        'end_of_run',     'E'],
              ['Monitoring {Name} run',    'monitoring_run', 'M'],
            ].map(([name, tt, rt]) => (
              <tr key={tt} style={{ borderTopWidth:1, borderTopStyle:'solid', borderColor: 'var(--border-subtle)' }}>
                <td style={{ paddingTop:4, paddingBottom:4, paddingRight:12, fontFamily:'var(--font-mono)' }}>{name}</td>
                <td style={{ paddingTop:4, paddingBottom:4, paddingRight:12 }}>{tt}</td>
                <td style={{ paddingTop:4, paddingBottom:4 }}>{rt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="③ Handshake — 자동 등록 (권장)">
        <p>
          시스템이 <strong>Command URL endpoint</strong>에서 handshake를 지원하면 완전 자동 등록이 됩니다.
          elog New Service 폼에서 URL 입력 후 [Discover]를 누르고 [등록]을 클릭하면:
          시스템 정보 자동 입력 → API Token 자동 발급 → ELOG_URL + ELOG_TOKEN 자동 전송까지 한 번에 완료됩니다.
        </p>
        <p style={{ fontWeight:600 }}>Handshake 요청 (elog → system):</p>
        <Code>{`POST <command_url>
{
  "event": "elog_handshake",
  "elog_url": "http://elog-server:8000"
}`}</Code>
        <p style={{ fontWeight:600 }}>Handshake 응답 (system → elog):</p>
        <Code>{`{
  "name": "DetectorDAQ",
  "description": "Main detector DAQ",
  "hostname": "daq01.lab.local",
  "directory": "/opt/daq",
  "is_system": true,
  "log_fields": []
}`}</Code>
        <p style={{ fontWeight:600, paddingTop:4 }}>FastAPI 구현 예제 (handshake + credentials 수신):</p>
        <Code>{`# pip install fastapi uvicorn
from fastapi import FastAPI
import json, pathlib

app = FastAPI()

CONFIG_FILE = pathlib.Path("elog_config.json")

@app.post("/elog-command")  # ← Command URL로 등록
def handle_elog(body: dict):
    event = body.get("event")

    # ── Handshake: 시스템 정보 반환 ──────────────────────────
    if event == "elog_handshake":
        return {
            "name":        "DetectorDAQ",
            "description": "Main detector data acquisition",
            "hostname":    "daq01.lab.local",
            "directory":   "/opt/daq",
            "is_system":   True,
            "log_fields":  [],   # 시스템은 보통 push만 하므로 비워도 됨
        }

    # ── Credentials 수신: 파일에 저장 ────────────────────────
    if event == "elog_credentials":
        CONFIG_FILE.write_text(json.dumps({
            "elog_url":   body.get("elog_url"),
            "elog_token": body.get("elog_token"),
        }, indent=2))
        print(f"elog credentials saved to {CONFIG_FILE}")
        return {"ok": True}

    # ── Run 명령 처리 ─────────────────────────────────────────
    if event == "start_run":
        start_run(body.get("run_number"))
    elif event == "stop_run":
        stop_run(body.get("run_number"))

    return {"ok": True}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9000)`}</Code>
        <p>저장된 config를 읽어서 elog로 push:</p>
        <Code>{`import json, requests, pathlib

cfg = json.loads(pathlib.Path("elog_config.json").read_text())
ELOG_URL   = cfg["elog_url"]
ELOG_TOKEN = cfg["elog_token"]`}</Code>
      </Section>

      <Section title="④ 수동 등록 — elog_service_setup.sh">
        <Note>
          <strong>elog_service_setup.sh는 elog가 제공하는 파일이 아닙니다.</strong><br />
          Handshake를 구현하지 않을 경우 아래 스크립트를 만들어 출력을 New Service 폼에 붙여넣으세요.
        </Note>
        <Code>{buildSetupScript(true)}</Code>
      </Section>

      <Section title="④ elog로 push하기">
        <Note>
          <strong>format_id 불필요</strong> — token으로 서비스를 자동 인식하고 <Inline>log_type</Inline>으로 포맷을 결정합니다.
        </Note>
        <table style={{ fontSize: 'var(--fs-tiny, 11px)', width:'100%', borderCollapse:'collapse', marginBottom:8 }}>
          <thead><tr style={{ color: 'var(--text-muted)' }}>
            <th style={{ textAlign:'left', paddingTop:4, paddingBottom:4, paddingRight:16 }}>log_type</th>
            <th style={{ textAlign:'left', paddingTop:4, paddingBottom:4, paddingRight:16 }}>포맷</th>
            <th style={{ textAlign:'left', paddingTop:4, paddingBottom:4 }}>run_type 자동 설정</th>
          </tr></thead>
          <tbody style={{ color: 'var(--text-secondary)' }}>
            {[['0','일반 서비스 로그 (handshake 포맷)','—'],
              ['11','init_of_run','I'],
              ['12','start_of_run','S'],
              ['13','end_of_run','E'],
              ['14','monitoring_run','M'],
            ].map(([t,f,r]) => (
              <tr key={t} style={{ borderTopWidth:1, borderTopStyle:'solid', borderColor: 'var(--border-subtle)' }}>
                <td style={{ paddingTop:4, paddingBottom:4, paddingRight:16, fontFamily:'var(--font-mono)' }}>{t}</td>
                <td style={{ paddingTop:4, paddingBottom:4, paddingRight:16 }}>{f}</td>
                <td style={{ paddingTop:4, paddingBottom:4, fontFamily:'var(--font-mono)' }}>{r}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontWeight:600 }}>curl 예제:</p>
        <Code>{`ELOG_URL="<New Service 폼에서 복사>"
ELOG_TOKEN="<New Service 폼에서 복사>"

curl -X POST $ELOG_URL/api/logs \\
  -H "Authorization: Bearer $ELOG_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Run 55 started",
    "log_type": 12,
    "run_number": 55,
    "is_auto": true,
    "format_fields": {
      "trigger_rate_hz": { "value": 1234.5, "error": 12.0 }
    }
  }'`}</Code>

        <p style={{ fontWeight:600 }}>Python 예제:</p>
        <Code>{`import requests

ELOG_URL   = "<여기에 붙여넣기>"
ELOG_TOKEN = "<여기에 붙여넣기>"

def push_log(title, log_type, run_number, fields=None):
    requests.post(
        f"{ELOG_URL}/api/logs",
        headers={"Authorization": f"Bearer {ELOG_TOKEN}"},
        json={
            "title":      title,
            "log_type":   log_type,   # 11=init 12=start 13=end 14=monitoring
            "run_number": run_number,
            "is_auto":    True,
            "format_fields": fields or {},
        }
    )

push_log("Run 55 started", log_type=12, run_number=55,
         fields={"trigger_rate_hz": {"value": 1234.5, "error": 12.0}})
push_log("Run 55 ended", log_type=13, run_number=55)`}</Code>
      </Section>

      <Section title="⑤ Command URL (선택)">
        <p>
          elog가 이 시스템에 run 시작/중지 명령을 보낼 때 사용합니다.
          등록하지 않아도 push는 정상 동작합니다.
        </p>
        <p style={{ fontWeight:600 }}>elog가 Command URL로 보내는 요청 형식:</p>
        <Code>{`POST <Command URL>
{
  "command": "start_run" | "stop_run",
  "run_number": 55,
  "requested_at": "2026-05-29T13:42:11Z"
}`}</Code>
        <p>응답은 200 OK만 확인합니다. 5초 타임아웃.</p>
      </Section>

      <Section title="⑥ 전형적인 run 플로우">
        <Code>{`[Detector DAQ]  run 시작
  → POST $ELOG_URL/api/logs  (run_type="S", API token)

[elog]  start_of_run 감지 → task 생성
  → POST http://beam-counting-daq/start  (Command URL)
  → GET  http://vacuum-service/status    (Request URL)

[Beam Counting DAQ]  명령 수신 → run 시작
  → POST $ELOG_URL/api/logs  (run_type="S", 자체 token)

[Detector DAQ]  run 종료
  → POST $ELOG_URL/api/logs  (run_type="E", API token)`}</Code>
      </Section>

      <Section title="⑦ 등록 절차">
        <ol style={{ listStyleType:'decimal', listStylePosition:'inside', paddingLeft:8, display:'flex', flexDirection:'column', gap:4 }}>
          <li>Experiment 탭 → [+ New Service]</li>
          <li>URL 입력 → <strong>[Discover]</strong> 클릭 → 시스템 정보 자동 입력</li>
          <li>Command URL이 없으면 Name + System 체크박스 ON 으로 직접 입력</li>
          <li><strong>[등록]</strong> 클릭</li>
          <li>자동으로: API Token 발급 + Command URL로 credentials 전송 + Init/Start/End/Monitoring 포맷 생성</li>
          <li><strong>등록 완료 배너에서 Token을 복사</strong> — 이후 다시 확인 불가</li>
        </ol>
        <Note>
          Command URL 서버가 꺼져 있어서 credentials 전송이 실패해도 등록은 완료됩니다.
          서버 실행 후 서비스 상세 화면 → [Send credentials]로 재전송할 수 있습니다.
        </Note>
      </Section>
    </>
  )
}

function SystemManualEn({ origin }) {
  return (
    <>
      <Section title="① Concept">
        <p>
          A <strong>System</strong> is an external program that autonomously manages runs and pushes logs directly to elog.
          Unlike a Service, elog does not request data from it — instead, the system sends logs to elog on its own
          at run start, stop, and monitoring intervals.
          Optionally, register a <Inline>Command URL</Inline> so elog can send run commands to this system.
        </p>
        <table style={{ fontSize: 'var(--fs-tiny, 11px)', width:'100%', borderCollapse:'collapse' }}>
          <tbody style={{ color: 'var(--text-secondary)' }}>
            <tr style={{ borderTopWidth:1, borderTopStyle:'solid', borderColor: 'var(--border-subtle)' }}>
              <td style={{ paddingTop:4, paddingBottom:4, paddingRight:12, fontWeight:600 }}>Examples</td>
              <td style={{ paddingTop:4, paddingBottom:4 }}>Detector DAQ, Beam Counting DAQ, Trigger System</td>
            </tr>
            <tr style={{ borderTopWidth:1, borderTopStyle:'solid', borderColor: 'var(--border-subtle)' }}>
              <td style={{ paddingTop:4, paddingBottom:4, paddingRight:12, fontWeight:600 }}>Required</td>
              <td style={{ paddingTop:4, paddingBottom:4 }}>Name, API Token (issued in the form)</td>
            </tr>
            <tr style={{ borderTopWidth:1, borderTopStyle:'solid', borderColor: 'var(--border-subtle)' }}>
              <td style={{ paddingTop:4, paddingBottom:4, paddingRight:12, fontWeight:600 }}>Optional</td>
              <td style={{ paddingTop:4, paddingBottom:4 }}>Command URL (elog → system run commands)</td>
            </tr>
          </tbody>
        </table>
      </Section>

      <Section title="② Auto-created formats">
        <p>When you register a system, these four formats are automatically created and linked:</p>
        <table style={{ fontSize: 'var(--fs-tiny, 11px)', width:'100%', borderCollapse:'collapse' }}>
          <thead>
            <tr style={{ color: 'var(--text-muted)' }}>
              <th style={{ textAlign:'left', paddingTop:4, paddingBottom:4, paddingRight:12 }}>Format name</th>
              <th style={{ textAlign:'left', paddingTop:4, paddingBottom:4, paddingRight:12 }}>task_type</th>
              <th style={{ textAlign:'left', paddingTop:4, paddingBottom:4 }}>run_type</th>
            </tr>
          </thead>
          <tbody style={{ color: 'var(--text-secondary)' }}>
            {[
              ['Init of {Name} run',       'init_of_run',    'I'],
              ['Start of {Name} run',      'start_of_run',   'S'],
              ['End of {Name} run',        'end_of_run',     'E'],
              ['Monitoring {Name} run',    'monitoring_run', 'M'],
            ].map(([name, tt, rt]) => (
              <tr key={tt} style={{ borderTopWidth:1, borderTopStyle:'solid', borderColor: 'var(--border-subtle)' }}>
                <td style={{ paddingTop:4, paddingBottom:4, paddingRight:12, fontFamily:'var(--font-mono)' }}>{name}</td>
                <td style={{ paddingTop:4, paddingBottom:4, paddingRight:12 }}>{tt}</td>
                <td style={{ paddingTop:4, paddingBottom:4 }}>{rt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section title="③ Handshake — auto-registration (recommended)">
        <p>
          If your system's Command URL endpoint supports handshake, registration is fully automatic:
          enter the URL, click [Discover] to auto-fill info, then click [Register] —
          elog issues an API token, delivers ELOG_URL + ELOG_TOKEN to your Command URL,
          and creates all run formats in one step.
        </p>
        <p style={{ fontWeight:600 }}>Handshake request (elog → system):</p>
        <Code>{`POST <command_url>
{
  "event": "elog_handshake",
  "elog_url": "http://elog-server:8000"
}`}</Code>
        <p style={{ fontWeight:600 }}>Handshake response (system → elog):</p>
        <Code>{`{
  "name": "DetectorDAQ",
  "description": "Main detector DAQ",
  "hostname": "daq01.lab.local",
  "directory": "/opt/daq",
  "is_system": true,
  "log_fields": []
}`}</Code>
        <p style={{ fontWeight:600, paddingTop:4 }}>FastAPI example (handshake + credentials + run commands):</p>
        <Code>{`# pip install fastapi uvicorn
from fastapi import FastAPI
import json, pathlib

app = FastAPI()

CONFIG_FILE = pathlib.Path("elog_config.json")

@app.post("/elog-command")  # ← register as Command URL
def handle_elog(body: dict):
    event = body.get("event")

    # ── Handshake: return system info ────────────────────────
    if event == "elog_handshake":
        return {
            "name":        "DetectorDAQ",
            "description": "Main detector data acquisition",
            "hostname":    "daq01.lab.local",
            "directory":   "/opt/daq",
            "is_system":   True,
            "log_fields":  [],   # systems usually push only — leave empty
        }

    # ── Credentials: save to file ─────────────────────────────
    if event == "elog_credentials":
        CONFIG_FILE.write_text(json.dumps({
            "elog_url":   body.get("elog_url"),
            "elog_token": body.get("elog_token"),
        }, indent=2))
        return {"ok": True}

    # ── Run commands ──────────────────────────────────────────
    if event == "start_run":
        start_run(body.get("run_number"))
    elif event == "stop_run":
        stop_run(body.get("run_number"))

    return {"ok": True}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=9000)`}</Code>
        <p>Load saved config and push to elog:</p>
        <Code>{`import json, requests, pathlib

cfg = json.loads(pathlib.Path("elog_config.json").read_text())
ELOG_URL   = cfg["elog_url"]
ELOG_TOKEN = cfg["elog_token"]`}</Code>
      </Section>

      <Section title="④ Manual registration — elog_service_setup.sh">
        <Note>
          <strong>elog does not provide this script.</strong><br />
          Use this if you cannot implement the handshake endpoint.
        </Note>
        <Code>{buildSetupScript(true)}</Code>
      </Section>

      <Section title="⑤ Pushing logs to elog">
        <Note>
          <strong>No format_id needed</strong> — elog resolves the format automatically from the token + <Inline>log_type</Inline>.
        </Note>
        <table style={{ fontSize: 'var(--fs-tiny, 11px)', width:'100%', borderCollapse:'collapse', marginBottom:8 }}>
          <thead><tr style={{ color: 'var(--text-muted)' }}>
            <th style={{ textAlign:'left', paddingTop:4, paddingBottom:4, paddingRight:16 }}>log_type</th>
            <th style={{ textAlign:'left', paddingTop:4, paddingBottom:4, paddingRight:16 }}>Format</th>
            <th style={{ textAlign:'left', paddingTop:4, paddingBottom:4 }}>run_type (auto)</th>
          </tr></thead>
          <tbody style={{ color: 'var(--text-secondary)' }}>
            {[['0','Regular service log (handshake format)','—'],
              ['11','init_of_run','I'],
              ['12','start_of_run','S'],
              ['13','end_of_run','E'],
              ['14','monitoring_run','M'],
            ].map(([t,f,r]) => (
              <tr key={t} style={{ borderTopWidth:1, borderTopStyle:'solid', borderColor: 'var(--border-subtle)' }}>
                <td style={{ paddingTop:4, paddingBottom:4, paddingRight:16, fontFamily:'var(--font-mono)' }}>{t}</td>
                <td style={{ paddingTop:4, paddingBottom:4, paddingRight:16 }}>{f}</td>
                <td style={{ paddingTop:4, paddingBottom:4, fontFamily:'var(--font-mono)' }}>{r}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p style={{ fontWeight:600 }}>curl example:</p>
        <Code>{`ELOG_URL="<paste from New Service form>"
ELOG_TOKEN="<paste from New Service form>"

curl -X POST $ELOG_URL/api/logs \\
  -H "Authorization: Bearer $ELOG_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Run 55 started",
    "log_type": 12,
    "run_number": 55,
    "is_auto": true,
    "format_fields": {
      "trigger_rate_hz": { "value": 1234.5, "error": 12.0 }
    }
  }'`}</Code>

        <p style={{ fontWeight:600 }}>Python example:</p>
        <Code>{`import requests

ELOG_URL   = "<paste here>"
ELOG_TOKEN = "<paste here>"

def push_log(title, log_type, run_number, fields=None):
    requests.post(
        f"{ELOG_URL}/api/logs",
        headers={"Authorization": f"Bearer {ELOG_TOKEN}"},
        json={
            "title":      title,
            "log_type":   log_type,   # 11=init 12=start 13=end 14=monitoring
            "run_number": run_number,
            "is_auto":    True,
            "format_fields": fields or {},
        }
    )

push_log("Run 55 started", log_type=12, run_number=55,
         fields={"trigger_rate_hz": {"value": 1234.5, "error": 12.0}})
push_log("Run 55 ended",   log_type=13, run_number=55)`}</Code>
      </Section>

      <Section title="⑤ Command URL (optional)">
        <p>
          Register a Command URL if you want elog to send run start/stop commands to this system.
          Push still works without it.
        </p>
        <p style={{ fontWeight:600 }}>Request elog sends to Command URL:</p>
        <Code>{`POST <Command URL>
{
  "command": "start_run" | "stop_run",
  "run_number": 55,
  "requested_at": "2026-05-29T13:42:11Z"
}`}</Code>
        <p>elog only checks for HTTP 200. 5-second timeout.</p>
      </Section>

      <Section title="⑥ Typical run flow">
        <Code>{`[Detector DAQ]  starts run
  → POST $ELOG_URL/api/logs  (run_type="S", API token)

[elog]  detects start_of_run → creates tasks
  → POST http://beam-counting-daq/start  (Command URL)
  → GET  http://vacuum-service/status    (Request URL)

[Beam Counting DAQ]  receives command → starts run
  → POST $ELOG_URL/api/logs  (run_type="S", own token)

[Detector DAQ]  ends run
  → POST $ELOG_URL/api/logs  (run_type="E", API token)`}</Code>
      </Section>

      <Section title="⑦ Registration steps">
        <ol style={{ listStyleType:'decimal', listStylePosition:'inside', paddingLeft:8, display:'flex', flexDirection:'column', gap:4 }}>
          <li>Experiment tab → [+ New Service]</li>
          <li>Enter URL → click <strong>[Discover]</strong> → system info auto-filled</li>
          <li>If no URL yet, enter Name and check System manually</li>
          <li>Click <strong>[Register]</strong></li>
          <li>Automatically: API Token issued + credentials sent to Command URL + Init/Start/End/Monitoring formats created</li>
          <li><strong>Copy the Token from the registration result banner</strong> — it will not be shown again</li>
        </ol>
        <Note>
          If the Command URL server is not running, credentials delivery will fail but registration still completes.
          You can retry via [Send credentials] in the service detail panel after the server is up.
        </Note>
      </Section>
    </>
  )
}

// ── Markdown builders ────────────────────────────────────────────────────────

function buildServiceMdKo(origin) {
  return `# elog Service 통합 스펙

저는 **lilak_elog** 전자 로그북에 연동되는 **Service**를 만들고 있습니다.
Service는 elog가 데이터를 요청하면 응답하는 외부 프로그램입니다.

현재 elog 서버 주소 (참고용): \`${origin}\`
> ⚠ 이 주소를 코드에 직접 쓰지 마세요. 환경변수 \`ELOG_URL\`로 관리하세요.

---

## 1. 개념

elog가 task 로그를 만들거나 사용자가 [Request Now]를 누르면, 등록된 **Request URL**로 POST를 보냅니다.
서비스는 현재 측정값을 응답하고, elog가 그걸로 로그를 채워 씁니다.

- 예시: 진공 게이지, HV 모듈, Actuator 위치, 온도 센서
- 필수: Name, Request URL

## 2. HTTP webhook 컨트랙트

### 요청 본문 (elog → service)
\`\`\`json
{
  "format_id": 12,
  "format_name": "Vacuum readout",
  "task_log_id": 9382,
  "requested_at": "2026-05-29T13:42:11Z",
  "mode": "task" | "snapshot" | "realtime"
}
\`\`\`

### 응답 본문 (service → elog)
\`\`\`json
{
  "fields": {
    "pressure_ch1": { "value": 1.2e-6, "error": 0.1e-6 },
    "title": "Vacuum readout",
    "body": "All chambers nominal."
  }
}
\`\`\`

- \`fields\` key는 연결된 log format의 field key와 일치해야 합니다.
- 5초 타임아웃. 실패 시 manual task로 변환, 에러 댓글 자동 추가.

## 3. Handshake — 서비스 등록 (필수)

**서비스는 handshake가 필수입니다.** handshake로 \`log_fields\`를 선언해야 하고, 등록 시 elog가 그 필드로 \`"<이름> log"\` 포맷을 **항상 자동 생성**합니다. 이 포맷이 있어야 값이 편집 가능하고, \`metric\` 필드는 Infography 변수로 등록됩니다. handshake/log_fields 없이 값만 push하면 포맷이 없어 편집·그래프가 안 됩니다.

New Service 폼에서 URL만 입력하고 [Discover]를 누르면 자동 등록됩니다.

### Handshake 요청 (elog → service)
\`\`\`json
POST <request_url>
{
  "event": "elog_handshake",
  "elog_url": "http://elog-server:8000"
}
\`\`\`

### Handshake 응답 (service → elog)
\`\`\`json
{
  "name": "Vacuum Monitor",
  "description": "RGA + ion gauge readout",
  "hostname": "vacuum01.lab.local",
  "directory": "/opt/vacuum",
  "is_system": false,
  "log_fields": [
    { "key": "pressure_ch1", "label": "Pressure Ch1 (Torr)", "type": "number_entry", "unit": "Torr", "metric": true },
    { "key": "pressure_ch2", "label": "Pressure Ch2 (Torr)", "type": "number_entry", "unit": "Torr", "metric": true },
    { "key": "body",         "label": "Summary",             "type": "body"         }
  ]
}
\`\`\`

\`log_fields\`의 \`type\`: \`number_entry\` | \`number\` | \`text\` | \`body\` | \`title\` | \`tags\` | \`level\`
같은 type을 여러 개 선언 가능 (key로 구분).

**중요 — Infography(그래프/시트)에 쓸 값은 \`"metric": true\` 를 붙이세요.**
\`number\` / \`number_entry\` 필드에 \`metric: true\`(+ 선택 \`unit\`)를 선언하면, 반복 push되는 값이 자동으로 Infography 변수 목록에 등록되어 그래프·시트에서 쓸 수 있습니다. metric을 안 붙이면 로그엔 보여도 그래프/시트 변수로는 안 잡힙니다.
또한 서비스는 push 시 이 포맷에 연결되도록 \`log_type: 0\`(또는 해당 format_id)을 사용해야 합니다 — 그래야 값이 편집 가능하고 변수로 등록됩니다.

### FastAPI 구현 예제 (handshake 포함)
\`\`\`python
from fastapi import FastAPI

app = FastAPI()

@app.post("/status")
def endpoint(body: dict):
    if body.get("event") == "elog_handshake":
        return {
            "name": "Vacuum Monitor", "description": "RGA + ion gauge readout",
            "hostname": "vacuum01.lab.local", "directory": "/opt/vacuum",
            "is_system": False,
            "log_fields": [
                {"key": "pressure_ch1", "label": "Pressure Ch1 (Torr)", "type": "number_entry"},
                {"key": "body",         "label": "Summary",             "type": "body"},
            ],
        }
    p = read_pressure()
    return {"fields": {"pressure_ch1": {"value": p, "error": 0}, "body": f"{p:.2e} Torr"}}
\`\`\`

## 4. number_entry 필드

항상 \`{value, error}\` 형태. 또는 raw 형태 (elog 자동 변환):
\`\`\`json
{ "single": 1.23 }
{ "min": 1.0, "max": 1.5 }
{ "values": [1.1, 1.2, 1.3] }
\`\`\`

## 5. 수동 등록 — elog_service_setup.sh (handshake 미구현 시)

⚠ **이 스크립트는 elog가 제공하는 파일이 아닙니다. 직접 만들어야 합니다.**
Handshake를 구현하지 않은 경우, 아래 스크립트를 서비스 디렉토리에 만들고 실행한 뒤,
출력 결과를 New Service 폼 상단의 "스크립트 출력 붙여넣기"에 붙여넣으면 필드가 자동으로 채워집니다.

이 스크립트는 **런처 단일 포트(8010)** 하나에만 접속합니다. 실행하면 ① 프로젝트(실험) 목록을 받아 선택 ② 로그인 ③ service/system/main-system 선택 ④ 무엇이 로깅될지(포맷·필드) 미리보기 ⑤ API로 등록 → 시스템은 토큰을 받아 \`elog_config.json\`에 **안정적인 프록시 URL**(\`http://host:8010/p/<project>\`)과 함께 저장합니다. 프로젝트 내부 포트가 바뀌어도 push가 깨지지 않습니다.

\`\`\`bash
${buildSetupScript(false)}
\`\`\`

출력/동작: 스크립트가 직접 handshake를 응답하므로, elog에서 URL을 입력하고 [Discover]를 누르면 자동 등록되고 터미널에 "✓ Connected to elog!"가 표시됩니다.

## 6. 서비스에서 직접 push하기 (선택)

서비스도 API token으로 elog에 직접 로그를 push할 수 있습니다.
\`log_type: 0\`을 사용하면 handshake로 자동 생성된 포맷이 연결됩니다.

\`\`\`python
import requests

ELOG_URL   = "<여기에 붙여넣기>"
ELOG_TOKEN = "<여기에 붙여넣기>"

requests.post(
    f"{ELOG_URL}/api/logs",
    headers={"Authorization": f"Bearer {ELOG_TOKEN}"},
    json={
        "title":    "Vacuum alert",
        "log_type": 0,
        "is_auto":  True,
        "format_fields": {
            "pressure_ch1": {"value": 9.9e-4, "error": 0},
            "body": "Ch1 pressure exceeds threshold",
        },
    }
)
\`\`\`
`
}

function buildSystemMdKo(origin) {
  return `# elog System 통합 스펙

저는 **lilak_elog** 전자 로그북에 연동되는 **System**을 만들고 있습니다.
System은 run을 자율적으로 관리하며 API token으로 elog에 직접 로그를 push하는 외부 프로그램입니다.

현재 elog 서버 주소 (참고용): \`${origin}\`
> ⚠ 이 주소를 코드에 직접 쓰지 마세요. 환경변수 \`ELOG_URL\`로 관리하세요.

---

## 1. 개념

- elog가 데이터를 요청하는 것이 아니라, System이 스스로 run 시작/중지 시 elog로 로그를 push합니다.
- 선택적으로 Command URL을 등록하면 elog가 이 시스템에 run 명령을 보낼 수 있습니다.
- 예시: Detector DAQ, Beam Counting DAQ, Trigger System
- 필수: Name, API Token / 선택: Command URL

## 2. 자동 생성 포맷

시스템 등록 시 자동으로 4개의 포맷이 만들어집니다:

| 포맷 이름 | task_type | run_type |
|----------|-----------|----------|
| Init of {Name} run | init_of_run | I |
| Start of {Name} run | start_of_run | S |
| End of {Name} run | end_of_run | E |
| Monitoring {Name} run | monitoring_run | M |

## 3. Handshake — 자동 등록 (권장)

시스템의 Command URL에서 handshake를 지원하면 자동 등록됩니다.

### Handshake 요청 (elog → system)
\`\`\`json
POST <command_url>
{
  "event": "elog_handshake",
  "elog_url": "http://elog-server:8000"
}
\`\`\`

### Handshake 응답 (system → elog)
\`\`\`json
{
  "name": "DetectorDAQ",
  "description": "Main detector DAQ",
  "hostname": "daq01.lab.local",
  "directory": "/opt/daq",
  "is_system": true,
  "log_fields": []
}
\`\`\`

### FastAPI 구현 (handshake + credentials + run 명령)
\`\`\`python
from fastapi import FastAPI
import json, pathlib

app = FastAPI()
CONFIG_FILE = pathlib.Path("elog_config.json")

@app.post("/elog-command")
def handle_elog(body: dict):
    event = body.get("event")
    if event == "elog_handshake":
        return {"name": "DetectorDAQ", "description": "Main detector DAQ",
                "hostname": "daq01.lab.local", "directory": "/opt/daq",
                "is_system": True, "log_fields": []}
    if event == "elog_credentials":
        CONFIG_FILE.write_text(json.dumps(
            {"elog_url": body["elog_url"], "elog_token": body["elog_token"]}, indent=2))
        return {"ok": True}
    if event == "start_run":
        start_run(body.get("run_number"))
    elif event == "stop_run":
        stop_run(body.get("run_number"))
    return {"ok": True}
\`\`\`

elog_config.json 읽어서 push:
\`\`\`python
import json, pathlib
cfg = json.loads(pathlib.Path("elog_config.json").read_text())
ELOG_URL   = cfg["elog_url"]
ELOG_TOKEN = cfg["elog_token"]
\`\`\`

## 3b. 수동 등록 — elog_service_setup.sh (handshake 미구현 시)

⚠ **이 스크립트는 elog가 제공하는 파일이 아닙니다. 직접 만들어야 합니다.**
Handshake를 구현하지 않을 경우, 아래 스크립트를 시스템 디렉토리에 만들고 실행한 뒤,
출력을 New Service 폼 상단의 "스크립트 출력 붙여넣기"에 붙여넣으세요.

**런처 단일 포트(8010)** 에만 접속하는 대화형 스크립트입니다. 프로젝트 목록 선택 → 로그인 → service/system/main 선택 → 로깅될 포맷·필드 미리보기 → 등록 → 시스템은 토큰을 받아 \`elog_config.json\` + \`elog_env.sh\`에 **프록시 URL**(\`http://host:8010/p/<project>\`)로 저장합니다. 내부 포트가 바뀌어도 안전합니다.

\`\`\`bash
${buildSetupScript(true)}
\`\`\`

(서비스와 달리 \`is_system: true\`, \`command_url\`을 사용하며, 시스템은 elog가 보내는 credentials를 받아 elog_config.json에 저장합니다.)

## 4. push 예제

> **token 취득 방법:** handshake를 구현하면 [등록] 클릭 시 ELOG_URL + ELOG_TOKEN이 Command URL로 자동 전송됩니다.
> 수동 등록 시에는 등록 완료 배너에서 token을 복사 후 직접 설정하세요.

**log_type 값:**
| log_type | 포맷 | run_type 자동 설정 |
|----------|------|--------------------|
| 0  | 일반 서비스 로그 | — |
| 11 | init_of_run | I |
| 12 | start_of_run | S |
| 13 | end_of_run | E |
| 14 | monitoring_run | M |

format_id 불필요 — token으로 서비스를 자동 인식합니다.

### curl
\`\`\`bash
ELOG_URL="<New Service 폼에서 복사>"
ELOG_TOKEN="<New Service 폼에서 복사>"

curl -X POST $ELOG_URL/api/logs \\
  -H "Authorization: Bearer $ELOG_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Run 55 started",
    "log_type": 12,
    "run_number": 55,
    "is_auto": true,
    "format_fields": {
      "trigger_rate_hz": { "value": 1234.5, "error": 12.0 }
    }
  }'
\`\`\`

### Python
\`\`\`python
import requests

ELOG_URL   = "<여기에 붙여넣기>"
ELOG_TOKEN = "<여기에 붙여넣기>"

def push_log(title, log_type, run_number, fields=None):
    requests.post(
        f"{ELOG_URL}/api/logs",
        headers={"Authorization": f"Bearer {ELOG_TOKEN}"},
        json={
            "title":      title,
            "log_type":   log_type,   # 11=init 12=start 13=end 14=monitoring
            "run_number": run_number,
            "is_auto":    True,
            "format_fields": fields or {},
        }
    )

push_log("Run 55 started", log_type=12, run_number=55,
         fields={"trigger_rate_hz": {"value": 1234.5, "error": 12.0}})
push_log("Run 55 ended",   log_type=13, run_number=55)
\`\`\`

## 5. Command URL (선택)

elog가 run 시작/중지 명령을 보낼 endpoint. 없어도 push는 동작합니다.

\`\`\`json
POST <Command URL>
{
  "command": "start_run" | "stop_run",
  "run_number": 55,
  "requested_at": "2026-05-29T13:42:11Z"
}
\`\`\`
200 OK 확인. 5초 타임아웃.

## 6. 전형적인 run 플로우

\`\`\`
[Detector DAQ]   → POST $ELOG_URL/api/logs  (run_type="S")
[elog]           → POST beam-daq/start  (Command URL)
                 → GET  vacuum/status   (Request URL)
[Beam DAQ]       → POST $ELOG_URL/api/logs  (run_type="S")
[elog]           → vacuum 응답으로 task log 작성
[Detector DAQ]   → POST $ELOG_URL/api/logs  (run_type="E")
\`\`\`
`
}

function buildServiceMdEn(origin) {
  return `# elog Service Integration Spec

I am building a **Service** to integrate with **lilak_elog**, an electronic logbook for physics labs.
A Service is an external program that responds to data requests from elog.

Current elog server (reference only): \`${origin}\`
> ⚠ Do not hardcode this URL. Store it as env var \`ELOG_URL\`.

---

## 1. Concept

When elog creates a task log or a user clicks [Request Now], it POSTs to the registered **Request URL**.
The service responds with current readings; elog fills the log with that data.

- Examples: vacuum gauges, HV modules, actuator positions, temperature sensors
- Required: Name, Request URL

## 2. HTTP webhook contract

### Request body (elog → service)
\`\`\`json
{
  "format_id": 12,
  "format_name": "Vacuum readout",
  "task_log_id": 9382,
  "requested_at": "2026-05-29T13:42:11Z",
  "mode": "task" | "snapshot" | "realtime"
}
\`\`\`

### Response body (service → elog)
\`\`\`json
{
  "fields": {
    "pressure_ch1": { "value": 1.2e-6, "error": 0.1e-6 },
    "title": "Vacuum readout",
    "body": "All chambers nominal."
  }
}
\`\`\`

- Keys in \`fields\` must match the field keys on the linked log format.
- 5-second timeout. On failure, elog converts to manual task and auto-comments the error.

## 3. Handshake — service registration (required)

**Handshake is required for a service.** It must declare its \`log_fields\` at the handshake endpoint; on registration elog **always creates a \`"<name> log"\` format** from them. That format makes values editable, and \`metric\` fields become Infography variables. Pushing values without handshake/log_fields leaves them with no format — not editable, not plottable.

Implement a handshake endpoint, then the New Service form auto-registers by entering the URL and clicking [Discover].

### Handshake request (elog → service)
\`\`\`json
POST <request_url>
{
  "event": "elog_handshake",
  "elog_url": "http://elog-server:8000"
}
\`\`\`

### Handshake response (service → elog)
\`\`\`json
{
  "name": "Vacuum Monitor",
  "description": "RGA + ion gauge readout",
  "hostname": "vacuum01.lab.local",
  "directory": "/opt/vacuum",
  "is_system": false,
  "log_fields": [
    { "key": "pressure_ch1", "label": "Pressure Ch1 (Torr)", "type": "number_entry", "unit": "Torr", "metric": true },
    { "key": "pressure_ch2", "label": "Pressure Ch2 (Torr)", "type": "number_entry", "unit": "Torr", "metric": true },
    { "key": "body",         "label": "Summary",             "type": "body"         }
  ]
}
\`\`\`

\`type\` values: \`number_entry\` | \`number\` | \`text\` | \`body\` | \`title\` | \`tags\` | \`level\`
Multiple fields of the same type are allowed — differentiated by \`key\`.

**Important — add \`"metric": true\` to values you want in Infography (graph / sheet).**
Flagging a \`number\` / \`number_entry\` field with \`metric: true\` (plus optional \`unit\`) auto-registers the repeatedly-pushed value as an Infography variable usable in graphs and the sheet. Without \`metric\` it still shows in the log but is NOT available as a plot/sheet variable.
The service must also push with \`log_type: 0\` (or the matching format_id) so values link to this format — that's what makes them editable and registered as variables.

### FastAPI example (with handshake)
\`\`\`python
from fastapi import FastAPI

app = FastAPI()

@app.post("/status")
def endpoint(body: dict):
    if body.get("event") == "elog_handshake":
        return {
            "name": "Vacuum Monitor", "description": "RGA + ion gauge readout",
            "hostname": "vacuum01.lab.local", "directory": "/opt/vacuum",
            "is_system": False,
            "log_fields": [
                {"key": "pressure_ch1", "label": "Pressure Ch1 (Torr)", "type": "number_entry"},
                {"key": "body",         "label": "Summary",             "type": "body"},
            ],
        }
    p = read_pressure()
    return {"fields": {"pressure_ch1": {"value": p, "error": 0}, "body": f"{p:.2e} Torr"}}
\`\`\`

## 4. number_entry field

Always use \`{value, error}\`. Or raw form (elog auto-converts):
\`\`\`json
{ "single": 1.23 }
{ "min": 1.0, "max": 1.5 }
{ "values": [1.1, 1.2, 1.3] }
\`\`\`

## 5. Manual registration — elog_service_setup.sh (when handshake is not implemented)

⚠ **This script is NOT provided by elog. You must create it yourself.**
If you do not implement handshake, create the script below in your service directory and run it,
then paste its output into "paste script output" at the top of the New Service form to auto-fill the fields.

This script talks ONLY to the **launcher's single port (8010)**. When run, it ① lists projects (experiments) and lets you pick one ② logs in ③ lets you choose service / system / main-system ④ previews the formats (what will be logged) ⑤ registers via the API — systems receive a token and save \`elog_config.json\` with the **stable proxy URL** (\`http://host:8010/p/<project>\`). A project's internal port can change without breaking pushes.

\`\`\`bash
${buildSetupScript(false)}
\`\`\`

The script itself answers the handshake, so after you paste the URL into elog and click [Discover], the service is registered and the terminal shows "✓ Connected to elog!".

## 6. Pushing logs directly (optional)

Services can also push logs directly via API token.
Use \`log_type: 0\` to auto-link the format created during handshake.

\`\`\`python
import requests

ELOG_URL   = "<paste here>"
ELOG_TOKEN = "<paste here>"

requests.post(
    f"{ELOG_URL}/api/logs",
    headers={"Authorization": f"Bearer {ELOG_TOKEN}"},
    json={
        "title":    "Vacuum alert",
        "log_type": 0,
        "is_auto":  True,
        "format_fields": {
            "pressure_ch1": {"value": 9.9e-4, "error": 0},
            "body": "Ch1 pressure exceeds threshold",
        },
    }
)
\`\`\`
`
}

function buildSystemMdEn(origin) {
  return `# elog System Integration Spec

I am building a **System** to integrate with **lilak_elog**, an electronic logbook for physics labs.
A System autonomously manages runs and pushes logs directly to elog via API token.

Current elog server (reference only): \`${origin}\`
> ⚠ Do not hardcode this URL. Store it as env var \`ELOG_URL\`.

---

## 1. Concept

- The system pushes logs to elog at run start/stop — elog does not request data.
- Optionally register a Command URL so elog can send run commands to this system.
- Examples: Detector DAQ, Beam Counting DAQ, Trigger System
- Required: Name, API Token / Optional: Command URL

## 2. Auto-created formats

Registering a system named \`X\` auto-creates:

| Format name | task_type | run_type |
|-------------|-----------|----------|
| Init of X run | init_of_run | I |
| Start of X run | start_of_run | S |
| End of X run | end_of_run | E |
| Monitoring X run | monitoring_run | M |

## 3. Handshake — auto-registration (recommended)

Implement handshake in your Command URL endpoint — auto-registration from the New Service form.

### Handshake request (elog → system)
\`\`\`json
POST <command_url>
{
  "event": "elog_handshake",
  "elog_url": "http://elog-server:8000"
}
\`\`\`

### Handshake response (system → elog)
\`\`\`json
{
  "name": "DetectorDAQ",
  "description": "Main detector DAQ",
  "hostname": "daq01.lab.local",
  "directory": "/opt/daq",
  "is_system": true,
  "log_fields": []
}
\`\`\`

### FastAPI example (handshake + credentials + run commands)
\`\`\`python
from fastapi import FastAPI
import json, pathlib

app = FastAPI()
CONFIG_FILE = pathlib.Path("elog_config.json")

@app.post("/elog-command")
def handle_elog(body: dict):
    event = body.get("event")
    if event == "elog_handshake":
        return {"name": "DetectorDAQ", "description": "Main detector DAQ",
                "hostname": "daq01.lab.local", "directory": "/opt/daq",
                "is_system": True, "log_fields": []}
    if event == "elog_credentials":
        CONFIG_FILE.write_text(json.dumps(
            {"elog_url": body["elog_url"], "elog_token": body["elog_token"]}, indent=2))
        return {"ok": True}
    if event == "start_run":
        start_run(body.get("run_number"))
    elif event == "stop_run":
        stop_run(body.get("run_number"))
    return {"ok": True}
\`\`\`

Load credentials and push:
\`\`\`python
import json, pathlib
cfg = json.loads(pathlib.Path("elog_config.json").read_text())
ELOG_URL   = cfg["elog_url"]
ELOG_TOKEN = cfg["elog_token"]
\`\`\`

## 3b. Manual registration — elog_service_setup.sh (when handshake is not implemented)

⚠ **This script is NOT provided by elog. You must create it yourself.**
If you do not implement handshake, create the script below in your system directory and run it,
then paste its output into "paste script output" at the top of the New Service form.

An interactive script that talks ONLY to the **launcher's single port (8010)**. Pick a project → log in → choose service / system / main → preview the formats/fields that will be logged → register → systems receive a token and save \`elog_config.json\` + \`elog_env.sh\` with the **proxy URL** (\`http://host:8010/p/<project>\`). Internal port changes are safe.

\`\`\`bash
${buildSetupScript(true)}
\`\`\`

(Unlike a service, use \`is_system: true\` and \`command_url\`; the system also receives credentials from elog and stores them in elog_config.json.)

## 4. Pushing logs

> **Getting credentials:** With handshake, ELOG_URL + ELOG_TOKEN are automatically delivered to your Command URL when you click [Register].
> For manual registration, copy the token from the registration result banner and set it in your config.

> No format_id needed — elog resolves the format automatically from the token + log_type.

| log_type | Format | run_type (auto) |
|----------|--------|-----------------|
| 0  | Regular service log | — |
| 11 | init_of_run | I |
| 12 | start_of_run | S |
| 13 | end_of_run | E |
| 14 | monitoring_run | M |

### curl
\`\`\`bash
ELOG_URL="<paste from New Service form>"
ELOG_TOKEN="<paste from New Service form>"

curl -X POST $ELOG_URL/api/logs \\
  -H "Authorization: Bearer $ELOG_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{
    "title": "Run 55 started",
    "log_type": 12,
    "run_number": 55,
    "is_auto": true,
    "format_fields": {
      "trigger_rate_hz": { "value": 1234.5, "error": 12.0 }
    }
  }'
\`\`\`

### Python
\`\`\`python
import requests

ELOG_URL   = "<paste here>"
ELOG_TOKEN = "<paste here>"

def push_log(title, log_type, run_number, fields=None):
    requests.post(
        f"{ELOG_URL}/api/logs",
        headers={"Authorization": f"Bearer {ELOG_TOKEN}"},
        json={
            "title":      title,
            "log_type":   log_type,   # 11=init 12=start 13=end 14=monitoring
            "run_number": run_number,
            "is_auto":    True,
            "format_fields": fields or {},
        }
    )

push_log("Run 55 started", log_type=12, run_number=55,
         fields={"trigger_rate_hz": {"value": 1234.5, "error": 12.0}})
push_log("Run 55 ended",   log_type=13, run_number=55)
\`\`\`

## 5. Command URL (optional)

Endpoint for elog to send run start/stop commands. Push works without it.

\`\`\`json
POST <Command URL>
{
  "command": "start_run" | "stop_run",
  "run_number": 55,
  "requested_at": "2026-05-29T13:42:11Z"
}
\`\`\`
HTTP 200 expected. 5-second timeout.

## 6. Typical run flow

\`\`\`
[Detector DAQ]   → POST ${origin}/api/logs  (run_type="S")
[elog]           → POST beam-daq/start  (Command URL)
                 → GET  vacuum/status   (Request URL)
[Beam DAQ]       → POST ${origin}/api/logs  (run_type="S")
[elog]           → vacuum response → writes task log
[Detector DAQ]   → POST ${origin}/api/logs  (run_type="E")
\`\`\`
`
}

// ── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({ label, buildMd }) {
  const [copied, setCopied] = useState(false)
  const { t } = useLang()

  async function copy() {
    const md = buildMd()
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(md)
      } else {
        const ta = document.createElement('textarea')
        ta.value = md; ta.style.position = 'fixed'; ta.style.opacity = '0'
        document.body.appendChild(ta); ta.select()
        document.execCommand('copy'); document.body.removeChild(ta)
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch (e) {
      alert(t('exp_manual_copy_fail') + ': ' + (e?.message || e))
    }
  }

  return (
    <button onClick={copy}
            style={{ fontSize: 'var(--fs-small, 12px)', padding: '4px 10px', borderRadius: 8, cursor: 'pointer', borderWidth: 1, borderStyle: 'solid',
              backgroundColor: copied ? 'var(--success-bg)' : 'var(--surface-2)',
              borderColor: copied ? 'var(--success-text)' : 'var(--border-default)',
              color: copied ? 'var(--success-text)' : 'var(--text-secondary)' }}>
      {copied ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={12} weight="bold" /> Copied</span> : label}
    </button>
  )
}

// ── Section divider with copy button ─────────────────────────────────────────

function ManualChapter({ title, children }) {
  return (
    <Stack gap={4}>
      <div style={{ paddingTop: 8, paddingBottom: 4, borderBottomWidth: 2, borderBottomStyle: 'solid', borderBottomColor: 'var(--border-default)' }}>
        <h2 style={{ margin: 0, fontSize: 'var(--fs-body, 13px)', fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h2>
      </div>
      <Stack gap={4}>{children}</Stack>
    </Stack>
  )
}

// ── Modal shell ──────────────────────────────────────────────────────────────

export default function ServiceManualModal({ onClose }) {
  const { t, lang } = useLang()
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:8010'

  return (
    <Modal title={t('exp_manual_title')} width={680} onClose={onClose}>
      <Stack gap={24}>
        <Row gap={8} wrap>
          <CopyButton label="Copy for AI (Service)" buildMd={() => lang === 'ko' ? buildServiceMdKo(origin) : buildServiceMdEn(origin)} />
          <CopyButton label="Copy for AI (System)" buildMd={() => lang === 'ko' ? buildSystemMdKo(origin) : buildSystemMdEn(origin)} />
        </Row>

        <ManualChapter title="Service">
          {lang === 'ko' ? <ServiceManualKo origin={origin} /> : <ServiceManualEn origin={origin} />}
        </ManualChapter>

        <ManualChapter title="System">
          {lang === 'ko' ? <SystemManualKo origin={origin} /> : <SystemManualEn origin={origin} />}
        </ManualChapter>

        <p style={{ paddingTop: 8, fontSize: 'var(--fs-micro, 10px)', textAlign: 'center', color: 'var(--text-muted)' }}>{t('exp_manual_footer')}</p>
      </Stack>
    </Modal>
  )
}
