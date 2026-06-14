import { useState } from 'react'
import { useLang } from '../context/LangContext'

export default function Pagination({ page, pageSize, total, onPageChange, loading }) {
  const { t } = useLang()
  const totalPages = Math.ceil(total / pageSize)
  const [inputVal, setInputVal] = useState('')
  const [inputFocused, setInputFocused] = useState(false)

  if (totalPages <= 1) return null

  const disabledStyle = { color: 'var(--text-muted)', borderColor: 'var(--border-subtle)', backgroundColor: 'var(--surface-2)', cursor: 'not-allowed' }
  const activeStyle   = { color: 'var(--text-primary)', borderColor: 'var(--border-default)', cursor: 'pointer' }

  function goToPage(raw) {
    const n = parseInt(raw, 10)
    if (!isNaN(n) && n >= 1 && n <= totalPages && n !== page) onPageChange(n)
    setInputVal('')
  }

  return (
    <div className="flex items-center justify-center gap-2 mt-6">
      <button
        disabled={loading || page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="px-3 py-1 rounded border text-sm transition-colors"
        style={(loading || page <= 1) ? disabledStyle : activeStyle}
        onMouseEnter={e => { if (!loading && page > 1) e.currentTarget.style.backgroundColor = 'var(--surface-2)' }}
        onMouseLeave={e => { if (!loading && page > 1) e.currentTarget.style.backgroundColor = '' }}
      >
        {t('page_prev')}
      </button>

      {/* Page info + direct input */}
      <div className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
        {inputFocused ? (
          <input
            autoFocus
            type="number"
            min={1}
            max={totalPages}
            value={inputVal}
            onChange={e => setInputVal(e.target.value)}
            onBlur={() => { goToPage(inputVal); setInputFocused(false) }}
            onKeyDown={e => {
              if (e.key === 'Enter') { goToPage(inputVal); setInputFocused(false) }
              if (e.key === 'Escape') { setInputVal(''); setInputFocused(false) }
            }}
            className="w-14 text-center rounded border px-1 py-0.5 text-sm"
            style={{ borderColor: 'var(--border-focus)', backgroundColor: 'var(--surface)', color: 'var(--text-primary)', outline: 'none' }}
          />
        ) : (
          <button
            onClick={() => { setInputVal(String(page)); setInputFocused(true) }}
            className="hover:underline rounded px-1"
            title="클릭해서 페이지 직접 입력"
            style={{ color: 'var(--text-secondary)' }}
          >
            {t('page_info', page, totalPages, total)}
          </button>
        )}
      </div>

      <button
        disabled={loading || page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="px-3 py-1 rounded border text-sm transition-colors"
        style={(loading || page >= totalPages) ? disabledStyle : activeStyle}
        onMouseEnter={e => { if (!loading && page < totalPages) e.currentTarget.style.backgroundColor = 'var(--surface-2)' }}
        onMouseLeave={e => { if (!loading && page < totalPages) e.currentTarget.style.backgroundColor = '' }}
      >
        {t('page_next')}
      </button>
    </div>
  )
}
