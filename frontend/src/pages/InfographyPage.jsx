import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { Icon, Modal, Button, Input, Badge, DataTable, ChipGroup, Row, Stack, Menu, DashboardGrid, TimeRangePicker, rangeBounds, useTaggables, SubTabs, openBarInput, closeBarInput } from 'lilak-ui'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { CommentsSection, ActionBtn, NumberBadge } from '../components/EntryShared'
import { useTagColors, synthChipProps } from '../utils/tagColors'
import {
  ResponsiveContainer, LineChart, Line,
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from 'recharts'

const SERIES_COLORS = ['#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#8b5cf6', '#ec4899', '#14b8a6']

// ── Variable helpers ──────────────────────────────────────────────────────────
function useVariables() {
  const [vars, setVars] = useState([])
  useEffect(() => {
    api.get('/infography/variables').then(r => setVars(Array.isArray(r.data) ? r.data : [])).catch(() => {})
  }, [])
  return vars
}
function varLabel(vars, key) { return vars.find(v => v.key === key)?.label || key }
function fmtTime(epoch) {
  if (epoch == null) return ''
  const d = new Date(epoch * 1000)
  if (isNaN(d)) return epoch
  const p = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

const fieldStyle = { background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 7, padding: '6px 9px', fontSize: 'var(--fs-body, 13px)', color: 'var(--text-primary)', outline: 'none' }

// ── Panel editor (Grafana "edit panel") — kit Modal ───────────────────────────
function PanelEditor({ initial, vars, onClose, onSaved }) {
  const [title, setTitle] = useState(initial?.title || '')
  const [tagsText, setTagsText] = useState((initial?.tags || []).join(', '))
  const [runSpec, setRunSpec] = useState(initial?.run_spec ?? '')
  const [source, setSource] = useState(initial?.source ?? '')
  const [xVars, setXVars] = useState(initial?.x_vars || [])
  const [yVars, setYVars] = useState(initial?.y_vars || [])
  const [sel, setSel] = useState(() => new Set())
  const [yExpr, setYExpr] = useState('')
  const [nBins, setNBins] = useState(initial?.n_bins ?? '')
  const [xMin, setXMin] = useState(initial?.x_min ?? '')
  const [xMax, setXMax] = useState(initial?.x_max ?? '')
  const [yMin, setYMin] = useState(initial?.y_min ?? '')
  const [yMax, setYMax] = useState(initial?.y_max ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const uniq = arr => [...new Set(arr)]
  function toggleSel(k) { setSel(prev => { const n = new Set(prev); n.has(k) ? n.delete(k) : n.add(k); return n }) }
  function assignX() { const next = uniq([...xVars, ...sel]); setXVars(next); if (next.length > 2) setYVars([]); setSel(new Set()) }
  function assignY() { if (xVars.length > 2) return; setYVars(uniq([...yVars, ...sel])); setSel(new Set()) }
  const removeX = k => setXVars(xVars.filter(v => v !== k))
  const removeY = k => setYVars(yVars.filter(v => v !== k))

  const canGraph = xVars.length >= 1 && xVars.length <= 2 && yVars.length >= 1
  const canHist = xVars.length >= 1 && yVars.length === 0
  const singleXHist = xVars.length === 1 && yVars.length === 0
  const lbl = k => varLabel(vars, k)

  async function save(kind) {
    if (!title.trim()) { setErr('제목을 입력하세요'); return }
    setBusy(true); setErr(null)
    try {
      const payload = {
        title: title.trim(), kind,
        x_vars: xVars, y_vars: kind === 'graph' ? yVars : [],
        n_bins: singleXHist && nBins !== '' ? Number(nBins) : null,
        x_min: xMin !== '' ? Number(xMin) : null, x_max: xMax !== '' ? Number(xMax) : null,
        y_min: yMin !== '' ? Number(yMin) : null, y_max: yMax !== '' ? Number(yMax) : null,
        tags: tagsText.split(',').map(s => s.trim()).filter(Boolean),
        run_spec: runSpec.trim() || null, source: source.trim() || null,
      }
      if (initial?.id) await api.put(`/infographs/${initial.id}`, payload)
      else await api.post('/infographs', payload)
      onSaved()
    } catch (e) { setErr(e.response?.data?.detail || '저장 실패') } finally { setBusy(false) }
  }

  function AxisList({ titleLabel, items, onRemove, color, dim }) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, opacity: dim ? 0.4 : 1 }}>
        <p style={{ fontSize: 'var(--fs-tiny, 11px)', fontWeight: 600, margin: '0 0 4px', color: 'var(--text-muted)' }}>{titleLabel}</p>
        <div style={{ border: '1px solid var(--border-default)', borderRadius: 8, flex: 1, overflowY: 'auto', padding: 4, minHeight: 150, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.length === 0 && <div style={{ fontSize: 'var(--fs-small, 12px)', padding: '4px 6px', color: 'var(--text-muted)' }}>없음</div>}
          {items.map(k => (
            <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4, padding: '4px 8px', borderRadius: 6, fontSize: 'var(--fs-small, 12px)', backgroundColor: color, color: '#fff' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{lbl(k)}</span>
              <button onClick={() => onRemove(k)} style={{ opacity: 0.85, flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', color: '#fff', display: 'inline-flex' }}><Icon name="close" size={13} /></button>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const footer = (
    <>
      <Button variant="ghost" onClick={onClose}>취소</Button>
      <Button variant="success" disabled={busy || !canGraph} onClick={() => save('graph')}>draw graph</Button>
      <Button variant="info" disabled={busy || !canHist} onClick={() => save('histogram')}>draw histogram</Button>
    </>
  )

  return (
    <Modal title={initial ? `Edit panel · ${initial.title}` : 'New panel'} width={720} onClose={onClose} footer={footer}
      onSubmit={() => { if (canGraph) save('graph'); else if (canHist) save('histogram') }}>
      <Stack gap={12}>
        <Input size="md" value={title} onChange={e => setTitle(e.target.value)} placeholder="title" autoFocus />

        {/* Axis range forcing */}
        <Row gap={6} wrap>
          <input type="number" value={nBins} disabled={!singleXHist} onChange={e => setNBins(e.target.value)} placeholder="nbins" title="히스토그램 빈 개수" style={{ ...fieldStyle, width: 90, opacity: singleXHist ? 1 : 0.4 }} />
          {[['x1', xMin, setXMin], ['x2', xMax, setXMax], ['y1', yMin, setYMin], ['y2', yMax, setYMax]].map(([ph, v, set]) => (
            <input key={ph} type="number" value={v} onChange={e => set(e.target.value)} placeholder={ph} style={{ ...fieldStyle, width: 72 }} />
          ))}
        </Row>

        <Input size="md" value={runSpec} onChange={e => setRunSpec(e.target.value)} placeholder="run 선택 (예: 1:80, 94:105, !77)" />
        <p style={{ fontSize: 'var(--fs-tiny, 11px)', margin: 0, lineHeight: 1.5, color: 'var(--text-muted)' }}>
          쉼표 <b>,</b> 로 여러 런, 콜론 <b>:</b> 으로 범위, 느낌표 <b>!</b> 로 제외.
          <span style={{ color: 'var(--text-secondary)' }}> x1·x2·y1·y2는 그래프 축 범위도 강제합니다.</span>
        </p>

        {/* Assign + y-expr */}
        <Row gap={8} wrap>
          <Button variant="info" disabled={sel.size === 0} onClick={assignX}>x 축으로 지정</Button>
          <Button variant="secondary" disabled={sel.size === 0 || xVars.length > 2} onClick={assignY}>y 축으로 지정</Button>
          <span style={{ flex: 1 }} />
          <input value={yExpr} onChange={e => setYExpr(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && yExpr.trim()) { setYVars(uniq([...yVars, yExpr.trim()])); setYExpr('') } }}
            placeholder="y 식 (예: {v3} / {v4} * 2)" style={{ ...fieldStyle, width: 220 }} title="변수는 {v1} 형태로" />
          <Button variant="secondary" disabled={!yExpr.trim() || xVars.length > 2} onClick={() => { if (yExpr.trim()) { setYVars(uniq([...yVars, yExpr.trim()])); setYExpr('') } }}>y 식 추가</Button>
        </Row>

        {/* Variable / x / y columns */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0,1fr))', gap: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <p style={{ fontSize: 'var(--fs-tiny, 11px)', fontWeight: 600, margin: '0 0 4px', color: 'var(--text-muted)' }}>변수 리스트</p>
            <div style={{ border: '1px solid var(--border-default)', borderRadius: 8, overflowY: 'auto', minHeight: 150, maxHeight: 220 }}>
              {vars.map(v => (
                <label key={v.key} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', fontSize: 'var(--fs-small, 12px)', cursor: 'pointer', borderBottom: '1px solid var(--border-subtle)', backgroundColor: sel.has(v.key) ? 'var(--info-bg)' : 'transparent' }}>
                  <input type="checkbox" checked={sel.has(v.key)} onChange={() => toggleSel(v.key)} />
                  {v.ref && (
                    <button type="button" title="y 식에 삽입" onClick={e => { e.preventDefault(); setYExpr(x => (x ? x + ' ' : '') + `{${v.ref}}`) }}
                      style={{ fontSize: 'var(--fs-micro, 10px)', fontFamily: 'var(--font-mono)', padding: '1px 4px', borderRadius: 4, flexShrink: 0, border: 'none', cursor: 'pointer', backgroundColor: 'var(--surface-2)', color: 'var(--text-link)' }}>{`{${v.ref}}`}</button>
                  )}
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-primary)' }}>{v.label}</span>
                </label>
              ))}
            </div>
          </div>
          <AxisList titleLabel="x 축" items={xVars} onRemove={removeX} color="#0ea5e9" />
          <AxisList titleLabel={`y 축${xVars.length > 2 ? ' (비활성)' : ''}`} items={yVars} onRemove={removeY} color="#10b981" dim={xVars.length > 2} />
        </div>

        <Row gap={8} wrap>
          <Input size="md" value={tagsText} onChange={e => setTagsText(e.target.value)} placeholder="태그 (쉼표로 구분)" style={{ flex: 1 }} />
          <Input size="md" value={source} onChange={e => setSource(e.target.value)} placeholder="source" style={{ width: 160 }} />
        </Row>

        {err && <div style={{ fontSize: 'var(--fs-small, 12px)', padding: '6px 10px', borderRadius: 8, backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)' }}>{err}</div>}
      </Stack>
    </Modal>
  )
}

// ── Chart renderer ────────────────────────────────────────────────────────────
function InfographChart({ ig, vars, refreshKey, timeRange, runOverride }) {
  const [data, setData] = useState(null)
  const xVars = ig.x_vars || []
  const yVars = ig.y_vars || []

  useEffect(() => {
    const x = xVars.join(',')
    const effRun = (runOverride && runOverride.trim()) || ig.run_spec
    const runs = effRun ? `&runs=${encodeURIComponent(effRun)}` : ''
    const q = ig.kind === 'graph'
      ? `/infography/data?x=${encodeURIComponent(x)}&y=${encodeURIComponent(yVars.join(','))}${runs}`
      : `/infography/data?x=${encodeURIComponent(x)}${runs}`
    api.get(q).then(r => setData(r.data)).catch(() => setData(null))
  }, [ig.x_vars, ig.y_vars, ig.kind, ig.run_spec, runOverride, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <Empty />

  // ── Stat (big number) ──
  if (ig.kind === 'stat') {
    const xs = (data.values && data.values.length ? data.values : (data.points || []).map(p => p.x)).filter(v => v != null)
    return <StatView values={xs} label={varLabel(vars, xVars[0])} />
  }

  if (data.mode === 'hist_sum') {
    if (!data.bins?.length) return <Empty />
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data.bins}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis dataKey="label" tick={{ fontSize: 'var(--fs-tiny, 11px)' }} /><YAxis tick={{ fontSize: 'var(--fs-tiny, 11px)' }} /><Tooltip />
          <Bar dataKey="value" fill="#6366f1" />
        </BarChart>
      </ResponsiveContainer>
    )
  }

  if (data.mode === 'hist') {
    const xs = data.values || []
    if (!xs.length) return <Empty />
    const isTime = xVars[0] === 'time'
    const lo = ig.x_min != null ? ig.x_min : Math.min(...xs)
    const hi = ig.x_max != null ? ig.x_max : Math.max(...xs)
    const bins = ig.n_bins && ig.n_bins > 0 ? ig.n_bins : 10
    const w = (hi - lo) / bins || 1
    const hist = Array.from({ length: bins }, (_, i) => {
      const center = lo + w * (i + 0.5)
      return { bin: isTime ? fmtTime(center) : center.toFixed(2).replace(/\.?0+$/, ''), count: 0 }
    })
    xs.forEach(x => { if (x < lo || x > hi) return; let i = Math.min(bins - 1, Math.floor((x - lo) / w)); if (i < 0) i = 0; hist[i].count++ })
    return (
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={hist}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
          <XAxis dataKey="bin" tick={{ fontSize: 'var(--fs-tiny, 11px)' }} label={{ value: varLabel(vars, xVars[0]), position: 'insideBottom', offset: -2, fontSize: 'var(--fs-tiny, 11px)' }} />
          <YAxis tick={{ fontSize: 'var(--fs-tiny, 11px)' }} allowDecimals={false} /><Tooltip />
          <Bar dataKey="count" fill="#6366f1" />
        </BarChart>
      </ResponsiveContainer>
    )
  }

  const points = data.points || []
  if (!points.length) return <Empty />
  const xIsTime = data.x === 'time'
  const sorted = [...points].sort((a, b) => a.x - b.x)
  const x2key = data.x2
  let x2Ticks = [], x2Label = {}
  if (x2key) {
    const seen = new Set()
    for (const p of sorted) { const v = p.x2; if (v == null) continue; if (!seen.has(v)) { seen.add(v); x2Ticks.push(p.x); x2Label[p.x] = v } }
  }
  // Time-range picker clamps the x domain for time-axis graphs (Grafana time window).
  const tClamp = xIsTime && timeRange && timeRange.from != null
  const xLo = tClamp ? timeRange.from / 1000 : (ig.x_min != null ? ig.x_min : 'auto')
  const xHi = tClamp ? timeRange.to / 1000 : (ig.x_max != null ? ig.x_max : 'auto')
  const xForced = tClamp || ig.x_min != null || ig.x_max != null
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={sorted} margin={{ top: x2key ? 22 : 5, right: 10, bottom: 5, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" />
        <XAxis type="number" dataKey="x" xAxisId={0} tick={{ fontSize: 'var(--fs-tiny, 11px)' }}
          domain={[xLo, xHi]}
          allowDataOverflow={xForced}
          tickFormatter={xIsTime ? fmtTime : undefined}
          label={{ value: varLabel(vars, data.x), position: 'insideBottom', offset: -2, fontSize: 'var(--fs-tiny, 11px)' }} />
        {x2key && (
          <XAxis type="number" dataKey="x" xAxisId="x2" orientation="top"
            domain={[xLo, xHi]}
            allowDataOverflow={xForced}
            ticks={x2Ticks} interval={0} tick={{ fontSize: 'var(--fs-micro, 10px)' }}
            tickFormatter={t => x2Label[t] != null ? x2Label[t] : ''}
            label={{ value: varLabel(vars, x2key), position: 'insideTop', offset: -18, fontSize: 'var(--fs-tiny, 11px)' }} />
        )}
        <YAxis tick={{ fontSize: 'var(--fs-tiny, 11px)' }} domain={[ig.y_min != null ? ig.y_min : 'auto', ig.y_max != null ? ig.y_max : 'auto']}
          allowDataOverflow={ig.y_min != null || ig.y_max != null} />
        <Tooltip labelFormatter={v => xIsTime ? fmtTime(v) : v} />
        {(data.y_vars || []).length > 1 && <Legend wrapperStyle={{ fontSize: 'var(--fs-tiny, 11px)' }} />}
        {(data.y_vars || []).map((yk, i) => (
          <Line key={yk} type="linear" dataKey={(d) => d[yk]} name={varLabel(vars, yk)}
            stroke={SERIES_COLORS[i % SERIES_COLORS.length]} dot={{ r: 3 }} isAnimationActive={false} connectNulls />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}
function Empty() {
  return <div style={{ height: '100%', minHeight: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>데이터 없음</div>
}

// Big-number "stat" panel (Grafana stat): latest value + mean/min/max/n.
function StatView({ values = [], label }) {
  if (!values.length) return <Empty />
  const n = values.length
  const last = values[n - 1]
  const mean = values.reduce((a, b) => a + b, 0) / n
  const min = Math.min(...values), max = Math.max(...values)
  const fmt = (v) => Number.isFinite(v) ? Number(v.toFixed(3)).toString() : '—'
  return (
    <div style={{ height: '100%', minHeight: 80, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 4 }}>
      <span style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>{label}</span>
      <span style={{ fontSize: 'clamp(28px, 6vw, 52px)', fontWeight: 700, lineHeight: 1, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>{fmt(last)}</span>
      <span style={{ fontSize: 'var(--fs-tiny, 11px)', color: 'var(--text-secondary)' }}>μ {fmt(mean)} · min {fmt(min)} · max {fmt(max)} · n {n}</span>
    </div>
  )
}

function exportNodePng(node, filename) {
  if (!node) return
  const svg = node.querySelector('svg')
  if (!svg) { window.alert('내보낼 그래프가 없습니다.'); return }
  const rect = svg.getBoundingClientRect()
  const w = Math.max(1, Math.round(rect.width)), h = Math.max(1, Math.round(rect.height))
  const clone = svg.cloneNode(true)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', w); clone.setAttribute('height', h)
  const xml = new XMLSerializer().serializeToString(clone)
  const svg64 = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml)))
  const img = new Image()
  img.onload = () => {
    const canvas = document.createElement('canvas')
    canvas.width = w * 2; canvas.height = h * 2
    const ctx = canvas.getContext('2d'); ctx.scale(2, 2)
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(img, 0, 0, w, h)
    canvas.toBlob(blob => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href) })
  }
  img.onerror = () => window.alert('이미지 변환에 실패했습니다.')
  img.src = svg64
}

function kindChipText(ig, vars) {
  const xs = (ig.x_vars || []).map(k => varLabel(vars, k))
  if (ig.kind === 'histogram') return `hist(${xs.join(', ')})`
  if (ig.kind === 'stat') return `stat(${xs.join(', ')})`
  return `${xs.join(',')} × ${(ig.y_vars || []).map(k => varLabel(vars, k)).join(', ')}`
}

// ── Panel: drag-grid cell that collapses (header only) / expands (chart+detail).
function InfographCard({ ig, vars, refreshKey, timeRange, runOverride, commentRefresh, open, focused, canManage, onToggle, onComment, onEdit, onDuplicate, onDeleted }) {
  const { user } = useAuth()
  const tagColors = useTagColors()
  const chartRef = useRef(null)
  const [comments, setComments] = useState([])
  const [openKey, setOpenKey] = useState(0)

  const loadComments = useCallback(() => {
    api.get(`/infographs/${ig.id}/comments`).then(r => setComments(r.data || [])).catch(() => {})
  }, [ig.id])
  useEffect(() => { if (open) { loadComments(); setOpenKey(k => k + 1) } }, [open, loadComments])
  useEffect(() => { if (open && commentRefresh) loadComments() }, [commentRefresh, open, loadComments])

  async function del() { if (!window.confirm('삭제할까요?')) return; await api.delete(`/infographs/${ig.id}`); onDeleted() }
  async function deleteComment(cid) { try { await api.delete(`/infographs/${ig.id}/comments/${cid}`); loadComments() } catch { /* ignore */ } }

  const tagChip = (tname) => {
    const { style } = synthChipProps(tname, tagColors)
    return <span key={tname} style={{ fontSize: 'var(--fs-tiny, 11px)', padding: '1px 8px', borderRadius: 999, ...style }}>#{tname}</span>
  }
  const kindChip = kindChipText(ig, vars)
  const menuItems = [
    ...(canManage ? [{ id: 'edit', label: '변수 편집', onSelect: () => onEdit(ig) }] : []),
    { id: 'export', label: '그림 내보내기', onSelect: () => exportNodePng(chartRef.current, `infograph-${ig.infograph_index ?? ig.id}.png`) },
    { id: 'comment', label: '댓글', onSelect: () => onComment && onComment(ig.id) },
    ...(canManage ? [{ id: 'duplicate', label: '복제', onSelect: () => onDuplicate(ig) }] : []),
    ...(canManage ? [{ id: 'remove', label: '삭제', onSelect: del }] : []),
  ]

  return (
    <div id={`infograph-card-${ig.id}`}
      style={{ height: '100%', display: 'flex', flexDirection: 'column', borderRadius: 10, overflow: 'hidden', backgroundColor: 'var(--surface)',
        border: '1px solid var(--border-default)', boxShadow: focused ? '0 0 0 2px var(--border-focus)' : '0 1px 2px rgba(0,0,0,0.04)' }}>
      {/* Header = drag handle. Buttons inside don't start a drag. */}
      <div data-drag-handle style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: open ? '1px solid var(--border-subtle)' : 'none', backgroundColor: 'var(--surface-2)', cursor: 'move', flexShrink: 0 }}>
        <NumberBadge>&{ig.infograph_index ?? ig.id}</NumberBadge>
        <Menu align="left" width={150}
          trigger={
            <button title="패널 메뉴" style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'var(--fs-body, 13px)', fontWeight: 500, color: 'var(--text-primary)', maxWidth: 180, overflow: 'hidden' }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ig.title}</span>
              <Icon name="caret-down" size={11} />
            </button>}
          sections={[{ items: menuItems }]} />
        {/* Collapsed = title only (like a log entry); details appear when open. */}
        {open && <span title={kindChip} style={{ fontSize: 'var(--fs-micro, 10px)', padding: '1px 6px', borderRadius: 4, fontFamily: 'var(--font-mono)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '32%', backgroundColor: 'var(--surface)', color: 'var(--text-secondary)' }}>{kindChip}</span>}
        <span style={{ flex: 1 }} />
        {open && <span style={{ fontSize: 'var(--fs-tiny, 11px)', color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{ig.author_name}</span>}
        <button onClick={onToggle} title={open ? '접기 (space)' : '펴기 (space)'} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'inline-flex', flexShrink: 0 }}>
          <Icon name={open ? 'caret-up' : 'caret-down'} size={14} />
        </button>
      </div>

      {open && (
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '10px 14px 12px' }}>
          <div ref={chartRef} style={{ height: 240, marginBottom: 10 }}>
            <InfographChart ig={ig} vars={vars} refreshKey={`${refreshKey}-${openKey}`} timeRange={timeRange} runOverride={runOverride} />
          </div>
          <Row gap={10} wrap style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)', marginBottom: 8 }}>
            {ig.created_at && <span>{new Date(ig.created_at).toLocaleString()}</span>}
            {ig.source && <span style={{ color: 'var(--text-link)' }}>{ig.source}</span>}
            {ig.run_spec && <Badge tone="neutral" mono>run {ig.run_spec}</Badge>}
            {(ig.tags || []).map(tagChip)}
          </Row>
          <Row gap={6} wrap style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 8 }}>
            <ActionBtn onClick={() => onComment && onComment(ig.id)} hoverFg="var(--text-link)" hoverBg="var(--info-bg)">댓글</ActionBtn>
            {canManage && <ActionBtn onClick={() => onEdit(ig)} hoverFg="var(--warning-text)" hoverBg="var(--warning-bg)">변수 편집</ActionBtn>}
            <ActionBtn onClick={() => exportNodePng(chartRef.current, `infograph-${ig.infograph_index ?? ig.id}.png`)} hoverFg="var(--text-link)" hoverBg="var(--info-bg)">그림 내보내기</ActionBtn>
            {canManage && <ActionBtn onClick={del} hoverFg="var(--danger-text)" hoverBg="var(--danger-bg)" extraClass="ml-auto"><span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="trash" size={13} /> 삭제</span></ActionBtn>}
          </Row>
          <CommentsSection comments={comments} user={user} onDelete={deleteComment} />
        </div>
      )}
    </div>
  )
}

// ── Google Sheets connection panel ────────────────────────────────────────────
function GSheetPanel() {
  const { user } = useAuth()
  const [status, setStatus] = useState(null)
  const [open, setOpen] = useState(false)
  const [creds, setCreds] = useState('')
  const [sheet, setSheet] = useState('')
  const [worksheet, setWorksheet] = useState('elog')
  const [autoSync, setAutoSync] = useState(true)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)

  const load = useCallback(() => { api.get('/infography/gsheet/config').then(r => setStatus(r.data)).catch(() => {}) }, [])
  useEffect(() => { load() }, [load])

  async function connect() {
    setBusy(true); setErr(null); setMsg(null)
    try {
      const r = await api.put('/infography/gsheet/config', { credentials_json: creds || undefined, spreadsheet: sheet, worksheet: worksheet || 'elog', auto_sync: autoSync })
      setMsg(`연결됨: ${r.data.spreadsheet_title || ''}`); setCreds(''); setOpen(false); load()
    } catch (e) { setErr(e.response?.data?.detail || '연결 실패') } finally { setBusy(false) }
  }
  async function syncNow() {
    setBusy(true); setErr(null); setMsg(null)
    try { const r = await api.post('/infography/gsheet/sync'); setMsg(`동기화 완료 (${r.data.rows}행)`); load() }
    catch (e) { setErr(e.response?.data?.detail || '동기화 실패') } finally { setBusy(false) }
  }
  async function disconnect() { if (!window.confirm('연결을 해제할까요?')) return; await api.delete('/infography/gsheet/config'); load() }
  async function toggleAuto() {
    setBusy(true)
    try { await api.put('/infography/gsheet/config', { spreadsheet: status.spreadsheet_id, worksheet: status.worksheet, auto_sync: !status.auto_sync }); load() }
    catch (e) { setErr(e.response?.data?.detail || '실패') } finally { setBusy(false) }
  }
  const isManager = user?.role === 'manager'

  return (
    <div style={{ border: '1px solid var(--border-default)', borderRadius: 12, padding: 12, backgroundColor: 'var(--surface-2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
      <Row gap={8} wrap>
        <span style={{ fontSize: 'var(--fs-body, 13px)', fontWeight: 600, color: 'var(--text-primary)' }}>Google Sheets</span>
        {status?.connected ? <Badge tone="success">연결됨</Badge> : <Badge tone="neutral">미연결</Badge>}
        <span style={{ flex: 1 }} />
        {status?.connected && <>
          <Button variant="info" disabled={busy} onClick={syncNow}>지금 동기화</Button>
          {isManager && <Button variant={status.auto_sync ? 'success' : 'secondary'} disabled={busy} onClick={toggleAuto}>자동동기화 {status.auto_sync ? 'ON' : 'OFF'}</Button>}
          {isManager && <Button variant="dangerSoft" onClick={disconnect}>해제</Button>}
        </>}
        {!status?.connected && isManager && <Button variant="info" onClick={() => setOpen(o => !o)}>연결 설정</Button>}
      </Row>

      {status?.connected && (
        <div style={{ fontSize: 'var(--fs-tiny, 11px)', color: 'var(--text-muted)' }}>
          {status.connected_email} · 시트 {status.spreadsheet_id?.slice(0, 10)}… / {status.worksheet}
          {status.last_synced_at && ` · 최근 동기화 ${new Date(status.last_synced_at).toLocaleString()}`}
        </div>
      )}
      {msg && <div style={{ fontSize: 'var(--fs-small, 12px)', padding: '4px 8px', borderRadius: 6, backgroundColor: 'var(--success-bg)', color: 'var(--success-text)' }}>{msg}</div>}
      {err && <div style={{ fontSize: 'var(--fs-small, 12px)', padding: '4px 8px', borderRadius: 6, backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)' }}>{err}</div>}

      {open && !status?.connected && (
        <Stack gap={8} style={{ paddingTop: 4 }}>
          <p style={{ fontSize: 'var(--fs-tiny, 11px)', margin: 0, color: 'var(--text-muted)' }}>① 서비스 계정 + Sheets API → ② JSON 키 → ③ 스프레드시트를 서비스 계정 이메일에 <b>편집자</b> 공유 → ④ 아래 입력</p>
          <textarea value={creds} onChange={e => setCreds(e.target.value)} rows={4} placeholder='서비스 계정 키 JSON 붙여넣기' style={{ ...fieldStyle, width: '100%', fontFamily: 'monospace', fontSize: 'var(--fs-tiny, 11px)', resize: 'vertical' }} />
          <Input size="md" value={sheet} onChange={e => setSheet(e.target.value)} placeholder="스프레드시트 URL 또는 ID" />
          <Row gap={8}>
            <Input size="md" value={worksheet} onChange={e => setWorksheet(e.target.value)} placeholder="워크시트 이름" style={{ width: 160 }} />
            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)' }}>
              <input type="checkbox" checked={autoSync} onChange={e => setAutoSync(e.target.checked)} /> 새 로그마다 자동동기화
            </label>
          </Row>
          <div><Button variant="success" disabled={busy || !creds || !sheet} onClick={connect}>{busy ? '연결 중…' : '연결 + 검증'}</Button></div>
        </Stack>
      )}
    </div>
  )
}

// ── Sheet tab — kit DataTable ─────────────────────────────────────────────────
function SheetTab() {
  const [data, setData] = useState({ columns: [], rows: [] })
  useEffect(() => { api.get('/infography/sheet').then(r => setData(r.data || { columns: [], rows: [] })).catch(() => {}) }, [])
  const fmt = v => v == null ? '' : (typeof v === 'number' ? Number(v).toFixed(2).replace(/\.?0+$/, '') : v)
  return (
    <Stack gap={12}>
      <GSheetPanel />
      <Row>
        <a href="/api/infography/sheet.csv" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 'var(--fs-small, 12px)', fontWeight: 500, padding: '5px 12px', borderRadius: 7, backgroundColor: 'var(--success-bg)', color: 'var(--success-text)', textDecoration: 'none' }}>
          <Icon name="download" size={13} /> CSV 내보내기
        </a>
      </Row>
      <div style={{ border: '1px solid var(--border-default)', borderRadius: 10, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <DataTable density="comfortable" rows={data.rows} rowKey={(_r, i) => i} emptyText="데이터 없음"
            columns={(data.columns || []).map(c => ({ key: c.key, header: c.label, mono: true, render: (row) => fmt(row[c.key]) }))} />
        </div>
      </div>
    </Stack>
  )
}

// ── Main page (Grafana-style dashboard) ───────────────────────────────────────
export default function InfographyPage() {
  const { user } = useAuth()
  const [subtab, setSubtab] = useState('graph')
  const vars = useVariables()
  const [infographs, setInfographs] = useState([])
  const [modal, setModal] = useState(null)         // null | {} (new) | infograph (edit)
  const [refreshKey, setRefreshKey] = useState(0)
  const [cols, setCols] = useState(() => Number(localStorage.getItem('infography_cols')) || 2)
  const [openIds, setOpenIds] = useState(() => new Set())
  const [focusedIdx, setFocusedIdx] = useState(0)
  const [commentBar, setCommentBar] = useState(null)   // { igId } | null
  const commentIgRef = useRef(null)                     // which infograph the bar comments on
  const [commentText, setCommentText] = useState('')
  const [commentRefresh, setCommentRefresh] = useState(0)
  const commentRef = useRef(null)
  const postingRef = useRef(false)
  // Grafana controls
  const [range, setRange] = useState(() => rangeBounds('all'))
  const [refresh, setRefresh] = useState('off')
  const [filterTag, setFilterTag] = useState('')
  const [runOverride, setRunOverride] = useState('')
  const [baseLayout, setBaseLayout] = useState(() => { try { return JSON.parse(localStorage.getItem('infography_layout') || '[]') } catch { return [] } })

  const COLLAPSED_H = 2, EXPANDED_H = 13
  const baseMap = useMemo(() => Object.fromEntries(baseLayout.map(l => [String(l.i), l])), [baseLayout])
  const shown = infographs.filter(ig => !filterTag || (ig.tags || []).includes(filterTag))

  // Effective layout = base positions/sizes, with collapsed panels shrunk to the header.
  const displayLayout = useMemo(() => shown.map((ig, i) => {
    const id = String(ig.id), b = baseMap[id]
    const w = b?.w ?? Math.round(12 / cols)
    const x = b?.x ?? (i % cols) * w
    const y = b?.y ?? Math.floor(i / cols) * EXPANDED_H
    return { i: id, x, y, w, h: openIds.has(ig.id) ? (b?.h ?? EXPANDED_H) : COLLAPSED_H }
  }), [shown, baseMap, openIds, cols])

  const saveLayout = useCallback((next) => {
    const nextBase = next.map(n => {
      const open = openIds.has(Number(n.i)) || openIds.has(n.i)
      return { i: String(n.i), x: n.x, y: n.y, w: n.w, h: open ? n.h : (baseMap[String(n.i)]?.h ?? EXPANDED_H) }
    })
    setBaseLayout(nextBase); localStorage.setItem('infography_layout', JSON.stringify(nextBase))
  }, [openIds, baseMap])

  function retile(n) {
    setCols(n); localStorage.setItem('infography_cols', n)
    const w = Math.round(12 / n)
    const next = shown.map((ig, i) => ({ i: String(ig.id), x: (i % n) * w, y: Math.floor(i / n) * EXPANDED_H, w, h: baseMap[String(ig.id)]?.h ?? EXPANDED_H }))
    setBaseLayout(next); localStorage.setItem('infography_layout', JSON.stringify(next))
  }

  const toggleOpen = useCallback((id) => {
    setOpenIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  }, [])
  const openAll = useCallback(() => setOpenIds(new Set(infographs.map(ig => ig.id))), [infographs])
  const closeAll = useCallback(() => setOpenIds(new Set()), [])

  async function duplicate(ig) {
    const { id, infograph_index, created_at, author_name, created_by, ...rest } = ig
    try { await api.post('/infographs', { ...rest, title: `${ig.title} (copy)` }); load() }
    catch (e) { window.alert('복제 실패: ' + (e.response?.data?.detail || e.message)) }
  }

  const load = useCallback(() => { api.get('/infographs').then(r => setInfographs(r.data || [])).catch(() => {}) }, [])
  useEffect(() => { load() }, [load])

  // Register figures into the data index so `&<number>` / `&name` finds them.
  useTaggables(() => infographs.map((ig) => ({
    id: `infograph:${ig.id}`,
    label: ig.title || `&${ig.infograph_index ?? ig.id}`,
    number: ig.infograph_index ?? ig.id,
    tags: ig.tags || [],
    kind: 'infograph',
    run: () => window.dispatchEvent(new CustomEvent('lilak:cmd:find-infograph', { detail: { number: ig.infograph_index ?? ig.id } })),
  })), [infographs])

  // Light live refresh of open charts.
  useEffect(() => { const id = setInterval(() => setRefreshKey(k => k + 1), 30000); return () => clearInterval(id) }, [])

  // '&N' opens infograph #N inline.
  useEffect(() => {
    function onFind(e) {
      const n = e.detail?.number
      if (n == null || Number.isNaN(n)) return
      const ig = infographs.find(g => g.infograph_index === n) || infographs.find(g => g.id === n)
      if (!ig) return
      setSubtab('graph'); setFocusedIdx(shown.indexOf(ig)); setOpenIds(prev => new Set(prev).add(ig.id))
      setTimeout(() => document.getElementById(`infograph-card-${ig.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 80)
    }
    window.addEventListener('lilak:cmd:find-infograph', onFind)
    return () => window.removeEventListener('lilak:cmd:find-infograph', onFind)
  }, [infographs, shown])

  // Keyboard nav: arrows + hjkl move focus, space/o/Enter toggle collapse, r comment.
  useEffect(() => {
    if (subtab !== 'graph' || modal) return
    function scrollTo(idx) { const ig = shown[idx]; if (ig) document.getElementById(`infograph-card-${ig.id}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }
    function onKey(e) {
      const el = document.activeElement
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        if (e.key === 'Escape' && commentBar) { e.preventDefault(); setCommentBar(null); el.blur() }
        return
      }
      if (e.metaKey || e.ctrlKey || e.altKey || !shown.length) return
      const move = (delta) => setFocusedIdx(i => { const n = Math.max(0, Math.min(shown.length - 1, i + delta)); scrollTo(n); return n })
      switch (e.key) {
        case 'l': case 'ArrowRight': e.preventDefault(); move(1); break
        case 'h': case 'ArrowLeft': e.preventDefault(); move(-1); break
        case 'j': case 'ArrowDown': e.preventDefault(); move(cols); break
        case 'k': case 'ArrowUp': e.preventDefault(); move(-cols); break
        case 'G': case 'End': e.preventDefault(); setFocusedIdx(() => { const n = shown.length - 1; scrollTo(n); return n }); break
        case 'g': case 'Home': e.preventDefault(); setFocusedIdx(() => { scrollTo(0); return 0 }); break
        case 'o': case ' ': case 'Enter': { e.preventDefault(); const ig = shown[focusedIdx]; if (ig) toggleOpen(ig.id); break }
        case 'r': case ',': {
          e.preventDefault(); const ig = shown[focusedIdx]
          if (ig) { setOpenIds(prev => new Set(prev).add(ig.id)); openInfographComment(ig.id) }
          break
        }
        case 'Escape': { const ig = shown[focusedIdx]; if (ig && openIds.has(ig.id)) { e.preventDefault(); toggleOpen(ig.id) } break }
        default: break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [subtab, modal, shown, focusedIdx, cols, openIds, toggleOpen, commentBar])

  // Comment on an infograph via the ONE collapsible bottom bar (no separate bar).
  function openInfographComment(igId) {
    const idx = infographs.find(g => g.id === igId)?.infograph_index ?? ''
    commentIgRef.current = igId
    const done = () => { commentIgRef.current = null; closeBarInput() }
    openBarInput({
      key: `ig-comment-${igId}`,
      label: `&${idx} 댓글`,
      placeholder: '댓글을 입력하고 Enter…',
      hint: 'Enter ↵',
      onSubmit: async (text) => {
        const body = (text || '').trim()
        if (body) { try { await api.post(`/infographs/${igId}/comments`, { body }); setCommentRefresh(k => k + 1) } catch { /* silent */ } }
        done()
      },
      onCancel: done,
    })
  }
  // Close the comment bar when its infograph collapses, or on unmount / leaving.
  useEffect(() => { if (commentIgRef.current != null && !openIds.has(commentIgRef.current)) { commentIgRef.current = null; closeBarInput() } }, [openIds])
  useEffect(() => () => closeBarInput(), [])

  const canManage = (ig) => user && (user.role === 'manager' || user.username === ig.created_by)
  const availableTags = [...new Set(infographs.flatMap(ig => ig.tags || []))].sort()

  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 16px 64px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Sub-tabs — kit SubTabs (shared across Data / Files / Schedule) */}
      <SubTabs tabs={[['graph', 'Infography'], ['sheet', 'Sheet']]} active={subtab} onChange={setSubtab} />


      {subtab === 'graph' && (
        <Stack gap={12}>
          {/* Toolbar: new panel · expand/collapse all · $tag/$run · columns · time range */}
          <Row gap={8} wrap>
            {user && <Button variant="success" onClick={() => setModal({})}><Row gap={4} align="center" as="span"><Icon name="plus" size={14} /> New panel</Row></Button>}
            {infographs.length > 0 && <>
              <Button variant="secondary" onClick={openAll}>전체 열기</Button>
              <Button variant="secondary" onClick={closeAll}>전체 접기</Button>
            </>}

            <Menu align="left" width={180}
              trigger={<span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, height: 28, padding: '0 10px', border: '1px solid var(--border-default)', borderRadius: 8, cursor: 'pointer', background: 'var(--surface)', fontSize: 'var(--fs-small, 12px)', color: 'var(--text-primary)' }}>
                <span style={{ color: 'var(--text-muted)' }}>$tag</span> {filterTag || 'All'} <Icon name="caret-down" size={12} /></span>}
              sections={[{ items: [{ id: '', label: 'All', active: !filterTag, onSelect: () => setFilterTag('') }, ...availableTags.map(t => ({ id: t, label: `#${t}`, active: filterTag === t, onSelect: () => setFilterTag(t) }))] }]} />
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, height: 28, padding: '0 4px 0 10px', border: '1px solid var(--border-default)', borderRadius: 8, background: 'var(--surface)' }}>
              <span style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>$run</span>
              <input value={runOverride} onChange={e => setRunOverride(e.target.value)} placeholder="all"
                style={{ width: 90, border: 'none', background: 'transparent', outline: 'none', fontSize: 'var(--fs-small, 12px)', color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }} title="모든 패널에 적용할 run 범위 (예: 1:80)" />
            </span>

            <span style={{ flex: 1 }} />
            <ChipGroup label="" value={cols} onChange={retile}
              options={[1, 2, 3].map(n => ({ value: n, label: String(n) }))}
              style={{ display: 'flex', alignItems: 'center', gap: 8 }} />
            <TimeRangePicker range={range.key} refresh={refresh}
              onRangeChange={setRange} onRefreshChange={setRefresh} onRefresh={() => setRefreshKey(k => k + 1)} />
          </Row>

          {shown.length === 0
            ? <p style={{ textAlign: 'center', padding: '40px 0', fontSize: 'var(--fs-body, 13px)', color: 'var(--text-muted)' }}>{filterTag ? '해당 태그의 패널이 없습니다.' : '아직 infograph가 없습니다.'}</p>
            : (
              <DashboardGrid cols={12} rowHeight={24} gap={10} layout={displayLayout} onLayoutChange={saveLayout} defaultW={Math.round(12 / cols)} defaultH={EXPANDED_H} editable>
                {shown.map((ig, idx) => (
                  <div key={String(ig.id)} style={{ height: '100%' }}>
                    <InfographCard ig={ig} vars={vars} refreshKey={refreshKey} timeRange={range} runOverride={runOverride} commentRefresh={commentRefresh}
                      open={openIds.has(ig.id)} focused={idx === focusedIdx} canManage={canManage(ig)}
                      onToggle={() => { setFocusedIdx(idx); toggleOpen(ig.id) }}
                      onComment={(id) => { setFocusedIdx(idx); openInfographComment(id) }}
                      onEdit={setModal} onDuplicate={duplicate} onDeleted={load} />
                  </div>
                ))}
              </DashboardGrid>
            )}
        </Stack>
      )}

      {subtab === 'sheet' && <SheetTab />}

      {modal && (
        <PanelEditor initial={modal.id ? modal : null} vars={vars}
          onClose={() => setModal(null)} onSaved={() => { setModal(null); load() }} />
      )}
    </div>
  )
}
