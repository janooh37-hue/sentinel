/**
 * Records page — right pane: ref stamp · form title · status badge, the
 * film-strip viewer, and the per-state action row. Hosts the full-preview
 * overlay and the add-scan flow (＋ frame, hidden file input, other-record
 * confirm dialog).
 */
import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Loader2, Mail, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { BookRead } from '@/lib/api'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useCapabilities } from '@/lib/useCapabilities'
import { useFocusTrap } from '@/lib/useFocusTrap'
import { cn } from '@/lib/utils'

import { canFileSignedCopy } from '@/components/books/book-detail-drawer-utils'

import { signedSourceOf } from './bookStateLabel'
import { formKindOf, subjectEmployeePart } from './formKind'
import { papersOf } from './recordPapers'
import { StateSeal } from './StateSeal'
import { useAddScan } from './useAddScan'

const RecordPaperViewer = lazy(() => import('./RecordPaperViewer'))

export function RecordPane({
  book,
  onOpenRecord,
  onContinueDraft,
  onSubmit,
  onSelectBook,
  onAddToEmail,
}: {
  book: BookRead | null
  onOpenRecord: (id: number) => void
  onContinueDraft: (id: number) => void
  onSubmit: (id: number) => void
  /** select a different record (scan matched another ref) */
  onSelectBook: (id: number) => void
  /** add this record to the email basket (enriches + toasts) */
  onAddToEmail: (book: BookRead) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const canManage = has('books.manage')
  const canScanCap = has('documents.scan')
  const canScan = canScanCap && canManage
  const fileRef = useRef<HTMLInputElement | null>(null)
  const addScan = useAddScan(book?.id ?? null)

  const papers = useMemo(() => (book ? papersOf(book) : []), [book])

  // A scan-back approval opens on its signed paper (the operator's question is
  // "what came back signed?", not the generated original).
  const initialPaperIndex = useMemo(() => {
    if (!book || book.approval_state !== 'approved' || signedSourceOf(book) !== 'scan') return 0
    const signedIdx = papers.findIndex((p) => p.kind === 'signed')
    return signedIdx >= 0 ? signedIdx : 0
  }, [book, papers])

  const [paperIndex, setPaperIndex] = useState(initialPaperIndex)
  const [fullOpen, setFullOpen] = useState(false)
  const [draftScan, setDraftScan] = useState<File | null>(null)
  // The full-preview overlay is a hand-rolled portal (not Radix Dialog), so it
  // needs explicit focus management to honour its aria-modal claim: move focus
  // in on open, trap Tab inside, restore to the trigger on close (UI-01).
  const overlayRef = useFocusTrap<HTMLDivElement>(fullOpen)

  // reset selection when the record changes (render-time derive, not effect)
  const bookKey = book?.id ?? null
  const [prevBookKey, setPrevBookKey] = useState(bookKey)
  if (prevBookKey !== bookKey) {
    setPrevBookKey(bookKey)
    setPaperIndex(initialPaperIndex)
    setFullOpen(false)
  }

  useEffect(() => {
    if (!fullOpen) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !e.defaultPrevented) setFullOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [fullOpen])

  if (!book) {
    return (
      <aside className="grid min-h-0 place-items-center rounded-2xl border border-hairline bg-surface p-6 text-center text-[0.8em] text-muted-foreground">
        {t('books.empty')}
      </aside>
    )
  }

  const kind = formKindOf(book.subject)
  const who = subjectEmployeePart(book.subject)
  const state = book.approval_state
  // Same gate as the record page (BookRecordPage): an admin files the
  // physically-signed scan back for a request out for signature (pending) or
  // at the printer (awaiting_scan). Shared helper keeps both surfaces aligned.
  const showFileSigned = canFileSignedCopy(state, { canManage, canScan: canScanCap })

  const addScanSlot = canScan ? (
    <button
      type="button"
      title={t('books.pane.addScanHint')}
      disabled={addScan.busy}
      onClick={() => fileRef.current?.click()}
      className="flex w-14 shrink-0 flex-col items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="grid aspect-[210/297] w-full place-items-center rounded-[3px] border-2 border-dashed border-border bg-surface-raised text-faint transition-colors hover:border-primary hover:text-primary">
        {addScan.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
      </span>
      <span className="w-full truncate text-center text-[0.56em] leading-tight text-faint">{t('books.pane.addScan')}</span>
    </button>
  ) : undefined

  return (
    <aside className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-hairline bg-surface">
      <div className="flex shrink-0 items-center gap-2.5 border-b border-hairline px-3.5 py-2.5">
        <span className="shrink-0 rounded-sm border-[1.5px] border-primary px-2 py-0.5 font-mono text-[0.72em] font-bold text-primary">
          {book.ref_number}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.82em] font-bold">
            <span aria-hidden className="me-1">{kind.glyph}</span>
            {t(kind.labelKey)}
          </span>
          <span className="block truncate text-[0.66em] text-muted-foreground" dir="auto">
            {who ? `${who} · ` : ''}
            <span className="font-mono">{book.created_at.slice(0, 10)}</span>
          </span>
        </span>
        <StateSeal
          state={state}
          signingPath={book.signing_path}
          signedSource={signedSourceOf(book)}
        />
      </div>

      <Suspense
        fallback={
          <div className="grid flex-1 place-items-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" aria-hidden />
          </div>
        }
      >
        <RecordPaperViewer
          papers={papers}
          paperIndex={paperIndex}
          onPaperIndexChange={setPaperIndex}
          baseWidth={400}
          onOpenFull={() => setFullOpen(true)}
          addScanSlot={addScanSlot}
          emptySlot={
            <div className="flex max-w-[24ch] flex-col items-center gap-1.5 text-center text-[0.78em] text-faint">
              <FileText className="h-7 w-7" aria-hidden />
              <b className="text-muted-foreground">{t('books.pane.noPapersTitle')}</b>
              {t('books.pane.noPapersBody')}
            </div>
          }
        />
      </Suspense>

      <div className="flex shrink-0 flex-wrap gap-2 border-t border-hairline px-3.5 py-2.5">
        {state === 'none' && (
          <>
            <PaneBtn primary onClick={() => onContinueDraft(book.id)}>{t('books.pane.continueDraft')}</PaneBtn>
            <PaneBtn onClick={() => onSubmit(book.id)}>{t('books.approval.submitForApproval')}</PaneBtn>
          </>
        )}
        {state === 'returned' && (
          <PaneBtn primary onClick={() => onOpenRecord(book.id)}>{t('books.pane.revise')}</PaneBtn>
        )}
        {/* pending (out for in-app signature) + awaiting_scan (paper at the
            printer): file the signed copy back, via the SAME hidden input as the
            ＋Add-scan frame. Mirrors the record page's "Scan signed copy" action
            so both surfaces offer it. */}
        {showFileSigned && (
          <PaneBtn primary disabled={addScan.busy} onClick={() => fileRef.current?.click()}>
            {t('books.pane.scanSignedCopy')}
          </PaneBtn>
        )}
        {state !== 'none' && (
          <PaneBtn
            primary={state !== 'returned' && !showFileSigned}
            onClick={() => onOpenRecord(book.id)}
          >
            {t('books.pane.openRecord')}
          </PaneBtn>
        )}
        {/* Add this record to the email basket — only when there's a document
            (PDF / signed copy / scan) to attach. */}
        {papers.length > 0 && (
          <PaneBtn onClick={() => onAddToEmail(book)}>
            <Mail className="h-3.5 w-3.5" aria-hidden />
            {t('basket.add')}
          </PaneBtn>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) {
            // awaiting_scan: target is unambiguous — file the signed copy straight.
            // none/pending: ask whether this is the signed copy or just an attachment.
            // other (resolved) states: route by OCR'd ref.
            if (state === 'awaiting_scan') void addScan.fileSignedCopy(f, book.ref_number)
            else if (state === 'none' || state === 'pending') setDraftScan(f)
            else void addScan.submit(f)
          }
          e.target.value = ''
        }}
      />

      <ConfirmDialog
        open={addScan.otherMatch !== null}
        onOpenChange={(open) => {
          if (!open) addScan.clearOtherMatch()
        }}
        title={t('books.pane.scanMatchedOther', { ref: addScan.otherMatch?.ref ?? '' })}
        confirmLabel={t('books.pane.scanFileToOther', { ref: addScan.otherMatch?.ref ?? '' })}
        onConfirm={() => {
          const target = addScan.otherMatch?.bookId
          void addScan.fileToOther().then(() => {
            if (target !== undefined) onSelectBook(target)
          })
        }}
      />

      <AlertDialog open={draftScan !== null} onOpenChange={(o) => { if (!o) setDraftScan(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('books.pane.signedCopyTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('books.pane.signedCopyBody', { ref: book.ref_number })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setDraftScan(null)}>
              {t('common.cancel')}
            </AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => {
                const f = draftScan
                setDraftScan(null)
                if (f) void addScan.fileToCurrent(f, book.ref_number)
              }}
            >
              {t('books.pane.justAttach')}
            </Button>
            <AlertDialogAction
              onClick={() => {
                const f = draftScan
                setDraftScan(null)
                if (f) void addScan.fileSignedCopy(f, book.ref_number)
              }}
            >
              {t('books.pane.approveSignedCopy')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {fullOpen && papers[paperIndex]
        ? createPortal(
            <div
              ref={overlayRef}
              role="dialog"
              aria-modal="true"
              aria-label={t('books.pane.fullPreview')}
              tabIndex={-1}
              className="fixed inset-0 z-50 flex flex-col bg-[rgba(10,14,24,0.78)] pt-3 focus:outline-none"
              onClick={(e) => {
                if (e.target === e.currentTarget) setFullOpen(false)
              }}
            >
              <Suspense fallback={null}>
                <RecordPaperViewer
                  papers={papers}
                  paperIndex={paperIndex}
                  onPaperIndexChange={setPaperIndex}
                  baseWidth={620}
                  isOverlay
                  onClose={() => setFullOpen(false)}
                />
              </Suspense>
            </div>,
            document.body,
          )
        : null}
    </aside>
  )
}

function PaneBtn({
  primary = false,
  disabled = false,
  onClick,
  children,
}: {
  primary?: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[0.74em] font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        primary
          ? 'bg-primary text-primary-foreground hover:bg-primary-hover'
          : 'border border-border text-muted-foreground hover:border-primary hover:text-primary',
      )}
    >
      {children}
    </button>
  )
}
