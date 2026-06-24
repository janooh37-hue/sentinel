/**
 * Modal for creating a new book entry — TAMM redesign.
 * RHF + Zod validation. StampStylePreview updates live as style changes.
 *
 * Dialog shell uses rounded-2xl + surface + hairline. Form fields lean on the
 * shared shadcn primitives; the preview panel sits on surface-tinted with
 * an `is`-side rule. Primary CTA is the navy pill from the page header.
 */

import { useEffect } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'

import type { BookCategoryRead, BookCreate } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { StampStylePreview } from './StampStylePreview'
import { cn } from '@/lib/utils'

/** Sentinel for the "all categories" item (Radix forbids an empty value). */
const NO_CATEGORY = '__none__'

const STAMP_STYLES = [
  'Header Text (Ref: XX-0000)',
  'Bold Top-Right Corner',
  'Watermark Style',
] as const

type StampStyle = (typeof STAMP_STYLES)[number]

const schema = z.object({
  category_id: z.string().min(1, 'Required'),
  subject: z.string().min(1, 'Required'),
  direction: z.enum(['incoming', 'outgoing']),
  stamp_style: z.enum(STAMP_STYLES),
})

type FormValues = z.infer<typeof schema>

interface NewBookDialogProps {
  categories: BookCategoryRead[]
  onSubmit: (body: BookCreate) => Promise<void>
  onClose: () => void
  submitting: boolean
}

export function NewBookDialog({
  categories,
  onSubmit,
  onClose,
  submitting,
}: NewBookDialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const {
    register,
    handleSubmit,
    watch,
    control,
    formState: { errors },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      direction: 'incoming',
      stamp_style: 'Header Text (Ref: XX-0000)',
    },
  })

  const selectedStyle = watch('stamp_style') as StampStyle
  const selectedDirection = watch('direction')

  const submit = handleSubmit(async (values) => {
    await onSubmit({
      category_id: values.category_id,
      subject: values.subject,
      direction: values.direction,
      stamp_style: values.stamp_style,
    })
  })

  return (
    /* Modal backdrop */
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('books.newEntry')}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="relative w-full max-w-2xl overflow-hidden rounded-2xl border border-hairline bg-surface shadow-xl">
        {/* Header */}
        <div className="border-b border-hairline px-6 py-4">
          <h2 className="text-[1.05em] font-semibold text-foreground">{t('books.newEntry')}</h2>
        </div>

        <form onSubmit={submit}>
          <div className="max-h-[85vh] overflow-y-auto">
          <div className="flex flex-col md:flex-row gap-0">
            {/* Left: form fields */}
            <div className="flex-1 space-y-4 px-6 py-5">
              {/* Category */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="category_id"
                  className="text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
                >
                  {t('books.filters.category')}
                </Label>
                <Controller
                  control={control}
                  name="category_id"
                  render={({ field }) => (
                    <Select
                      value={field.value || NO_CATEGORY}
                      onValueChange={(v) => field.onChange(v === NO_CATEGORY ? '' : v)}
                    >
                      <SelectTrigger id="category_id">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_CATEGORY}>— {t('employees.filters.all')} —</SelectItem>
                        {categories.map((cat) => {
                          const label = isAr
                            ? (cat.name_ar ?? cat.name_en)
                            : (cat.name_en ?? cat.name_ar)
                          return (
                            <SelectItem key={cat.id} value={String(cat.id)}>
                              {cat.prefix} — {label}
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                  )}
                />
                {errors.category_id && (
                  <p className="text-xs text-accent">{errors.category_id.message}</p>
                )}
              </div>

              {/* Subject */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="subject"
                  className="text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
                >
                  {t('books.columns.subject')}
                </Label>
                <Input
                  id="subject"
                  {...register('subject')}
                  placeholder={t('books.columns.subject')}
                  className="h-9 text-[0.9em]"
                />
                {errors.subject && (
                  <p className="text-xs text-accent">{errors.subject.message}</p>
                )}
              </div>

              {/* Direction — chips instead of radios */}
              <div className="space-y-1.5">
                <Label className="text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  {t('books.columns.direction')}
                </Label>
                <div className="flex flex-wrap gap-1.5">
                  {(['incoming', 'outgoing'] as const).map((dir) => {
                    const active = selectedDirection === dir
                    return (
                      <label
                        key={dir}
                        className={cn(
                          'inline-flex cursor-pointer items-center rounded-full px-3 py-1 text-[0.78em] transition-colors max-md:min-h-[36px] max-md:py-1.5',
                          active
                            ? 'bg-primary-soft font-semibold text-primary'
                            : 'bg-surface-tinted text-muted-foreground hover:bg-border hover:text-foreground',
                        )}
                      >
                        <input
                          type="radio"
                          value={dir}
                          {...register('direction')}
                          className="sr-only"
                        />
                        {t(`books.direction.${dir}`)}
                      </label>
                    )
                  })}
                </div>
              </div>

              {/* Stamp style */}
              <div className="space-y-1.5">
                <Label
                  htmlFor="stamp_style"
                  className="text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
                >
                  {t('books.columns.stampStyle')}
                </Label>
                <Controller
                  control={control}
                  name="stamp_style"
                  render={({ field }) => (
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger id="stamp_style">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {STAMP_STYLES.map((s) => (
                          <SelectItem key={s} value={s}>
                            {s}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                />
              </div>
            </div>

            {/* Right: stamp preview */}
            <div className="flex w-full shrink-0 flex-col items-center justify-center border-t border-hairline bg-surface-tinted px-5 py-5 md:w-[220px] md:border-s md:border-t-0">
              <p className="mb-3 text-[0.7em] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                {t('books.stampPreview', { defaultValue: 'Stamp preview' })}
              </p>
              <StampStylePreview style={selectedStyle} />
            </div>
          </div>
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-2 border-t border-hairline bg-surface-raised px-6 py-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="rounded-full"
            >
              {t('common.cancel')}
            </Button>
            <Button type="submit" size="sm" disabled={submitting} className="rounded-full">
              {submitting ? t('common.loading') : t('books.newEntry')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
