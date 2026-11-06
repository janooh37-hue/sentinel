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
  external: z.boolean(),
  paper_preset: z.enum(['normal', 'report']),
  reference_book_ids: z.array(z.number().int()).max(20),
  folder_ids: z.array(z.number().int()).max(10),
  signer_manager_id: z.number().int().nullable(),
  addressees: z.array(z.object({ role: z.enum(['to', 'cc']), user_id: z.number().int().optional().nullable(), contact_id: z.number().int().optional().nullable() })).max(50),
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
    external: draft.external,
    paper_preset: draft.paper_preset,
    reference_book_ids: draft.reference_book_ids,
    folder_ids: draft.folder_ids,
    signer_manager_id: draft.signer_manager_id,
    addressees: draft.addressees,
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
  if (next.external !== saved.external) patch.external = next.external
  if (next.paper_preset !== saved.paper_preset) patch.paper_preset = next.paper_preset
  if (JSON.stringify(next.reference_book_ids) !== JSON.stringify(saved.reference_book_ids)) patch.reference_book_ids = next.reference_book_ids
  if (JSON.stringify(next.folder_ids) !== JSON.stringify(saved.folder_ids)) patch.folder_ids = next.folder_ids
  if (next.signer_manager_id !== saved.signer_manager_id) patch.signer_manager_id = next.signer_manager_id
  if (JSON.stringify(next.addressees) !== JSON.stringify(saved.addressees)) patch.addressees = next.addressees
  return patch
}
