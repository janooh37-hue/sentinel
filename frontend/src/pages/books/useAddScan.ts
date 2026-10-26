/**
 * In-strip scan intake (Records pane + frame).
 *
 * postIntake OCRs the file and resolves stamped refs (ref-first, Phase C):
 * - matches the CURRENT record  → attach here, invalidate, success toast
 * - matches a DIFFERENT record  → hand the match to the caller (confirm dialog)
 * - external / no ref           → info toast pointing at the Scan drawer
 */
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from '@/lib/toast'

import { api, apiErrorMessage } from '@/lib/api'
import type { ReturnedFormOut } from '@/lib/api'

export interface OtherMatch {
  bookId: number
  ref: string
  file: File
}

export function useAddScan(currentBookId: number | null): {
  busy: boolean
  otherMatch: OtherMatch | null
  clearOtherMatch: () => void
  fileToOther: () => Promise<void>
  submit: (file: File) => Promise<void>
  fileSignedCopy: (file: File, ref: string) => Promise<void>
  fileToCurrent: (file: File, ref: string) => Promise<void>
} {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [otherMatch, setOtherMatch] = useState<OtherMatch | null>(null)

  const attach = async (bookId: number, file: File, ref: string, toastId?: string | number): Promise<void> => {
    await api.addBookAttachment(bookId, file, false)
    await qc.invalidateQueries({ queryKey: ['books'] })
    toast.success(t('books.pane.scanFiledHere'), { id: toastId, reference: ref })
  }

  const submit = async (file: File): Promise<void> => {
    if (currentBookId === null || busy) return
    setBusy(true)
    const reading = toast.loading(t('books.pane.scanReading'))
    let reference: string | undefined
    try {
      const result = await api.postIntake(file)
      // TypeScript narrows result to ReturnedFormOut via the discriminant
      if (result.mode === 'returned_form') {
        const r: ReturnedFormOut = result
        reference = r.ref_number
        if (r.book_id === currentBookId) {
          await attach(currentBookId, file, r.ref_number, reading)
        } else {
          setOtherMatch({ bookId: r.book_id, ref: r.ref_number, file })
          toast.dismiss(reading)
        }
      } else {
        toast.info(t('books.pane.scanNoRef'), {
          id: reading,
          duration: 8000,
          action: {
            label: t('books.pane.scanOpenDrawer'),
            onClick: () => navigate('/intake'),
          },
        })
      }
    } catch (err) {
      toast.error(apiErrorMessage(err), { id: reading, reference })
    } finally {
      setBusy(false)
    }
  }

  const fileToOther = async (): Promise<void> => {
    if (!otherMatch) return
    const id = toast.loading(t('common.saving'))
    try {
      await attach(otherMatch.bookId, otherMatch.file, otherMatch.ref, id)
    } catch (err) {
      toast.error(apiErrorMessage(err), { id, reference: otherMatch.ref })
    } finally {
      setOtherMatch(null)
    }
  }

  // Direct file-back for an `awaiting_scan` record: the user opened THIS record
  // and is filing its signed copy, so the target is unambiguous — attach straight
  // to it (the backend scan-back flip approves it). No OCR ref-match, which can't
  // be trusted to re-read a stamped ref off a gov-form scan (GS-0333 → "65-3").
  // Also used for none/pending records when the operator explicitly confirms this
  // is the signed copy (per-record draft confirm dialog).
  const fileSignedCopy = async (file: File, ref: string): Promise<void> => {
    if (currentBookId === null || busy) return
    setBusy(true)
    const id = toast.loading(t('scanBack.filing'))
    try {
      await api.addBookAttachment(currentBookId, file, true)
      await qc.invalidateQueries({ queryKey: ['books'] })
      toast.success(t('books.pane.signedCopyFiled'), { id, reference: ref })
    } catch (err) {
      toast.error(apiErrorMessage(err), { id, reference: ref })
    } finally {
      setBusy(false)
    }
  }

  // Plain attach for none/pending records when the operator chooses "Just attach"
  // in the draft confirm dialog (as_signed=false — does not approve the record).
  const fileToCurrent = async (file: File, ref: string): Promise<void> => {
    if (currentBookId === null || busy) return
    setBusy(true)
    const id = toast.loading(t('common.saving'))
    try {
      await attach(currentBookId, file, ref, id)
    } catch (err) {
      toast.error(apiErrorMessage(err), { id, reference: ref })
    } finally {
      setBusy(false)
    }
  }

  return {
    busy,
    otherMatch,
    clearOtherMatch: () => setOtherMatch(null),
    fileToOther,
    submit,
    fileSignedCopy,
    fileToCurrent,
  }
}
