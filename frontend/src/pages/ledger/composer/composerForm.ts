/** The composer's form values, their Zod schema and the PATCH diff. */
import { z } from 'zod'

import type { LedgerDraftRead, LedgerDraftUpdate } from '@/lib/api'

export const MAX_SUBJECT_LINES = 20

export const composerSchema = z.object({
  tab: z.number().int().min(1).max(15).nullable(),
  grade: z.enum(['unclassified', 'secret', 'top_secret', 'addressee_only']),
  importance: z.enum(['medium', 'high']).nullable(),
  subjects: z.array(z.string()).min(1).max(MAX_SUBJECT_LINES),
  body_html: z.string(),
})

export type ComposerValues = z.infer<typeof composerSchema>

/** An empty draft still shows one subject line to type into. */
export function valuesFromDraft(draft: LedgerDraftRead): ComposerValues {
  return {
    tab: draft.tab,
    grade: draft.grade,
    importance: draft.importance,
    subjects: draft.subjects.length > 0 ? draft.subjects : [''],
    body_html: draft.body_html,
  }
}

/** Only the fields that differ from what the server last accepted. */
export function changedFields(saved: ComposerValues, next: ComposerValues): LedgerDraftUpdate {
  const patch: LedgerDraftUpdate = {}
  if (next.tab !== saved.tab) patch.tab = next.tab
  if (next.grade !== saved.grade) patch.grade = next.grade
  if (next.importance !== saved.importance) patch.importance = next.importance
  if (next.subjects.length !== saved.subjects.length || next.subjects.some((s, i) => s !== saved.subjects[i])) {
    patch.subjects = next.subjects
  }
  if (next.body_html !== saved.body_html) patch.body_html = next.body_html
  return patch
}
