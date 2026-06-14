import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { CrudTable } from 'lilak-ui'
import api from '../api'
import { useAuth } from '../context/AuthContext'
import { useLang } from '../context/LangContext'

// API tokens — rebuilt on the kit CrudTable. Tokens can be created and revoked
// (no edit); the freshly-created secret is revealed once below.
export default function AdminTokens() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const { t } = useLang()
  const [tokens, setTokens] = useState([])
  const [loading, setLoading] = useState(true)
  const [newToken, setNewToken] = useState(null)

  useEffect(() => {
    if (!user || user.role !== 'manager') { navigate('/'); return }
    fetchTokens()
  }, [user])

  async function fetchTokens() {
    setLoading(true)
    try { const res = await api.get('/tokens'); setTokens(res.data) } finally { setLoading(false) }
  }

  if (!user || user.role !== 'manager') return null

  const statusBadge = (active) => (
    <span style={{ fontSize: 'var(--fs-tiny, 11px)', padding: '1px 8px', borderRadius: 999, whiteSpace: 'nowrap',
      backgroundColor: active ? 'var(--success-bg)' : 'var(--danger-bg)',
      color: active ? 'var(--success-text)' : 'var(--danger-text)' }}>
      {active ? t('tokens_active') : t('tokens_revoked')}
    </span>
  )

  return (
    <div className="max-w-3xl mx-auto">
      {/* Usage hint */}
      <div className="border rounded-xl px-5 py-4 text-sm mb-5"
           style={{ backgroundColor: 'var(--info-bg)', borderColor: 'var(--border-focus)', color: 'var(--info-text)' }}>
        <strong>{t('tokens_usage_title')}:</strong>
        <pre className="mt-2 rounded p-3 text-xs overflow-x-auto"
             style={{ backgroundColor: 'var(--surface)', color: 'var(--text-primary)' }}>
{`curl -X POST ${window.location.origin}/api/logs \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"title":"Run 42 started","level":"info","is_auto":true,"run_number":42}'`}
        </pre>
      </div>

      {/* New token revealed once */}
      {newToken && (
        <div className="border rounded-xl px-5 py-4 mb-5"
             style={{ backgroundColor: 'var(--success-bg)', borderColor: 'var(--success-text)' }}>
          <p className="text-sm font-semibold mb-2" style={{ color: 'var(--success-text)' }}>{t('tokens_created_msg')}</p>
          <code className="block text-xs border rounded px-3 py-2 break-all"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--success-text)', color: 'var(--text-primary)' }}>
            {newToken}
          </code>
          <button onClick={() => { navigator.clipboard.writeText(newToken); alert(t('tokens_copied')) }}
            className="mt-2 text-xs hover:underline" style={{ color: 'var(--success-text)' }}>{t('tokens_copy')}</button>
        </div>
      )}

      <CrudTable
        rows={tokens}
        rowKey={(r) => r.id}
        loading={loading}
        columns={[
          { key: 'name', header: t('tokens_col_name') },
          { key: 'source_name', header: t('tokens_col_source'), mono: true, render: (r) => r.source_name || '—' },
          { key: 'status', header: t('tokens_col_status'), render: (r) => statusBadge(r.is_active) },
          { key: 'last', header: t('tokens_col_last'), render: (r) => r.last_used_at ? new Date(r.last_used_at).toLocaleString() : t('tokens_never') },
        ]}
        formFields={[
          { key: 'name', label: t('tokens_form_name'), required: true, placeholder: 'e.g. DAQ System' },
          { key: 'source_name', label: t('tokens_form_source'), placeholder: 'e.g. daq_system' },
        ]}
        onCreate={async (v) => { const res = await api.post('/tokens', v); setNewToken(res.data.token); await fetchTokens() }}
        onDelete={async (row) => { await api.delete(`/tokens/${row.id}`); await fetchTokens() }}
        canDelete={(row) => row.is_active}
        labels={{
          add: t('tokens_new'), delete: t('tokens_revoke'),
          confirmDelete: () => t('tokens_revoke_confirm'),
          newTitle: t('tokens_new'), empty: t('tokens_empty'), loading: t('tokens_loading'),
        }}
      />
    </div>
  )
}
