import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { createPortal } from 'react-dom'
import { Avatar, Icon, useTaggables, activateBarSlot, subscribeBarSlotEl } from 'lilak-ui'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'
import { useTab } from '../context/TabContext'
import { combo } from '../theme/textCombos'

/** Parse #123 log links + @user mentions; preserve line breaks (two-space markdown). */
function parseMessageMarkdown(text) {
  return text
    .replace(/#(\d+)/g, (_, id) => `[#${id}](/logs/${id})`)
    .replace(/(^|[^\w/])_(\d+)/g, (_, pre, n) => `${pre}[_${n}](/logidx/${n})`)
    .replace(/(^|[^\w/])&(\d+)/g, (_, pre, n) => `${pre}[&${n}](/infograph/${n})`)
    .replace(/(^|[^\w/])@([A-Za-z0-9_]+)/g, (_, pre, name) => `${pre}**@${name}**`)
    .replace(/\n/g, '  \n')
}

function openLogInTab(activateTab, logId) {
  if (!logId) return
  activateTab('logs')
  setTimeout(() => window.dispatchEvent(new CustomEvent('lilak:cmd:open-log', { detail: { id: Number(logId) } })), 100)
}

// AI bot accent → theme tokens (was Tailwind emerald/orange/violet classes).
const AI_BOT_STYLES = {
  gpt:     { bg: 'var(--success-bg)', text: 'var(--success-text)', color: '#10b981' },
  claude:  { bg: 'var(--warning-bg)', text: 'var(--warning-text)', color: '#8b5cf6' },
  default: { bg: 'var(--info-bg)',    text: 'var(--info-text)',    color: '#6366f1' },
}
function aiBotStyle(name) {
  const key = Object.keys(AI_BOT_STYLES).find(k => (name || '').toLowerCase().includes(k))
  return AI_BOT_STYLES[key] || AI_BOT_STYLES.default
}

/* Chat-row avatar — kit Avatar (Phosphor icon in a colored circle). AI bots get
   a robot icon tinted by bot accent; humans get their profile icon/color (or a
   stable per-username fallback). */
function ChatAvatar({ name, isAi = false, profile, size = 24 }) {
  if (isAi) return <Avatar icon="robot" color={aiBotStyle(name).color} seed={name} size={size} />
  return <Avatar icon={profile?.shape} color={profile?.color} seed={name} size={size} />
}

function truncate(text, max = 60) {
  if (!text) return ''
  const clean = text.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}

function MdLink({ href, children, activateTab }) {
  const logMatch = href?.match(/^\/logs\/(\d+)$/)
  const idxMatch = href?.match(/^\/logidx\/(\d+)$/)
  const infMatch = href?.match(/^\/infograph\/(\d+)$/)
  const asButton = (onClick) => (
    <button style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontFamily: 'var(--font-mono)', color: 'var(--text-link)', textDecoration: 'underline' }} onClick={onClick}>{children}</button>
  )
  if (logMatch) return asButton(() => openLogInTab(activateTab, logMatch[1]))
  if (idxMatch) return asButton(() => { activateTab('logs'); setTimeout(() => window.dispatchEvent(new CustomEvent('lilak:cmd:find-log', { detail: { logIndex: Number(idxMatch[1]) } })), 100) })
  if (infMatch) return asButton(() => { activateTab('infography'); setTimeout(() => window.dispatchEvent(new CustomEvent('lilak:cmd:find-infograph', { detail: { number: Number(infMatch[1]) } })), 120) })
  return <a href={href} target="_blank" rel="noopener noreferrer">{children}</a>
}

const miniBadge = (extra) => ({ fontSize: 'var(--fs-micro, 10px)', padding: '1px 4px', borderRadius: 4, ...extra })

function MessageBubble({ msg, currentUser, onDelete, onReply, onJumpToMsg, t, activateTab, grouped = false, authorProfile = null }) {
  const [hovered, setHovered] = useState(false)
  const isMine = currentUser && msg.author_name === currentUser.username && !msg.external_source
  const isCrossPost = msg.is_cross_posted
  const isSystem = msg.is_system
  const isAi = msg.is_ai_response
  const isExternal = !!msg.external_source
  const canDelete = currentUser && (isMine || currentUser.role === 'manager')
  const hasReply = msg.reply_to_id && msg.reply_to_author
  const mdComponents = { a: ({ href, children }) => <MdLink href={href} activateTab={activateTab}>{children}</MdLink> }

  // ── System message: centered divider ──
  if (isSystem) {
    return (
      <div id={`msg-${msg.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px' }}>
        <div style={{ flex: 1, borderTop: '1px solid var(--border-subtle)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-tiny, 11px)', flexShrink: 0, color: 'var(--bubble-system-text)' }}>
          <span style={{ fontFamily: 'var(--font-mono)' }}>sys</span>
          <button onClick={() => openLogInTab(activateTab, msg.log_id)}
            style={{ background: 'none', border: 'none', padding: 0, cursor: msg.log_id ? 'pointer' : 'default', color: 'inherit' }}>{msg.body}</button>
          <span style={{ fontSize: 'var(--fs-micro, 10px)', opacity: 0.6 }}>{new Date(msg.created_at).toLocaleTimeString()}</span>
          {canDelete && <button onClick={() => onDelete(msg.id)} style={{ marginLeft: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)' }}>×</button>}
        </div>
        <div style={{ flex: 1, borderTop: '1px solid var(--border-subtle)' }} />
      </div>
    )
  }

  const aiStyle = isAi ? aiBotStyle(msg.author_name) : null
  const bubbleStyle = isMine
    ? { ...combo('bubbleMine'), borderColor: 'var(--bubble-mine-border)' }
    : isAi
    ? { ...combo('bubbleAi'), borderColor: 'var(--bubble-ai-border)', backgroundColor: aiStyle.bg }
    : { ...combo('bubbleOther'), borderColor: 'var(--bubble-other-border)' }
  const authorColor = isAi ? aiStyle.text : isMine ? 'var(--text-link)' : 'var(--text-secondary)'

  return (
    <div id={`msg-${msg.id}`} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ display: 'flex', gap: 6, position: 'relative', alignItems: 'flex-start', marginTop: grouped ? 2 : 0 }}>
      {grouped
        ? <div style={{ width: 24, flexShrink: 0 }} aria-hidden="true" />
        : <div style={{ marginTop: -2, flexShrink: 0 }}><ChatAvatar name={msg.author_name} isAi={isAi} profile={authorProfile} /></div>}
      <div style={{ maxWidth: '75%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0 }}>
        {!grouped && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, lineHeight: 1 }}>
            <span style={{ fontSize: 'var(--fs-tiny, 11px)', color: authorColor }}>{msg.author_name}</span>
            {isMine && <span style={miniBadge({ backgroundColor: 'var(--bubble-mine-bg)', color: 'var(--text-link)' })}>me</span>}
            {isAi && <span style={miniBadge({ backgroundColor: aiStyle.bg, color: aiStyle.text, fontFamily: 'var(--font-mono)' })}>AI</span>}
            {isExternal && (
              <span title={`from ${msg.external_source}`} style={miniBadge({ backgroundColor: 'var(--info-bg)', color: 'var(--info-text)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase' })}>
                {msg.external_source}{msg.external_author && msg.external_author !== msg.author_name && <span style={{ opacity: 0.8 }}> · {msg.external_author}</span>}
              </span>
            )}
            <span style={{ fontSize: 'var(--fs-micro, 10px)', color: 'var(--text-muted)' }}>{new Date(msg.created_at).toLocaleTimeString()}</span>
            {isCrossPost && !isAi && <span style={miniBadge({ backgroundColor: 'var(--surface-2)', color: 'var(--text-muted)' })}>댓글</span>}
          </div>
        )}

        <div style={{ borderRadius: 12, padding: '3px 10px', fontSize: 'var(--fs-body, 13px)', border: '1px solid', marginTop: grouped ? 0 : 2, borderTopLeftRadius: grouped ? 12 : 3, display: 'flex', flexDirection: 'column', justifyContent: 'center', ...bubbleStyle }}>
          {hasReply && (
            <button type="button" onClick={() => onJumpToMsg(msg.reply_to_id)}
              style={{ display: 'flex', alignItems: 'flex-start', gap: 4, marginBottom: 4, padding: '2px 6px', borderRadius: 4, fontSize: 'var(--fs-tiny, 11px)', width: '100%', textAlign: 'left', cursor: 'pointer', border: 'none',
                ...(isMine ? { backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)', opacity: 0.85 } : { backgroundColor: 'var(--surface-2)', color: 'var(--text-secondary)', borderLeft: '2px solid var(--border-default)' }) }}>
              <span style={{ flexShrink: 0, opacity: 0.7 }}>↩</span>
              <div style={{ minWidth: 0 }}>
                <span style={{ marginRight: 4, color: isMine ? 'var(--btn-primary-text)' : 'var(--text-secondary)', opacity: isMine ? 0.85 : 1 }}>{msg.reply_to_author}</span>
                <span style={{ opacity: 0.8 }}>{truncate(msg.reply_to_body)}</span>
              </div>
            </button>
          )}
          {msg.log_id && !isCrossPost && (
            <button onClick={() => openLogInTab(activateTab, msg.log_id)}
              style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-tiny, 11px)', marginBottom: 4, padding: '2px 6px', borderRadius: 4, width: '100%', textAlign: 'left', cursor: 'pointer',
                ...(isMine ? combo('solidPrimary') : { ...combo('pillInfo'), border: '1px solid var(--border-focus)' }) }}>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{msg.log_id} {msg.log_title || ''}</span>
            </button>
          )}
          {msg.image_filename && (
            <img src={`/api/community/images/${msg.image_filename}`} alt="" style={{ maxWidth: '100%', borderRadius: 6, marginBottom: 2, maxHeight: 192, objectFit: 'contain' }} />
          )}
          {msg.body && (
            <div className="markdown-body cbubble" style={{ fontSize: 'var(--fs-body, 13px)', lineHeight: 1.4 }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>{parseMessageMarkdown(msg.body)}</ReactMarkdown>
            </div>
          )}
        </div>
      </div>

      {/* Hover actions — large icon+label pills, right beside the bubble. */}
      {currentUser && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, alignSelf: 'center', flexShrink: 0,
          opacity: hovered ? 1 : 0, pointerEvents: hovered ? 'auto' : 'none', transition: 'opacity .12s' }}>
          <button onClick={() => onReply(msg)} title={t('community_reply')}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
              fontSize: 'var(--fs-small, 12px)', border: '1px solid var(--border-subtle)', backgroundColor: 'var(--surface)', color: 'var(--text-secondary)' }}>
            <Icon name="reply" size={16} weight="bold" /> {t('community_reply')}
          </button>
          {canDelete && (
            <button onClick={() => onDelete(msg.id)} title={t('community_delete')}
              style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', borderRadius: 8, cursor: 'pointer',
                fontSize: 'var(--fs-small, 12px)', border: '1px solid var(--danger-border, var(--border-subtle))', backgroundColor: 'var(--surface)', color: 'var(--danger-text, #ef4444)' }}>
              <Icon name="trash" size={16} weight="bold" /> {t('community_delete')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export default function CommunityPage() {
  const { user } = useAuth()
  const { t } = useLang()
  const { openSettings, activateTab } = useTab()
  const navigate = useNavigate()
  const [messages, setMessages] = useState([])
  const [body, setBody] = useState('')
  const [, setFocused] = useState(false)
  const [logLinkId, setLogLinkId] = useState('')
  const [logLinkInfo, setLogLinkInfo] = useState(null)
  const [sending, setSending] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [replyTo, setReplyTo] = useState(null)
  const [showScrollBtn, setShowScrollBtn] = useState(false)
  const [highlightedMsgId, setHighlightedMsgId] = useState(null)
  const bottomRef = useRef(null)
  const scrollRef = useRef(null)
  const textareaRef = useRef(null)
  const lastIdRef = useRef(0)
  const firstIdRef = useRef(0)
  const [initialLoaded, setInitialLoaded] = useState(false)
  const [loadingOlder, setLoadingOlder] = useState(false)
  const [hasOlder, setHasOlder] = useState(true)

  // The composer is portaled into the ONE bottom bar's slot (always expanded),
  // so the rich chat input (mentions / paste-upload / reply / log-link) stays
  // intact but there is no second fixed bottom bar.
  const [slotEl, setSlotEl] = useState(null)
  useEffect(() => {
    activateBarSlot(true)
    const un = subscribeBarSlotEl(setSlotEl)
    return () => { un(); activateBarSlot(false) }
  }, [])

  const [users, setUsers] = useState([])
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionIdx, setMentionIdx] = useState(0)

  useEffect(() => { api.get('/users/public').then(r => setUsers(r.data)).catch(() => {}) }, [])

  const filteredMentionUsers = users
    .filter(u => u.username.toLowerCase().startsWith(mentionQuery.toLowerCase()))
    .filter(u => !user || u.username !== user.username)
    .slice(0, 6)

  const userProfiles = useMemo(() => {
    const map = {}
    for (const u of users) map[u.username] = { shape: u.profile_shape, color: u.profile_color }
    if (user) map[user.username] = { shape: user.profile_shape, color: user.profile_color }
    return map
  }, [users, user])

  function handleBodyChange(value) { setBody(value); detectMentionAt(value) }

  function detectMentionAt(value) {
    const ta = textareaRef.current
    const caret = ta ? ta.selectionStart : value.length
    const m = value.slice(0, caret).match(/(?:^|\s)@([A-Za-z0-9_]*)$/)
    if (m) { setMentionOpen(true); setMentionQuery(m[1]); setMentionIdx(0) }
    else setMentionOpen(false)
  }
  function handleSelectChange() { const ta = textareaRef.current; if (ta) detectMentionAt(ta.value) }

  function applyMention(username) {
    const ta = textareaRef.current
    if (!ta) return
    const caret = ta.selectionStart
    const before = body.slice(0, caret), after = body.slice(caret)
    const replaced = before.replace(/@([A-Za-z0-9_]*)$/, `@${username} `)
    setBody(replaced + after)
    setMentionOpen(false)
    requestAnimationFrame(() => { const pos = replaced.length; ta.focus(); ta.setSelectionRange(pos, pos) })
  }

  function scrollToBottom(behavior = 'auto') {
    const el = scrollRef.current
    if (!el) return
    if (behavior === 'smooth') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
    else el.scrollTop = el.scrollHeight
  }

  function scrollToMsg(msgId) {
    const el = scrollRef.current
    if (!el) return
    const target = el.querySelector(`#msg-${msgId}`)
    if (!target) return
    const elRect = el.getBoundingClientRect(), tgRect = target.getBoundingClientRect()
    const offsetWithinContainer = (tgRect.top - elRect.top) + el.scrollTop
    const desired = offsetWithinContainer - (el.clientHeight - target.offsetHeight) / 2
    el.scrollTo({ top: Math.max(0, desired), behavior: 'smooth' })
    setHighlightedMsgId(msgId)
    setTimeout(() => setHighlightedMsgId(null), 1200)
  }

  // Register loaded community posts into the data index (`~<id>` / `~text`).
  useTaggables(() => messages.map((m) => ({
    id: `post:${m.id}`,
    label: `${m.author_name || ''}: ${(m.body || '').replace(/\s+/g, ' ').slice(0, 48)}`,
    number: m.id,
    tags: [m.author_name].filter(Boolean),
    kind: m.reply_to_id != null ? 'comment' : 'post',
    run: () => scrollToMsg(m.id),
  })), [messages])

  const scrollHideRef = useRef(null)
  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setShowScrollBtn(distFromBottom > 120)
    if (el.scrollTop < 100) loadOlder()
    // reveal the soft scrollbar while actively scrolling, hide shortly after
    el.classList.add('is-scrolling')
    if (scrollHideRef.current) clearTimeout(scrollHideRef.current)
    scrollHideRef.current = setTimeout(() => el.classList.remove('is-scrolling'), 700)
  }

  useEffect(() => {
    const html = document.documentElement, body = document.body
    const prevHtml = html.style.overflow, prevBody = body.style.overflow
    html.style.overflow = 'hidden'; body.style.overflow = 'hidden'
    return () => { html.style.overflow = prevHtml; body.style.overflow = prevBody }
  }, [])

  useEffect(() => {
    async function onSend(e) {
      const text = (e.detail?.text || '').trim()
      if (!text) return
      try {
        const r = await api.post('/community/messages', { body: text, log_id: null, reply_to_id: null })
        setMessages(prev => [...prev, r.data]); lastIdRef.current = r.data.id
        setTimeout(() => scrollToBottom('smooth'), 50)
      } catch { /* silent */ }
    }
    async function onReplyTo(e) {
      const id = e.detail?.id, text = (e.detail?.text || '').trim()
      if (!id || !text) return
      try {
        const r = await api.post('/community/messages', { body: text, log_id: null, reply_to_id: id })
        setMessages(prev => [...prev, r.data]); lastIdRef.current = r.data.id
        setTimeout(() => scrollToBottom('smooth'), 50)
      } catch { /* silent */ }
    }
    window.addEventListener('lilak:cmd:msg-send', onSend)
    window.addEventListener('lilak:cmd:msg-reply', onReplyTo)
    return () => {
      window.removeEventListener('lilak:cmd:msg-send', onSend)
      window.removeEventListener('lilak:cmd:msg-reply', onReplyTo)
    }
  }, [])

  useEffect(() => {
    function onKey(e) {
      const inInput = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)
      if (inInput || e.key !== 'Enter') return
      if (e.metaKey || e.ctrlKey || e.altKey) return
      e.preventDefault(); textareaRef.current?.focus()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    api.get('/community/messages/latest').then(r => {
      setMessages(r.data)
      if (r.data.length) {
        firstIdRef.current = r.data[0].id
        lastIdRef.current = r.data[r.data.length - 1].id
        if (r.data.length < 60) setHasOlder(false)
      } else setHasOlder(false)
      setInitialLoaded(true)
    }).catch(() => setInitialLoaded(true))
  }, [])

  const loadOlder = useCallback(async () => {
    if (!firstIdRef.current || loadingOlder || !hasOlder) return
    setLoadingOlder(true)
    const el = scrollRef.current
    const prevScrollHeight = el ? el.scrollHeight : 0
    const prevScrollTop = el ? el.scrollTop : 0
    try {
      const r = await api.get(`/community/messages?before_id=${firstIdRef.current}&limit=50`)
      if (!r.data.length) setHasOlder(false)
      else {
        setMessages(prev => [...r.data, ...prev])
        firstIdRef.current = r.data[0].id
        if (r.data.length < 50) setHasOlder(false)
        requestAnimationFrame(() => { if (el) { const delta = el.scrollHeight - prevScrollHeight; el.scrollTop = prevScrollTop + delta } })
      }
    } catch { /* silent */ } finally { setLoadingOlder(false) }
  }, [loadingOlder, hasOlder])

  useEffect(() => { if (initialLoaded) scrollToBottom('auto') }, [initialLoaded]) // eslint-disable-line react-hooks/exhaustive-deps

  const poll = useCallback(async () => {
    if (!lastIdRef.current) return
    try {
      const r = await api.get(`/community/messages?after_id=${lastIdRef.current}&limit=50`)
      if (r.data.length) {
        setMessages(prev => [...prev, ...r.data]); lastIdRef.current = r.data[r.data.length - 1].id
        setTimeout(() => scrollToBottom('smooth'), 50)
      }
    } catch { /* silent */ }
  }, [])
  useEffect(() => { const id = setInterval(poll, 5000); return () => clearInterval(id) }, [poll])

  useEffect(() => {
    const match = body.match(/#(\d+)/)
    const detected = match ? match[1] : logLinkId
    if (!detected) { setLogLinkInfo(null); return }
    api.get(`/logs/${detected}`).then(r => setLogLinkInfo(r.data)).catch(() => setLogLinkInfo(null))
  }, [body, logLinkId])

  async function handlePaste(e) {
    const items = [...(e.clipboardData?.items || [])]
    const imageItem = items.find(item => item.type.startsWith('image/'))
    if (!imageItem) return
    e.preventDefault(); setUploading(true)
    try {
      const file = imageItem.getAsFile()
      const fd = new FormData()
      fd.append('file', file, `paste_${Date.now()}.png`)
      const r = await api.post('/community/upload-image', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      setBody(prev => prev + `\n![image](${r.data.url})\n`)
    } catch { /* silent */ } finally { setUploading(false) }
  }

  function handleReply(msg) { setReplyTo({ id: msg.id, author_name: msg.author_name, body: msg.body }); textareaRef.current?.focus() }
  function cancelReply() { setReplyTo(null) }

  async function send(e) {
    e?.preventDefault()
    const text = body.trim()
    if (!text && !uploading) return
    setSending(true)
    try {
      const match = text.match(/#(\d+)/)
      const linkedLogId = match ? parseInt(match[1]) : (logLinkId ? parseInt(logLinkId) : null)
      const r = await api.post('/community/messages', { body: text, log_id: linkedLogId || null, reply_to_id: replyTo?.id || null })
      setMessages(prev => [...prev, r.data]); lastIdRef.current = r.data.id
      setBody(''); setLogLinkId(''); setLogLinkInfo(null); setReplyTo(null)
      setTimeout(() => scrollToBottom('smooth'), 50)
    } catch { /* silent */ } finally { setSending(false) }
  }

  async function deleteMessage(msgId) {
    try { await api.delete(`/community/messages/${msgId}`); setMessages(prev => prev.filter(m => m.id !== msgId)) }
    catch { /* silent */ }
  }

  return (
    <>
      {/* Message list */}
      <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', position: 'relative', height: 'calc(100vh - 7rem)' }}>
        <div ref={scrollRef} onScroll={handleScroll} className="scroll-soft"
          style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4, padding: '0 12px 48px 4px' }}>
          {!initialLoaded && <div style={{ textAlign: 'center', padding: '48px 0', color: 'var(--text-muted)' }}>{t('home_loading')}</div>}
          {initialLoaded && messages.length === 0 && (
            <div style={{ textAlign: 'center', padding: '64px 0', fontSize: 'var(--fs-small, 12px)', color: 'var(--text-muted)' }}><p>{t('community_empty')}</p></div>
          )}
          {initialLoaded && messages.length > 0 && (
            <div style={{ textAlign: 'center', padding: '8px 0', fontSize: 'var(--fs-micro, 10px)', color: 'var(--text-muted)' }}>
              {loadingOlder ? '옛 메시지 불러오는 중…' : hasOlder ? '↑ 위로 스크롤해서 더 보기' : '— 대화 시작 —'}
            </div>
          )}
          {messages.map((msg, i) => {
            const prev = messages[i - 1]
            const GROUP_WINDOW_MS = 5 * 60 * 1000
            const grouped = !!prev && !msg.is_system && !prev.is_system
              && prev.author_name === msg.author_name
              && !!prev.is_ai_response === !!msg.is_ai_response
              && (prev.external_source || null) === (msg.external_source || null)
              && (new Date(msg.created_at) - new Date(prev.created_at)) <= GROUP_WINDOW_MS
            return (
              <div key={msg.id} style={{ borderRadius: 6, transition: 'background-color .3s',
                ...(highlightedMsgId === msg.id ? { backgroundColor: 'var(--highlight-bg)', boxShadow: '0 0 0 1px var(--warning-text)' } : {}) }}>
                <MessageBubble msg={msg} currentUser={user} onDelete={deleteMessage} onReply={handleReply}
                  onJumpToMsg={scrollToMsg} activateTab={activateTab} t={t} grouped={grouped}
                  authorProfile={userProfiles[msg.author_name] || null} />
              </div>
            )
          })}
          <div ref={bottomRef} />
        </div>

        {showScrollBtn && (
          <button onClick={() => scrollToBottom('smooth')} title="최신 메시지로"
            style={{ ...combo('solidPrimary'), position: 'absolute', bottom: 12, right: 12, zIndex: 10, fontSize: 'var(--fs-small, 12px)', borderRadius: '50%', width: 28, height: 28, border: 'none', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 6px rgba(0,0,0,0.2)' }}>↓</button>
        )}
      </div>

      {/* Composer — portaled into the ONE bottom bar's slot (always expanded). */}
      {slotEl && createPortal(
      <div style={{ fontFamily: 'var(--font-mono)', userSelect: 'none', backgroundColor: 'var(--nav-bg)', color: 'var(--nav-text)' }}>
        {logLinkInfo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, borderTop: '1px solid var(--nav-border)', padding: '4px 16px', fontSize: 'var(--fs-small, 12px)', backgroundColor: 'var(--nav-accent)', color: 'var(--nav-text)' }}>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>#{logLinkInfo.id} {logLinkInfo.title}</span>
            <button onClick={() => { setLogLinkId(''); setLogLinkInfo(null) }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--nav-text-muted)' }}>×</button>
          </div>
        )}
        {replyTo && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 16px', borderTop: '1px solid var(--nav-border)', fontSize: 'var(--fs-small, 12px)', color: 'var(--nav-text-muted)' }}>
            <span style={{ color: 'var(--nav-text)' }}>↳ {replyTo.author_name}</span>
            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--nav-text-muted)' }}>{truncate(replyTo.body, 60)}</span>
            <button onClick={cancelReply} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--nav-text-muted)' }}>×</button>
          </div>
        )}

        {user ? (
          <form onSubmit={send} style={{ display: 'flex', alignItems: 'center', height: 40, padding: '0 16px', gap: 8, fontSize: 'var(--fs-small, 12px)', borderTop: '1px solid var(--nav-border)' }}>
            <Icon name="chats" size={14} weight="regular" style={{ flexShrink: 0, color: 'var(--nav-text-muted)' }} />
            <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center' }}>
              <textarea ref={textareaRef} value={body} onChange={e => handleBodyChange(e.target.value)}
                onSelect={handleSelectChange} onPaste={handlePaste}
                onFocus={() => setFocused(true)} onBlur={() => { setFocused(false); setTimeout(() => setMentionOpen(false), 120) }}
                onKeyDown={e => {
                  // Korean/IME composition: a pending Hangul syllable fires keydown
                  // (isComposing/keyCode 229). Ignore special keys until it commits,
                  // otherwise Enter both commits AND sends → duplicate bubble.
                  if (e.nativeEvent.isComposing || e.keyCode === 229) return
                  if (mentionOpen && filteredMentionUsers.length > 0) {
                    if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx(i => (i + 1) % filteredMentionUsers.length); return }
                    if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx(i => (i - 1 + filteredMentionUsers.length) % filteredMentionUsers.length); return }
                    if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); applyMention(filteredMentionUsers[mentionIdx].username); return }
                    if (e.key === 'Escape') { e.preventDefault(); setMentionOpen(false); return }
                  }
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
                  if (e.key === 'Escape') { if (replyTo) { e.stopPropagation(); cancelReply(); return } e.stopPropagation(); textareaRef.current?.blur() }
                }}
                placeholder={replyTo ? `@${replyTo.author_name}에게 답글…` : t('community_placeholder')}
                rows={1} disabled={uploading}
                style={{ width: '100%', background: 'transparent', outline: 'none', fontSize: 'var(--fs-small, 12px)', resize: 'none', border: 'none', maxHeight: 56, overflowY: 'auto', lineHeight: 1.4, color: 'var(--nav-text)', fontFamily: 'inherit' }} />
              {uploading && <span style={{ position: 'absolute', right: 0, fontSize: 'var(--fs-small, 12px)', color: 'var(--nav-text-muted)' }}>업로드 중…</span>}
              {sending && <span style={{ position: 'absolute', right: 0, fontSize: 'var(--fs-small, 12px)', color: 'var(--nav-text-muted)' }}>전송 중…</span>}

              {mentionOpen && filteredMentionUsers.length > 0 && (
                <div style={{ position: 'absolute', bottom: '100%', left: 0, marginBottom: 4, minWidth: 160, borderRadius: 6, overflow: 'hidden', zIndex: 40,
                  border: '1px solid var(--nav-border)', backgroundColor: 'var(--nav-accent)', boxShadow: '0 8px 20px rgba(0,0,0,0.25)' }}>
                  {filteredMentionUsers.map((u, idx) => (
                    <button key={u.username} type="button" onMouseDown={e => { e.preventDefault(); applyMention(u.username) }} onMouseEnter={() => setMentionIdx(idx)}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '4px 12px', fontSize: 'var(--fs-small, 12px)', fontFamily: 'var(--font-mono)', border: 'none', cursor: 'pointer',
                        ...(idx === mentionIdx ? { backgroundColor: 'var(--btn-primary-bg)', color: 'var(--btn-primary-text)' } : { background: 'transparent', color: 'var(--nav-text)' }) }}>
                      @{u.username}{u.display_name && <span style={{ marginLeft: 8, color: 'var(--nav-text-muted)' }}>{u.display_name}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span style={{ fontSize: 'var(--fs-small, 12px)', flexShrink: 0, color: 'var(--nav-text-muted)' }}>Enter·전송  Shift+Enter·줄바꿈  Ctrl+V·이미지</span>
          </form>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 40, fontSize: 'var(--fs-small, 12px)', borderTop: '1px solid var(--nav-border)', color: 'var(--nav-text-muted)' }}>
            <button onClick={() => openSettings('account')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-link)', textDecoration: 'underline' }}>{t('nav_login')}</button>
            <span style={{ marginLeft: 4 }}>{t('community_login_prompt')}</span>
          </div>
        )}
      </div>,
      slotEl)}
    </>
  )
}
