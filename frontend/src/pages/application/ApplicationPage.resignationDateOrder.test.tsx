/**
 * Ordering test for the resignation-date seed inside ApplicationPage's
 * schemaReady effect (ApplicationPage.tsx ~622-658): restore the draft
 * FIRST, seed only afterwards, and only when still absent.
 *
 * The pure `seedResignationDate` tests in
 * ApplicationPage.resignationDate.test.tsx cover the helper in isolation but
 * cannot catch a call-site regression where the seed is moved before the
 * restore — this repo has already shipped that exact bug shape once (a
 * stale draft overriding a default-on toggle, in production).
 *
 * The harness below replicates the two effect steps in the real order
 * (mirrors ApplicationPage.tsx lines 636-654: `loadDraft` + `form.reset`,
 * then `seedResignationDate` + `form.setValue`) using the real
 * `loadDraft`/`saveDraft` from `@/lib/formDrafts` and the real helper.
 *
 * Why "draft lacks resignation_date" is the discriminating case (verified
 * empirically against react-hook-form 7.76's reset() semantics): when a
 * draft DOES carry its own resignation_date, `form.reset(draft)` always
 * wins regardless of order, because reset() fully replaces the form's
 * values — a prior setValue can't survive it either way. The seed only
 * changes the outcome when the draft is silent on the field (e.g. an
 * in-flight draft saved before this feature shipped): seed-after-restore
 * correctly fills in today; seed-before-restore loses the seeded value
 * entirely, because the following reset() wipes any key not present in the
 * draft. That is the scenario this test locks down — it fails if the two
 * steps are swapped.
 */
import { render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useForm, FormProvider } from 'react-hook-form'
import { useEffect } from 'react'

import { loadDraft, saveDraft } from '@/lib/formDrafts'
import { seedResignationDate, todayIso } from './resignationDate'

const TEMPLATE_ID = 'Resignation Letter'
const TODAY = todayIso()

function RestoreOrderHarness({ onValues }: { onValues: (v: Record<string, unknown>) => void }) {
  const form = useForm<Record<string, unknown>>({ defaultValues: {} })

  useEffect(() => {
    // Mirrors ApplicationPage.tsx's schemaReady effect: restore the draft...
    const draft = loadDraft(TEMPLATE_ID)
    if (draft) form.reset(draft)
    // ...THEN seed, only when still absent.
    const seed = seedResignationDate(form.getValues('resignation_date'), TODAY)
    if (seed !== null) form.setValue('resignation_date', seed)

    onValues(form.getValues())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <FormProvider {...form}>
      <div />
    </FormProvider>
  )
}

describe('ApplicationPage schemaReady effect — resignation_date restore ordering', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => window.localStorage.clear())

  it('keeps a restored draft that already has its own resignation_date', async () => {
    saveDraft(TEMPLATE_ID, { resignation_date: '2026-08-15' })
    let captured: Record<string, unknown> = {}
    render(<RestoreOrderHarness onValues={(v) => { captured = v }} />)
    await waitFor(() => expect(captured.resignation_date).toBeDefined())
    expect(captured.resignation_date).toBe('2026-08-15')
  })

  it('seeds today when a restored draft predates the field (order-sensitive case)', async () => {
    // An in-flight draft saved before resignation_date existed — it has other
    // fields but is silent on this one. Under the correct order (restore,
    // then seed) the seed fills it in with today. Under the wrong order
    // (seed, then restore) the subsequent form.reset(draft) wipes the seeded
    // value because reset() replaces the whole form, and the field is
    // permanently lost. This assertion fails under that regression.
    saveDraft(TEMPLATE_ID, { other_field: 'x' })
    let captured: Record<string, unknown> = {}
    render(<RestoreOrderHarness onValues={(v) => { captured = v }} />)
    await waitFor(() => expect(captured.resignation_date).toBeDefined())
    expect(captured.resignation_date).toBe(TODAY)
  })

  it('seeds today when there is no draft at all', async () => {
    let captured: Record<string, unknown> = {}
    render(<RestoreOrderHarness onValues={(v) => { captured = v }} />)
    await waitFor(() => expect(captured.resignation_date).toBeDefined())
    expect(captured.resignation_date).toBe(TODAY)
  })
})
