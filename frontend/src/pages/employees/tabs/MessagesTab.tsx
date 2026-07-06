/** Messages tab — SMS notifications sent to this employee (sent / failed). */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, AlertTriangle } from 'lucide-react'
import type { SmsMessageRead } from '@/lib/api'

export function MessagesTab({ messages }: { messages: SmsMessageRead[] }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const fmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )
  if (messages.length === 0) {
    return (
      <div className="rounded-2xl bg-surface p-12 text-center text-muted-foreground">
        {t('employee.messages.empty')}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-3">
      {messages.map((m) => {
        const ok = m.status === 'sent'
        return (
          <div key={m.id} className="rounded-xl border border-hairline bg-surface p-4">
            <div className="mb-1.5 flex items-center gap-2 text-[0.78em]">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-semibold ${ok ? 'bg-success-soft text-success' : 'bg-destructive/10 text-destructive'}`}>
                {ok ? <Check className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}
                {ok ? t('employee.messages.sent') : t('employee.messages.failed')}
              </span>
              <span className="font-mono text-muted-foreground">{m.phone}</span>
              <span className="ms-auto font-mono text-muted-foreground">{fmt.format(new Date(m.created_at))}</span>
            </div>
            {m.body && <div className="whitespace-pre-wrap text-[0.9em] text-foreground" dir="auto">{m.body}</div>}
            {!ok && m.error && <div className="mt-1 text-[0.8em] text-destructive" dir="ltr">{m.error}</div>}
          </div>
        )
      })}
    </div>
  )
}
