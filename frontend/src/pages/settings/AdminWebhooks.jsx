import { useState, useEffect, useCallback } from 'react'
import { CrudTable, Badge } from 'lilak-ui'
import api from '../../api'
import { useLang } from '../../context/LangContext'

// Webhook admin = a plain CRUD list (name + url + enabled toggle) → kit CrudTable.
export default function AdminWebhooks() {
  const { t } = useLang()
  const [webhooks, setWebhooks] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState('')

  const fetchWebhooks = useCallback(async () => {
    setLoading(true)
    try { setWebhooks((await api.get('/webhooks')).data) }
    catch { /* silent */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchWebhooks() }, [fetchWebhooks])

  async function toggle(wh) {
    try { await api.put(`/webhooks/${wh.id}`, { enabled: !wh.enabled }); fetchWebhooks() }
    catch { /* silent */ }
  }

  // A small switch reused for the enabled column.
  const Switch = ({ on, onClick, title }) => (
    <button onClick={(e) => { e.stopPropagation(); onClick() }} title={title}
      style={{ width: 40, height: 24, borderRadius: 999, border: 'none', cursor: 'pointer', position: 'relative',
        backgroundColor: on ? 'var(--success-text)' : 'var(--surface-3)', transition: 'background-color .15s' }}>
      <span style={{ position: 'absolute', top: 4, left: on ? 20 : 4, width: 16, height: 16, borderRadius: '50%',
        backgroundColor: 'var(--surface)', boxShadow: '0 1px 2px rgba(0,0,0,.3)', transition: 'left .2s' }} />
    </button>
  )

  return (
    <div style={{ maxWidth: 720 }}>
      <p style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)', margin: '0 0 12px' }}>{t('webhook_subtitle')}</p>
      <CrudTable
        rows={webhooks}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        columns={[
          { key: 'enabled', header: '', fit: true,
            render: (wh) => <Switch on={wh.enabled} onClick={() => toggle(wh)} title={wh.enabled ? t('webhook_disable') : t('webhook_enable')} /> },
          { key: 'name', header: t('webhook_name') },
          { key: 'url', header: t('webhook_url'), mono: true,
            render: (wh) => <span style={{ opacity: wh.enabled ? 1 : 0.5 }}>{wh.url}</span> },
        ]}
        formFields={[
          { key: 'name', label: t('webhook_name'), placeholder: t('webhook_name_placeholder'), requiredOnCreate: true, full: true },
          { key: 'url', label: t('webhook_url'), placeholder: 'https://…', mono: true, requiredOnCreate: true, full: true },
        ]}
        onCreate={async (v) => { setError(''); try { await api.post('/webhooks', { name: v.name?.trim(), url: v.url?.trim() }); fetchWebhooks() } catch { setError(t('webhook_save_fail')); throw new Error() } }}
        onUpdate={async (row, v) => { setError(''); try { await api.put(`/webhooks/${row.id}`, { name: v.name?.trim(), url: v.url?.trim() }); fetchWebhooks() } catch { setError(t('webhook_save_fail')); throw new Error() } }}
        onDelete={async (row) => { await api.delete(`/webhooks/${row.id}`); fetchWebhooks() }}
        labels={{
          add: t('webhook_add'), edit: t('admin_edit'), delete: t('admin_delete'),
          newTitle: t('webhook_add'), editTitle: t('admin_edit'),
          loading: t('admin_loading'), empty: t('webhook_empty'),
          confirmDelete: (r) => t('webhook_delete_confirm', r.name),
        }}
      />
    </div>
  )
}
