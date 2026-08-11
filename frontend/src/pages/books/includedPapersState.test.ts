import { describe, expect, it } from 'vitest'

import type { IncludedPaperRead, IncludedPapersPreviewRead, StagedAttachmentRead } from '@/lib/api'
import {
  addStagedPaper,
  applyPackagePreview,
  createIncludedPapersState,
  includedPapersRequest,
  isPreviewCurrent,
  moveIncludedPaper,
  removeIncludedPaper,
  replaceIncludedPaper,
} from './includedPapersState'

const existing: IncludedPaperRead = {
  id: '11111111-1111-4111-8111-111111111111',
  original_name: 'existing.pdf',
  slot_key: null,
  media_type: 'application/pdf',
  size: 100,
  page_count: 2,
  added_by_user_id: 1,
  added_at: '2026-08-10T10:00:00Z',
  page_start: 3,
  page_end: 4,
  embedded_in_signed_base: false,
}

const embedded: IncludedPaperRead = {
  ...existing,
  id: '22222222-2222-4222-8222-222222222222',
  original_name: 'approved.pdf',
  embedded_in_signed_base: true,
}

const firstUpload: StagedAttachmentRead = {
  token: 'stage-one',
  filename: 'first.pdf',
  size: 250,
}

const secondUpload: StagedAttachmentRead = {
  token: 'stage-two',
  filename: 'second.png',
  size: 350,
}

describe('includedPapersState', () => {
  it('adds staged papers in selection order and builds the save proposal', () => {
    let state = createIncludedPapersState(4, [existing])
    state = addStagedPaper(state, firstUpload, '33333333-3333-4333-8333-333333333333')
    state = addStagedPaper(state, secondUpload, '44444444-4444-4444-8444-444444444444')

    expect(state.items.map((paper) => paper.original_name)).toEqual([
      'existing.pdf',
      'first.pdf',
      'second.png',
    ])
    expect(includedPapersRequest(state)).toEqual({
      revision: 4,
      items: [
        { id: existing.id },
        {
          id: '33333333-3333-4333-8333-333333333333',
          staged_token: 'stage-one',
          original_name: 'first.pdf',
        },
        {
          id: '44444444-4444-4444-8444-444444444444',
          staged_token: 'stage-two',
          original_name: 'second.png',
        },
      ],
    })
  })

  it('replaces an editable paper in place but leaves signed-base papers locked', () => {
    const initial = createIncludedPapersState(1, [existing, embedded])
    const replaced = replaceIncludedPaper(initial, existing.id, firstUpload)
    const locked = replaceIncludedPaper(replaced, embedded.id, secondUpload)

    expect(replaced.items[0]).toMatchObject({
      id: existing.id,
      original_name: 'first.pdf',
      staged_token: 'stage-one',
      size: 250,
    })
    expect(locked).toBe(replaced)
    expect(locked.items[1]).toEqual(embedded)
  })

  it('removes and reorders only editable papers', () => {
    let state = createIncludedPapersState(2, [embedded, existing])
    state = removeIncludedPaper(state, embedded.id)
    expect(state.items).toHaveLength(2)

    state = addStagedPaper(state, firstUpload, '33333333-3333-4333-8333-333333333333')
    state = moveIncludedPaper(state, '33333333-3333-4333-8333-333333333333', -1)
    expect(state.items.map((paper) => paper.original_name)).toEqual([
      'approved.pdf',
      'first.pdf',
      'existing.pdf',
    ])
    const cannotCrossSignedBase = moveIncludedPaper(
      state,
      '33333333-3333-4333-8333-333333333333',
      -1,
    )
    expect(cannotCrossSignedBase).toBe(state)

    state = removeIncludedPaper(state, existing.id)
    expect(state.items.map((paper) => paper.original_name)).toEqual(['approved.pdf', 'first.pdf'])
  })

  it('marks a preview current only until the next edit', () => {
    const initial = addStagedPaper(
      createIncludedPapersState(3, [existing]),
      firstUpload,
      '33333333-3333-4333-8333-333333333333',
    )
    const preview: IncludedPapersPreviewRead = {
      revision: 3,
      fixed_page_count: 2,
      total_page_count: 5,
      papers: [
        existing,
        {
          ...existing,
          id: '33333333-3333-4333-8333-333333333333',
          original_name: 'first.pdf',
          size: 250,
          page_count: 1,
          page_start: 5,
          page_end: 5,
        },
      ],
      pdf_base64: 'cGRm',
    }

    const reviewed = applyPackagePreview(initial, preview)
    expect(isPreviewCurrent(reviewed)).toBe(true)
    expect(reviewed.items[1]).toMatchObject({ staged_token: 'stage-one', page_count: 1 })

    const changed = moveIncludedPaper(
      reviewed,
      '33333333-3333-4333-8333-333333333333',
      -1,
    )
    expect(isPreviewCurrent(changed)).toBe(false)
    expect(changed.preview).toBeNull()
  })
})
