import { useState, useEffect, useCallback, useRef } from 'react'
import { Input, Button, Chip, ChipGroup, Lightbox, Row, Grid } from 'lilak-ui'
import api, { apiBaseFor, getExperiment } from '../api'
import { useLang } from '../context/LangContext'
import { useAuth } from '../context/AuthContext'
import { useTab } from '../context/TabContext'

// Experiment-aware attachment URL (raw <img>/<a> bypass axios' baseURL).
const attUrl = (id) => `${apiBaseFor(getExperiment())}/attachments/${id}`

// ── Editable tag widget (kit Chip + Input + Button) ──────────────────────────
function TagEditor({ logId, initialTags, allTags, onSaved }) {
  const { t } = useLang()
  const { user } = useAuth()
  const [tags, setTags] = useState(initialTags.map(tg => tg.name))
  const [input, setInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const suggestions = allTags.filter(
    n => input.trim() && n.toLowerCase().includes(input.toLowerCase()) && !tags.includes(n)
  ).slice(0, 6)

  function addTag(name) {
    const clean = name.trim().toLowerCase()
    if (clean && !tags.includes(clean)) setTags(prev => [...prev, clean])
    setInput('')
  }
  function removeTag(name) { setTags(prev => prev.filter(n => n !== name)) }

  async function handleSave() {
    setSaving(true)
    try {
      await api.put(`/logs/${logId}`, { tags })
      setSaved(true); setTimeout(() => setSaved(false), 2000)
      onSaved && onSaved(tags)
    } catch { /* silent */ } finally { setSaving(false) }
  }

  if (!user) return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      {tags.map(name => <Chip key={name} round>#{name}</Chip>)}
    </div>
  )

  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
        {tags.map(name => (
          <Chip key={name} round selected onClick={() => removeTag(name)} title="제거">{name} ×</Chip>
        ))}
      </div>
      <div style={{ position: 'relative' }}>
        <Input value={input} onChange={e => setInput(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (input.trim()) addTag(input) } }}
          placeholder={t('gallery_tags_add')} />
        {suggestions.length > 0 && (
          <ul style={{ position: 'absolute', zIndex: 10, left: 0, right: 0, marginTop: 2, listStyle: 'none', padding: 0,
            border: '1px solid var(--border-default)', borderRadius: 6, overflow: 'hidden',
            backgroundColor: 'var(--surface)', boxShadow: '0 8px 20px rgba(0,0,0,0.18)' }}>
            {suggestions.map(n => (
              <li key={n}>
                <button type="button" onMouseDown={e => { e.preventDefault(); addTag(n) }}
                  style={{ width: '100%', textAlign: 'left', padding: '4px 8px', fontSize: 'var(--fs-small, 12px)', background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-primary)' }}
                  onMouseEnter={e => e.currentTarget.style.backgroundColor = 'var(--info-bg)'}
                  onMouseLeave={e => e.currentTarget.style.backgroundColor = ''}>{n}</button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Button onClick={handleSave} disabled={saving} style={{ marginTop: 8 }}>
        {saved ? t('gallery_tags_saved') : saving ? '…' : t('gallery_tags_save')}
      </Button>
    </div>
  )
}

// ── Main Gallery ─────────────────────────────────────────────────────────────
export default function Gallery() {
  const { t } = useLang()
  const { activateTab } = useTab()

  function openLogInTab(id) {
    if (!id) return
    activateTab('logs')
    setTimeout(() => window.dispatchEvent(new CustomEvent('lilak:cmd:open-log', { detail: { id: Number(id) } })), 100)
  }

  const [images, setImages] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadErr, setLoadErr] = useState(null)
  const [allTags, setAllTags] = useState([])
  const [availableTags, setAvailableTags] = useState([])

  const [filterRun, setFilterRun] = useState('')
  const [filterTag, setFilterTag] = useState('')
  const [cols, setCols] = useState(4)

  const [selectedIdx, setSelectedIdx] = useState(null)
  const [fullscreen, setFullscreen] = useState(false)
  const gridRef = useRef(null)

  useEffect(() => {
    Promise.all([
      api.get('/attachments?images_only=true&page_size=500'),
      api.get('/tags'),
    ]).then(([imgRes, tagRes]) => {
      const items = imgRes.data.items ?? []
      setImages(items)
      setAllTags(tagRes.data.map(tg => tg.name))
      const tagSet = new Set()
      items.forEach(img => (img.log_tags ?? []).forEach(tg => tagSet.add(tg.name)))
      setAvailableTags([...tagSet].sort())
    }).catch(err => setLoadErr(err.response?.data?.detail || err.message || 'Load failed'))
      .finally(() => setLoading(false))
  }, [])

  const filtered = images.filter(img => {
    if (filterRun) {
      const runStr = (img.log_run_number_type === 'single' || !img.log_run_number_type)
        ? String(img.log_run_number ?? '') : (img.log_run_number_text || '')
      if (!runStr.includes(filterRun)) return false
    }
    if (filterTag && !img.log_tags.some(tg => tg.name === filterTag)) return false
    return true
  })

  const navigate = useCallback((delta) => {
    setSelectedIdx(prev => {
      if (prev === null) return delta >= 0 ? 0 : filtered.length - 1
      return Math.max(0, Math.min(filtered.length - 1, prev + delta))
    })
  }, [filtered.length])

  // Grid keyboard nav (the Lightbox owns its own keys while open).
  useEffect(() => {
    function onKey(e) {
      if (fullscreen) return
      const tag = document.activeElement?.tagName
      if (['INPUT', 'TEXTAREA'].includes(tag)) return
      if (e.key === 'ArrowRight' || e.key === 'l') { e.preventDefault(); navigate(1) }
      if (e.key === 'ArrowLeft' || e.key === 'h') { e.preventDefault(); navigate(-1) }
      if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); navigate(cols) }
      if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); navigate(-cols) }
      if (e.key === ' ' && selectedIdx !== null) { e.preventDefault(); setFullscreen(true) }
      if (e.key === 'Escape') setSelectedIdx(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullscreen, navigate, cols, selectedIdx])

  useEffect(() => {
    if (selectedIdx !== null && gridRef.current) {
      gridRef.current.children[selectedIdx]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
  }, [selectedIdx])

  function handleTagsSaved(imgId, newTagNames) {
    setImages(prev => prev.map(img =>
      img.id === imgId ? { ...img, log_tags: newTagNames.map((name, i) => ({ id: i, name })) } : img))
  }

  const selectedImg = selectedIdx !== null ? filtered[selectedIdx] : null

  if (loadErr) return <div style={{ textAlign: 'center', padding: '64px 0', fontSize: 'var(--fs-body, 13px)', color: 'var(--danger-text)' }}>{loadErr}</div>

  const labelS = { fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)', whiteSpace: 'nowrap' }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Filter bar */}
      <Row gap={12} wrap style={{ marginBottom: 12 }}>
        <Row gap={6}>
          <label style={labelS}>{t('gallery_filter_run')}</label>
          <Input value={filterRun} onChange={e => { setFilterRun(e.target.value); setSelectedIdx(null) }} placeholder="—" size="md" style={{ width: 96 }} />
        </Row>
        <Row gap={6}>
          <label style={labelS}>{t('gallery_filter_tag')}</label>
          <select value={filterTag} onChange={e => { setFilterTag(e.target.value); setSelectedIdx(null) }}
            style={{ background: 'var(--input-bg)', border: '1px solid var(--input-border)', borderRadius: 7, padding: '6px 10px', fontSize: 'var(--fs-body, 13px)', color: 'var(--text-primary)', outline: 'none' }}>
            <option value="">{t('gallery_filter_all')}</option>
            {availableTags.map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </Row>
        <ChipGroup label={t('gallery_cols')} value={cols} onChange={setCols}
          options={[3, 4, 5, 6].map(n => ({ value: n, label: String(n) }))}
          style={{ display: 'flex', alignItems: 'center', gap: 8 }} />
        <span style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)', marginLeft: 'auto' }}>{filtered.length} / {images.length}</span>
      </Row>

      {loading && <p style={{ textAlign: 'center', padding: '64px 0', color: 'var(--text-muted)' }}>{t('gallery_loading')}</p>}
      {!loading && filtered.length === 0 && <p style={{ textAlign: 'center', padding: '64px 0', color: 'var(--text-muted)' }}>{t('gallery_empty')}</p>}

      {!loading && filtered.length > 0 && (
        <div style={{ display: 'flex', gap: 16, flex: 1, minHeight: 0 }}>
          {/* Image grid */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <Grid ref={gridRef} cols={cols} gap={6} tabIndex={0}>
              {filtered.map((img, idx) => (
                <div key={img.id}
                  onClick={() => setSelectedIdx(idx === selectedIdx ? null : idx)}
                  onDoubleClick={() => { setSelectedIdx(idx); setFullscreen(true) }}
                  style={{ position: 'relative', aspectRatio: '1 / 1', overflow: 'hidden', borderRadius: 6, cursor: 'pointer',
                    border: '2px solid', borderColor: selectedIdx === idx ? 'var(--border-focus)' : 'transparent',
                    boxShadow: selectedIdx === idx ? '0 8px 20px rgba(0,0,0,0.2)' : 'none', transition: 'border-color .12s' }}
                  onMouseEnter={e => { if (selectedIdx !== idx) e.currentTarget.style.borderColor = 'var(--border-strong)' }}
                  onMouseLeave={e => { if (selectedIdx !== idx) e.currentTarget.style.borderColor = 'transparent' }}>
                  <img src={attUrl(img.id)} alt={img.original_filename} loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                </div>
              ))}
            </Grid>
          </div>

          {/* Info panel */}
          {selectedImg && (
            <div style={{ width: 256, flexShrink: 0, borderRadius: 12, border: '1px solid var(--border-default)',
              backgroundColor: 'var(--surface)', overflowY: 'auto', display: 'flex', flexDirection: 'column' }}>
              <div style={{ aspectRatio: '16 / 9', overflow: 'hidden', borderRadius: '12px 12px 0 0', backgroundColor: 'var(--surface-2)' }}>
                <img src={attUrl(selectedImg.id)} alt={selectedImg.original_filename}
                  onClick={() => setFullscreen(true)}
                  style={{ width: '100%', height: '100%', objectFit: 'contain', cursor: 'zoom-in', display: 'block' }} />
              </div>
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12, flex: 1 }}>
                <p style={{ margin: 0, fontWeight: 500, fontSize: 'var(--fs-small, 12px)', wordBreak: 'break-all', color: 'var(--text-primary)' }}>{selectedImg.original_filename}</p>
                <div>
                  <p style={{ margin: '0 0 2px', fontSize: 'var(--fs-tiny, 11px)', color: 'var(--text-muted)' }}>{t('gallery_info_log')}</p>
                  <button type="button" onClick={() => openLogInTab(selectedImg.log_id)}
                    style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 'var(--fs-small, 12px)', fontWeight: 500, textAlign: 'left', color: 'var(--text-link)' }}>
                    #{selectedImg.log_id} {selectedImg.log_title}
                  </button>
                  <p style={{ margin: '2px 0 0', fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)' }}>{selectedImg.log_author}</p>
                  <p style={{ margin: 0, fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>{new Date(selectedImg.log_created_at).toLocaleString()}</p>
                </div>
                {(selectedImg.log_run_number != null || selectedImg.log_run_number_text) && (
                  <p style={{ margin: 0 }}>
                    <span style={{ fontSize: 'var(--fs-small, 12px)', padding: '1px 8px', borderRadius: 999, backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)' }}>
                      Run {selectedImg.log_run_number_type === 'single' || !selectedImg.log_run_number_type ? selectedImg.log_run_number : selectedImg.log_run_number_text}
                    </span>
                  </p>
                )}
                <TagEditor logId={selectedImg.log_id} initialTags={selectedImg.log_tags} allTags={allTags}
                  onSaved={(newTags) => handleTagsSaved(selectedImg.id, newTags)} />
                <p style={{ margin: 0, paddingTop: 8, borderTop: '1px solid var(--border-subtle)', fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}>{t('gallery_fullscreen_hint')}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Fullscreen — kit Lightbox */}
      <Lightbox
        open={fullscreen && !!selectedImg}
        src={selectedImg ? attUrl(selectedImg.id) : ''}
        alt={selectedImg?.original_filename}
        onClose={() => setFullscreen(false)}
        onPrev={() => navigate(-1)}
        onNext={() => navigate(1)}
        index={selectedIdx} count={filtered.length}
        caption={selectedImg && (
          <>
            <p style={{ margin: 0, fontWeight: 500, fontSize: 'var(--fs-medium, 14px)' }}>{selectedImg.original_filename}</p>
            <p style={{ margin: 0, fontSize: 'var(--fs-small, 12px)', color: 'rgba(255,255,255,0.7)' }}>
              #{selectedImg.log_id} {selectedImg.log_title} · {selectedImg.log_author}
              {selectedImg.log_run_number != null && ` · Run ${selectedImg.log_run_number}`}
            </p>
          </>
        )}
      />
    </div>
  )
}
