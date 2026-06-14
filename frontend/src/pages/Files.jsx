import { useState, useEffect, useCallback, useRef } from 'react'
import { Icon, DataCard, DataGrid, Pagination, Input, Button, Row, ChipGroup } from 'lilak-ui'
import { useTaggables, useBookmarks } from 'lilak-ui'
import api, { apiBaseFor, getExperiment } from '../api'
import { useLang } from '../context/LangContext'
import { useTab } from '../context/TabContext'

// Experiment-aware attachment URL (raw <img>/<a> bypass axios' baseURL).
const attUrl = (id) => `${apiBaseFor(getExperiment())}/attachments/${id}`

const PAGE_SIZE = 50

function formatSize(bytes) {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

const isImage = (ct) => !!ct && ct.startsWith('image/')
const isText = (ct) => !!ct && (ct.startsWith('text/') || ct.includes('json') || ct.includes('xml') || ct.includes('csv'))

function fileTypeLabel(ct) {
  if (!ct) return 'file'
  if (ct.startsWith('image/')) return 'img'
  if (ct.startsWith('video/')) return 'vid'
  if (ct.startsWith('audio/')) return 'aud'
  if (ct.includes('pdf')) return 'pdf'
  if (ct.includes('zip') || ct.includes('tar')) return 'zip'
  if (isText(ct)) return 'txt'
  return 'file'
}

// Browse files as DATA COMPONENTS: collapsed shows name + type + tags; opening a
// card reveals the data inline — the picture if it's an image, the text if it's
// text, otherwise a download/metadata panel. Grid focus nav + space toggle and
// the `^<number>` command-bar index come from the kit (DataGrid / data index).
export default function Files() {
  const { t } = useLang()
  const { activateTab } = useTab()

  const openLogInTab = useCallback((id) => {
    if (!id) return
    activateTab('logs')
    setTimeout(() => window.dispatchEvent(new CustomEvent('lilak:cmd:open-log', { detail: { id: Number(id) } })), 100)
  }, [activateTab])

  const [items, setItems] = useState([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)
  const [q, setQ] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [cols, setCols] = useState(3)
  const [openIds, setOpenIds] = useState(() => new Set())
  const [focusIdx, setFocusIdx] = useState(-1)
  const [textCache, setTextCache] = useState({})  // id -> text | 'ERR' | undefined(loading)
  const itemsRef = useRef(items)
  itemsRef.current = items
  const bm = useBookmarks()

  const load = useCallback((pageNum, query) => {
    setLoading(true); setLoadErr(null)
    const params = new URLSearchParams({ page: pageNum, page_size: PAGE_SIZE })
    if (query) params.set('q', query)
    api.get(`/attachments?${params}`)
      .then(r => { setItems(r.data.items ?? []); setTotal(r.data.total ?? 0); setOpenIds(new Set()); setFocusIdx(-1) })
      .catch(err => setLoadErr(err.response?.data?.detail || err.message || 'Load failed'))
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load(page, q) }, [page, q, load])

  function handleSearch(e) { e.preventDefault(); setPage(1); setQ(searchInput.trim()) }

  // Open a card by id (used by the `^<number>` command index and by toggling).
  const openCard = useCallback((id, force) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      const willOpen = force != null ? force : !next.has(id)
      if (willOpen) next.add(id); else next.delete(id)
      return next
    })
    const i = itemsRef.current.findIndex((it) => it.id === id)
    if (i >= 0) setFocusIdx(i)
  }, [])

  // Lazily fetch text content the first time a text file is opened.
  useEffect(() => {
    for (const it of items) {
      if (!openIds.has(it.id) || !isText(it.content_type)) continue
      if (textCache[it.id] !== undefined) continue
      setTextCache((c) => ({ ...c, [it.id]: undefined }))
      api.get(`/attachments/${it.id}`, { responseType: 'text' })
        .then((r) => setTextCache((c) => ({ ...c, [it.id]: typeof r.data === 'string' ? r.data : JSON.stringify(r.data, null, 2) })))
        .catch(() => setTextCache((c) => ({ ...c, [it.id]: 'ERR' })))
    }
  }, [openIds, items]) // eslint-disable-line

  // Register every file into the kit tag index so `^<number>` / `^name` finds it.
  useTaggables(() => items.map((it, i) => ({
    id: `file:${it.id}`,
    label: it.original_filename,
    number: i + 1,
    kind: isImage(it.content_type) ? 'photo' : 'file',
    tags: (it.log_tags || []).map((tg) => tg.name),
    keywords: `${fileTypeLabel(it.content_type)} ${it.log_title || ''} #${it.log_id ?? ''}`,
    run: () => openCard(it.id, true),
  })), [items, openCard])

  function mediaFor(it) {
    if (isImage(it.content_type)) return { type: 'image', src: attUrl(it.id) }
    if (isText(it.content_type)) {
      const txt = textCache[it.id]
      return { type: 'text', text: txt === 'ERR' ? '(미리보기를 불러오지 못했습니다)' : txt === undefined ? '로딩 중…' : txt }
    }
    return { type: 'node', node: (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)' }}>
        <Row gap={16} wrap>
          <span>{fileTypeLabel(it.content_type).toUpperCase()}</span>
          <span>{formatSize(it.size)}</span>
          <span>{new Date(it.created_at).toLocaleDateString()}</span>
        </Row>
        <a href={attUrl(it.id)} download={it.original_filename}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-link)', textDecoration: 'none' }}>
          <Icon name="download" size={14} /> {t('files_download')}
        </a>
      </div>
    ) }
  }

  async function addTag(it) {
    const name = window.prompt(t('gallery_tags_add') || '태그 추가')?.trim().toLowerCase()
    if (!name || !it.log_id) return
    const existing = (it.log_tags || []).map((tg) => tg.name)
    if (existing.includes(name)) return
    try {
      await api.put(`/logs/${it.log_id}`, { tags: [...existing, name] })
      setItems((prev) => prev.map((x) => x.id === it.id ? { ...x, log_tags: [...(x.log_tags || []), { id: name, name }] } : x))
    } catch { /* silent */ }
  }

  return (
    <div style={{ maxWidth: 1100, margin: '0 auto' }}>
      <form onSubmit={handleSearch} style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Input value={searchInput} onChange={e => setSearchInput(e.target.value)} placeholder={t('files_search')} size="md" style={{ flex: 1 }} />
        <Button type="submit" size="md">{t('search_btn')}</Button>
        {q && (
          <Button type="button" variant="secondary" size="md" icon onClick={() => { setSearchInput(''); setQ(''); setPage(1) }}>
            <Icon name="close" size={14} />
          </Button>
        )}
        <ChipGroup label={t('gallery_cols')} value={cols} onChange={setCols}
          options={[2, 3, 4].map(n => ({ value: n, label: String(n) }))}
          style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }} />
        <span style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)', alignSelf: 'center' }}>{t('files_total', total)}</span>
      </form>

      {loading ? (
        <p style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>{t('files_loading')}</p>
      ) : loadErr ? (
        <p style={{ textAlign: 'center', padding: '40px 0', fontSize: 'var(--fs-body, 13px)', color: 'var(--danger-text)' }}>{loadErr}</p>
      ) : items.length === 0 ? (
        <p style={{ textAlign: 'center', padding: '40px 0', color: 'var(--text-muted)' }}>{t('files_empty')}</p>
      ) : (
        <DataGrid
          items={items}
          cols={cols}
          gap={10}
          getId={(it) => it.id}
          openIds={openIds}
          onOpenChange={setOpenIds}
          focusIndex={focusIdx}
          onFocusChange={setFocusIdx}
          renderItem={(it, { focused, open, toggle, focus }) => (
            <DataCard
              kind={isImage(it.content_type) ? 'photo' : 'file'}
              number={items.indexOf(it) + 1}
              title={it.original_filename}
              tags={(it.log_tags || []).map((tg) => tg.name)}
              open={open}
              onToggle={toggle}
              focused={focused}
              onFocus={focus}
              media={open ? mediaFor(it) : undefined}
              style={open && isImage(it.content_type) ? { gridRow: 'span 2' } : undefined}
              bodyStyle={isImage(it.content_type) ? { maxHeight: 360 } : { maxHeight: 280 }}
              headerActions={
                <button type="button" title={t('files_col_log')} onClick={(e) => { e.stopPropagation(); openLogInTab(it.log_id) }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-tiny, 11px)' }}>
                  #{it.log_id}
                </button>
              }
              onAddTag={() => addTag(it)}
              onComment={() => openLogInTab(it.log_id)}
              bookmarked={bm.has(`file:${it.id}`)}
              onToggleBookmark={() => bm.toggle(`file:${it.id}`)}
            />
          )}
        />
      )}

      <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} loading={loading}
        labels={{ prev: t('page_prev'), next: t('page_next'), info: (p, tp, tot) => t('page_info', p, tp, tot) }} />
    </div>
  )
}
