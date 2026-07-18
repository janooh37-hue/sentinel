/**
 * WordHandoffDialog — "بطاقة الرقم المحجوز"
 *
 * Shown immediately after a Word book is created. Displays the reserved ref,
 * three steps, and footer actions (Finish / Open Again / Discard). Polls the
 * book every 5s while open to watch edit_session.last_put_at; Finish is gated
 * until at least one Word save has reached the server.
 */

import { lazy, Suspense, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import type { BookRead, WordSessionRead } from '@/lib/api'

// Same pdf.js canvas the generate-preview tab uses — the finished book renders
// exactly like a rich-editor generation (lazy: pdf.js ships in its own chunk).
const DocPdfCanvas = lazy(() => import('@/pages/application/DocPdfCanvas'))
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

interface Props {
  session: WordSessionRead | null
  open: boolean
  onClose: () => void
}

export function WordHandoffDialog({ session, open, onClose }: Props): React.JSX.Element | null {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const qc = useQueryClient()
  const [discardOpen, setDiscardOpen] = useState(false)
  // Set once Finish succeeds — flips the dialog to the rendered-PDF view so
  // the operator sees the final book the same way the rich-editor flow shows
  // its generated preview.
  const [finishedBook, setFinishedBook] = useState<BookRead | null>(null)

  // The dialog stays mounted between sessions (ApplicationPage/BookWordActions
  // just swap the `session` prop) — a fresh session must not inherit the
  // previous one's finished-PDF view. Render-phase state adjustment (the
  // React-recommended pattern), not an effect.
  const [prevToken, setPrevToken] = useState(session?.token)
  if (session?.token !== prevToken) {
    setPrevToken(session?.token)
    setFinishedBook(null)
  }

  // Poll the book while dialog is open to detect the first Word save.
  // Stops once Finish succeeded — the finished view is static.
  const polling = open && session != null && finishedBook == null
  const bookQuery = useQuery({
    queryKey: ['books', session?.book_id],
    queryFn: () => api.getBook(session!.book_id),
    enabled: polling,
    refetchInterval: polling ? 5000 : false,
    staleTime: 0,
  })

  const hasSave = Boolean(bookQuery.data?.edit_session?.last_put_at)

  const finishMutation = useMutation({
    mutationFn: () => api.finishWordSession(session!.book_id),
    onSuccess: (book) => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      toast.success(t('books.word.finished', { ref: bidi(session?.ref_number ?? '') }))
      // Keep the dialog open showing the finished PDF instead of closing.
      setFinishedBook(book)
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err))
    },
  })

  const discardMutation = useMutation({
    mutationFn: () => api.discardWordSession(session!.book_id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      onClose()
    },
    onError: (err) => {
      toast.error(apiErrorMessage(err))
    },
  })

  if (!session) return null

  // ------------------------------------------------------------------
  // Finished view — the saved version's PDF, rendered with the same
  // pdf.js canvas the rich-editor generate preview uses.
  // ------------------------------------------------------------------
  if (finishedBook) {
    const versions = finishedBook.versions ?? []
    const latest = versions.length > 0 ? versions[versions.length - 1] : null
    const pdfUrl = latest?.pdf_url ?? null
    const docxUrl = latest?.docx_url ?? undefined
    return (
      <DialogRoot open={open} onOpenChange={(v) => { if (!v) onClose() }}>
        <DialogContent className="max-w-3xl p-0 overflow-hidden">
          <div className="h-2 bg-[#0d2845]" aria-hidden />
          <div className="flex max-h-[85vh] flex-col px-6 pb-6 pt-4">
            <DialogHeader className="mb-3">
              <DialogTitle>
                {t('books.word.finishedPdfTitle', { ref: bidi(session.ref_number) })}
              </DialogTitle>
            </DialogHeader>
            <div className="min-h-[400px] flex-1 overflow-hidden">
              {pdfUrl ? (
                <Suspense fallback={<p className="text-[0.82em] text-muted-foreground">…</p>}>
                  <DocPdfCanvas key={pdfUrl} pdfUrl={pdfUrl} docxUrl={docxUrl} />
                </Suspense>
              ) : (
                // PDF conversion pending/failed — the docx is still the truth;
                // offer it instead of dead-ending (mirrors the generate flow's
                // "PDF unavailable" state).
                <p className="text-[0.84em] text-muted-foreground">
                  {t('books.word.pdfPending')}{' '}
                  {docxUrl && (
                    <a className="text-primary underline" href={docxUrl}>
                      DOCX
                    </a>
                  )}
                </p>
              )}
            </div>
            <div className="mt-4 flex justify-end border-t border-hairline pt-4">
              <Button type="button" variant="commit" size="commit" onClick={onClose}>
                {t('books.word.close')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </DialogRoot>
    )
  }

  const createdDate = bookQuery.data?.created_at
    ? new Date(bookQuery.data.created_at).toLocaleDateString(isAr ? 'ar-AE' : 'en-GB')
    : null

  const steps = ['books.word.step1', 'books.word.step2', 'books.word.step3']

  return (
    <>
      <DialogRoot open={open} onOpenChange={(v) => { if (!v) onClose() }}>
        <DialogContent
          className="max-w-lg p-0 overflow-hidden"
          // Prevent accidental close while the Word session is live.
          onInteractOutside={(e) => e.preventDefault()}
        >
          {/* Letterhead strip — navy bar matching the mockup */}
          <div className="h-2 bg-[#0d2845]" aria-hidden />

          <div className="px-6 pb-6 pt-4">
            <DialogHeader className="mb-4">
              <div className="text-[0.72em] font-semibold uppercase tracking-widest text-muted-foreground">
                {t('books.word.reserved')}
              </div>
              <DialogTitle className="sr-only">{t('books.word.reserved')}</DialogTitle>
            </DialogHeader>

            {/* Ref stamp — red rotated label per mockup */}
            <div
              dir="rtl"
              className="mb-4 flex items-center justify-center rounded-xl border-2 border-red-600/30 bg-red-50 py-4 dark:bg-red-950/30"
            >
              <span className="font-mono text-2xl font-black text-red-600 tracking-tight">
                <bdi dir="ltr">{session.ref_number}</bdi>
              </span>
            </div>

            {/* Classification + date line */}
            {(bookQuery.data?.classification_code || createdDate) && (
              <p className="mb-4 text-center text-[0.78em] text-muted-foreground">
                {bookQuery.data?.classification_code && (
                  <span className="font-medium text-foreground">
                    {bookQuery.data.classification_code}
                  </span>
                )}
                {bookQuery.data?.classification_code && createdDate && ' · '}
                {createdDate && (
                  <bdi dir="ltr">{createdDate}</bdi>
                )}
                {bookQuery.data?.submitted_by_name && (
                  <> · {t('books.word.preparedBy')}: <bdi dir="ltr">{bookQuery.data.submitted_by_name}</bdi></>
                )}
              </p>
            )}

            {/* Steps */}
            <ol className="mb-5 space-y-3" dir={isAr ? 'rtl' : 'ltr'}>
              {steps.map((key, idx) => (
                <li key={key} className="flex items-start gap-3">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-soft text-[0.72em] font-bold text-primary">
                    {idx + 1}
                  </span>
                  <span className="text-[0.86em] text-foreground">{t(key)}</span>
                </li>
              ))}
            </ol>

            {/* No-saves hint */}
            {!hasSave && (
              <p className="mb-4 text-center text-[0.78em] text-amber-600 dark:text-amber-400">
                {t('books.word.noSavesYet')}
              </p>
            )}

            {/* Footer actions */}
            <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
              {/* Primary: Finish */}
              <Button
                type="button"
                variant="commit"
                size="commit"
                disabled={!hasSave || finishMutation.isPending}
                onClick={() => finishMutation.mutate()}
                className="min-h-10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {t('books.word.finish')}
              </Button>

              {/* Ghost: Open in Word again — Word-brand blue */}
              <Button
                type="button"
                variant="ghost"
                onClick={() => { window.location.href = session.word_url }}
                style={{ color: '#185abd', borderColor: '#185abd' }}
                className="min-h-10 border"
              >
                {t('books.word.openAgain')}
              </Button>

              {/* Danger ghost: Discard */}
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDiscardOpen(true)}
                className="min-h-10 border border-accent/50 text-accent hover:bg-accent/10"
              >
                {t('books.word.discard')}
              </Button>
            </div>
          </div>
        </DialogContent>
      </DialogRoot>

      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t('books.word.discard')}
        description={t('books.word.discardConfirm')}
        confirmLabel={t('common.confirm')}
        onConfirm={() => discardMutation.mutate()}
        destructive
      />
    </>
  )
}
