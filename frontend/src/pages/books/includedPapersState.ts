import type {
  IncludedPaperRead,
  IncludedPapersPreviewRead,
  IncludedPapersRequest,
  StagedAttachmentRead,
} from '@/lib/api'

export type EditableIncludedPaper = IncludedPaperRead & { staged_token?: string }

export interface IncludedPapersState {
  revision: number
  items: EditableIncludedPaper[]
  preview: IncludedPapersPreviewRead | null
  previewFingerprint: string | null
}

export function createIncludedPapersState(
  revision: number,
  papers: IncludedPaperRead[],
): IncludedPapersState {
  return { revision, items: papers.map((paper) => ({ ...paper })), preview: null, previewFingerprint: null }
}

function changed(state: IncludedPapersState, items: EditableIncludedPaper[]): IncludedPapersState {
  return { ...state, items, preview: null, previewFingerprint: null }
}

function mediaType(filename: string): string {
  return /\.pdf$/i.test(filename) ? 'application/pdf' : `image/${/\.png$/i.test(filename) ? 'png' : 'jpeg'}`
}

export function addStagedPaper(
  state: IncludedPapersState,
  staged: StagedAttachmentRead,
  id: string,
): IncludedPapersState {
  return changed(state, [
    ...state.items,
    {
      id,
      original_name: staged.filename,
      slot_key: null,
      media_type: mediaType(staged.filename),
      size: staged.size,
      page_count: 0,
      added_by_user_id: null,
      added_at: new Date().toISOString(),
      page_start: null,
      page_end: null,
      embedded_in_signed_base: false,
      staged_token: staged.token,
    },
  ])
}

export function replaceIncludedPaper(
  state: IncludedPapersState,
  id: string,
  staged: StagedAttachmentRead,
): IncludedPapersState {
  const current = state.items.find((paper) => paper.id === id)
  if (!current || current.embedded_in_signed_base) return state
  return changed(
    state,
    state.items.map((paper) =>
      paper.id === id
        ? {
            ...paper,
            original_name: staged.filename,
            media_type: mediaType(staged.filename),
            size: staged.size,
            page_count: 0,
            page_start: null,
            page_end: null,
            staged_token: staged.token,
          }
        : paper,
    ),
  )
}

export function removeIncludedPaper(state: IncludedPapersState, id: string): IncludedPapersState {
  const current = state.items.find((paper) => paper.id === id)
  if (!current || current.embedded_in_signed_base) return state
  return changed(state, state.items.filter((paper) => paper.id !== id))
}

export function moveIncludedPaper(
  state: IncludedPapersState,
  id: string,
  offset: -1 | 1,
): IncludedPapersState {
  const index = state.items.findIndex((paper) => paper.id === id)
  const target = index + offset
  if (
    index < 0 ||
    target < 0 ||
    target >= state.items.length ||
    state.items[index].embedded_in_signed_base ||
    state.items[target].embedded_in_signed_base
  ) {
    return state
  }
  const items = [...state.items]
  ;[items[index], items[target]] = [items[target], items[index]]
  return changed(state, items)
}

export function includedPapersRequest(state: IncludedPapersState): IncludedPapersRequest {
  return {
    revision: state.revision,
    items: state.items.map((paper) => ({
      id: paper.id,
      ...(paper.staged_token
        ? { staged_token: paper.staged_token, original_name: paper.original_name }
        : {}),
    })),
  }
}

function fingerprint(state: IncludedPapersState): string {
  return JSON.stringify(includedPapersRequest(state))
}

export function applyPackagePreview(
  state: IncludedPapersState,
  preview: IncludedPapersPreviewRead,
): IncludedPapersState {
  const tokens = new Map(state.items.map((paper) => [paper.id, paper.staged_token]))
  return {
    ...state,
    items: preview.papers.map((paper) => ({
      ...paper,
      ...(tokens.get(paper.id) ? { staged_token: tokens.get(paper.id) } : {}),
    })),
    preview,
    previewFingerprint: fingerprint(state),
  }
}

export function isPreviewCurrent(state: IncludedPapersState): boolean {
  return state.preview !== null && state.previewFingerprint === fingerprint(state)
}
