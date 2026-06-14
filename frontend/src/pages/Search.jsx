import { useState, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../api'
import LogCard from '../components/LogCard'
import Pagination from '../components/Pagination'
import { useLang } from '../context/LangContext'
import { btnPrimary, btnPrimaryHover, inputBase, hoverify } from '../theme/uiStyles'
import { combo } from '../theme/textCombos'

const SEVERITIES = ['', 'info', 'warning', 'error', 'critical']

const fieldInputCls = 'w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--input-focus-border)]'
const labelCls   = 'block text-xs mb-1'
const labelStyle = { color: 'var(--text-secondary)' }

export default function Search() {
  const [searchParams] = useSearchParams()
  const { t } = useLang()

  const [filters, setFilters] = useState({
    q: searchParams.get('q') || '',
    author: '',
    tag: searchParams.get('tag') || '',
    run_number: '',
    category: '',
    level: '',
    date_from: '',
    date_to: '',
    is_auto: '',
  })
  const [results, setResults] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(false)
  const PAGE_SIZE = 20

  const doSearch = useCallback(async (p = 1) => {
    setLoading(true)
    const params = { page: p, page_size: PAGE_SIZE }
    if (filters.q) params.q = filters.q
    if (filters.author) params.author = filters.author
    if (filters.tag) params.tag = filters.tag
    if (filters.run_number) params.run_number = parseInt(filters.run_number)
    if (filters.category) params.category = filters.category
    if (filters.level) params.level = filters.level
    if (filters.date_from) params.date_from = filters.date_from
    if (filters.date_to) params.date_to = filters.date_to
    if (filters.is_auto === 'true') params.is_auto = true
    if (filters.is_auto === 'false') params.is_auto = false
    try {
      const res = await api.get('/logs', { params })
      setResults(res.data.items)
      setTotal(res.data.total)
      setPage(p)
    } finally {
      setLoading(false)
    }
  }, [filters])

  function handleSubmit(e) {
    e.preventDefault()
    doSearch(1)
  }

  function handleField(e) {
    const { name, value } = e.target
    setFilters(prev => ({ ...prev, [name]: value }))
  }

  return (
    <div className="max-w-3xl mx-auto">
      <h1 className="text-xl font-bold mb-5" style={{ color: 'var(--text-primary)' }}>{t('search_title')}</h1>

      <form onSubmit={handleSubmit}
            className="rounded-xl border shadow-sm p-5 mb-6"
            style={{ ...combo('body'), borderColor: 'var(--border-default)' }}>
        {/* Full-text */}
        <div className="flex gap-2 mb-4">
          <input
            name="q"
            value={filters.q}
            onChange={handleField}
            placeholder={t('search_placeholder')}
            className={`flex-1 ${fieldInputCls}`}
            style={inputBase}
          />
          <button
            type="submit"
            disabled={loading}
            className="disabled:opacity-50 px-5 py-2 rounded-lg text-sm font-medium transition-colors"
            style={btnPrimary}
            {...hoverify(btnPrimary, btnPrimaryHover)}
          >
            {loading ? t('search_searching') : t('search_btn')}
          </button>
        </div>

        {/* Filter grid */}
        <details className="text-sm">
          <summary className="cursor-pointer hover:underline mb-3" style={{ color: 'var(--text-secondary)' }}>
            {t('search_advanced')}
          </summary>
          <div className="grid grid-cols-2 gap-3 mt-3">
            <div>
              <label className={labelCls} style={labelStyle}>{t('search_author')}</label>
              <input name="author" value={filters.author} onChange={handleField}
                placeholder="username" className={fieldInputCls} style={inputBase} />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>{t('search_tag')}</label>
              <input name="tag" value={filters.tag} onChange={handleField}
                placeholder="tagname" className={fieldInputCls} style={inputBase} />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>{t('search_run')}</label>
              <input name="run_number" value={filters.run_number} onChange={handleField}
                type="number" placeholder="e.g. 42" className={fieldInputCls} style={inputBase} />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>{t('search_category')}</label>
              <input name="category" value={filters.category} onChange={handleField}
                placeholder="e.g. detector" className={fieldInputCls} style={inputBase} />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>{t('search_level')}</label>
              <select name="level" value={filters.level} onChange={handleField}
                className={fieldInputCls} style={inputBase}>
                {SEVERITIES.map(s => <option key={s} value={s}>{s || t('search_source_any')}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>{t('search_source')}</label>
              <select name="is_auto" value={filters.is_auto} onChange={handleField}
                className={fieldInputCls} style={inputBase}>
                <option value="">{t('search_source_any')}</option>
                <option value="false">{t('search_source_human')}</option>
                <option value="true">{t('search_source_auto')}</option>
              </select>
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>{t('search_date_from')}</label>
              <input name="date_from" value={filters.date_from} onChange={handleField}
                type="datetime-local" className={fieldInputCls} style={inputBase} />
            </div>
            <div>
              <label className={labelCls} style={labelStyle}>{t('search_date_to')}</label>
              <input name="date_to" value={filters.date_to} onChange={handleField}
                type="datetime-local" className={fieldInputCls} style={inputBase} />
            </div>
          </div>
        </details>
      </form>

      {/* Results */}
      {results === null && !loading && (
        <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>{t('search_empty')}</p>
      )}
      {loading && <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>{t('search_searching')}</p>}
      {results !== null && !loading && (
        <>
          <p className="text-sm mb-3" style={{ color: 'var(--text-secondary)' }}>{t('search_results', total)}</p>
          {results.length === 0 ? (
            <p className="text-center py-8" style={{ color: 'var(--text-muted)' }}>{t('search_no_results')}</p>
          ) : (
            <div className="flex flex-col gap-3">
              {results.map(e => <LogCard key={e.id} entry={e} />)}
            </div>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={p => doSearch(p)} />
        </>
      )}

    </div>
  )
}
