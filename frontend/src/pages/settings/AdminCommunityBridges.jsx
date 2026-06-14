import { useState, useEffect } from 'react'
import { CrudForm, CopyField, Input, Button, Badge, Icon, Stack, Row } from 'lilak-ui'
import api from '../../api'

const SOURCE_TYPES = [
  { value: 'dooray',  label: 'Dooray!',  outgoing_hint: 'Dooray incoming-webhook URL',
    incoming_hint: 'Paste this URL into Dooray as an outgoing webhook' },
  { value: 'discord', label: 'Discord',  outgoing_hint: 'Discord webhook URL',
    incoming_hint: 'Discord 기본 웹훅은 outbound 전용 — 가져오려면 Bot 또는 relay 서비스 필요' },
  { value: 'slack',   label: 'Slack',    outgoing_hint: 'Slack incoming-webhook URL (hooks.slack.com/services/...)',
    incoming_hint: 'Use this as the Request URL in your Slack App → Event Subscriptions (or legacy Outgoing Webhook)' },
]

const label = { fontSize: 'var(--fs-tiny, 11px)', color: 'var(--text-secondary)' }
const card = { border: '1px solid var(--border-default)', backgroundColor: 'var(--surface)', borderRadius: 12, padding: 16 }

export default function AdminCommunityBridges() {
  const [bridges, setBridges] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  function load() {
    setLoading(true)
    api.get('/community/bridges').then(r => setBridges(r.data)).catch(() => {}).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, [])

  async function handleCreate(v) {
    setError(null); setSaving(true)
    try {
      await api.post('/community/bridges', {
        name: v.name, source_type: v.source_type || 'dooray',
        outgoing_url: v.outgoing_url || '', enable_incoming: !!v.enable_incoming, enabled: true,
      })
      setShowForm(false)
      load()
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to create bridge'); throw err
    } finally { setSaving(false) }
  }

  async function handleUpdate(b, patch) {
    try { await api.put(`/community/bridges/${b.id}`, patch); load() }
    catch (err) { window.alert('Update failed: ' + (err.response?.data?.detail || err.message)) }
  }
  async function handleDelete(b) {
    if (!window.confirm(`Delete bridge "${b.name}"?`)) return
    try { await api.delete(`/community/bridges/${b.id}`); load() }
    catch (err) { window.alert('Delete failed: ' + (err.response?.data?.detail || err.message)) }
  }
  async function handleSetBotToken(b) {
    const newTok = window.prompt(
      `${b.name} 의 Discord Bot Token 을 입력하세요.\n\nDiscord Developer Portal → Bot → Reset Token 으로 받은 값.\n(빈칸 그대로 OK 하면 토큰이 삭제됩니다.)`, '')
    if (newTok === null) return
    try { await api.put(`/community/bridges/${b.id}`, { bot_token: newTok.trim() }); load() }
    catch (err) { window.alert('저장 실패: ' + (err.response?.data?.detail || err.message)) }
  }
  async function handleStartRelay(b) {
    try {
      const d = (await api.post(`/community/bridges/${b.id}/relay/start`)).data
      if (d.ok) window.alert(d.already_running ? `이미 실행 중 (PID ${d.pid})` : `✅ 릴레이 시작 (PID ${d.pid})`)
      else window.alert(`❌ 시작 실패: ${d.error}\n\n${d.log_tail || ''}`)
      load()
    } catch (err) { window.alert('호출 실패: ' + (err.response?.data?.detail || err.message)) }
  }
  async function handleStopRelay(b) {
    try { await api.post(`/community/bridges/${b.id}/relay/stop`); load() }
    catch (err) { window.alert('호출 실패: ' + (err.response?.data?.detail || err.message)) }
  }
  async function handleTestOutgoing(b) {
    if (!b.outgoing_url) { window.alert('Outgoing URL이 비어있습니다.'); return }
    try {
      const { ok, status, response, error } = (await api.post(`/community/bridges/${b.id}/test-outgoing`)).data
      window.alert(ok ? `✅ 전송 성공\nHTTP ${status}\n\nResponse:\n${response || '(empty)'}` : `❌ 전송 실패\nHTTP ${status}\n\nError:\n${error}`)
    } catch (err) { window.alert('테스트 호출 실패: ' + (err.response?.data?.detail || err.message)) }
  }

  return (
    <div style={{ maxWidth: 768 }}>
      <Row align="start" justify="between" gap={12} style={{ marginBottom: 12 }}>
        <p style={{ ...label, margin: 0, flex: 1 }}>
          커뮤니티 채팅을 외부 메신저(Dooray, Discord)와 양방향으로 연결합니다.
          외부 → 우리 방향(Incoming) 메시지는 시스템이 별도 배지로 표시하고 다시 외부로는 재전송하지 않습니다(루프 방지).
        </p>
        <Button variant={showForm ? 'secondary' : 'primary'} onClick={() => { setShowForm(s => !s); setError(null) }} style={{ flexShrink: 0 }}>
          {showForm ? '취소' : '+ 브리지 추가'}
        </Button>
      </Row>

      {/* Create form — kit CrudForm */}
      {showForm && (
        <div style={{ marginBottom: 20 }}>
          <CrudForm
            fields={[
              { key: 'name', label: '이름', placeholder: 'ex) Dooray #실험실', required: true },
              { key: 'source_type', label: '플랫폼', type: 'select', required: true, default: 'dooray', options: SOURCE_TYPES.map(s => ({ value: s.value, label: s.label })) },
              { key: 'outgoing_url', label: 'Outgoing webhook URL (우리 → 외부)', placeholder: ' 비워두면 외부로 보내지 않음', full: true },
              { key: 'enable_incoming', label: 'Incoming', type: 'checkbox', checkboxLabel: 'Incoming 활성화 (외부 → 우리, 토큰 자동 생성)', full: true },
            ]}
            title="브리지 추가"
            submitLabel="저장"
            cancelLabel="취소"
            busy={saving}
            error={error}
            onSubmit={handleCreate}
            onCancel={() => setShowForm(false)}
          />
        </div>
      )}

      {/* List */}
      {loading ? (
        <p style={{ textAlign: 'center', padding: '32px 0', fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>로딩 중…</p>
      ) : bridges.length === 0 ? (
        <div style={{ ...card, textAlign: 'center', padding: '40px 0', fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>등록된 브리지가 없습니다.</div>
      ) : (
        <Stack gap={12}>
          {bridges.map(b => {
            const meta = SOURCE_TYPES.find(s => s.value === b.source_type)
            return (
              <Stack key={b.id} gap={12} style={card}>
                {/* Header */}
                <Row gap={8} align="center">
                  <span style={{ fontSize: 'var(--fs-medium, 14px)', fontWeight: 600, color: 'var(--text-primary)' }}>{b.name}</span>
                  <Badge tone="info" mono>{(meta?.label || b.source_type).toUpperCase()}</Badge>
                  {!b.enabled && <Badge tone="neutral">비활성</Badge>}
                  <span style={{ flex: 1 }} />
                  <Button variant="secondary" onClick={() => handleUpdate(b, { enabled: !b.enabled })}>{b.enabled ? '비활성화' : '활성화'}</Button>
                  <Button variant="dangerSoft" onClick={() => handleDelete(b)}>삭제</Button>
                </Row>

                {/* Outgoing URL */}
                <div>
                  <p style={{ ...label, margin: '0 0 4px' }}>Outgoing webhook (우리 → {meta?.label}):</p>
                  <Row gap={6} align="center">
                    <Input mono defaultValue={b.outgoing_url || ''} placeholder="(없음) — 비워두면 외부로 보내지 않음"
                      onBlur={e => { const v = e.target.value.trim(); if (v !== (b.outgoing_url || '')) handleUpdate(b, { outgoing_url: v }) }} />
                    {b.outgoing_url && (
                      <Button variant="info" onClick={() => handleTestOutgoing(b)} title="이 URL로 즉시 테스트 메시지를 보냅니다" style={{ flexShrink: 0 }}>
                        <Row gap={4} align="center" as="span"><Icon name="refresh" size={12} />테스트</Row>
                      </Button>
                    )}
                  </Row>
                </div>

                {/* Incoming URL */}
                <div>
                  <Row gap={8} align="center" style={{ marginBottom: 4 }}>
                    <p style={{ ...label, margin: 0 }}>Incoming webhook ({meta?.label} → 우리):</p>
                    {b.incoming_token ? (
                      <>
                        <button onClick={() => { if (window.confirm('Incoming 토큰을 재생성하시겠습니까? 기존 URL은 동작하지 않게 됩니다.')) handleUpdate(b, { rotate_token: true }) }}
                          style={{ fontSize: 'var(--fs-micro, 10px)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-link)', textDecoration: 'underline' }}>토큰 재생성</button>
                        <button onClick={() => handleUpdate(b, { enable_incoming: false })}
                          style={{ fontSize: 'var(--fs-micro, 10px)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', textDecoration: 'underline' }}>끄기</button>
                      </>
                    ) : (
                      <button onClick={() => handleUpdate(b, { enable_incoming: true })}
                        style={{ fontSize: 'var(--fs-micro, 10px)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-link)', textDecoration: 'underline' }}>+ 토큰 생성</button>
                    )}
                  </Row>
                  {b.incoming_token ? (
                    <>
                      <CopyField value={b.incoming_url} labels={{ copy: 'copy', copied: 'copied' }} />
                      <p style={{ fontSize: 'var(--fs-micro, 10px)', margin: '4px 0 0', color: 'var(--text-muted)' }}>{meta?.incoming_hint}</p>
                      {b.source_type === 'discord' && (
                        <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 6, fontSize: 'var(--fs-micro, 10px)', lineHeight: 1.6,
                          backgroundColor: 'var(--warning-bg)', border: '1px solid var(--warning-text)', color: 'var(--warning-text)' }}>
                          <Icon name="warning" weight="fill" size={11} style={{ verticalAlign: -1 }} /> Discord 는 기본 웹훅이 <strong>outbound 전용</strong>이라 채널 메시지를 자동으로 이 URL로 보내지 않습니다.
                          아래 <strong>Discord Bot Relay</strong> 를 설정하면 lilak 이 직접 봇 프로세스를 띄워 양방향 연결을 만들어줍니다.
                        </div>
                      )}
                    </>
                  ) : (
                    <p style={{ fontSize: 'var(--fs-tiny, 11px)', margin: 0, color: 'var(--text-muted)' }}>(비활성 — 외부에서 들어오는 메시지를 받지 않습니다)</p>
                  )}
                </div>

                {/* Discord-only: managed bot relay subprocess */}
                {b.source_type === 'discord' && (
                  <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
                    <Row gap={8} align="center" style={{ marginBottom: 8 }}>
                      <p style={{ ...label, margin: 0, flex: 1 }}>Discord Bot Relay (관리되는 봇 프로세스):</p>
                      {b.relay_status === 'running'
                        ? <Badge tone="success" dot mono>running · PID {b.relay_pid}</Badge>
                        : <Badge tone="neutral" mono>stopped</Badge>}
                    </Row>

                    <Row gap={6} align="center" style={{ marginBottom: 8 }}>
                      <span style={{ fontSize: 'var(--fs-tiny, 11px)', color: 'var(--text-secondary)' }}>Bot Token:</span>
                      <span style={{ flex: 1, fontSize: 'var(--fs-tiny, 11px)', color: b.has_bot_token ? 'var(--success-text)' : 'var(--text-muted)' }}>
                        {b.has_bot_token ? <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="check" size={12} weight="bold" /> 저장됨</span> : '미설정'}
                      </span>
                      <Button variant="info" onClick={() => handleSetBotToken(b)}>{b.has_bot_token ? '토큰 변경' : '토큰 입력'}</Button>
                    </Row>

                    <Row gap={6} align="center">
                      {b.relay_status === 'running'
                        ? <Button variant="danger" onClick={() => handleStopRelay(b)}>■ 중지</Button>
                        : <Button variant="success" disabled={!b.has_bot_token || !b.incoming_token} onClick={() => handleStartRelay(b)}>▶ 시작</Button>}
                      <Button variant="ghost" onClick={load} title="상태 다시 확인" icon><Icon name="refresh" size={13} /></Button>
                      {!b.has_bot_token && <span style={{ fontSize: 'var(--fs-micro, 10px)', color: 'var(--text-muted)' }}>(Bot Token 먼저 입력)</span>}
                      {!b.incoming_token && b.has_bot_token && <span style={{ fontSize: 'var(--fs-micro, 10px)', color: 'var(--text-muted)' }}>(Incoming 토큰 먼저 생성)</span>}
                    </Row>

                    {b.relay_log_tail && (
                      <details style={{ marginTop: 8 }}>
                        <summary style={{ fontSize: 'var(--fs-micro, 10px)', cursor: 'pointer', color: 'var(--text-muted)' }}>로그 보기</summary>
                        <pre style={{ marginTop: 4, fontSize: 'var(--fs-micro, 10px)', fontFamily: 'var(--font-mono)', padding: 8, borderRadius: 6,
                          backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', maxHeight: '12rem', overflowX: 'auto', whiteSpace: 'pre-wrap' }}>
                          {b.relay_log_tail}
                        </pre>
                      </details>
                    )}
                  </div>
                )}
              </Stack>
            )
          })}
        </Stack>
      )}
    </div>
  )
}
