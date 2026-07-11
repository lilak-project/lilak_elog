/**
 * Portal-safe dialogs — a Promise-based replacement for window.confirm / prompt /
 * alert, which are BLOCKED when elog runs inside the portal proxy frame (so a
 * `if (!await confirm(...)) return` there silently did nothing).
 *
 *   import { confirm, promptDialog, alertDialog } from '../components/dialog'
 *   if (!(await confirm('삭제할까요?'))) return          // → boolean
 *   const name = await promptDialog('이름', current)     // → string | null
 *   alertDialog('저장했습니다.')                          // fire-and-forget notice
 *
 * A single <DialogHost/> is mounted once at the app root; the functions above drive
 * it and resolve when the user acts. Rendered with the kit's Card/Button/Input on the
 * app's theme tokens.
 */
import React, { useEffect, useRef, useState } from 'react'

import { Button, Card, Input } from 'lilak-ui'

let _set = null            // setter of the mounted host
let _seq = 0

function open(spec) {
  return new Promise((resolve) => {
    if (!_set) {           // host not mounted (shouldn't happen) → safe default
      resolve(spec.kind === 'confirm' ? false : spec.kind === 'prompt' ? null : undefined)
      return
    }
    _set({ ...spec, id: ++_seq, resolve })
  })
}

export function confirm(message, opts = {}) {
  return open({ kind: 'confirm', message, ...opts })          // → Promise<boolean>
}
export function promptDialog(message, value = '', opts = {}) {
  return open({ kind: 'prompt', message, value: value ?? '', ...opts })  // → Promise<string|null>
}
export function alertDialog(message, opts = {}) {
  return open({ kind: 'alert', message, ...opts })            // → Promise<void>
}

export function DialogHost() {
  const [dlg, setDlg] = useState(null)
  const [value, setValue] = useState('')
  const inputRef = useRef(null)

  useEffect(() => {
    _set = (d) => { setValue(d?.kind === 'prompt' ? (d.value ?? '') : ''); setDlg(d) }
    return () => { if (_set) _set = null }
  }, [])
  useEffect(() => { if (dlg?.kind === 'prompt') setTimeout(() => inputRef.current?.focus(), 0) }, [dlg])

  if (!dlg) return null

  const close = (result) => { dlg.resolve?.(result); setDlg(null) }
  const onConfirm = () => close(dlg.kind === 'prompt' ? value : dlg.kind === 'confirm' ? true : undefined)
  const onCancel = () => close(dlg.kind === 'prompt' ? null : dlg.kind === 'confirm' ? false : undefined)

  return (
    <div role="dialog" aria-modal="true"
         style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center', padding: 16, zIndex: 3000 }}
         onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}>
      <Card style={{ width: '100%', maxWidth: 420 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: 4 }}>
          <div style={{ margin: 0, lineHeight: 1.5, whiteSpace: 'pre-wrap', color: 'var(--text)' }}>{dlg.message}</div>
          {dlg.kind === 'prompt' && (
            <Input ref={inputRef} size="md" value={value}
                   onChange={(e) => setValue(e.target.value)}
                   onKeyDown={(e) => { if (e.key === 'Enter') onConfirm() }} />
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            {dlg.kind !== 'alert' && (
              <Button size="md" variant="secondary" type="button" onClick={onCancel}>
                {dlg.cancelLabel || '취소'}
              </Button>
            )}
            <Button size="md" type="button" variant={dlg.danger ? 'danger' : undefined} onClick={onConfirm}>
              {dlg.confirmLabel || '확인'}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  )
}
