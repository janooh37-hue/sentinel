/** Form pieces of the print setup column: fieldsets, option rows, segmented choices. */

import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

import type { Orientation, PaperLanguage } from './printSettings'

export function SetupFieldset({
  legend,
  children,
  last = false,
}: {
  legend: string
  children: ReactNode
  last?: boolean
}): React.JSX.Element {
  return (
    <fieldset className={cn('m-0 grid gap-0.5 border-0 px-0 py-4', !last && 'border-b border-hairline')}>
      <legend className="float-start mb-2 w-full p-0 text-sm font-semibold text-primary">{legend}</legend>
      {children}
    </fieldset>
  )
}

export function OptionRow({
  type,
  name,
  checked,
  onChange,
  label,
  detail,
  disabled,
}: {
  type: 'radio' | 'checkbox'
  name?: string
  checked: boolean
  onChange: (checked: boolean) => void
  label: ReactNode
  /** Range or count shown at inline-end. */
  detail?: ReactNode
  disabled?: boolean
}): React.JSX.Element {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-1.5 text-sm',
        checked ? 'border-primary/50 bg-primary-soft' : 'border-transparent hover:bg-surface-tinted',
        disabled && 'cursor-default opacity-60',
      )}
    >
      <input
        type={type}
        name={name}
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        className="size-4 accent-[var(--primary)]"
      />
      <span className="flex-1">{label}</span>
      {detail !== undefined && <span className="text-xs text-muted-foreground">{detail}</span>}
    </label>
  )
}

export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: { value: T; label: string; lang?: string }[]
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div role="group" aria-label={label} className="inline-flex w-fit overflow-hidden rounded-md border border-border bg-surface">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          lang={option.lang}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'border-e border-border px-4 py-1.5 text-sm last:border-e-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
            value === option.value ? 'bg-primary font-medium text-primary-foreground' : 'hover:bg-surface-tinted',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

export function DateField({
  label,
  value,
  max,
  onChange,
}: {
  label: string
  value: string
  max: string
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <label className="grid gap-1 text-xs text-muted-foreground">
      {label}
      <input
        type="date"
        value={value}
        max={max}
        onChange={(event) => {
          if (event.target.value) onChange(event.target.value)
        }}
        className="rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm text-foreground"
      />
    </label>
  )
}

export function Hint({ children }: { children: ReactNode }): React.JSX.Element {
  return <p className="mt-1.5 text-xs text-muted-foreground">{children}</p>
}

/** Language and paper orientation: the same two choices on both setups. */
export function LanguageAndPaper({
  lang,
  orient,
  languageHint,
  onChange,
}: {
  lang: PaperLanguage
  orient: Orientation
  languageHint: string
  onChange: (patch: { lang?: PaperLanguage; orient?: Orientation }) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <SetupFieldset legend={t('statementPrint.language')}>
        <Segmented
          label={t('statementPrint.language')}
          value={lang}
          onChange={(value) => onChange({ lang: value })}
          options={[
            { value: 'ar', label: 'العربية', lang: 'ar' },
            { value: 'en', label: 'English', lang: 'en' },
          ]}
        />
        <Hint>{languageHint}</Hint>
      </SetupFieldset>
      <SetupFieldset legend={t('statementPrint.paperSize')} last>
        <Segmented
          label={t('statementPrint.paperSize')}
          value={orient}
          onChange={(value) => onChange({ orient: value })}
          options={[
            { value: 'portrait', label: t('statementPrint.portrait') },
            { value: 'landscape', label: t('statementPrint.landscape') },
          ]}
        />
        <Hint>A4</Hint>
      </SetupFieldset>
    </>
  )
}
