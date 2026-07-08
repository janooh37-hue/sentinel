/**
 * Delete / replace one film-strip paper. Routes by paper kind:
 *   - scan   → the plain-attachment endpoints (by index)
 *   - signed → the signed-copy endpoints (unfile reverts approval; replace keeps it)
 * Generated/imported papers are read-only (no delete/replace). Invalidates the
 * `['books']` query so every record surface refreshes.
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage } from '@/lib/api'

import type { Paper } from './recordPapers'

export function useManagePaper(bookId: number | null): {
  busy: boolean
  deletePaper: (paper: Paper) => Promise<void>
  replacePaper: (paper: Paper, file: File) => Promise<void>
} {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<unknown>, successKey: string): Promise<void> => {
    if (bookId === null || busy) return
    setBusy(true)
    try {
      await fn()
      await qc.invalidateQueries({ queryKey: ['books'] })
      toast.success(t(successKey))
    } catch (err) {
      toast.error(apiErrorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const deletePaper = (paper: Paper): Promise<void> => {
    if (bookId === null) return Promise.resolve()
    if (paper.kind === 'signed')
      return run(() => api.unfileSignedCopy(bookId), 'books.pane.signedCopyUnfiled')
    if (paper.kind === 'scan' && paper.attachmentIndex !== undefined) {
      const index = paper.attachmentIndex
      return run(() => api.deleteBookAttachment(bookId, index), 'books.pane.paperDeleted')
    }
    return Promise.resolve()
  }

  const replacePaper = (paper: Paper, file: File): Promise<void> => {
    if (bookId === null) return Promise.resolve()
    if (paper.kind === 'signed')
      return run(() => api.replaceSignedCopy(bookId, file), 'books.pane.paperReplaced')
    if (paper.kind === 'scan' && paper.attachmentIndex !== undefined) {
      const index = paper.attachmentIndex
      return run(() => api.replaceBookAttachment(bookId, index, file), 'books.pane.paperReplaced')
    }
    return Promise.resolve()
  }

  return { busy, deletePaper, replacePaper }
}
