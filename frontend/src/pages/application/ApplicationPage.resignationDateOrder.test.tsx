/**
 * Ordering test for `restoreThenSeedResignationDate` — the single function
 * ApplicationPage.tsx's schemaReady effect calls to restore a draft and then
 * seed the Resignation Letter's date (ApplicationPage.tsx ~636-655).
 *
 * This imports and calls the REAL production function (not a re-implemented
 * copy of its logic), via a real react-hook-form instance obtained through
 * `renderHook` — no `ApplicationPage` mount, no DOM render at all, so this
 * stays cheap on a machine that has crashed V8 running two suites at once.
 *
 * Because the restore-then-seed order now lives in exactly one function
 * (rather than as two separate statements at the ApplicationPage call site),
 * there is no ordering left for a future edit to silently reverse at the
 * call site — this test guards the one place the ordering still exists.
 *
 * Why "draft lacks resignation_date" is the discriminating case (verified
 * empirically against react-hook-form 7.76's reset() semantics): when a
 * draft DOES carry its own resignation_date, `form.reset(draft)` always
 * wins regardless of order, because reset() fully replaces the form's
 * values — a prior setValue can't survive it either way. The seed only
 * changes the outcome when the draft is silent on the field (e.g. an
 * in-flight draft saved before this feature shipped): seed-after-restore
 * correctly fills in today; seed-before-restore would lose the seeded value
 * entirely, because the restore's reset() wipes any key not present in the
 * draft. That is the scenario this test locks down.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useForm } from 'react-hook-form'

import { loadDraft, saveDraft } from '@/lib/formDrafts'
import { restoreThenSeedResignationDate, todayIso } from './resignationDate'

const TEMPLATE_ID = 'Resignation Letter'
const TODAY = todayIso()

function setup() {
  return renderHook(() => useForm<Record<string, unknown>>({ defaultValues: {} }))
}

// restoreThenSeedResignationDate calls form.reset()/setValue(), which trigger
// React state updates on the hook under test — act() keeps that synchronous
// and out of the console as an "update not wrapped in act" warning.
function run(
  result: ReturnType<typeof setup>['result'],
  draftValues: Record<string, unknown> | null,
  hasField: boolean,
) {
  act(() => {
    restoreThenSeedResignationDate(result.current, draftValues, hasField, TODAY)
  })
}

describe('restoreThenSeedResignationDate — as called by ApplicationPage.tsx', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => window.localStorage.clear())

  it('keeps a restored draft that already has its own resignation_date', () => {
    saveDraft(TEMPLATE_ID, { resignation_date: '2026-08-15' })
    const { result } = setup()
    run(result, loadDraft(TEMPLATE_ID), true)
    expect(result.current.getValues('resignation_date')).toBe('2026-08-15')
  })

  it('seeds today when a restored draft predates the field (order-sensitive case)', () => {
    // An in-flight draft saved before resignation_date existed — it has
    // other fields but is silent on this one.
    saveDraft(TEMPLATE_ID, { other_field: 'x' })
    const { result } = setup()
    run(result, loadDraft(TEMPLATE_ID), true)
    expect(result.current.getValues('resignation_date')).toBe(TODAY)
  })

  it('seeds today when there is no draft at all', () => {
    const { result } = setup()
    run(result, loadDraft(TEMPLATE_ID), true)
    expect(result.current.getValues('resignation_date')).toBe(TODAY)
  })

  it('does nothing when the template has no resignation_date field', () => {
    const { result } = setup()
    run(result, null, false)
    expect(result.current.getValues('resignation_date')).toBeUndefined()
  })
})
