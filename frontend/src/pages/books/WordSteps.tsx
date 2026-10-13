import { Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

interface Props {
  /** «Open in Word» was clicked this visit (we can't observe Word itself). */
  opened: boolean
  /** Word save timestamps seen this visit, oldest first. */
  saveTimes: string[]
  /** Label of the page's finish button, quoted in step 3. */
  finishLabel: string
}

/** Open → save → finish, each step lit by real session state. */
export function WordSteps({ opened, saveTimes, finishLabel }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const locale = i18n.language.startsWith('ar') ? 'ar-AE' : 'en-GB'
  const saved = saveTimes.length > 0
  const current = saved ? 2 : opened ? 1 : 0
  const steps = [t('books.word.step1'), t('books.word.step2'), t('books.word.step3', { action: finishLabel })]
  return (
    <ol className="space-y-4">
      {steps.map((label, index) => {
        const done = index < current
        return (
          <li key={index} className="flex gap-3" aria-current={index === current ? 'step' : undefined}>
            <span
              aria-hidden
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                done && 'bg-success-soft text-success',
                index === current && 'bg-primary text-primary-foreground',
                index > current && 'border border-hairline text-muted-foreground',
              )}
            >
              {done ? <Check className="h-3.5 w-3.5" strokeWidth={2.5} /> : index + 1}
            </span>
            <div className="min-w-0 pt-0.5 text-sm">
              <p className={cn(index === current ? 'font-semibold text-foreground' : done ? 'text-muted-foreground' : 'text-foreground')}>{label}</p>
              {index === 0 && !saved && <p className="mt-1 text-xs text-muted-foreground">{t('books.word.protocolHint')}</p>}
              {index === 1 && saved && (
                <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                  {saveTimes.toReversed().map((time) => (
                    <li key={time}><bdi dir="auto">{new Date(time).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</bdi></li>
                  ))}
                </ul>
              )}
            </div>
          </li>
        )
      })}
    </ol>
  )
}
