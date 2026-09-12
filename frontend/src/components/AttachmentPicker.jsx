/**
 * AttachmentPicker — pick files that are already in this logbook and attach
 * them to the log being written.
 *
 * The same files the Files tab lists, in a grid: images as thumbnails, anything
 * else as a filename chip. Multi-select, then Attach. The bytes are copied into
 * the target log server-side (`POST /logs/{id}/attachments/link`), so the two
 * logs' attachments are independent afterwards — deleting one never disturbs
 * the other.
 */
import { useEffect, useState } from 'react'
import { Modal, Button, Input, Icon } from 'lilak-ui'
import api, { apiBaseFor, getExperiment } from '../api'

const isImg = (a) => a.content_type
  ? a.content_type.startsWith('image/')
  : /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(a.original_filename || '')

function fmtSize(n) {
  if (!n && n !== 0) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function AttachmentPicker({ onPick, onClose }) {
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(() => new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Debounced so typing does not fire a request per keystroke.
    const id = setTimeout(() => {
      setLoading(true)
      api.get('/attachments', { params: { page_size: 120, q: q.trim() || undefined } })
        .then(r => setItems(r.data?.items || []))
        .catch(() => setItems([]))
        .finally(() => setLoading(false))
    }, q ? 250 : 0)
    return () => clearTimeout(id)
  }, [q])

  const href = (a) => `${apiBaseFor(getExperiment())}/attachments/${a.id}`
  const toggle = (id) => setSel(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const picked = items.filter(a => sel.has(a.id))

  return (
    <Modal title="파일에서 선택" width={720} onClose={onClose}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
          <span style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>
            {sel.size ? `${sel.size}개 선택됨` : '첨부할 파일을 고르세요'}
          </span>
          <span style={{ flex: 1 }} />
          <Button variant="secondary" onClick={onClose}>취소</Button>
          <Button disabled={!sel.size} onClick={() => { onPick(picked); onClose() }}>첨부</Button>
        </div>
      }>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Input size="md" value={q} onChange={e => setQ(e.target.value)} placeholder="파일 이름으로 검색…" />
        <div style={{ maxHeight: '52vh', overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {loading && <span style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>불러오는 중…</span>}
          {!loading && items.length === 0 && (
            <span style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>파일이 없습니다.</span>
          )}
          {items.map(a => {
            const on = sel.has(a.id)
            return (
              <button key={a.id} type="button" onClick={() => toggle(a.id)} title={a.original_filename}
                style={{
                  position: 'relative', padding: 0, borderRadius: 8, overflow: 'hidden', cursor: 'pointer',
                  border: `2px solid ${on ? 'var(--border-focus)' : 'var(--border-default)'}`,
                  backgroundColor: on ? 'var(--info-bg)' : 'var(--surface-2)',
                  width: 116, height: 116, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 4,
                }}>
                {isImg(a)
                  ? <img src={href(a)} alt={a.original_filename} loading="lazy"
                         style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  : <>
                      <Icon name="file" size={22} />
                      <span style={{ fontSize: 'var(--fs-tiny, 11px)', color: 'var(--text-secondary)',
                                     maxWidth: '96%', overflow: 'hidden', textOverflow: 'ellipsis',
                                     whiteSpace: 'nowrap', padding: '0 4px' }}>{a.original_filename}</span>
                      <span style={{ fontSize: 'var(--fs-micro, 10px)', color: 'var(--text-muted)' }}>{fmtSize(a.size)}</span>
                    </>}
                {on && (
                  <span style={{ position: 'absolute', top: 4, right: 4, borderRadius: 999, lineHeight: 0,
                                 padding: 3, backgroundColor: 'var(--border-focus)', color: '#fff' }}>
                    <Icon name="check" size={11} weight="bold" />
                  </span>
                )}
                {/* which run it came off — the listing carries the run, not the
                    log number, and the run is the more useful of the two here */}
                {a.log_run_number != null && (
                  <span style={{ position: 'absolute', bottom: 0, left: 0, right: 0, fontSize: 'var(--fs-micro, 10px)',
                                 padding: '1px 4px', textAlign: 'left', color: '#fff',
                                 background: 'rgba(0,0,0,0.45)', fontFamily: 'var(--font-mono)' }}>
                    *{a.log_run_number}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </Modal>
  )
}
