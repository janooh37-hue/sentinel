/**
 * ManagerPickerField — searchable combobox for manager selection.
 *
 * Fetches GET /api/v1/managers via TanStack Query. An empty-string value
 * means "no manager" (cell left blank in the generated form). This is
 * intentional: it is NOT the same as "use the default manager".
 */

import { useEffect, useId, useRef, useState } from 'react'
import { Controller, useFormContext } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { X } from 'lucide-react'

import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'
import type { ManagerRead } from '@/lib/api'
import type { FieldProps } from '../types'

export function ManagerPickerField({
  name,
  label_en,
  label_ar,
  required,
}: FieldProps): React.JSX.Element {
  const { i18n, t } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const label = isAr ? label_ar : label_en

  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const listboxId = useId()
  const rootRef = useRef<HTMLDivElement>(null)

  const {
    control,
    formState: { errors },
  } = useFormContext()

  const { data: managers = [], isLoading, isError: isPickerError } = useQuery<ManagerRead[]>({
    queryKey: ['managers'],
    queryFn: () => api.listManagers(),
    staleTime: 5 * 60 * 1000,
  })

  const q = query.toLowerCase()
  const filtered = query.trim()
    ? managers.filter(
        (m) =>
          (m.name_en ?? '').toLowerCase().includes(q) ||
          (m.name_ar ?? '').toLowerCase().includes(q),
      )
    : managers

  const error = (errors[name] as { message?: string } | undefined)?.message

  // Close on click outside (replaces the fragile blur setTimeout race).
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [open])

  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`${name}-input`}>
        {label}
        {required && <span className="ms-0.5 text-destructive">*</span>}
      </Label>
      <Controller
        control={control}
        name={name}
        render={({ field }) => {
          const selectedManager = managers.find((m) => m.id === field.value) ?? null

          const commit = (m: ManagerRead): void => {
            field.onChange(m.id)
            setOpen(false)
            setQuery('')
            setActiveIndex(-1)
          }

          const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
            if (e.key === 'ArrowDown') {
              e.preventDefault()
              if (!open) {
                setOpen(true)
                return
              }
              if (filtered.length > 0) {
                setActiveIndex((i) => (i + 1) % filtered.length)
              }
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              if (open && filtered.length > 0) {
                setActiveIndex((i) => (i <= 0 ? filtered.length - 1 : i - 1))
              }
            } else if (e.key === 'Enter') {
              if (open && activeIndex >= 0 && filtered[activeIndex]) {
                e.preventDefault()
                commit(filtered[activeIndex]!)
              }
            } else if (e.key === 'Escape') {
              if (open) {
                e.preventDefault()
                setOpen(false)
                setQuery('')
                setActiveIndex(-1)
              }
            }
          }

          return (
            <div className="relative" ref={rootRef}>
              <div className="flex gap-1.5">
                <input
                  id={`${name}-input`}
                  type="text"
                  role="combobox"
                  aria-expanded={open}
                  aria-controls={open ? listboxId : undefined}
                  aria-activedescendant={
                    open && activeIndex >= 0 ? `${listboxId}-opt-${activeIndex}` : undefined
                  }
                  aria-autocomplete="list"
                  autoComplete="off"
                  className="flex h-9 w-full rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50"
                  placeholder={t('application.searchManagers')}
                  value={open ? query : (selectedManager ? (isAr ? (selectedManager.name_ar ?? selectedManager.name_en ?? '') : (selectedManager.name_en ?? '')) : '')}
                  onFocus={() => {
                    setOpen(true)
                    setQuery('')
                    setActiveIndex(-1)
                  }}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setActiveIndex(-1)
                  }}
                  onKeyDown={onKeyDown}
                  title={t('application.managerPickerHint')}
                />
                {field.value && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      field.onChange(null)
                      setQuery('')
                    }}
                    aria-label={t('application.clearManager')}
                  >
                    <X className="h-4 w-4" strokeWidth={1.8} />
                  </Button>
                )}
              </div>

              {open && (
                <div
                  id={listboxId}
                  role="listbox"
                  className="absolute z-50 mt-1 max-h-56 w-full overflow-auto rounded-md border border-border bg-surface py-1 shadow-md"
                >
                  {isLoading ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      {t('common.loading')}
                    </div>
                  ) : filtered.length === 0 ? (
                    <div className="px-3 py-2 text-sm text-muted-foreground">
                      {t('common.noResults')}
                    </div>
                  ) : (
                    filtered.map((m, idx) => (
                      <button
                        key={m.id}
                        id={`${listboxId}-opt-${idx}`}
                        type="button"
                        role="option"
                        aria-selected={field.value === m.id}
                        className={`flex w-full flex-col px-3 py-1.5 text-start text-sm hover:bg-muted focus-visible:bg-muted ${
                          idx === activeIndex ? 'bg-muted' : ''
                        }`}
                        // onPointerDown fires before the input blur, so the
                        // selection commits reliably without a timeout race.
                        onPointerDown={(e) => {
                          e.preventDefault()
                          commit(m)
                        }}
                        onMouseEnter={() => setActiveIndex(idx)}
                      >
                        <span>{isAr ? (m.name_ar ?? m.name_en) : (m.name_en ?? m.name_ar)}</span>
                        {m.title && (
                          <span className="text-xs text-muted-foreground">
                            {m.title}
                          </span>
                        )}
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          )
        }}
      />
      {isPickerError && (
        <span role="alert" className="text-xs text-destructive">
          {t('application.pickerLoadError')}
        </span>
      )}
      <p className="text-xs text-muted-foreground">{t('application.managerPickerHint')}</p>
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}
