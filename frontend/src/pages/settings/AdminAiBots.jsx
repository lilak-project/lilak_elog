import { useState, useEffect, useCallback } from 'react'
import { CrudTable, Badge } from 'lilak-ui'
import api from '../../api'

const PROVIDERS = [
  { value: 'openai',    label: 'OpenAI (ChatGPT)' },
  { value: 'anthropic', label: 'Anthropic (Claude)' },
]

// @mention AI bots = a CRUD list with a richer form → kit CrudTable + CrudForm.
export default function AdminAiBots() {
  const [bots, setBots]   = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    api.get('/ai-bots').then(r => setBots(r.data)).finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  function buildPayload(v) {
    return {
      name: (v.name || '').trim().toLowerCase(),
      display_name: (v.display_name || '').trim() || (v.name || '').trim(),
      provider: v.provider,
      api_key: v.api_key ? v.api_key.trim() : undefined,
      model: (v.model || '').trim() || undefined,
      system_prompt: (v.system_prompt || '').trim() || undefined,
      context_count: Number(v.context_count) || 10,
      enabled: !!v.enabled,
    }
  }

  const Avatar = ({ provider }) => (
    <span style={{
      width: 34, height: 34, borderRadius: '50%', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-medium, 14px)', flexShrink: 0,
      backgroundColor: provider === 'openai' ? 'var(--success-bg)' : 'var(--warning-bg)',
      color: provider === 'openai' ? 'var(--success-text)' : 'var(--warning-text)',
    }}>{provider === 'openai' ? 'G' : 'C'}</span>
  )

  return (
    <div style={{ maxWidth: 720 }}>
      <p style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)', margin: '0 0 12px' }}>
        커뮤니티 채팅에서 <code style={{ padding: '0 4px', borderRadius: 4, backgroundColor: 'var(--surface-2)' }}>@이름</code> 으로 호출할 수 있는 AI 봇을 등록합니다.
      </p>
      <CrudTable
        rows={bots}
        rowKey={(r) => r.id}
        loading={loading}
        error={error}
        columns={[
          { key: 'name', header: '봇', render: (bot) => (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
              <Avatar provider={bot.provider} />
              <span style={{ minWidth: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-primary)' }}>@{bot.name}</span>
                  {bot.display_name && bot.display_name !== bot.name && (
                    <span style={{ fontSize: 'var(--fs-small, 12px)', color: 'var(--text-secondary)' }}>{bot.display_name}</span>
                  )}
                  {!bot.enabled && <Badge tone="neutral">비활성</Badge>}
                </span>
                <span style={{ display: 'flex', gap: 10, fontSize: 'var(--fs-tiny, 11px)', color: 'var(--text-muted)', marginTop: 2 }}>
                  <span>{bot.provider === 'openai' ? 'OpenAI' : 'Anthropic'}</span>
                  {bot.model && <span>{bot.model}</span>}
                  <span>컨텍스트 {bot.context_count}개</span>
                  <span style={{ fontFamily: 'var(--font-mono)' }}>{bot.api_key_hint}</span>
                </span>
              </span>
            </span>
          ) },
        ]}
        formColumns={2}
        formFields={[
          { key: 'name', label: '@멘션 이름', placeholder: 'gpt / claude / assistant', requiredOnCreate: true, disabledOnEdit: true },
          { key: 'display_name', label: '표시 이름', placeholder: 'ChatGPT / Claude AI' },
          { key: 'provider', label: '프로바이더', type: 'select', options: PROVIDERS, default: 'openai', required: true },
          { key: 'api_key', label: 'API 키', type: 'password', placeholder: '변경 시에만 입력', requiredOnCreate: true },
          { key: 'model', label: '모델', placeholder: '기본값 사용' },
          { key: 'context_count', label: '대화 컨텍스트 (개)', type: 'number', default: 10 },
          { key: 'system_prompt', label: '시스템 프롬프트', type: 'textarea', placeholder: '비워두면 기본값 사용', full: true },
          { key: 'enabled', label: '활성화', type: 'checkbox', checkboxLabel: '활성화', default: true, full: true },
        ]}
        onCreate={async (v) => { setError(''); try { await api.post('/ai-bots', buildPayload(v)); load() } catch (e) { setError(e.response?.data?.detail || '저장 실패'); throw e } }}
        onUpdate={async (row, v) => { setError(''); try { await api.put(`/ai-bots/${row.id}`, buildPayload(v)); load() } catch (e) { setError(e.response?.data?.detail || '저장 실패'); throw e } }}
        onDelete={async (row) => { await api.delete(`/ai-bots/${row.id}`); load() }}
        labels={{
          add: '봇 추가', edit: '편집', delete: '삭제',
          newTitle: 'AI 봇 추가', editTitle: '봇 편집',
          loading: '로딩 중…', empty: '등록된 AI 봇이 없습니다.',
          confirmDelete: (r) => `@${r.name} 봇을 삭제하시겠습니까?`,
        }}
      />
    </div>
  )
}
