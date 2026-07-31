/**
 * Seed rule for the Resignation Letter's date input.
 *
 * Returns the value to write, or `null` to leave the form as-is. Only a truly
 * absent value is seeded: a restored draft or a revise snapshot is the
 * operator's own state and must never be overwritten by today's date.
 */
export function seedResignationDate(
  current: unknown,
  today: string,
): string | null {
  if (current === undefined || current === null || current === '') return today
  return null
}

/** Today as `YYYY-MM-DD` in the browser's local timezone. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** The subset of react-hook-form's `UseFormReturn` this module needs. Kept
 * structural (rather than importing RHF's generics) so any form instance —
 * real or a test's — satisfies it without a cast. */
export interface SeedableForm {
  getValues(name: string): unknown
  setValue(name: string, value: unknown): void
  reset(values: Record<string, unknown>): void
}

/**
 * Restore a draft's values into the form (if a draft exists), then seed the
 * Resignation Letter's date — only if it is still absent afterwards.
 *
 * This is the ONE place the restore-then-seed order lives. ApplicationPage.tsx
 * and this module's own test both call it, so there is no separate ordering
 * left at the call site for a future edit to silently reverse: moving the
 * seed before the restore, or making it unconditional, requires editing
 * *this* function, where both the restore and the seed sit side by side.
 *
 * Preserves the previous call-site behaviour exactly: when there is no
 * draft, `reset` is never called — the form is left exactly as the caller
 * (ApplicationPage's template-switch handler) already set it — and only the
 * resignation_date seed applies on top.
 */
export function restoreThenSeedResignationDate(
  form: SeedableForm,
  draftValues: Record<string, unknown> | null,
  hasResignationDateField: boolean,
  today: string,
): void {
  if (draftValues) form.reset(draftValues)
  if (hasResignationDateField) {
    const seed = seedResignationDate(form.getValues('resignation_date'), today)
    if (seed !== null) form.setValue('resignation_date', seed)
  }
}
