/**
 * SubjectLines — ordered subject lines; the first line is the book's subject.
 * Lines can be added (up to 20), removed (one always stays) and moved.
 */
import { ArrowDown, ArrowUp, Plus, X } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { MAX_SUBJECT_LINES } from './composerForm'

interface Rows { keys: number[]; next: number }

export function SubjectLines({ value, onChange, error, disabled }: {
  value: string[]
  onChange: (value: string[]) => void
  error?: string
  disabled?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const id = useId()
  // Stable row keys, so a moved line keeps its input (and focus) across renders.
  const [rows, setRows] = useState<Rows>(() => ({ keys: value.map((_, i) => i), next: value.length }))
  if (rows.keys.length !== value.length) {
    setRows({ keys: value.map((_, i) => rows.next + i), next: rows.next + value.length })
  }
  const keys = rows.keys

  const commit = (lines: string[], order: number[], next = rows.next): void => {
    setRows({ keys: order, next })
    onChange(lines)
  }
  const move = (from: number, to: number): void => {
    const lines = [...value]
    const order = [...keys]
    ;[lines[from], lines[to]] = [lines[to], lines[from]]
    ;[order[from], order[to]] = [order[to], order[from]]
    commit(lines, order)
  }
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled}>
      <legend className="mb-1 text-[0.78em] font-semibold text-muted-foreground">{t('ledgerBook.composer.subjects.legend')}</legend>
      <p id={hintId} className="text-[0.76em] text-muted-foreground">
        {t('ledgerBook.composer.subjects.hint', { max: MAX_SUBJECT_LINES })}
      </p>
      <ol className="flex flex-col gap-2">
        {value.map((line, index) => {
          const n = index + 1
          return (
            <li key={keys[index]} className="flex items-center gap-1">
              <span aria-hidden="true" className="w-6 shrink-0 text-center text-[0.78em] tabular-nums text-muted-foreground">{n}</span>
              <Input
                value={line}
                aria-label={t('ledgerBook.composer.subjects.line', { n })}
                aria-describedby={[index === 0 ? hintId : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined}
                aria-invalid={error ? true : undefined}
                className={index === 0 ? 'font-semibold' : undefined}
                onChange={(e) => onChange(value.map((old, i) => (i === index ? e.target.value : old)))}
              />
              <Button
                type="button" variant="ghost" size="icon" className="size-10 shrink-0"
                aria-label={t('ledgerBook.composer.subjects.moveUp', { n })}
                disabled={index === 0}
                onClick={() => move(index, index - 1)}
              >
                <ArrowUp aria-hidden="true" className="size-4" />
              </Button>
              <Button
                type="button" variant="ghost" size="icon" className="size-10 shrink-0"
                aria-label={t('ledgerBook.composer.subjects.moveDown', { n })}
                disabled={index === value.length - 1}
                onClick={() => move(index, index + 1)}
              >
                <ArrowDown aria-hidden="true" className="size-4" />
              </Button>
              <Button
                type="button" variant="ghost" size="icon" className="size-10 shrink-0"
                aria-label={t('ledgerBook.composer.subjects.remove', { n })}
                disabled={value.length === 1}
                onClick={() => commit(value.filter((_, i) => i !== index), keys.filter((_, i) => i !== index))}
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </li>
          )
        })}
      </ol>
      <Button
        type="button" variant="outline" size="sm" className="self-start"
        disabled={value.length >= MAX_SUBJECT_LINES}
        onClick={() => commit([...value, ''], [...keys, rows.next], rows.next + 1)}
      >
        <Plus aria-hidden="true" className="size-4" />
        {t('ledgerBook.composer.subjects.add')}
      </Button>
      {error && <p id={errorId} role="alert" className="text-[0.78em] text-destructive">{error}</p>}
    </fieldset>
  )
}
