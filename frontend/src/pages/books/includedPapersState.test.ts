import { describe, expect, it } from 'vitest'

import type {
  IncludedPaperRead,
  IncludedPapersPreviewRead,
  StagedAttachmentRead,
} from '@/lib/api'

import {
  addStagedPaper,
  applyPackagePreview,
  createIncludedPapersState,
  includedPapersRequest,
  isIncludedPapersOwner,
  isPreviewCurrent,
  moveIncludedPaper,
  removeIncludedPaper,
  replaceIncludedPaper,
} from './includedPapersState'

const saved: IncludedPaperRead[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    original_name: 'required.pdf',
    slot_key: 'medical_certificate',
    media_type: 'application/pdf',
    size: 100,
    page_count: 2,
    added_by_user_id: 1,
    added_at: '2026-08-10T08:00:00Z',
    page_start: 3,
    page_end: 4,
    embedded_in_signed_base: true,
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    original_name: 'editable.pdf',
    slot_key: null,
    media_type: 'application/pdf',
    size: 200,
    page_count: 1,
    added_by_user_id: 1,
    added_at: '2026-08-10T08:01:00Z',
    page_start: 5,
    page_end: 5,
    embedded_in_signed_base: false,
  },
]

const staged: StagedAttachmentRead = {
  token: '33333333-3333-3333-3333-333333333333',
  filename: 'late.png',
  size: 300,
}

const replacement: StagedAttachmentRead = {
  token: '44444444-4444-4444-4444-444444444444',
  filename: 'corrected.pdf',
  size: 400,
}

describe('includedPapersState', () => {
  it('keeps the fixed form implicit, protects embedded papers, and preserves replacement identity', () => {
    let state = createIncludedPapersState(7, saved)

    state = addStagedPaper(state, staged, '33333333-3333-3333-3333-333333333333')
    state = moveIncludedPaper(state, staged.token, -1)
    state = replaceIncludedPaper(state, saved[1].id, replacement)
    state = removeIncludedPaper(state, saved[0].id)

    expect(state.items.map((paper) => paper.id)).toEqual([
      saved[0].id,
      staged.token,
      saved[1].id,
    ])
    expect(state.items[0].embedded_in_signed_base).toBe(true)
    expect(includedPapersRequest(state)).toEqual({
      revision: 7,
      items: [
        { id: saved[0].id },
        { id: staged.token, staged_token: staged.token, original_name: 'late.png' },
        { id: saved[1].id, staged_token: replacement.token, original_name: 'corrected.pdf' },
      ],
    })
  })

  it('marks a preview current only until the ordered proposal changes', () => {
    let state = createIncludedPapersState(7, saved)
    state = addStagedPaper(state, staged, staged.token)
    const preview: IncludedPapersPreviewRead = {
      revision: 7,
      fixed_page_count: 2,
      total_page_count: 6,
      papers: [...saved, {
        ...saved[1],
        id: staged.token,
        original_name: staged.filename,
        size: staged.size,
        page_count: 1,
        page_start: 6,
        page_end: 6,
      }],
      pdf_base64: 'JVBERi0=',
    }

    state = applyPackagePreview(state, preview)
    expect(isPreviewCurrent(state)).toBe(true)
    expect(state.items[2].staged_token).toBe(staged.token)

    state = moveIncludedPaper(state, staged.token, -1)
    expect(isPreviewCurrent(state)).toBe(false)
  })

  it('allows package management only for the record creator', () => {
    expect(isIncludedPapersOwner({ original_creator_user_id: 12 }, 12)).toBe(true)
    expect(isIncludedPapersOwner({ original_creator_user_id: 12 }, 13)).toBe(false)
    expect(isIncludedPapersOwner({ original_creator_user_id: null }, 12)).toBe(false)
    expect(isIncludedPapersOwner({ original_creator_user_id: 12 }, undefined)).toBe(false)
  })
})
