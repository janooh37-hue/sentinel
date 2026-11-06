/**
 * LedgerBookActions — record-toolbar actions for an issued Ledger Book: Print
 * the shown Revision, pick a Revision, and for the writer either "Edit content"
 * (latest Revision unsigned) or "Start correction" (latest Revision signed).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FilePenLine, Printer } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { api, apiErrorMessage } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { ledgerBookKey, ledgerPaperUrl } from './ledgerBookKeys'
import { SigningManagerPicker } from './SigningManagerPicker'

export function LedgerBookActions({ bookId, revision, onRevisionChange, className }: {
  bookId: number
  /** The shown Revision's `version_id`; omitted = the newest the viewer may read. */
  revision?: number
  /** Without it the Revision picker is hidden. */
  onRevisionChange?: (versionId: number) => void
  className?: string
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const userId = useAuth().user?.id
  const pickerId = useId()
  const [signOpen, setSignOpen] = useState(false)
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnNote, setReturnNote] = useState('')
  const [returnError, setReturnError] = useState(false)
  const [signerOpen, setSignerOpen] = useState(false)
  const [managerId, setManagerId] = useState<number | null>(null)
  const [signerError, setSignerError] = useState(false)
  const query = useQuery({ queryKey: ledgerBookKey(bookId, revision), queryFn: () => api.getLedgerBook(bookId, revision) })
  const correction = useMutation({
    mutationFn: () => api.startLedgerCorrection(bookId),
    onSuccess: (book) => {
      void qc.invalidateQueries({ queryKey: ['ledger', 'books', bookId] })
      const latest = book.revisions.at(-1)
      if (latest) toast.success(t('ledgerBook.composer.book.correctionStarted', { n: latest.version_no }))
      navigate(`/ledger/books/${bookId}/edit`)
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const sign = useMutation({
    mutationFn: () => api.signLedgerBook(bookId),
    onSuccess: (updated) => {
      qc.setQueryData(ledgerBookKey(bookId), updated)
      void qc.invalidateQueries({ queryKey: ['ledger', 'books', bookId] })
      void qc.invalidateQueries({ queryKey: ['books'] })
      toast.success(t('ledgerBook.actions.signed'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const sendBack = useMutation({
    mutationFn: () => api.returnLedgerBook(bookId, returnNote.trim()),
    onSuccess: (updated) => {
      qc.setQueryData(ledgerBookKey(bookId), updated)
      void qc.invalidateQueries({ queryKey: ['ledger', 'books', bookId] })
      void qc.invalidateQueries({ queryKey: ['books'] })
      setReturnOpen(false)
      toast.success(t('ledgerBook.actions.returned'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const changeSigner = useMutation({
    mutationFn: (id: number) => api.changeLedgerSigner(bookId, id),
    onSuccess: (updated) => {
      qc.setQueryData(ledgerBookKey(bookId), updated)
      void qc.invalidateQueries({ queryKey: ['ledger', 'books', bookId] })
      void qc.invalidateQueries({ queryKey: ['books'] })
      setSignerOpen(false)
      toast.success(t('ledgerBook.actions.signerChanged'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const resubmit = useMutation({
    mutationFn: () => api.resubmitLedgerBook(bookId),
    onSuccess: (updated) => {
      qc.setQueryData(ledgerBookKey(bookId), updated)
      void qc.invalidateQueries({ queryKey: ['ledger', 'books', bookId] })
      void qc.invalidateQueries({ queryKey: ['books'] })
      toast.success(t('ledgerBook.actions.resubmitted'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const outlookDraft = useMutation({
    mutationFn: () => api.createLedgerOutlookDraft(bookId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ledger', 'books', bookId] })
      void qc.invalidateQueries({ queryKey: ['books'] })
      toast.success(t('ledgerBook.actions.outlookDraftCreated'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const book = query.data
  if (!book) return null
  const shown = revision ?? book.selected_version_id
  const latest = book.revisions.at(-1)
  const isWriter = userId !== undefined && book.created_by_user_id === userId && !book.voided

  const print = (): void => {
    const win = window.open(ledgerPaperUrl({ bookId, revision: shown }), `ledger-book-${bookId}`)
    win?.addEventListener('load', () => win.print(), { once: true })
  }

  return (
    <div className={cn('flex min-w-0 max-w-full flex-wrap items-center gap-2', className)}>
      <Button type="button" variant="outline" size="sm" onClick={print}>
        <Printer aria-hidden="true" className="size-4" />
        {t('ledgerBook.composer.book.print')}
      </Button>
      {book.can_sign && (
        <Button type="button" variant="outline" size="sm" disabled={sign.isPending} onClick={() => setSignOpen(true)}>
          {t('ledgerBook.actions.sign')}
        </Button>
      )}
      <ConfirmDialog
        open={signOpen}
        onOpenChange={setSignOpen}
        title={t('ledgerBook.actions.signConfirmTitle')}
        description={t('ledgerBook.actions.signConfirmDescription')}
        confirmLabel={t('ledgerBook.actions.sign')}
        onConfirm={() => sign.mutate()}
      />
      {book.can_return && (
        <Button type="button" variant="outline" size="sm" disabled={sign.isPending || sendBack.isPending} onClick={() => {
          setReturnNote('')
          setReturnError(false)
          setReturnOpen(true)
        }}>
          {t('ledgerBook.actions.return')}
        </Button>
      )}
      <DialogRoot open={returnOpen} onOpenChange={setReturnOpen}>
        <DialogContent>
          <DialogHeader className="pe-12">
            <DialogTitle>{t('ledgerBook.actions.returnTitle')}</DialogTitle>
            <DialogDescription><bdi dir="ltr">{book.ref_number}</bdi></DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => {
            event.preventDefault()
            if (!returnNote.trim()) {
              setReturnError(true)
              return
            }
            if (!sendBack.isPending) sendBack.mutate()
          }}>
            <div className="space-y-2 px-4 py-4">
              <label htmlFor={`${pickerId}-return`} className="text-sm font-semibold">{t('ledgerBook.actions.returnNote')}</label>
              <Textarea id={`${pickerId}-return`} value={returnNote} onChange={(event) => setReturnNote(event.target.value)}
                aria-required="true" aria-invalid={returnError} aria-describedby={returnError ? `${pickerId}-return-error` : undefined}
                disabled={sendBack.isPending} />
              {returnError && <p id={`${pickerId}-return-error`} role="alert" className="text-sm text-destructive">{t('ledgerBook.actions.returnNoteRequired')}</p>}
            </div>
            <footer className="flex flex-wrap justify-end gap-2 border-t border-hairline px-4 py-3">
              <Button type="button" variant="outline" onClick={() => setReturnOpen(false)}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={sendBack.isPending}>{t('ledgerBook.actions.return')}</Button>
            </footer>
          </form>
        </DialogContent>
      </DialogRoot>
      {book.can_change_signer && (
        <Button type="button" variant="outline" size="sm" disabled={changeSigner.isPending} onClick={() => {
          setManagerId(book.signer?.manager_id ?? null)
          setSignerError(false)
          setSignerOpen(true)
        }}>
          {t('ledgerBook.actions.changeSigner')}
        </Button>
      )}
      <DialogRoot open={signerOpen} onOpenChange={setSignerOpen}>
        {signerOpen && <DialogContent>
          <DialogHeader className="pe-12">
            <DialogTitle>{t('ledgerBook.actions.changeSignerTitle')}</DialogTitle>
            <DialogDescription><bdi dir="ltr">{book.ref_number}</bdi></DialogDescription>
          </DialogHeader>
          <form onSubmit={(event) => {
            event.preventDefault()
            if (managerId === null) {
              setSignerError(true)
              return
            }
            if (!changeSigner.isPending) changeSigner.mutate(managerId)
          }}>
            <div className="px-4 py-4">
              <SigningManagerPicker value={managerId} onChange={(id) => {
                setManagerId(id)
                setSignerError(false)
              }} error={signerError ? t('ledgerBook.actions.signerRequired') : undefined} />
            </div>
            <footer className="flex flex-wrap justify-end gap-2 border-t border-hairline px-4 py-3">
              <Button type="button" variant="outline" onClick={() => setSignerOpen(false)}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={changeSigner.isPending || managerId === book.signer?.manager_id}>{t('common.save')}</Button>
            </footer>
          </form>
        </DialogContent>}
      </DialogRoot>
      {book.return_note && (
        <p className="basis-full whitespace-pre-wrap rounded-md bg-warning-soft px-3 py-2 text-sm text-foreground" dir="auto">
          <span className="font-semibold">{t('ledgerBook.actions.returnNote')}: </span>
          <span>{book.return_note}</span>
        </p>
      )}
      {book.can_resubmit && (
        <Button type="button" variant="outline" size="sm" disabled={resubmit.isPending} onClick={() => resubmit.mutate()}>
          {t('ledgerBook.actions.resubmit')}
        </Button>
      )}
      {book.can_create_outlook_draft && (
        <Button type="button" variant="outline" size="sm" disabled={outlookDraft.isPending} onClick={() => outlookDraft.mutate()}>
          {t('ledgerBook.actions.createOutlookDraft')}
        </Button>
      )}
      {onRevisionChange && (
        <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
          <label htmlFor={pickerId} className="text-[0.78em] font-semibold text-muted-foreground">{t('ledgerBook.composer.book.revisions')}</label>
          <select
            id={pickerId}
            value={shown}
            onChange={(e) => onRevisionChange(Number(e.target.value))}
            className="min-h-11 min-w-0 max-w-full rounded-md border border-hairline bg-background px-2 text-[0.84em] focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {book.revisions.map((r) => (
              <option key={r.version_id} value={r.version_id}>
                {t(r.locked ? 'ledgerBook.composer.book.revisionLocked' : 'ledgerBook.composer.book.revisionOption', { n: r.version_no })}
              </option>
            ))}
          </select>
        </span>
      )}
      {isWriter && latest && (latest.locked ? (
        <Button type="button" variant="outline" size="sm" disabled={correction.isPending} onClick={() => correction.mutate()}>
          <FilePenLine aria-hidden="true" className="size-4" />
          {t('ledgerBook.composer.book.startCorrection')}
        </Button>
      ) : (
        <Link to={`/ledger/books/${bookId}/edit`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
          <FilePenLine aria-hidden="true" className="size-4" />
          {t('ledgerBook.composer.book.editContent')}
        </Link>
      ))}
    </div>
  )
}
