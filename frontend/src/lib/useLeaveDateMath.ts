/**
 * useLeaveDateMath — two-way binding for any template form that exposes
 * `start_date` plus a day-count field (`total_days` or `days`) plus
 * `end_date`. On first mount, defaults `start_date` to today. Recomputes
 * `end_date` when `start_date` or days changes, and back-computes days
 * when the user edits `end_date`.
 *
 * Must be mounted inside the FormProvider that owns these fields. The
 * hook short-circuits when the active template doesn't have all three
 * fields, so it's safe to mount unconditionally.
 */

import { useEffect, useRef } from 'react'
import { useFormContext, useWatch } from 'react-hook-form'

import type { TemplateField } from '@/components/application/types'
import { computeDaysBetween, computeEndDate, todayIso } from './leaveDateMath'

export function useLeaveDateMath(fields: TemplateField[]): void {
  const { setValue, getValues, control } = useFormContext()
  const initialized = useRef(false)

  const hasStart = fields.some((f) => f.id === 'start_date')
  const daysField = fields.find((f) => f.id === 'total_days' || f.id === 'days')
  const hasEnd = fields.some((f) => f.id === 'end_date')

  const start = useWatch({ control, name: 'start_date' })
  const days = useWatch({ control, name: daysField?.id ?? '' })
  const end = useWatch({ control, name: 'end_date' })

  // Previous-render values, to tell which field the user actually changed.
  // The reverse (end→days) effect must fire ONLY on a genuine end_date edit —
  // not when `days` changed and `end` is still the not-yet-recomputed old value.
  // Reading the stale `end` there is what reset a 2-digit days entry back to 1
  // (the "11 bounces to 1" bug).
  const prevDays = useRef(days)
  const prevEnd = useRef(end)

  // Default start_date to today on first mount if empty.
  useEffect(() => {
    if (initialized.current) return
    if (hasStart && !getValues('start_date')) {
      setValue('start_date', todayIso(), { shouldDirty: false })
    }
    initialized.current = true
  }, [hasStart, getValues, setValue])

  // start or days → end
  useEffect(() => {
    if (!hasStart || !daysField || !hasEnd) return
    if (!start || !days) return
    const newEnd = computeEndDate(start as string, Number(days))
    if (newEnd && getValues('end_date') !== newEnd) {
      setValue('end_date', newEnd, { shouldDirty: true })
    }
  }, [start, days, hasStart, daysField, hasEnd, setValue, getValues])

  // end → days — only when the USER edited end_date (it changed while days did
  // not). When `days` changed, the start/days→end effect owns `end`, so skip the
  // back-compute and avoid the days↔end feedback loop.
  useEffect(() => {
    const daysChanged = prevDays.current !== days
    const endChanged = prevEnd.current !== end
    prevDays.current = days
    prevEnd.current = end

    if (!hasStart || !daysField || !hasEnd) return
    if (!start || !end) return
    if (!endChanged || daysChanged) return

    const newDays = computeDaysBetween(start as string, end as string)
    if (newDays > 0 && Number(days) !== newDays) {
      setValue(daysField.id, String(newDays), { shouldDirty: true })
    }
  }, [end, days, start, hasStart, daysField, hasEnd, setValue])
}
