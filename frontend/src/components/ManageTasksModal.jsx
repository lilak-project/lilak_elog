import { useState, useEffect, useCallback } from 'react'
import { Icon, Modal, Button, Badge, Stack } from 'lilak-ui'
import api from '../api'

// Two modes:
//  • template mode (formatId)  — edits a log format's task template; future
//      logs of that format spawn these tasks. Persisted via /formats/{id}/task-template.
//  • instance mode (motherId)  — edits the task logs already attached to one
//      mother log. Persisted via /tasks/register (add) and /tasks/{id} (remove).
export default function ManageTasksModal({ motherId, formatId, formatName, onClose, onChanged }) {
  const isTemplate = formatId != null

  const [items, setItems] = useState([])      // instance: child logs / template: template items
  const [formats, setFormats] = useState([])
  const [modules, setModules] = useState([])
  const [services, setServices] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const [moduleSel, setModuleSel] = useState('')
  const [moduleInterval, setModuleInterval] = useState('')
  const [formatSel, setFormatSel] = useState('')
  const [formatTitle, setFormatTitle] = useState('')
  const [serviceSel, setServiceSel] = useState('')
  const [serviceInterval, setServiceInterval] = useState('')
  const [serviceTitle, setServiceTitle] = useState('')
  const [serviceOnStart, setServiceOnStart] = useState(true)   // request at run start
  const [serviceOnEnd, setServiceOnEnd] = useState(false)      // request at run end

  const load = useCallback(() => {
    if (isTemplate) {
      api.get(`/formats/${formatId}/task-template`)
        .then(r => setItems(Array.isArray(r.data?.items) ? r.data.items : []))
        .catch(() => {})
    } else {
      api.get(`/tasks/${motherId}/children`)
        .then(r => setItems(Array.isArray(r.data) ? r.data : []))
        .catch(() => {})
    }
  }, [isTemplate, formatId, motherId])

  useEffect(() => {
    load()
    api.get('/formats').then(r => setFormats(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    api.get('/modules').then(r => setModules(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    api.get('/services').then(r => setServices(Array.isArray(r.data) ? r.data : [])).catch(() => {})
    function onKey(e) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [load, onClose])

  async function persistTemplate(newItems) {
    setBusy(true); setError(null)
    try {
      await api.put(`/formats/${formatId}/task-template`, { items: newItems })
      setItems(newItems)
      if (onChanged) onChanged()
    } catch (e) {
      setError(e.response?.data?.detail || e.message || '저장 실패')
    } finally { setBusy(false) }
  }

  async function addItem(item) {
    if (isTemplate) {
      await persistTemplate([...items, item])
    } else {
      setBusy(true); setError(null)
      try {
        await api.post('/tasks/register', { mother_log_id: motherId, items: [item] })
        load(); if (onChanged) onChanged()
      } catch (e) {
        setError(e.response?.data?.detail || e.message || '추가 실패')
      } finally { setBusy(false) }
    }
  }

  function addModule() {
    if (!moduleSel) return
    addItem({ kind: 'module', module_id: moduleSel, interval_min: moduleInterval === '' ? null : Number(moduleInterval) })
    setModuleSel(''); setModuleInterval('')
  }
  function addFormat() {
    if (!formatSel) return
    const fmt = formats.find(f => f.id === Number(formatSel))
    addItem({ kind: 'format', format_id: Number(formatSel), title: formatTitle.trim() || (fmt?.name ?? '') })
    setFormatSel(''); setFormatTitle('')
  }
  function addService() {
    if (!serviceSel) return
    const svc = services.find(s => s.id === Number(serviceSel))
    addItem({ kind: 'service', service_id: Number(serviceSel),
              title: serviceTitle.trim() || (svc?.name ?? ''),
              on_start: serviceOnStart,
              interval_min: serviceInterval === '' ? null : Number(serviceInterval),
              on_end: serviceOnEnd })
    setServiceSel(''); setServiceTitle(''); setServiceInterval(''); setServiceOnStart(true); setServiceOnEnd(false)
  }

  async function removeAt(idx, child) {
    if (isTemplate) {
      await persistTemplate(items.filter((_, i) => i !== idx))
    } else {
      if (!window.confirm('이 task log를 삭제할까요?')) return
      setBusy(true); setError(null)
      try {
        await api.delete(`/tasks/${child.id}`)
        load(); if (onChanged) onChanged()
      } catch (e) {
        setError(e.response?.data?.detail || e.message || '삭제 실패')
      } finally { setBusy(false) }
    }
  }

  const modMap = Object.fromEntries(modules.map(m => [m.id, m]))
  const fmtMap = Object.fromEntries(formats.map(f => [f.id, f]))
  const svcMap = Object.fromEntries(services.map(s => [s.id, s]))
  const reqServices = services.filter(s => s.request_url)

  const labelStyle = { fontSize: 'var(--fs-tiny, 11px)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.04em' }
  const inputStyle = { backgroundColor: 'var(--surface)', borderWidth: 1, borderStyle: 'solid', borderColor: 'var(--border-default)', color: 'var(--text-primary)', outline: 'none', borderRadius: 8, padding: '6px 8px', fontSize: 'var(--fs-body, 13px)' }

  function renderRow(it, idx) {
    if (isTemplate) {
      return (
        <div key={idx} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, paddingLeft:10, paddingRight:10, paddingTop:6, paddingBottom:6, borderRadius:8, fontSize: 'var(--fs-body, 13px)', backgroundColor: 'var(--surface-2)', color: 'var(--text-primary)' }}>
          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>
            {it.kind === 'module'
              ? <span style={{ display:'inline-flex', alignItems:'center', gap:4 }}><Icon name="refresh" size={12} /> {modMap[it.module_id]?.name || it.module_id}{it.interval_min ? ` · ${it.interval_min}분마다` : ' · 1회'}</span>
              : it.kind === 'service'
              ? (() => {
                  const parts = []
                  if (it.on_start !== false) parts.push('시작')
                  if (it.interval_min) parts.push(`${it.interval_min}분마다`)
                  if (it.on_end) parts.push('끝')
                  return <>🌐 {it.title}{' '}<span style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>({svcMap[it.service_id]?.name || `service#${it.service_id}`} · {parts.length ? parts.join(' · ') : '수동'})</span></>
                })()
              : <>📝 {it.title}{' '}<span style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>({fmtMap[it.format_id]?.name})</span></>}
          </span>
          <button onClick={() => removeAt(idx)} disabled={busy} style={{ fontSize: 'var(--fs-small, 12px)', flexShrink:0, color: 'var(--danger-text)' }}><Icon name="close" size={13} /></button>
        </div>
      )
    }
    return (
      <div key={it.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, paddingLeft:10, paddingRight:10, paddingTop:6, paddingBottom:6, borderRadius:8, fontSize: 'var(--fs-body, 13px)', backgroundColor: 'var(--surface-2)', color: 'var(--text-primary)' }}>
        <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', display:'flex', alignItems:'center', gap:6 }}>
          <span style={{ fontFamily:'var(--font-mono)', fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>#{it.log_index}</span>
          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{it.title}</span>
          {it.task_status === 'pending' && (
            <span style={{ fontSize: 'var(--fs-micro, 10px)', paddingLeft:4, paddingRight:4, paddingTop:2, paddingBottom:2, borderRadius:4, flexShrink:0, backgroundColor: 'var(--warning-bg)', color: 'var(--warning-text)' }}>pending</span>
          )}
          {it.task_module && it.task_interval_min > 0 && (
            <span style={{ fontSize: 'var(--fs-micro, 10px)', paddingLeft:4, paddingRight:4, paddingTop:2, paddingBottom:2, borderRadius:4, flexShrink:0, display:'inline-flex', alignItems:'center', gap:4, backgroundColor: 'var(--success-bg)', color: 'var(--success-text)' }}><Icon name="refresh" size={10} /> {it.task_interval_min}m</span>
          )}
        </span>
        <button onClick={() => removeAt(idx, it)} disabled={busy} style={{ fontSize: 'var(--fs-small, 12px)', flexShrink:0, color: 'var(--danger-text)' }}><Icon name="close" size={13} /></button>
      </div>
    )
  }

  return (
    <Modal width={512}
      title={isTemplate ? `Manage tasks — ${formatName || `format#${formatId}`}` : `Manage task logs — #${motherId}`}
      onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose} style={{ width: '100%' }}>닫기</Button>}>
      <Stack gap={16}>
        {isTemplate && (
          <p style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)' }}>
            이 포멧으로 작성되는 <b>다음 로그부터</b> 아래 task들이 자동으로 등록됩니다.
          </p>
        )}

        {/* Current items */}
        <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
          <p style={{ ...labelStyle, color: 'var(--text-muted)' }}>
            {isTemplate ? `task 템플릿 (${items.length})` : `현재 task log (${items.length})`}
          </p>
          {items.length === 0
            ? <p style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>없음</p>
            : items.map(renderRow)}
        </div>

        {/* Add module */}
        <div style={{ display:'flex', flexDirection:'column', gap:6, borderWidth:1, borderStyle:'solid', borderRadius:8, padding:12, borderColor: 'var(--border-subtle)' }}>
          <p style={{ ...labelStyle, color: 'var(--text-muted)' }}>자동 모듈 추가</p>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center' }}>
            <select value={moduleSel} onChange={e => setModuleSel(e.target.value)} style={inputStyle}>
              <option value="">모듈 선택…</option>
              {modules.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input type="number" min="0" value={moduleInterval} onChange={e => setModuleInterval(e.target.value)}
                   placeholder="자동요청(분)" style={{ ...inputStyle, width: 110 }} />
            <button onClick={addModule} disabled={!moduleSel || busy}
                    style={{ fontSize: 'var(--fs-small, 12px)', paddingLeft:12, paddingRight:12, paddingTop:6, paddingBottom:6, borderRadius:8, fontWeight:500, backgroundColor: 'var(--info-bg)', color: 'var(--info-text)' }}>추가</button>
          </div>
        </div>

        {/* Add format */}
        <div style={{ display:'flex', flexDirection:'column', gap:6, borderWidth:1, borderStyle:'solid', borderRadius:8, padding:12, borderColor: 'var(--border-subtle)' }}>
          <p style={{ ...labelStyle, color: 'var(--text-muted)' }}>로그 포멧 추가 (나중에 Go로 채움)</p>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center' }}>
            <select value={formatSel} onChange={e => setFormatSel(e.target.value)} style={inputStyle}>
              <option value="">포멧 선택…</option>
              {formats.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
            <input value={formatTitle} onChange={e => setFormatTitle(e.target.value)} placeholder="타이틀"
                   style={{ ...inputStyle, flex: 1, minWidth: 120 }} />
            <button onClick={addFormat} disabled={!formatSel || busy}
                    style={{ fontSize: 'var(--fs-small, 12px)', paddingLeft:12, paddingRight:12, paddingTop:6, paddingBottom:6, borderRadius:8, fontWeight:500, backgroundColor: 'var(--surface-2)', color: 'var(--text-primary)', border: '1px solid var(--border-default)' }}>추가</button>
          </div>
        </div>

        {/* Add service (auto-fill from request_url) */}
        <div style={{ display:'flex', flexDirection:'column', gap:6, borderWidth:1, borderStyle:'solid', borderRadius:8, padding:12, borderColor: 'var(--border-subtle)' }}>
          <p style={{ ...labelStyle, color: 'var(--text-muted)' }}>서비스 자동 fill 추가</p>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8, alignItems:'center' }}>
            <select value={serviceSel} onChange={e => setServiceSel(e.target.value)} style={inputStyle}>
              <option value="">서비스 선택…</option>
              {reqServices.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <input value={serviceTitle} onChange={e => setServiceTitle(e.target.value)} placeholder="타이틀"
                   style={{ ...inputStyle, flex: 1, minWidth: 100 }} />
            <button onClick={addService} disabled={!serviceSel || busy}
                    style={{ fontSize: 'var(--fs-small, 12px)', paddingLeft:12, paddingRight:12, paddingTop:6, paddingBottom:6, borderRadius:8, fontWeight:500, backgroundColor: 'var(--info-bg)', color: 'var(--info-text)' }}>추가</button>
          </div>
          {/* 요청 빈도 — 시작할때 / N분마다 / 끝날때 (복수 선택 가능) */}
          <div style={{ display:'flex', flexWrap:'wrap', gap:'4px 14px', alignItems:'center', fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)' }}>
            <label style={{ display:'inline-flex', alignItems:'center', gap:5, cursor:'pointer' }}>
              <input type="checkbox" checked={serviceOnStart} onChange={e => setServiceOnStart(e.target.checked)} /> 시작할때
            </label>
            <label style={{ display:'inline-flex', alignItems:'center', gap:5 }}>
              <input type="checkbox" checked={serviceInterval !== '' && Number(serviceInterval) > 0}
                     onChange={e => setServiceInterval(e.target.checked ? '5' : '')} />
              <input type="number" min="1" value={serviceInterval} onChange={e => setServiceInterval(e.target.value)}
                     placeholder="N" style={{ ...inputStyle, width: 56, padding: '4px 6px' }} /> 분마다
            </label>
            <label style={{ display:'inline-flex', alignItems:'center', gap:5, cursor:'pointer' }}>
              <input type="checkbox" checked={serviceOnEnd} onChange={e => setServiceOnEnd(e.target.checked)} /> 끝날때
            </label>
          </div>
          {reqServices.length === 0 && (
            <p style={{ fontSize: 'var(--fs-tiny, 11px)', color: 'var(--text-muted)' }}>
              request_url이 등록된 서비스가 없습니다. 핸드셰이크로 서비스를 먼저 등록하세요.
            </p>
          )}
        </div>

        {error && (
          <div style={{ fontSize: 'var(--fs-small, 12px)', paddingLeft:12, paddingRight:12, paddingTop:8, paddingBottom:8, borderRadius:8, borderWidth:1, borderStyle:'solid', backgroundColor: 'var(--danger-bg)', borderColor: 'var(--danger-text)', color: 'var(--danger-text)' }}>
            {error}
          </div>
        )}

      </Stack>
    </Modal>
  )
}
