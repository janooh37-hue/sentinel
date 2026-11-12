/**
 * ImportancePicker — بدون / None · متوسطة / Medium · عالية / High (D2, D8).
 * Medium and High carry different glyphs, so the choice never rests on colour.
 */
import { CircleAlert, TriangleAlert } from 'lucide-react'
import { useId } from 'react'
import { useTranslation } from 'react-i18next'

import type { Importance } from '@/components/books/ImportanceMark'
import { cn } from '@/lib/utils'

const OPTIONS: { value: Importance | null; key: string; icon: typeof CircleAlert | null; tone: string }[] = [
  { value: null, key: 'none', icon: null, tone: '' },
  { value: 'medium', key: 'medium', icon: CircleAlert, tone: 'text-caution' },
  { value: 'high', key: 'high', icon: TriangleAlert, tone: 'text-destructive' },
]

export function ImportancePicker({ value, onChange, disabled }: {
  value: Importance | null
  onChange: (value: Importance | null) => void
  disabled?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const name = useId()
  return (
    <fieldset className="flex flex-col gap-1" disabled={disabled}>
      <legend className="mb-1 text-[0.78em] font-semibold text-muted-foreground">{t('books.importance.label')}</legend>
      <div className="flex flex-wrap gap-2">
        {OPTIONS.map(({ value: option, key, icon: Icon, tone }) => (
          <label
            key={key}
            className={cn(
              'inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border border-hairline px-3 text-[0.84em]',
              'has-[:checked]:border-primary has-[:checked]:bg-primary/5 has-[:checked]:font-semibold',
              'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring',
            )}
          >
            <input
              type="radio"
              name={name}
              className="size-4 accent-primary"
              checked={value === option}
              onChange={() => onChange(option)}
            />
            {Icon && <Icon aria-hidden="true" className={cn('size-4', tone)} />}
            {t(`books.importance.${key}`)}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
