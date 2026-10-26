/**
 * Delete / replace one film-strip paper. Routes by paper kind:
 *   - scan   → the plain-attachment endpoints (by index)
 *   - signed → the signed-copy endpoints (unfile reverts approval; replace keeps it)
 * Generated/imported papers are read-only (no delete/replace). A successful run
 * purges the PDF document and thumbnail caches and invalidates the `['books']`
 * query so every record surface refreshes.
 */
import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from '@/lib/toast'

import { api, apiErrorMessage } from '@/lib/api'
import { purgePdfCaches } from '@/lib/pdfCachePurge'

import type { Paper } from './recordPapers'

export function useManagePaper(bookId: number | null, ref?: string): {
  busy: boolean
  deletePaper: (paper: Paper) => Promise<void>
  replacePaper: (paper: Paper, file: File) => Promise<void>
} {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<unknown>, successKey: string, loadingKey?: string): Promise<void> => {
    if (bookId === null || busy) return
    setBusy(true)
    const toastId = loadingKey ? toast.loading(t(loadingKey)) : undefined
    try {
      await fn()
      // The replaced/removed file's cached bytes and thumbnail must not outlive it.
      purgePdfCaches()
      await qc.invalidateQueries({ queryKey: ['books'] })
      toast.success(t(successKey), { id: toastId, reference: ref })
    } catch (err) {
      toast.error(apiErrorMessage(err), { id: toastId, reference: ref })
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
      return run(() => api.replaceSignedCopy(bookId, file), 'books.pane.paperReplaced', 'books.pane.paperReplacing')
    if (paper.kind === 'scan' && paper.attachmentIndex !== undefined) {
      const index = paper.attachmentIndex
      return run(() => api.replaceBookAttachment(bookId, index, file), 'books.pane.paperReplaced', 'books.pane.paperReplacing')
    }
    return Promise.resolve()
  }

  return { busy, deletePaper, replacePaper }
}
