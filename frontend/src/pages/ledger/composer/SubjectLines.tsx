/**
 * SubjectLines — ordered subject lines; the first line is the book's subject.
 */
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/components/ui/input'
import { MAX_SUBJECT_LINES } from './composerForm'

export function SubjectLines({ value, onChange, error, disabled }: {
  value: string[]
  onChange: (value: string[]) => void
  error?: string
  disabled?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const id = useId()
  const set = (index: number, text: string) => onChange(value.map((line, i) => (i === index ? text : line)))
  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled} aria-describedby={`${id}-hint${error ? ` ${id}-error` : ''}`}>
      <legend className="mb-1 text-[0.78em] font-semibold text-muted-foreground">{t('ledgerBook.composer.subjects.legend')}</legend>
      <p id={`${id}-hint`} className="text-[0.76em] text-muted-foreground">
        {t('ledgerBook.composer.subjects.hint', { max: MAX_SUBJECT_LINES })}
      </p>
      <ol className="flex flex-col gap-2">
        {value.map((line, index) => (
          <li key={index} className="flex items-center gap-1.5">
            <span aria-hidden="true" className="w-6 shrink-0 text-center text-[0.78em] tabular-nums text-muted-foreground">{index + 1}</span>
            <Input
              value={line}
              aria-label={t('ledgerBook.composer.subjects.line', { n: index + 1 })}
              aria-invalid={error ? true : undefined}
              className={index === 0 ? 'font-semibold' : undefined}
              onChange={(e) => set(index, e.target.value)}
            />
          </li>
        ))}
      </ol>
      {error && <p id={`${id}-error`} role="alert" className="text-[0.78em] text-destructive">{error}</p>}
    </fieldset>
  )
}
