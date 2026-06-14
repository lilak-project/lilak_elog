/**
 * ExperimentPage — Phase 1b shell.
 *
 *  • Lists every Service registered in the current experiment.
 *  • Managers see a "+ New service" button to add one.
 *  • Each row expands inline so you can read/edit the basic info.
 *  • The detail/action buttons (request-now, real-time, etc.) come in Phase 7;
 *    they're rendered here as disabled placeholders so the layout is ready.
 *
 *  Subsystems and ordinary services live in the same list — the row badges
 *  distinguish them visually.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { Icon, Button, Input, Badge, Row, Stack, Callout, CopyField, Modal, useTaggables } from 'lilak-ui'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { modalFrame, inputBase } from '../theme/uiStyles'
import ServiceManualModal from './experiment/ServiceManualModal'
import ManageTasksModal from '../components/ManageTasksModal'
import { useTab } from '../context/TabContext'

const fieldInputStyle = { ...inputBase, width: '100%', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--input-border)', borderRadius: 8, padding: '8px 12px', fontSize: 'var(--fs-body, 13px)', outline: 'none', boxSizing: 'border-box' }
const fieldLabelStyle = { display: 'block', fontSize: 'var(--fs-tiny, 11px)', fontWeight: 500, marginBottom: 4, color: 'var(--text-secondary)' }

// ── Format sort order helper ─────────────────────────────────────────────────
const TASK_TYPE_ORDER = ['init_of_run', 'start_of_run', 'end_of_run', 'monitoring_run']
const SYSTEM_TASK_TYPES = new Set(['init_of_run', 'start_of_run', 'end_of_run', 'monitoring_run'])

function sortFormats(formats) {
  return [...formats].sort((a, b) => {
    const ai = TASK_TYPE_ORDER.indexOf(a.task_type)
    const bi = TASK_TYPE_ORDER.indexOf(b.task_type)
    if (ai !== -1 && bi !== -1) return ai - bi
    if (ai !== -1) return -1
    if (bi !== -1) return 1
    return a.name.localeCompare(b.name)
  })
}

// ── elog server address info box ────────────────────────────────────────────

// ── Registration text parser ─────────────────────────────────────────────────
function parseRegistration(text) {
  const lines = text.split('\n')
  const result = {}
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colon = trimmed.indexOf(':')
    if (colon === -1) continue
    const key = trimmed.slice(0, colon).trim().toLowerCase()
    const val = trimmed.slice(colon + 1).trim()
    result[key] = val
  }
  return result
}

// ── 시스템 등록 완료 배너 (kit Callout + CopyField) ──────────────────────────
function RegisterResultBanner({ result, onClose }) {
  return (
    <Callout tone="success" title={`${result.name} 등록 완료`} icon="check"
      right={<button onClick={onClose} style={{ fontSize: 'var(--fs-tiny, 11px)', padding: '1px 8px', borderRadius: 6, border: '1px solid var(--border-default)', background: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>닫기</button>}>
      <Stack gap={10} style={{ padding: '10px 12px 12px' }}>
        {result.credentials_sent === true && (
          <p style={{ margin: 0, fontSize: 'var(--fs-small, 12px)', color: 'var(--success-text)' }}>
            <Icon name="check" size={13} weight="bold" style={{ verticalAlign: -2 }} /> Credentials를 Command URL로 전송했습니다
            {result.command_url && <span style={{ fontFamily: 'var(--font-mono)', marginLeft: 4, opacity: 0.7 }}>({result.command_url})</span>}
          </p>
        )}
        {result.credentials_sent === false && (
          <Stack gap={2} style={{ fontSize: 'var(--fs-small, 12px)' }}>
            <p style={{ margin: 0, color: 'var(--warning-text)' }}>
              <Icon name="warning" weight="fill" size={12} style={{ verticalAlign: -2 }} /> Credentials 전송 실패 — Command URL 서버가 실행 중인지 확인하세요
            </p>
            {result.credentials_error && <p style={{ margin: 0, fontFamily: 'var(--font-mono)', opacity: 0.7, color: 'var(--text-muted)' }}>{result.credentials_error}</p>}
            <p style={{ margin: 0, color: 'var(--text-secondary)' }}>서버 실행 후 서비스 상세 화면에서 [Send credentials]를 다시 누를 수 있습니다.</p>
          </Stack>
        )}
        <div>
          <p style={{ margin: '0 0 4px', fontSize: 'var(--fs-small, 12px)', fontWeight: 500, color: 'var(--text-secondary)' }}>API Token — 지금 복사해두세요. 이후 다시 확인할 수 없습니다.</p>
          <CopyField value={result.token} labels={{ copy: '복사', copied: '복사됨' }} />
        </div>
      </Stack>
    </Callout>
  )
}

// ── Service form (create + edit) ─────────────────────────────────────────────
function ServiceForm({ initial, formats, onSave, onCancel, busy, t, isManager, hasMainSystem }) {
  const isEdit = !!initial?.id
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')

  // Discover (handshake) state — new service only
  // status: 'idle' | 'loading' | 'ok' | 'error'
  const [discoverUrl, setDiscoverUrl] = useState('')
  const [discoverState, setDiscoverState] = useState({ status: 'idle', error: null, fields: null })
  const [showManual, setShowManual] = useState(false)

  const [form, setForm] = useState(() => ({
    name:        initial?.name        || '',
    description: initial?.description || '',
    hostname:    initial?.hostname || initial?.ip || '',
    directory:   initial?.directory   || '',
    request_url: initial?.request_url || '',
    is_system: !!(initial?.is_system ?? initial?.is_subsystem),
    is_main_system: !!initial?.is_main_system,
    max_interval_sec:      initial?.max_interval_sec      ?? '',
    realtime_interval_sec: initial?.realtime_interval_sec ?? '',
    request_required: initial?.request_required === true,
    format_ids: initial?.format_ids || [],
    is_active:  initial?.is_active !== false,
  }))

  function set(k, v) { setForm(p => ({ ...p, [k]: v })) }

  async function runDiscover() {
    if (!discoverUrl.trim()) return
    setDiscoverState({ status: 'loading', error: null, fields: null })
    try {
      const res = await api.post('/services/discover', {
        url: discoverUrl.trim(),
        elog_url: typeof window !== 'undefined' ? window.location.origin : '',
      })
      if (res.data.ok) {
        const d = res.data.data
        const isSystem = !!(d.is_system)
        setForm(p => ({
          ...p,
          name:        d.name        || p.name,
          description: d.description || p.description,
          hostname:    d.hostname    || p.hostname,
          directory:   d.directory   || p.directory,
          request_url: discoverUrl.trim(),
          is_system:   isSystem,
        }))
        setDiscoverState({ status: 'ok', error: null, fields: d.log_fields || [] })
        setShowManual(false)
      } else {
        setDiscoverState({ status: 'error', error: res.data.error || 'Handshake failed', fields: null })
        setShowManual(true)
      }
    } catch (e) {
      setDiscoverState({ status: 'error', error: e.response?.data?.detail || e.message || 'Request failed', fields: null })
      setShowManual(true)
    }
  }

  function applyPaste() {
    const parsed = parseRegistration(pasteText)
    if (!parsed.name) return
    const isSystem = parsed.is_system === 'true'
    setForm(p => ({
      ...p,
      name:        parsed.name        || p.name,
      description: parsed.description || p.description,
      hostname:    parsed.hostname    || p.hostname,
      directory:   parsed.directory   || p.directory,
      request_url: parsed.request_url || parsed.command_url || p.request_url,
      is_system:   'is_system' in parsed ? isSystem : p.is_system,
    }))
    setPasteOpen(false)
    setPasteText('')
  }

  // When toggling to system, auto-check all system-task-type formats belonging to this service
  function setIsSystem(val) {
    setForm(p => {
      if (!val) return { ...p, is_system: false }
      const sysFormatIds = (formats ?? [])
        .filter(f => SYSTEM_TASK_TYPES.has(f.task_type) && (f.system_id === initial?.id || f.subsystem_id === initial?.id))
        .map(f => f.id)
      const merged = [...new Set([...p.format_ids, ...sysFormatIds])]
      return { ...p, is_system: true, format_ids: merged }
    })
  }

  function toggleFormat(id) {
    setForm(p => ({
      ...p,
      format_ids: p.format_ids.includes(id)
        ? p.format_ids.filter(x => x !== id)
        : [...p.format_ids, id],
    }))
  }

  // API token generation (for systems only)
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const [tokenState, setTokenState] = useState({ token: null, loading: false, copiedToken: false, copiedConfig: false })

  async function generateToken() {
    const name = form.name.trim() || 'system'
    setTokenState(s => ({ ...s, loading: true }))
    try {
      const res = await api.post('/tokens', { name, source_name: name })
      setTokenState({ token: res.data.token, loading: false, copiedToken: false, copiedConfig: false })
    } catch {
      setTokenState(s => ({ ...s, loading: false }))
    }
  }

  function copyToken() {
    if (!tokenState.token) return
    navigator.clipboard.writeText(tokenState.token)
    setTokenState(s => ({ ...s, copiedToken: true }))
    setTimeout(() => setTokenState(s => ({ ...s, copiedToken: false })), 2000)
  }

  function copyConfig() {
    if (!tokenState.token) return
    const cfg = `ELOG_URL   = "${origin}"\nELOG_TOKEN = "${tokenState.token}"`
    navigator.clipboard.writeText(cfg)
    setTokenState(s => ({ ...s, copiedConfig: true }))
    setTimeout(() => setTokenState(s => ({ ...s, copiedConfig: false })), 2000)
  }

  async function sendCredentials() {
    if (!tokenState.token || !form.request_url) return
    setTokenState(s => ({ ...s, sending: true, sendResult: null }))
    try {
      await fetch(form.request_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'elog_credentials',
          elog_url: origin,
          elog_token: tokenState.token,
        }),
      })
      setTokenState(s => ({ ...s, sending: false, sendResult: 'ok' }))
    } catch {
      setTokenState(s => ({ ...s, sending: false, sendResult: 'err' }))
    }
    setTimeout(() => setTokenState(s => ({ ...s, sendResult: null })), 3000)
  }

  function submit(e) {
    e.preventDefault()
    onSave({
      ...form,
      max_interval_sec: form.request_required
        ? (form.max_interval_sec === '' ? null : Number(form.max_interval_sec))
        : null,
      realtime_interval_sec: form.realtime_interval_sec === '' ? null : Number(form.realtime_interval_sec),
      // Include discovered log_fields so the backend auto-creates the log format
      log_fields: (!isEdit && discoverState.status === 'ok' && discoverState.fields?.length)
        ? discoverState.fields
        : undefined,
      // 프론트엔드가 알고 있는 실제 elog 서버 주소 (credentials 전송 시 사용)
      elog_url: origin,
    })
  }

  // Formats visible to this form:
  // - Non-system task types: always shown
  // - System task types: only shown for systems, and only if tied to THIS service (not global)
  const thisId = initial?.id
  const visibleFormats = sortFormats(
    (formats ?? []).filter(f => {
      if (!SYSTEM_TASK_TYPES.has(f.task_type)) return true
      if (!form.is_system) return false
      const owner = f.system_id || f.subsystem_id
      return owner && owner === thisId
    })
  )

  const req = <span style={{ color: 'var(--error-text, #ef4444)' }}>*</span>
  const opt = <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}> (optional)</span>

  return (
    <form onSubmit={submit}
          onKeyDown={(e) => {
            if (e.key === 'Escape') { e.stopPropagation(); onCancel?.() }
            else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(e) }
          }}
          style={{ ...modalFrame, border: '1px solid var(--border-default)', borderRadius: 12, boxShadow: '0 1px 2px rgba(0,0,0,0.04)', padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <h3 style={{ margin: 0, fontWeight: 600, color: 'var(--text-secondary)' }}>{isEdit ? t('exp_form_edit') : t('exp_form_new')}</h3>

      {/* ── Discover (handshake) — new service only ── */}
      {!isEdit && (
        <Stack gap={8}>
          <Row gap={8} align="end">
            <div style={{ flex: 1 }}>
              <label style={fieldLabelStyle}>URL <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(endpoint to discover)</span></label>
              <input value={discoverUrl} onChange={e => setDiscoverUrl(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); runDiscover() } }}
                placeholder="http://myserver.local:8080/elog-command" style={fieldInputStyle} />
            </div>
            <Button type="button" size="md" disabled={!discoverUrl.trim() || discoverState.status === 'loading'} onClick={runDiscover}>
              {discoverState.status === 'loading' ? '...' : 'Discover'}
            </Button>
          </Row>

          {discoverState.status === 'ok' && (
            <Stack gap={4} style={{ borderRadius: 8, border: '1px solid var(--success-text)', padding: '8px 12px', fontSize: 'var(--fs-small, 12px)', backgroundColor: 'var(--success-bg)' }}>
              <p style={{ margin: 0, fontWeight: 500, color: 'var(--success-text)' }}><Icon name="check" size={12} weight="bold" style={{ verticalAlign: -2 }} /> Handshake successful — form auto-filled</p>
              {discoverState.fields?.length > 0 && (
                <div>
                  <p style={{ margin: 0, color: 'var(--text-secondary)' }}>Log format "{form.name || '…'} log" will be auto-created with {discoverState.fields.length} field(s):</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 4 }}>
                    {discoverState.fields.map((f, i) => (
                      <span key={i} style={{ fontFamily: 'var(--font-mono)', padding: '2px 6px', borderRadius: 4, fontSize: 'var(--fs-micro, 10px)', backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', border: '1px solid var(--border-default)' }}>
                        {f.label} <span style={{ color: 'var(--text-muted)' }}>({f.type})</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {discoverState.fields?.length === 0 && <p style={{ margin: 0, color: 'var(--text-muted)' }}>No log fields declared — no format will be auto-created.</p>}
            </Stack>
          )}

          {discoverState.status === 'error' && (
            <Stack gap={4} style={{ borderRadius: 8, border: '1px solid var(--danger-text)', padding: '8px 12px', fontSize: 'var(--fs-small, 12px)', backgroundColor: 'var(--danger-bg)' }}>
              <Row justify="between" align="center">
                <p style={{ margin: 0, fontWeight: 500, color: 'var(--danger-text)' }}><Icon name="close" size={12} weight="bold" style={{ verticalAlign: -2 }} /> Handshake failed: {discoverState.error}</p>
                <button type="button" onClick={runDiscover} style={{ flexShrink: 0, marginLeft: 8, padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border-default)', background: 'none', cursor: 'pointer', fontSize: 'var(--fs-micro, 10px)', color: 'var(--text-secondary)' }}>Retry</button>
              </Row>
              <p style={{ margin: 0, color: 'var(--text-muted)' }}>Fill the form manually below, or fix the endpoint and retry.</p>
            </Stack>
          )}

          {/* Paste from script — collapsible fallback */}
          <div style={{ borderRadius: 8, borderWidth: 1, borderStyle: 'solid', borderColor: pasteOpen ? 'var(--border-focus)' : 'var(--border-default)', overflow: 'hidden' }}>
            <button type="button" onClick={() => setPasteOpen(v => !v)}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', fontSize: 'var(--fs-small, 12px)', fontWeight: 500, cursor: 'pointer', border: 'none', backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
              <span>📋 또는 스크립트 출력 붙여넣기 (elog_service_setup.sh)</span>
              <span style={{ color: 'var(--text-muted)' }}>{pasteOpen ? '▲' : '▼'}</span>
            </button>
            {pasteOpen && (
              <Stack gap={8} style={{ padding: 12, borderTop: '1px solid var(--border-default)' }}>
                <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} rows={5}
                  placeholder={`# elog-registration\nname: My Service\nhostname: myserver.local\ndirectory: /opt/myservice\nis_system: false\nrequest_url: http://myserver.local:8765/webhook`}
                  style={{ ...inputBase, width: '100%', fontSize: 'var(--fs-tiny, 11px)', fontFamily: 'var(--font-mono)', border: '1px solid var(--border-default)', borderRadius: 8, padding: '6px 8px', resize: 'none', outline: 'none', boxSizing: 'border-box' }} />
                <Row gap={8}>
                  <Button type="button" disabled={!pasteText.trim()} onClick={applyPaste} style={{ flex: 1 }}>필드 채우기</Button>
                  <Button type="button" variant="secondary" onClick={() => { setPasteOpen(false); setPasteText('') }}>취소</Button>
                </Row>
              </Stack>
            )}
          </div>
        </Stack>
      )}

      {/* ── System toggle (top) ── */}
      <Stack gap={6}>
        <Row gap={8}>
          <input id="svc-system" type="checkbox" checked={form.is_system} onChange={e => setIsSystem(e.target.checked)} />
          <label htmlFor="svc-system" style={{ fontSize: 'var(--fs-body, 13px)', fontWeight: 500, color: 'var(--text-secondary)' }}>{t('exp_field_subsystem')}</label>
        </Row>
        {form.is_system && (
          <Row gap={8} style={{ marginLeft: 20 }}>
            <input id="svc-main-system" type="checkbox" checked={form.is_main_system} disabled={!form.is_main_system && hasMainSystem} onChange={e => set('is_main_system', e.target.checked)} />
            <label htmlFor="svc-main-system" style={{ fontSize: 'var(--fs-body, 13px)', color: (!form.is_main_system && hasMainSystem) ? 'var(--text-muted)' : 'var(--text-secondary)', cursor: (!form.is_main_system && hasMainSystem) ? 'not-allowed' : 'pointer' }}>
              Main system
              {!form.is_main_system && hasMainSystem && <span style={{ marginLeft: 8, fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>(메인 시스템이 이미 등록되어 있음)</span>}
            </label>
          </Row>
        )}
      </Stack>

      {/* ── Required fields ── */}
      <div>
        <label style={fieldLabelStyle}>
          {t('exp_field_name')} {req}
        </label>
        <input value={form.name}
               onChange={e => set('name', e.target.value)}
               required autoFocus
               style={fieldInputStyle} />
      </div>

      <div>
        <label style={fieldLabelStyle}>
          {form.is_system
            ? <><span>Command URL</span>{opt}</>
            : <>{t('exp_field_request_url')} {req}</>}
        </label>
        <input value={form.request_url}
               onChange={e => set('request_url', e.target.value)}
               placeholder={form.is_system
                 ? 'http://myserver.local:8080/command-endpoint'
                 : 'http://myserver.local:8080/your-webhook-endpoint'}
               style={fieldInputStyle} />
        <p style={{ margin: '4px 0 0', fontSize: 'var(--fs-tiny, 11px)', color: 'var(--text-muted)' }}>
          {form.is_system ? 'elog이 이 시스템에 run 시작/중지 명령을 보낼 때 사용' : 'elog이 이 서비스에 데이터를 요청할 때 사용'}
        </p>
      </div>

      {/* 신규 시스템: 등록 시 token 자동발급 + credentials 자동전송 안내 */}
      {form.is_system && isManager && !isEdit && (
        <p style={{ margin: 0, fontSize: 'var(--fs-small, 12px)', padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border-default)', color: 'var(--text-muted)', backgroundColor: 'var(--surface-2)' }}>
          🔑 등록 시 API Token이 자동으로 발급되고, Command URL이 있으면 credentials가 자동 전송됩니다.
        </p>
      )}

      {/* ── API Token + elog config (시스템 편집 시만 표시, 신규 등록은 자동) ── */}
      {form.is_system && isManager && isEdit && (
        <Stack gap={8} style={{ borderRadius: 8, border: '1px solid var(--border-default)', padding: 12, backgroundColor: 'var(--surface-2)' }}>
          <Row justify="between" align="center">
            <span style={{ fontSize: 'var(--fs-small, 12px)', fontWeight: 500, color: 'var(--text-secondary)' }}>API Token {req}</span>
            <button type="button" onClick={generateToken} disabled={tokenState.loading}
              style={{ fontSize: 'var(--fs-small, 12px)', padding: '4px 10px', borderRadius: 4, fontWeight: 500, border: '1px solid var(--border-default)', background: 'none', cursor: 'pointer', opacity: tokenState.loading ? 0.5 : 1, color: 'var(--text-secondary)' }}>
              {tokenState.loading ? '...' : tokenState.token ? 'Regenerate' : 'Generate Token'}
            </button>
          </Row>

          {tokenState.token ? (
            <>
              <div style={{ borderRadius: 4, border: '1px solid var(--border-default)', overflow: 'hidden' }}>
                <Row justify="between" align="center" style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-default)', backgroundColor: 'var(--surface-3)' }}>
                  <span style={{ fontSize: 'var(--fs-micro, 10px)', fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>system config</span>
                  <button type="button" onClick={copyConfig} style={{ fontSize: 'var(--fs-micro, 10px)', padding: '2px 8px', borderRadius: 4, border: '1px solid var(--border-default)', background: 'none', cursor: 'pointer', color: tokenState.copiedConfig ? 'var(--success-text)' : 'var(--text-secondary)' }}>
                    {tokenState.copiedConfig ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={12} weight="bold" /> Copied</span> : 'Copy config'}
                  </button>
                </Row>
                <pre style={{ margin: 0, fontSize: 'var(--fs-tiny, 11px)', fontFamily: 'var(--font-mono)', padding: '8px 12px', lineHeight: 1.6, backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
{`ELOG_URL   = "${origin}"
ELOG_TOKEN = "${tokenState.token}"`}
                </pre>
              </div>
              <Row gap={8} align="center">
                <span style={{ fontSize: 'var(--fs-micro, 10px)', flex: 1, color: 'var(--text-muted)' }}>Token only:</span>
                <code style={{ fontSize: 'var(--fs-tiny, 11px)', fontFamily: 'var(--font-mono)', padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border-default)', flexShrink: 1, minWidth: 0, overflowX: 'auto', backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>{tokenState.token}</code>
                <button type="button" onClick={copyToken} style={{ flexShrink: 0, fontSize: 'var(--fs-small, 12px)', padding: '4px 8px', borderRadius: 4, border: '1px solid var(--border-default)', background: 'none', cursor: 'pointer', color: tokenState.copiedToken ? 'var(--success-text)' : 'var(--text-secondary)' }}>
                  {tokenState.copiedToken ? <Icon name="check" size={12} weight="bold" /> : 'Copy'}
                </button>
              </Row>
              {form.request_url && (
                <Row gap={8} align="center">
                  <button type="button" onClick={sendCredentials} disabled={tokenState.sending}
                    style={{ fontSize: 'var(--fs-small, 12px)', padding: '4px 10px', borderRadius: 4, background: 'none', cursor: 'pointer', opacity: tokenState.sending ? 0.5 : 1,
                      borderWidth: 1, borderStyle: 'solid', borderColor: tokenState.sendResult === 'ok' ? 'var(--success-text)' : tokenState.sendResult === 'err' ? 'var(--danger-text)' : 'var(--border-default)',
                      color: tokenState.sendResult === 'ok' ? 'var(--success-text)' : tokenState.sendResult === 'err' ? 'var(--danger-text)' : 'var(--text-secondary)' }}>
                    {tokenState.sending ? '전송 중...'
                      : tokenState.sendResult === 'ok' ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={12} weight="bold" /> 전송됨</span>
                      : tokenState.sendResult === 'err' ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="close" size={12} weight="bold" /> 전송 실패</span>
                      : `Send credentials → ${form.request_url}`}
                  </button>
                  <span style={{ fontSize: 'var(--fs-micro, 10px)', color: 'var(--text-muted)' }}>Command URL로 ELOG_URL + ELOG_TOKEN 전송</span>
                </Row>
              )}
              <p style={{ margin: 0, fontSize: 'var(--fs-micro, 10px)', color: 'var(--text-muted)' }}><Icon name="warning" weight="fill" size={12} style={{ verticalAlign: -2 }} /> 지금 복사해두세요 — 이 폼을 닫으면 token을 다시 확인할 수 없습니다.</p>
            </>
          ) : (
            <p style={{ margin: 0, fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>시스템은 API token으로 elog에 로그를 push합니다. 발급하면 elog 서버 주소와 함께 복사할 수 있습니다.</p>
          )}
        </Stack>
      )}

      {/* ── Optional fields ── */}
      <div>
        <label style={fieldLabelStyle}>
          {t('exp_field_description')}{opt}
        </label>
        <input value={form.description}
               onChange={e => set('description', e.target.value)}
               style={fieldInputStyle} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: 12 }}>
        <div>
          <label style={fieldLabelStyle}>{t('exp_field_hostname') || 'Host name'}{opt}</label>
          <input value={form.hostname} onChange={e => set('hostname', e.target.value)} placeholder="myserver.local" style={fieldInputStyle} />
        </div>
        <div>
          <label style={fieldLabelStyle}>{t('exp_field_directory')}{opt}</label>
          <input value={form.directory} onChange={e => set('directory', e.target.value)} placeholder="/opt/hv_module" style={fieldInputStyle} />
        </div>
      </div>

      <Stack gap={8}>
        <Row gap={8}>
          <input id="svc-req-required" type="checkbox" checked={form.request_required} onChange={e => set('request_required', e.target.checked)} />
          <label htmlFor="svc-req-required" style={{ fontSize: 'var(--fs-body, 13px)', color: 'var(--text-secondary)' }}>Periodic request required</label>
        </Row>
        {form.request_required && (
          <div>
            <label style={fieldLabelStyle}>{t('exp_field_max_interval')}</label>
            <input type="number" min="0" value={form.max_interval_sec} onChange={e => set('max_interval_sec', e.target.value)} placeholder="3600" style={fieldInputStyle} />
          </div>
        )}
      </Stack>

      <div>
        <label style={fieldLabelStyle}>{t('exp_field_formats')}</label>
        {visibleFormats.length === 0 ? (
          <p style={{ margin: 0, fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>{t('exp_no_formats')}</p>
        ) : (
          <Stack gap={4} style={{ maxHeight: 160, overflowY: 'auto', border: '1px solid var(--border-default)', borderRadius: 8, padding: 8 }}>
            {visibleFormats.map(f => (
              <label key={f.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--fs-small, 12px)', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.format_ids.includes(f.id)} onChange={() => toggleFormat(f.id)} />
                <span style={{ color: 'var(--text-primary)' }}>{f.name}</span>
                <span style={{ fontSize: 'var(--fs-micro, 10px)', padding: '2px 4px', borderRadius: 4, fontFamily: 'var(--font-mono)', backgroundColor: f.format_type === 'system' ? 'var(--info-bg)' : 'var(--surface-2)', color: f.format_type === 'system' ? 'var(--info-text)' : 'var(--text-secondary)' }}>{f.format_type || 'user'}</span>
                {f.task_type && <span style={{ fontSize: 'var(--fs-micro, 10px)', padding: '2px 4px', borderRadius: 4, fontFamily: 'var(--font-mono)', backgroundColor: 'var(--warning-bg)', color: 'var(--warning-text)' }}>{f.task_type.replace(/_/g, ' ')}</span>}
                {(f.system_id || f.subsystem_id) && <span title="이 포멧은 system 서비스 등록 시 자동 생성됨" style={{ fontSize: 'var(--fs-micro, 10px)', padding: '2px 4px', borderRadius: 4, backgroundColor: 'var(--surface-3)', color: 'var(--text-muted)' }}>auto</span>}
              </label>
            ))}
          </Stack>
        )}
      </div>

      <Row gap={8} style={{ paddingTop: 8 }}>
        <Button type="submit" size="md" disabled={busy} style={{ flex: 1 }}>{busy ? t('exp_btn_saving') : isEdit ? t('exp_btn_save') : t('exp_btn_register')}</Button>
        <Button type="button" variant="secondary" size="md" onClick={onCancel}>{t('exp_btn_cancel')}</Button>
      </Row>
    </form>
  )
}

// ── Module row (collapsible, with live realtime) ──────────────────────────────
const MAX_HISTORY = 60   // keep last 60 data points (~30s at 0.5s interval)

function ModuleRow({ mod, busy, intervalVal, onIntervalChange, onIntervalSave, onToggle, isManager, onOpenLog, t }) {
  const [open, setOpen] = useState(false)
  const [liveData, setLiveData] = useState(null)        // {key: value} latest sample
  const [history, setHistory] = useState([])            // [{t, key: value}, ...] for graph
  const [liveActive, setLiveActive] = useState(false)
  const [liveError, setLiveError] = useState(null)
  const [logResult, setLogResult] = useState(null)      // {id, log_index} after Request Log
  const liveTimerRef = useRef(null)

  // Start / stop 0.5s polling — only updates liveData + history, never writes a log
  useEffect(() => {
    if (!liveActive) {
      if (liveTimerRef.current) { clearInterval(liveTimerRef.current); liveTimerRef.current = null }
      return
    }
    async function tick() {
      try {
        const r = await api.post(`/modules/${mod.id}/collect`)
        const data = r.data
        setLiveData(data)
        setLiveError(null)
        const now = Date.now()
        setHistory(prev => {
          const point = { t: now }
          for (const [k, v] of Object.entries(data)) {
            point[k] = typeof v === 'object' ? (v?.value ?? null) : v
          }
          const next = [...prev, point]
          return next.length > MAX_HISTORY ? next.slice(next.length - MAX_HISTORY) : next
        })
      } catch (e) {
        setLiveError(e.response?.data?.detail || 'collect error')
      }
    }
    tick()
    liveTimerRef.current = setInterval(tick, 500)
    return () => { clearInterval(liveTimerRef.current); liveTimerRef.current = null }
  }, [liveActive, mod.id])

  // Stop live + clear when row collapses
  useEffect(() => {
    if (!open) { setLiveActive(false); setLiveData(null); setHistory([]) }
  }, [open])

  const bigNumbers = (data, color, size) => (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: size === 3 ? 24 : 16 }}>
      {Object.entries(data).map(([k, v]) => {
        const display = typeof v === 'object' ? (v?.value ?? JSON.stringify(v)) : v
        return (
          <div key={k} style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <span style={{ fontSize: size === 3 ? 30 : 24, fontFamily: 'var(--font-mono)', fontWeight: 700, lineHeight: 1, color }}>{display}</span>
            <span style={{ fontSize: 'var(--fs-micro, 10px)', marginTop: size === 3 ? 4 : 2, color, opacity: size === 3 ? 0.7 : 1 }}>{k}</span>
          </div>
        )
      })}
    </div>
  )

  return (
    <div style={{ borderWidth: 1, borderStyle: 'solid', borderColor: open ? 'var(--border-focus)' : 'var(--border-default)', borderRadius: 12, overflow: 'hidden' }}>
      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'stretch' }}>
        <button type="button" onClick={() => setOpen(o => !o)}
          style={{ flex: 1, textAlign: 'left', padding: 12, cursor: 'pointer', background: 'var(--surface-2)', border: 'none' }}
          onMouseEnter={e => e.currentTarget.style.background = 'var(--surface-3)'} onMouseLeave={e => e.currentTarget.style.background = 'var(--surface-2)'}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon name={open ? 'caret-down' : 'caret-right'} size={12} style={{ color: 'var(--text-muted)' }} />
            <span style={{ fontSize: 'var(--fs-micro, 10px)', fontFamily: 'var(--font-mono)', padding: '1px 6px', borderRadius: 4, textTransform: 'uppercase', backgroundColor: 'var(--surface-3)', color: 'var(--text-muted)' }}>module</span>
            <span style={{ fontSize: 'var(--fs-medium, 14px)', fontWeight: 500, color: 'var(--text-primary)' }}>{mod.name}</span>
            {liveActive && <Badge tone="success" mono dot>LIVE</Badge>}
          </div>
        </button>
        <button onClick={() => onToggle()} disabled={busy} title={mod.enabled ? 'Disable' : 'Enable'}
          style={{ flexShrink: 0, padding: '0 14px', cursor: 'pointer', fontSize: 'var(--fs-small, 12px)', fontFamily: 'var(--font-mono)', borderTop: 'none', borderRight: 'none', borderBottom: 'none', borderLeft: '1px solid var(--border-default)', opacity: busy ? 0.5 : 1,
            ...(mod.enabled ? { backgroundColor: 'var(--success-bg)', color: 'var(--success-text)' } : { backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' }) }}>
          {busy ? '…' : mod.enabled ? 'ON' : 'OFF'}
        </button>
      </div>

      {/* Expanded detail */}
      {open && (
        <Stack gap={12} style={{ padding: 16, borderTop: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface)' }}>
          <p style={{ margin: 0, fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)' }}>{mod.description}</p>

          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 6, fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)', margin: 0 }}>
            <dt>Interval</dt>
            <dd style={{ margin: 0 }}>
              {isManager ? (
                <input type="number" min="5" value={intervalVal}
                  onChange={e => onIntervalChange(Number(e.target.value))}
                  onBlur={e => onIntervalSave(parseInt(e.target.value))}
                  style={{ width: 80, border: '1px solid var(--border-default)', borderRadius: 6, padding: '2px 8px', fontSize: 'var(--fs-small, 12px)', backgroundColor: 'var(--surface-2)', color: 'var(--text-primary)', outline: 'none' }} />
              ) : <span>{mod.interval_sec} s</span>}
            </dd>
            <dt>Last request</dt><dd style={{ margin: 0 }}>{mod.last_run_at ? new Date(mod.last_run_at).toLocaleString() : '—'}</dd>
            <dt>Next scheduled</dt><dd style={{ margin: 0 }}>{mod.next_run_at ? new Date(mod.next_run_at).toLocaleString() : '—'}</dd>
          </dl>

          {/* Live value + graph */}
          {liveActive && (
            <Stack gap={8} style={{ borderRadius: 8, border: '1px solid var(--success-text)', padding: 12, backgroundColor: 'var(--success-bg)' }}>
              {liveData ? bigNumbers(liveData, 'var(--success-text)', 3)
                : <span style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--success-text)' }}>측정 중…</span>}
              {history.length > 1 && liveData && (() => {
                const numericKeys = Object.keys(liveData).filter(k => { const v = liveData[k]; return typeof v === 'number' || (typeof v === 'object' && v?.value != null) })
                if (!numericKeys.length) return null
                const t0 = history[0].t
                const chartData = history.map(pt => ({ ...pt, s: ((pt.t - t0) / 1000).toFixed(1) }))
                return (
                  <ResponsiveContainer width="100%" height={120}>
                    <LineChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                      <XAxis dataKey="s" tick={{ fontSize: 'var(--fs-micro, 10px)', fill: 'var(--success-text)', opacity: 0.6 }} tickLine={false} axisLine={false} interval="preserveStartEnd"
                        label={{ value: 's', position: 'insideRight', fontSize: 'var(--fs-micro, 10px)', fill: 'var(--success-text)', opacity: 0.5 }} />
                      <YAxis tick={{ fontSize: 'var(--fs-micro, 10px)', fill: 'var(--success-text)', opacity: 0.6 }} tickLine={false} axisLine={false} width={40} />
                      <Tooltip contentStyle={{ backgroundColor: 'var(--surface)', border: '1px solid var(--border-default)', borderRadius: 6, fontSize: 'var(--fs-tiny, 11px)' }} labelFormatter={v => `${v}s`} />
                      {numericKeys.map((k, i) => (
                        <Line key={k} type="monotone" dataKey={k} stroke={i === 0 ? 'var(--success-text)' : 'var(--info-text)'} strokeWidth={1.5} dot={false} isAnimationActive={false} />
                      ))}
                    </LineChart>
                  </ResponsiveContainer>
                )
              })()}
            </Stack>
          )}

          {/* One-shot result */}
          {liveData && !liveActive && (
            <div style={{ borderRadius: 8, border: '1px solid var(--border-default)', padding: '8px 16px', backgroundColor: 'var(--surface-2)' }}>
              {bigNumbers(liveData, 'var(--text-primary)', 2)}
            </div>
          )}

          {/* Buttons */}
          <Row gap={8} wrap>
            <Button variant="secondary" onClick={async () => { setLogResult(null); try { const r = await api.post(`/modules/${mod.id}/collect`); setLiveData(r.data); setLiveError(null) } catch (e) { setLiveError(e.response?.data?.detail || 'error') } }}>Request Now</Button>
            <Button variant="info" onClick={async () => { setLogResult(null); setLiveError(null); try { const r = await api.post(`/modules/${mod.id}/log`); setLogResult(r.data) } catch (e) { setLiveError(e.response?.data?.detail || 'error') } }}>Request Log</Button>
            <Button variant={liveActive ? 'success' : 'secondary'} onClick={() => { setLiveActive(a => !a); setLogResult(null) }}>{liveActive ? '● Stop Realtime' : '○ Start Realtime'}</Button>
          </Row>

          {logResult && (
            <div style={{ fontSize: 'var(--fs-small, 12px)', padding: '6px 12px', borderRadius: 6, border: '1px solid var(--success-text)', backgroundColor: 'var(--success-bg)', color: 'var(--success-text)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={12} weight="bold" /> Log #{logResult.log_index} created</span>
              <button onClick={() => onOpenLog(logResult.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', opacity: 0.8, color: 'inherit' }}>view</button>
            </div>
          )}
          {liveError && (
            <div style={{ fontSize: 'var(--fs-small, 12px)', padding: '6px 12px', borderRadius: 6, border: '1px solid var(--danger-text)', backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)' }}>{liveError}</div>
          )}
        </Stack>
      )}
    </div>
  )
}

// ── Service row (collapsed list item) ────────────────────────────────────────
function ServiceRow({ svc, onOpen, isOpen, onToggleActive, t }) {
  const typeBadge = svc.is_main_system
    ? { label: 'MAIN', style: { backgroundColor: 'var(--border-focus)', color: '#fff' } }
    : (svc.is_system || svc.is_subsystem)
      ? { label: 'system', style: { backgroundColor: 'var(--warning-bg)', color: 'var(--warning-text)' } }
      : { label: 'service', style: { backgroundColor: 'var(--info-bg)', color: 'var(--info-text)' } }
  return (
    <div style={{ display: 'flex', alignItems: 'stretch' }}>
      <button onClick={() => onOpen(svc.id)}
        style={{ flex: 1, textAlign: 'left', cursor: 'pointer', padding: 12, background: 'var(--surface)', color: 'var(--text-primary)',
          borderWidth: 1, borderStyle: 'solid', borderColor: isOpen ? 'var(--border-focus)' : 'var(--border-default)', borderRightWidth: 0, borderRadius: '12px 0 0 12px',
          boxShadow: isOpen ? '0 0 0 1px var(--border-focus)' : undefined }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <span style={{ fontSize: 'var(--fs-micro, 10px)', fontFamily: 'var(--font-mono)', padding: '1px 6px', borderRadius: 4, flexShrink: 0, textTransform: 'uppercase', ...typeBadge.style }}>{typeBadge.label}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontWeight: 600, fontSize: 'var(--fs-medium, 14px)', color: 'var(--text-primary)' }}>{svc.name}</span>
              {svc.realtime_enabled && <Badge tone="success" mono>{t('exp_realtime')}</Badge>}
            </div>
            {svc.description && <p style={{ margin: '2px 0 0', fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{svc.description}</p>}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 'var(--fs-tiny, 11px)', marginTop: 4, flexWrap: 'wrap', color: 'var(--text-muted)' }}>
              {(svc.hostname || svc.ip) && <span>📡 {svc.hostname || svc.ip}</span>}
              {svc.directory && <span style={{ fontFamily: 'var(--font-mono)' }}>📁 {svc.directory}</span>}
              {svc.format_names?.length > 0 && <span>📋 {svc.format_names.length} format(s)</span>}
            </div>
          </div>
        </div>
      </button>
      <button onClick={e => { e.stopPropagation(); onToggleActive(svc) }} title={svc.is_active ? 'Disable' : 'Enable'}
        style={{ flexShrink: 0, padding: '0 14px', cursor: 'pointer', fontSize: 'var(--fs-small, 12px)', fontFamily: 'var(--font-mono)', borderWidth: 1, borderStyle: 'solid', borderRadius: '0 12px 12px 0',
          ...(svc.is_active
            ? { backgroundColor: 'var(--success-bg)', borderColor: 'var(--success-text)', color: 'var(--success-text)' }
            : { backgroundColor: 'var(--surface-2)', borderColor: 'var(--border-default)', color: 'var(--text-muted)' }) }}>
        {svc.is_active ? 'ON' : 'OFF'}
      </button>
    </div>
  )
}

// ── Service detail panel (expanded view) ─────────────────────────────────────
function ServiceDetail({ svc, formats, modules, onEdit, onDelete, onClose, onChanged, isManager, t }) {
  const [busy, setBusy] = useState(null)   // which action is in flight: 'now' | 'log' | 'realtime'
  const [snapshot, setSnapshot] = useState(null)   // last "request now" response
  const [actionError, setActionError] = useState(null)
  const [createdLogId, setCreatedLogId] = useState(null)
  const [taskModalFmt, setTaskModalFmt] = useState(null)  // format whose task template is being edited
  const realtimeTimerRef = useRef(null)

  /* Phase 7: real actions. The 3 buttons hit the matching backend endpoints
     and surface errors / responses inline (no separate modal needed). */
  async function doRequestNow() {
    setBusy('now'); setActionError(null); setSnapshot(null); setCreatedLogId(null)
    try {
      const r = await api.post(`/services/${svc.id}/request-now`)
      setSnapshot(r.data?.response ?? r.data)
    } catch (e) {
      setActionError(e.response?.data?.detail || e.message || 'Request failed')
    } finally { setBusy(null) }
  }
  async function doRequestLog() {
    setBusy('log'); setActionError(null); setCreatedLogId(null)
    try {
      const r = await api.post(`/services/${svc.id}/request-log`)
      setCreatedLogId(r.data?.id || null)
      if (onChanged) onChanged()
    } catch (e) {
      setActionError(e.response?.data?.detail || e.message || 'Request failed')
    } finally { setBusy(null) }
  }
  async function toggleRealtime() {
    const next = !svc.realtime_enabled
    setBusy('realtime'); setActionError(null)
    try {
      await api.post(`/services/${svc.id}/realtime?enable=${next}`)
      if (onChanged) await onChanged()
    } catch (e) {
      setActionError(e.response?.data?.detail || e.message || 'Toggle failed')
    } finally { setBusy(null) }
  }

  /* Client-side realtime loop — poll /request-now on the configured cadence
     while the flag is on. The server only stores the flag; this useEffect
     drives the actual repeated calls. Cleared on unmount / flag-off. */
  useEffect(() => {
    if (!svc.realtime_enabled) return
    const intervalMs = Math.max(200, (svc.realtime_interval_sec || 1) * 1000)
    let mounted = true
    async function tick() {
      if (!mounted) return
      try {
        const r = await api.post(`/services/${svc.id}/request-now`)
        if (mounted) setSnapshot(r.data?.response ?? r.data)
      } catch (e) {
        if (mounted) setActionError(e.response?.data?.detail || 'realtime error')
      }
    }
    tick()
    realtimeTimerRef.current = setInterval(tick, intervalMs)
    return () => {
      mounted = false
      if (realtimeTimerRef.current) clearInterval(realtimeTimerRef.current)
      realtimeTimerRef.current = null
    }
  }, [svc.realtime_enabled, svc.realtime_interval_sec, svc.id])

  const fmtMap = Object.fromEntries((formats ?? []).map(f => [f.id, f]))
  const dtdd = (label, value, mono) => (<><dt>{label}</dt><dd style={{ margin: 0, fontFamily: mono ? 'var(--font-mono)' : undefined, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value}</dd></>)
  return (
    <Stack gap={12} style={{ border: '1px solid var(--border-focus)', borderRadius: 12, padding: 16, backgroundColor: 'var(--surface)' }}>
      <Row justify="between" align="center">
        <h3 style={{ margin: 0, fontWeight: 600, color: 'var(--text-primary)' }}>{svc.name}</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 'var(--fs-body, 13px)', color: 'var(--text-muted)' }}>{t('exp_btn_close')}</button>
      </Row>

      {svc.description && <p style={{ margin: 0, fontSize: 'var(--fs-body, 13px)', color: 'var(--text-secondary)' }}>{svc.description}</p>}

      <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', rowGap: 6, fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)', margin: 0 }}>
        {dtdd(t('exp_field_hostname') || 'Host name', svc.hostname || svc.ip || '—', true)}
        {dtdd(t('exp_detail_directory'), svc.directory || '—', true)}
        {dtdd(t('exp_field_request_url').split(' ')[0], svc.request_url || '—', true)}
        {dtdd(t('exp_detail_max_interval'), svc.max_interval_sec ? `${svc.max_interval_sec} ${t('exp_detail_sec')}` : '—')}
        {dtdd(t('exp_detail_realtime_interval'), svc.realtime_interval_sec ? `${svc.realtime_interval_sec} ${t('exp_detail_sec')}` : '—')}
        {dtdd(t('exp_detail_last_request'), svc.last_request_at ? new Date(svc.last_request_at).toLocaleString() : '—')}
        {dtdd(t('exp_detail_next_request'), svc.next_request_at ? new Date(svc.next_request_at).toLocaleString() : '—')}
      </dl>

      <div>
        <p style={{ margin: '0 0 6px', fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>{t('exp_detail_formats')}</p>
        {(svc.format_ids ?? []).length === 0 ? (
          <p style={{ margin: 0, fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>{t('exp_detail_none')}</p>
        ) : (
          <Stack gap={4}>
            {(svc.format_ids ?? []).map(id => {
              const f = fmtMap[id]
              return (
                <Row key={id} justify="between" gap={8} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-2)' }}>
                  <Row gap={8} style={{ minWidth: 0 }}>
                    <span style={{ fontSize: 'var(--fs-medium, 14px)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{f?.name || `format#${id}`}</span>
                    {f?.task_type && <Badge tone="warning" mono>{f.task_type.replace(/_/g, ' ')}</Badge>}
                  </Row>
                  {isManager && f && <Button variant="info" onClick={() => setTaskModalFmt(f)} style={{ flexShrink: 0 }}>Manage tasks</Button>}
                </Row>
              )
            })}
          </Stack>
        )}
      </div>

      {taskModalFmt && (
        <ManageTasksModal formatId={taskModalFmt.id} formatName={taskModalFmt.name} onClose={() => setTaskModalFmt(null)} onChanged={() => {}} />
      )}

      {/* Actions */}
      <Stack gap={8} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
        <Row gap={8} wrap>
          <Button variant="secondary" size="md" disabled={busy === 'now' || !svc.request_url} onClick={doRequestNow}
            title={!svc.request_url ? 'No request_url configured' : t('exp_action_request_now_hint')}>{busy === 'now' ? '…' : t('exp_action_request_now')}</Button>
          <Button variant="info" size="md" disabled={busy === 'log' || !svc.request_url} onClick={doRequestLog}
            title={!svc.request_url ? 'No request_url configured' : t('exp_action_request_log_hint')}>{busy === 'log' ? '…' : t('exp_action_request_log')}</Button>
          <Button variant={svc.realtime_enabled ? 'success' : 'secondary'} size="md" disabled={busy === 'realtime' || !svc.request_url} onClick={toggleRealtime} title={t('exp_action_realtime_hint')}>
            {busy === 'realtime' ? '…' : svc.realtime_enabled ? `● ${t('exp_action_realtime')} (${svc.realtime_interval_sec || 1}s)` : `○ ${t('exp_action_realtime')}`}
          </Button>
        </Row>

        {actionError && <div style={{ fontSize: 'var(--fs-small, 12px)', padding: '6px 12px', borderRadius: 8, border: '1px solid var(--danger-text)', backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)' }}>{actionError}</div>}
        {createdLogId && <div style={{ fontSize: 'var(--fs-small, 12px)', padding: '6px 12px', borderRadius: 8, backgroundColor: 'var(--success-bg)', color: 'var(--success-text)' }}><Icon name="check" size={13} weight="bold" style={{ verticalAlign: -2 }} /> Created log #{createdLogId}</div>}
        {snapshot && (
          <details open style={{ fontSize: 'var(--fs-small, 12px)', border: '1px solid var(--border-default)', borderRadius: 8 }}>
            <summary style={{ padding: '6px 12px', cursor: 'pointer', userSelect: 'none', color: 'var(--text-secondary)' }}>Snapshot {svc.realtime_enabled && '(live)'}</summary>
            <pre style={{ margin: 0, padding: '8px 12px', overflowX: 'auto', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-tiny, 11px)', borderTop: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface-2)', color: 'var(--text-primary)' }}>{JSON.stringify(snapshot, null, 2)}</pre>
          </details>
        )}
      </Stack>

      {isManager && (
        <Row gap={8} style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
          <Button variant="secondary" onClick={() => onEdit(svc)}>{t('exp_btn_edit')}</Button>
          <Button variant="dangerSoft" onClick={() => onDelete(svc.id)}>{t('exp_btn_delete')}</Button>
        </Row>
      )}
    </Stack>
  )
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function ExperimentPage() {
  const { user } = useAuth()
  const { t } = useLang()
  const { openLog } = useTab()
  const isManager = user?.role === 'manager'

  const [services, setServices] = useState([])
  const [formats, setFormats] = useState([])
  const [loading, setLoading] = useState(true)
  const [openId, setOpenId] = useState(null)
  const [editTarget, setEditTarget] = useState(null)   // null | 'new' | service object
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [registerResult, setRegisterResult] = useState(null)  // 등록 완료 결과 (token, credentials_sent 등)

  // Modules state
  const [modules, setModules] = useState([])
  const [modulesBusy, setModulesBusy] = useState({})   // {id: true} while saving
  const [modulesError, setModulesError] = useState(null)
  const [moduleIntervals, setModuleIntervals] = useState({})  // local interval edits

  // Register modules + services into the data index (`%<n>` / `%name`).
  useTaggables(() => [
    ...services.map((s, i) => ({
      id: `service:${s.id}`, label: s.name || s.display_name || `service ${s.id}`, number: i + 1,
      tags: [s.is_active ? 'active' : 'inactive', s.kind].filter(Boolean), kind: 'service',
      run: () => { setOpenId(s.id); setTimeout(() => document.getElementById(`exp-service-${s.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60) },
    })),
    ...modules.map((m, i) => ({
      id: `module:${m.id}`, label: m.name || m.display_name || `module ${m.id}`, number: i + 1,
      tags: [m.enabled ? 'enabled' : 'disabled'].filter(Boolean), kind: 'module',
      run: () => document.getElementById(`exp-module-${m.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
    })),
  ], [services, modules])

  const reload = useCallback(async () => {
    try {
      const [svcRes, fmtRes] = await Promise.all([
        api.get('/services?include_inactive=true'),
        api.get('/formats'),
      ])
      setServices(Array.isArray(svcRes.data) ? svcRes.data : svcRes.data?.items ?? [])
      setFormats(Array.isArray(fmtRes.data) ? fmtRes.data : fmtRes.data?.items ?? [])
    } catch (e) {
      setError(e.response?.data?.detail || t('exp_err_load'))
    } finally {
      setLoading(false)
    }
  }, [t])

  const reloadModules = useCallback(async () => {
    try {
      const res = await api.get('/modules')
      const mods = Array.isArray(res.data) ? res.data : res.data?.items ?? []
      setModules(mods)
      const ivs = {}
      mods.forEach(m => { ivs[m.id] = m.interval_sec })
      setModuleIntervals(ivs)
    } catch (e) {
      setModulesError(e.response?.data?.detail || t('modules_err_load'))
    }
  }, [t])

  async function saveModule(id, patch) {
    setModulesBusy(p => ({ ...p, [id]: true }))
    setModulesError(null)
    try {
      await api.patch(`/modules/${id}`, patch)
      await reloadModules()
    } catch (e) {
      setModulesError(e.response?.data?.detail || t('modules_err_save'))
    } finally {
      setModulesBusy(p => ({ ...p, [id]: false }))
    }
  }

  useEffect(() => { reload() }, [reload])
  useEffect(() => { reloadModules() }, [reloadModules])

  async function save(form) {
    setBusy(true); setError(null); setRegisterResult(null)
    try {
      if (editTarget && editTarget !== 'new') {
        await api.put(`/services/${editTarget.id}`, form)
        setEditTarget(null)
      } else {
        const res = await api.post('/services', form)
        const data = res.data
        // 시스템이면 token + credentials 전송 결과 표시
        if (data.token) {
          setRegisterResult({
            name:             data.name,
            token:            data.token,
            credentials_sent: data.credentials_sent,
            credentials_error: data.credentials_error,
            command_url:      form.request_url,
          })
        }
        setEditTarget(null)
      }
      await reload()
    } catch (e) {
      setError(e.response?.data?.detail || t('exp_err_save'))
    } finally {
      setBusy(false)
    }
  }

  async function del(id) {
    if (!confirm(t('exp_delete_confirm'))) return
    try {
      await api.delete(`/services/${id}`)
      if (openId === id) setOpenId(null)
      await reload()
    } catch (e) {
      setError(e.response?.data?.detail || t('exp_err_delete'))
    }
  }

  const openSvc = openId ? services.find(s => s.id === openId) : null
  // True if any service (other than the one being edited) is already main system
  const hasMainSystem = services.some(s =>
    s.is_main_system && (!editTarget || editTarget === 'new' || s.id !== editTarget.id)
  )

  return (
    <div style={{ maxWidth: 768, margin: '0 auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Row gap={8} justify="between" wrap>
        <h2 style={{ margin: 0, fontSize: 'var(--fs-xlarge, 18px)', fontWeight: 600, color: 'var(--text-primary)' }}>{t('exp_title')}</h2>
        <Row gap={8}>
          {/* Manual is visible to everyone. */}
          <Button variant="secondary" size="md" onClick={() => setManualOpen(true)} title={t('exp_manual_btn_hint')}>{t('exp_manual_btn')}</Button>
          {isManager && editTarget !== 'new' && (
            <Button size="md" onClick={() => { setEditTarget('new'); setOpenId(null) }}>{t('exp_new_service')}</Button>
          )}
        </Row>
      </Row>

      {error && (
        <div style={{ border: '1px solid var(--danger-text)', backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)', fontSize: 'var(--fs-body, 13px)', padding: '8px 16px', borderRadius: 8 }}>{error}</div>
      )}

      {/* ── 시스템 등록 완료 결과 ── */}
      {registerResult && (
        <RegisterResultBanner
          result={registerResult}
          onClose={() => setRegisterResult(null)}
        />
      )}

      {/* New / edit form */}
      {editTarget && (
        <ServiceForm
          initial={editTarget === 'new' ? null : editTarget}
          formats={formats}
          onSave={save}
          onCancel={() => setEditTarget(null)}
          busy={busy}
          t={t}
          isManager={isManager}
          hasMainSystem={hasMainSystem}
        />
      )}

      {/* List */}
      {loading ? (
        <p style={{ textAlign: 'center', padding: '40px 0', fontSize: 'var(--fs-body, 13px)', color: 'var(--text-muted)' }}>{t('home_loading')}</p>
      ) : services.length === 0 ? (
        <p style={{ textAlign: 'center', padding: '40px 0', fontSize: 'var(--fs-body, 13px)', color: 'var(--text-muted)' }}>{t('exp_empty')}</p>
      ) : (
        <Stack gap={8}>
          {services.map(svc => (
            <Stack key={svc.id} gap={8} id={`exp-service-${svc.id}`}>
              <ServiceRow
                svc={svc}
                onOpen={(id) => setOpenId(openId === id ? null : id)}
                isOpen={openId === svc.id}
                onToggleActive={async (s) => {
                  try { await api.put(`/services/${s.id}`, { is_active: !s.is_active }); await reload() }
                  catch {}
                }}
                t={t}
              />
              {openId === svc.id && (
                <ServiceDetail
                  svc={openSvc}
                  formats={formats}
                  modules={modules}
                  onEdit={(s) => { setEditTarget(s); setOpenId(null) }}
                  onDelete={del}
                  onClose={() => setOpenId(null)}
                  onChanged={reload}
                  isManager={isManager}
                  t={t}
                />
              )}
            </Stack>
          ))}
        </Stack>
      )}

      {/* ── Modules section ─────────────────────────────────────────────── */}
      <Stack gap={8} style={{ paddingTop: 16 }}>
        <Row gap={8} align="baseline">
          <h3 style={{ margin: 0, fontWeight: 600, fontSize: 'var(--fs-large, 16px)', color: 'var(--text-primary)' }}>{t('modules_title')}</h3>
          <span style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>{t('modules_desc')}</span>
        </Row>

        {modulesError && (
          <div style={{ border: '1px solid var(--danger-text)', backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)', fontSize: 'var(--fs-small, 12px)', padding: '6px 12px', borderRadius: 8 }}>{modulesError}</div>
        )}

        {modules.length === 0 ? (
          <p style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>—</p>
        ) : (
          <Stack gap={8}>
            {modules.map(mod => (
              <div key={mod.id} id={`exp-module-${mod.id}`}>
              <ModuleRow
                mod={mod}
                busy={modulesBusy[mod.id]}
                intervalVal={moduleIntervals[mod.id] ?? mod.interval_sec}
                onIntervalChange={v => setModuleIntervals(p => ({ ...p, [mod.id]: v }))}
                onIntervalSave={v => { if (v !== mod.interval_sec) saveModule(mod.id, { interval_sec: v }) }}
                onToggle={() => saveModule(mod.id, { enabled: !mod.enabled })}
                onOpenLog={openLog}
                isManager={isManager}
                t={t}
              />
              </div>
            ))}
          </Stack>
        )}
      </Stack>

      {manualOpen && <ServiceManualModal onClose={() => setManualOpen(false)} />}
    </div>
  )
}
