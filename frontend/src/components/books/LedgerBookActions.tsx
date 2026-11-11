/**
 * LedgerBookActions — record-toolbar actions for an issued Ledger Book: Print
 * the shown Revision, pick a Revision, and for the writer either "Edit content"
 * (latest Revision unsigned) or "Start correction" (latest Revision signed).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { FilePenLine, Printer } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { Textarea } from '@/components/ui/textarea'
import { api, apiErrorMessage, ApiError, type LedgerBookRead, type LedgerSignRequest } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { toast } from '@/lib/toast'
import { cn } from '@/lib/utils'
import { ledgerBookKey, ledgerBookPrefix, ledgerPaperUrl } from './ledgerBookKeys'
import { SigningManagerPicker } from './SigningManagerPicker'

const CONFIRM_LABEL = {
  correction: 'ledgerBook.composer.book.startCorrection',
  resubmit: 'ledgerBook.actions.resubmit',
  outlook: 'ledgerBook.actions.createOutlookDraft',
} as const

export interface LedgerReviewedPaper { versionId: number; contentHash: string }

interface LedgerBookActionsProps {
  bookId: number
  reviewedPaper: LedgerReviewedPaper | null
  /** The shown Revision's `version_id`; omitted = the newest the viewer may read. */
  revision?: number
  /** Without it the Revision picker is hidden. */
  onRevisionChange?: (versionId: number) => void
  className?: string
}

export function LedgerBookActions(props: LedgerBookActionsProps): React.JSX.Element {
  return <BookActions key={props.bookId} {...props} />
}

function BookActions({ bookId, reviewedPaper, revision, onRevisionChange, className }: LedgerBookActionsProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const activeVisit = useRef<number | null>(null)
  useEffect(() => {
    activeVisit.current = bookId
    return () => { activeVisit.current = null }
  }, [bookId])
  const userId = useAuth().user?.id
  const pickerId = useId()
  const [signOpen, setSignOpen] = useState(false)
  const [signSnapshot, setSignSnapshot] = useState<LedgerSignRequest | null>(null)
  const [confirming, setConfirming] = useState<'correction' | 'resubmit' | 'outlook' | null>(null)
  const [returnOpen, setReturnOpen] = useState(false)
  const [returnNote, setReturnNote] = useState('')
  const [returnError, setReturnError] = useState(false)
  const [signerOpen, setSignerOpen] = useState(false)
  const [managerId, setManagerId] = useState<number | null>(null)
  const [signerError, setSignerError] = useState(false)
  // The newest Revision is cached under the 'latest' key: asking for it by number would refetch the
  // same book (and its paper) under a second key.
  const cachedLatest = qc.getQueryData<LedgerBookRead>(ledgerBookKey(bookId))?.revisions.at(-1)?.version_id
  const requested = revision !== undefined && revision === cachedLatest ? undefined : revision
  const query = useQuery({
    queryKey: ledgerBookKey(bookId, requested),
    queryFn: () => api.getLedgerBook(bookId, requested),
    // Keep the toolbar (and the picker) mounted while another Revision loads; never carry one book's data to another.
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2] === bookId ? previous : undefined,
  })
  // A mutation returns the book: write it as the latest and refresh every other cached Revision, but
  // not the key just written. Always refresh the Books lists.
  const commit = (updated: LedgerBookRead): void => {
    const latestKey = ledgerBookKey(bookId)
    qc.setQueryData(latestKey, updated)
    void qc.invalidateQueries({
      queryKey: ledgerBookPrefix(bookId),
      predicate: (q) => q.queryKey[3] !== latestKey[3],
    })
    void qc.invalidateQueries({ queryKey: ['books'] })
  }
  const correction = useMutation({
    mutationFn: () => api.startLedgerCorrection(bookId),
    onSuccess: (book) => {
      void qc.invalidateQueries({ queryKey: ledgerBookPrefix(book.id) })
      void qc.invalidateQueries({ queryKey: ['books'] })
      if (activeVisit.current !== book.id) return
      const latest = book.revisions.at(-1)
      if (latest) toast.success(t('ledgerBook.composer.book.correctionStarted', { n: latest.version_no }))
      navigate(`/ledger/books/${book.id}/edit`)
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const sign = useMutation({
    mutationFn: (snapshot: LedgerSignRequest) => api.signLedgerBook(bookId, snapshot),
    onSuccess: (updated) => {
      commit(updated)
      toast.success(t('ledgerBook.actions.signed'))
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'SIGNING_CONTENT_CONFLICT') {
        setSignOpen(false)
        void qc.invalidateQueries({ queryKey: ledgerBookPrefix(bookId) })
        void qc.invalidateQueries({ queryKey: ['books'] })
      }
      toast.error(apiErrorMessage(err))
    },
  })
  const sendBack = useMutation({
    mutationFn: () => api.returnLedgerBook(bookId, returnNote.trim()),
    onSuccess: (updated) => {
      commit(updated)
      setReturnOpen(false)
      toast.success(t('ledgerBook.actions.returned'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const changeSigner = useMutation({
    mutationFn: (id: number) => api.changeLedgerSigner(bookId, id),
    onSuccess: (updated) => {
      commit(updated)
      setSignerOpen(false)
      toast.success(t('ledgerBook.actions.signerChanged'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const resubmit = useMutation({
    mutationFn: () => api.resubmitLedgerBook(bookId),
    onSuccess: (updated) => {
      commit(updated)
      toast.success(t('ledgerBook.actions.resubmitted'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const outlookDraft = useMutation({
    mutationFn: () => api.createLedgerOutlookDraft(bookId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ledgerBookPrefix(bookId) })
      void qc.invalidateQueries({ queryKey: ['books'] })
      toast.success(t('ledgerBook.actions.outlookDraftCreated'))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const book = query.data
  if (!book) return null
  const shown = revision ?? book.selected_version_id
  const paperReady = reviewedPaper?.versionId === shown && reviewedPaper.contentHash === book.content_sha256
  const signConflict = sign.error instanceof ApiError && sign.error.code === 'SIGNING_CONTENT_CONFLICT'
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
        <Button type="button" variant="outline" size="sm" disabled={sign.isPending || !paperReady || query.isFetching || query.isError} onClick={() => {
          setSignSnapshot({ expected_version_id: shown, expected_content_sha256: book.content_sha256 })
          setSignOpen(true)
        }}>
          {t('ledgerBook.actions.sign')}
        </Button>
      )}
      {signConflict && <p role="alert" className="basis-full text-sm text-destructive">{apiErrorMessage(sign.error)}</p>}
      <ConfirmDialog
        open={signOpen}
        onOpenChange={setSignOpen}
        title={t('ledgerBook.actions.signConfirmTitle')}
        description={t('ledgerBook.actions.signConfirmDescription')}
        confirmLabel={t('ledgerBook.actions.sign')}
        onConfirm={() => { if (signSnapshot) sign.mutate(signSnapshot) }}
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
        <Button type="button" variant="outline" size="sm" disabled={resubmit.isPending} onClick={() => setConfirming('resubmit')}>
          {t('ledgerBook.actions.resubmit')}
        </Button>
      )}
      {book.can_create_outlook_draft && (
        <Button type="button" variant="outline" size="sm" disabled={outlookDraft.isPending} onClick={() => setConfirming('outlook')}>
          {t('ledgerBook.actions.createOutlookDraft')}
        </Button>
      )}
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => { if (!open) setConfirming(null) }}
        title={t(`ledgerBook.actions.${confirming ?? 'correction'}ConfirmTitle`)}
        description={t(`ledgerBook.actions.${confirming ?? 'correction'}ConfirmDescription`)}
        confirmLabel={t(CONFIRM_LABEL[confirming ?? 'correction'])}
        onConfirm={() => {
          if (confirming === 'correction') correction.mutate()
          else if (confirming === 'resubmit') resubmit.mutate()
          else if (confirming === 'outlook') outlookDraft.mutate()
        }}
      />
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
        <Button type="button" variant="outline" size="sm" disabled={correction.isPending} onClick={() => setConfirming('correction')}>
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
