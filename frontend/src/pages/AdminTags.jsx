import { useState, useEffect, useCallback } from 'react'
import { Icon, ColorPicker, Modal, Button, Input, Stack } from 'lilak-ui'
import { useNavigate } from 'react-router-dom'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { refreshTagColors, synthChipProps, chipProps, BORDER_TAGS, DEFAULT_TAG_COLORS, textOn } from '../utils/tagColors'

// The color swatch should show the SAME text color the chip displays: when no
// explicit text color is set, chips pick a readable color via textOn(bg).
const resolvedText = (rawText, bgColor, name) => {
  if (rawText) return rawText
  const eb = bgColor === 'theme' ? '' : (bgColor || DEFAULT_TAG_COLORS[name] || '')
  return eb ? textOn(eb) : ''
}

// Synthetic tags (derived from log fields) — color/border configurable.
const SYSTEM_TAGS = [
  { name: 'init',    note: 'Init 상태' },
  { name: 'start',   note: 'Start 상태' },
  { name: 'running', note: 'Running 상태' },
  { name: 'end',     note: 'End 상태' },
  { name: 'idle',    note: 'IDLE 상태' },
  { name: 'pending', note: '미입력 task' },
  { name: 'auto',    note: '자동 생성 로그' },
  { name: 'task',    note: 'task 로그' },
  { name: 'confirm', note: '확인 필요' },
]

// Chip color controls — one kit ColorPicker (parts: background / border / text)
// + theme-bg, no-border, reset, copy/paste utilities.
function ColorControls({ bg, border, text, onBg, onBorder, onText, onClearBg, onClearBorder, onReset, onCopy, onPaste, canPaste }) {
  const pBg = bg || '#888888'
  const pBorder = (border && border !== 'none') ? border : '#4b5563'
  const pText = text || '#111827'
  const util = { fontSize: 'var(--fs-micro)', padding: '2px 7px', borderRadius: 6, background: 'none', cursor: 'pointer', border: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
      <ColorPicker size={22} title="배경·테두리·글씨 색"
        parts={{ background: pBg, border: pBorder, text: pText }}
        labels={{ background: '배경', border: '테두리', text: '글씨' }}
        onPartsChange={(p) => {
          if (p.background !== pBg) onBg(p.background)
          else if (p.border !== pBorder) onBorder(p.border)
          else if (p.text !== pText) onText(p.text)
        }} />
      <button onClick={onClearBg} style={util} title="배경을 테마색(sky)으로">배경 테마색</button>
      <button onClick={onClearBorder} style={util} title="테두리 없애기">테두리 없음</button>
      {onReset && <button onClick={onReset} style={util} title="기본 색상으로 되돌리기">기본값</button>}
      <button onClick={onCopy} style={util} title="이 색 복사">복사</button>
      <button onClick={onPaste} disabled={!canPaste} style={{ ...util, color: 'var(--text-link)', opacity: canPaste ? 1 : 0.3 }} title="복사한 색 적용">붙여넣기</button>
    </span>
  )
}

// Popup for rename / merge / delete of a tag (opened by clicking the chip).
function TagEditPopup({ tag, tags, onClose, onChanged }) {
  const [name, setName] = useState(tag.name)
  const [mergeId, setMergeId] = useState('')
  const [err, setErr] = useState(null)
  const builtin = tag.builtin

  async function doRename() {
    const n = name.trim()
    if (!n || n === tag.name) { onClose(); return }
    try { await api.put(`/tags/${tag.id}`, { name: n }); onChanged(); onClose() }
    catch (e) { setErr(e.response?.data?.detail || '이름 변경 실패') }
  }
  async function doMerge() {
    if (!mergeId) return
    const dst = tags.find(t => String(t.id) === String(mergeId))
    if (!dst || !window.confirm(`'${tag.name}' 를 '${dst.name}' 에 합칠까요?`)) return
    try { await api.post(`/tags/${tag.id}/merge-into/${mergeId}`); onChanged(); onClose() }
    catch (e) { setErr(e.response?.data?.detail || '합치기 실패') }
  }
  async function doDelete() {
    if (!window.confirm(`태그 '${tag.name}' (${tag.count}개 로그)를 삭제할까요?`)) return
    try { await api.delete(`/tags/${tag.id}`); onChanged(); onClose() }
    catch (e) { setErr(e.response?.data?.detail || '삭제 실패') }
  }

  const fldStyle = { width: '100%', backgroundColor: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 8, padding: '6px 8px', fontSize: 'var(--fs-body)', color: 'var(--text-primary)', outline: 'none' }
  const lbl = { display: 'block', fontSize: 'var(--fs-tiny)', fontWeight: 600, marginBottom: 6, color: 'var(--text-muted)' }

  return (
    <Modal title={`#${tag.name} 관리`} width={400} onClose={onClose} onSubmit={builtin ? undefined : doRename}>
      <Stack gap={16}>
        {builtin && <p style={{ margin: 0, fontSize: 'var(--fs-small)', color: 'var(--text-muted)' }}>빌트인 태그는 이름변경·합치기·삭제할 수 없습니다.</p>}
        {err && <div style={{ fontSize: 'var(--fs-small)', padding: '8px 12px', borderRadius: 8, backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)' }}>{err}</div>}

        {!builtin && (
          <div>
            <label style={lbl}>이름 바꾸기</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input size="md" value={name} onChange={e => { setName(e.target.value); setErr(null) }} onKeyDown={e => { if (e.key === 'Enter') doRename() }} style={{ flex: 1 }} />
              <Button variant="info" size="md" onClick={doRename}>저장</Button>
            </div>
          </div>
        )}

        {!builtin && (
          <div>
            <label style={lbl}>다른 태그에 합치기</label>
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={mergeId} onChange={e => setMergeId(e.target.value)} style={fldStyle}>
                <option value="">대상 선택…</option>
                {tags.filter(t => t.id !== tag.id).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <Button variant="warning" size="md" disabled={!mergeId} onClick={doMerge}>합치기</Button>
            </div>
          </div>
        )}

        {!builtin && (
          <div style={{ borderTop: '1px solid var(--border-subtle)', paddingTop: 12 }}>
            <Button variant="dangerSoft" onClick={doDelete}>태그 삭제</Button>
          </div>
        )}
      </Stack>
    </Modal>
  )
}

export default function AdminTags() {
  const { user } = useAuth()
  const navigate = useNavigate()

  const [tags, setTags] = useState([])
  const [sys, setSys] = useState({})          // name → {color, border, text}
  const [counts, setCounts] = useState({})    // synthetic tag → usage count
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState(null)
  const [err, setErr] = useState(null)
  const [clip, setClip] = useState(null)   // copied {color, border_color, text_color}
  const [editTag, setEditTag] = useState(null)   // tag whose name/merge popup is open

  const load = useCallback(() => {
    setLoading(true)
    api.get('/tags/manage').then(r => setTags(r.data || [])).catch(() => {}).finally(() => setLoading(false))
    api.get('/tags/colors').then(r => setSys(r.data || {})).catch(() => {})
    api.get('/tags/system-counts').then(r => setCounts(r.data || {})).catch(() => {})
  }, [])

  useEffect(() => {
    if (!user || user.role !== 'manager') { navigate('/', { replace: true }); return }
    load()
  }, [user, load, navigate])

  function flash(setter, v) { setter(v); setTimeout(() => setter(null), 2500) }

  async function patchSystem(name, patch) {
    setErr(null)
    try { await api.put(`/tags/system/${name}`, patch); refreshTagColors(); load() }
    catch (e) { flash(setErr, e.response?.data?.detail || '변경 실패') }
  }
  async function patchTag(tag, patch) {
    setErr(null)
    try { await api.put(`/tags/${tag.id}`, patch); refreshTagColors(); load() }
    catch (e) { flash(setErr, e.response?.data?.detail || '변경 실패') }
  }

  if (!user || user.role !== 'manager') return null

  const card = { backgroundColor: 'var(--surface)', borderColor: 'var(--border-default)' }
  const header = { backgroundColor: 'var(--surface-2)', borderColor: 'var(--border-subtle)', color: 'var(--text-secondary)' }

  const Chip = ({ name, props }) => (
    <span className={`text-xs px-2.5 py-1 rounded-full inline-block ${props.className}`} style={props.style}>#{name}</span>
  )

  // Color controls bound to a real DB tag.
  const dbTagControls = (tag) => (
    <ColorControls
      bg={tag.color === 'theme' ? '' : (tag.color || '')} border={tag.border_color || ''} text={resolvedText(tag.text_color, tag.color, tag.name)}
      onBg={c => patchTag(tag, { color: c })}
      onBorder={c => patchTag(tag, { border_color: c })}
      onText={c => patchTag(tag, { text_color: c })}
      onClearBg={() => patchTag(tag, { color: 'theme' })}
      onClearBorder={() => patchTag(tag, { border_color: 'none' })}
      onReset={() => patchTag(tag, { color: '', border_color: '', text_color: '' })}
      onCopy={() => setClip({ color: tag.color || 'theme', border_color: tag.border_color || 'none', text_color: tag.text_color || '' })}
      onPaste={() => clip && patchTag(tag, clip)}
      canPaste={!!clip}
    />
  )

  const builtinTags = tags.filter(t => t.builtin)
  const userTags = tags.filter(t => !t.builtin)

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-20">
      {msg && <div className="text-sm px-4 py-2 rounded-lg" style={{ backgroundColor: 'var(--success-bg)', color: 'var(--success-text)' }}>{msg}</div>}
      {err && <div className="text-sm px-4 py-2 rounded-lg" style={{ backgroundColor: 'var(--danger-bg)', color: 'var(--danger-text)' }}>{err}</div>}

      {/* System tags */}
      <div className="rounded-xl border shadow-sm overflow-hidden" style={card}>
        <div className="px-5 py-3 border-b text-sm font-semibold" style={header}>시스템 태그 (배경·테두리 색 변경)</div>
        <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
          {SYSTEM_TAGS.map(s => {
            const cfg = sys[s.name] || {}
            return (
              <div key={s.name} className="flex items-center gap-2 px-4 py-2">
                <Chip name={s.name} props={synthChipProps(s.name, sys)} />
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.note}</span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· {counts[s.name] ?? 0}개</span>
                <span className="flex-1" />
                <ColorControls
                  bg={cfg.color === 'theme' ? '' : (cfg.color || DEFAULT_TAG_COLORS[s.name] || '')}
                  border={cfg.border || BORDER_TAGS[s.name] || ''}
                  text={resolvedText(cfg.text, cfg.color, s.name)}
                  onBg={c => patchSystem(s.name, { color: c })}
                  onBorder={c => patchSystem(s.name, { border_color: c })}
                  onText={c => patchSystem(s.name, { text_color: c })}
                  onClearBg={() => patchSystem(s.name, { color: 'theme' })}
                  onClearBorder={() => patchSystem(s.name, { border_color: 'none' })}
                  onReset={() => patchSystem(s.name, { color: '', border_color: '', text_color: '' })}
                  onCopy={() => setClip({
                    color: cfg.color || DEFAULT_TAG_COLORS[s.name] || 'theme',
                    border_color: cfg.border || BORDER_TAGS[s.name] || 'none',
                    text_color: cfg.text || '',
                  })}
                  onPaste={() => clip && patchSystem(s.name, clip)}
                  canPaste={!!clip}
                />
              </div>
            )
          })}
          {/* Built-in DB tags — also system-managed (no rename/merge/delete). */}
          {builtinTags.map(tag => (
            <div key={tag.id} className="flex items-center gap-2 px-4 py-2">
              <Chip name={tag.name} props={chipProps(tag.name, tag.color, tag.border_color, tag.text_color)} />
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--surface)', color: 'var(--text-muted)' }}>built-in</span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>· {tag.count}개</span>
              <span className="flex-1" />
              {dbTagControls(tag)}
            </div>
          ))}
        </div>
      </div>

      {/* User tags */}
      <div className="rounded-xl border shadow-sm overflow-hidden" style={card}>
        <div className="px-5 py-3 border-b text-sm font-semibold" style={header}>
          {loading ? '불러오는 중…' : `태그 (${userTags.length})`}
        </div>
        {!loading && userTags.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>태그가 없습니다.</p>
        ) : (
          <div className="divide-y" style={{ borderColor: 'var(--border-subtle)' }}>
            {userTags.map(tag => (
              <div key={tag.id} className="flex items-center gap-2 px-4 py-2">
                <button onClick={() => setEditTag(tag)} title="이름변경·합치기·삭제">
                  <Chip name={tag.name} props={chipProps(tag.name, tag.color, tag.border_color, tag.text_color)} />
                </button>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{tag.count}개</span>
                <span className="flex-1" />
                {dbTagControls(tag)}
              </div>
            ))}
          </div>
        )}
      </div>

      {editTag && (
        <TagEditPopup tag={editTag} tags={tags} onClose={() => setEditTag(null)} onChanged={load} />
      )}
    </div>
  )
}
