import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { api } from '@/lib/api'
import type { IncludedPaperRead } from '@/lib/api'

import {
  addStagedPaper,
  applyPackagePreview,
  createIncludedPapersState,
  includedPapersRequest,
  isPreviewCurrent,
  moveIncludedPaper,
  removeIncludedPaper,
  replaceIncludedPaper,
  type IncludedPapersState,
} from './includedPapersState'

export interface IncludedPapersBook {
  id: number
  included_papers_revision: number
  included_papers?: IncludedPaperRead[]
}

export interface IncludedPapersEditor {
  state: IncludedPapersState
  busy: boolean
  error: unknown
  canSave: boolean
  dirty: boolean
  addFiles: (files: File[]) => Promise<void>
  replacePaper: (id: string, file: File) => Promise<void>
  removePaper: (id: string) => void
  movePaper: (id: string, offset: -1 | 1) => void
  previewPackage: () => Promise<void>
  savePackage: () => Promise<void>
}

export function useIncludedPapersEditor(book: IncludedPapersBook): IncludedPapersEditor {
  const queryClient = useQueryClient()
  const [state, setState] = useState(() =>
    createIncludedPapersState(book.included_papers_revision, book.included_papers ?? []),
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null)

  const addFiles = async (files: File[]): Promise<void> => {
    if (busy || files.length === 0) return
    setBusy(true)
    setError(null)
    try {
      for (const file of files) {
        const staged = await api.stageAttachment(file)
        setState((current) => addStagedPaper(current, staged, crypto.randomUUID()))
      }
    } catch (caught) {
      setError(caught)
      throw caught
    } finally {
      setBusy(false)
    }
  }

  const replacePaper = async (id: string, file: File): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const staged = await api.stageAttachment(file)
      setState((current) => replaceIncludedPaper(current, id, staged))
    } catch (caught) {
      setError(caught)
      throw caught
    } finally {
      setBusy(false)
    }
  }

  const previewPackage = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const preview = await api.previewIncludedPapers(book.id, includedPapersRequest(state))
      setState((current) => applyPackagePreview(current, preview))
    } catch (caught) {
      setError(caught)
      throw caught
    } finally {
      setBusy(false)
    }
  }

  const savePackage = async (): Promise<void> => {
    if (!isPreviewCurrent(state)) throw new Error('INCLUDED_PAPERS_PREVIEW_REQUIRED')
    setBusy(true)
    setError(null)
    try {
      await api.saveIncludedPapers(book.id, includedPapersRequest(state))
      await queryClient.invalidateQueries({ queryKey: ['books'] })
    } catch (caught) {
      setError(caught)
      throw caught
    } finally {
      setBusy(false)
    }
  }

  const initialPapers = book.included_papers ?? []
  const dirty =
    state.items.length !== initialPapers.length ||
    state.items.some(
      (paper, index) =>
        paper.staged_token !== undefined || paper.id !== initialPapers[index]?.id,
    )

  return {
    state,
    busy,
    error,
    canSave: !busy && isPreviewCurrent(state),
    dirty,
    addFiles,
    replacePaper,
    removePaper: (id) => setState((current) => removeIncludedPaper(current, id)),
    movePaper: (id, offset) => setState((current) => moveIncludedPaper(current, id, offset)),
    previewPackage,
    savePackage,
  }
}
