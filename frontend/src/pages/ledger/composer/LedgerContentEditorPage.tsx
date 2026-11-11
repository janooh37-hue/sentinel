/**
 * Ledger Book content editor — `/ledger/books/:bookId/edit`. The writer edits
 * the subject lines and body of the latest, unsigned Revision (PUT /content;
 * each save is tracked). A signed Revision is locked: it shows read-only with
 * "Start correction". Unsaved edits block leaving: in-app navigation asks to
 * discard them, and a reload or tab close gets the browser's own warning.
 */
import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Lock } from 'lucide-react'
import { useEffect, useId, useRef } from 'react'
import { Controller, useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, useBlocker, useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'

import { LedgerBookActions } from '@/components/books/LedgerBookActions'
import { deskBookUrl, ledgerBookKey } from '@/components/books/ledgerBookKeys'
import { LedgerPaperPdf } from '@/components/books/LedgerPaperPdf'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { api, apiErrorMessage, type LedgerBookRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { bidi } from '@/lib/bidi'
import { toast } from '@/lib/toast'
import { MAX_SUBJECT_LINES } from './composerForm'
import { LedgerBodyEditor } from './LedgerBodyEditor'
import { SubjectLines } from './SubjectLines'

const contentSchema = z.object({
  subjects: z.array(z.string()).max(MAX_SUBJECT_LINES)
    .refine((lines) => lines.some((line) => line.trim() !== ''), 'errors.ledger.draftSubjectRequired'),
  body_html: z.string().refine(
    (html) => /<img\b/i.test(html) || html.replace(/<[^>]*>|&nbsp;/g, '').trim() !== '',
    'errors.ledger.draftBodyRequired',
  ),
})
type ContentValues = z.infer<typeof contentSchema>

export function LedgerContentEditorPage(): React.JSX.Element {
  const { t } = useTranslation()
  const bookId = Number(useParams().bookId)
  const userId = useAuth().user?.id
  const query = useQuery({ queryKey: ledgerBookKey(bookId), queryFn: () => api.getLedgerBook(bookId) })
  if (query.isError) {
    return (
      <div className="mx-auto flex max-w-xl flex-col items-start gap-3 p-6">
        <p role="alert">{apiErrorMessage(query.error)}</p>
        <Button type="button" variant="outline" onClick={() => void query.refetch()}>{t('ledgerBook.composer.retry')}</Button>
      </div>
    )
  }
  const book = query.data
  if (!book) return <p role="status" className="p-6 text-muted-foreground">{t('ledgerBook.composer.loading')}</p>
  const latest = book.revisions.at(-1)
  const editable = latest !== undefined && !latest.locked && !book.voided && userId !== undefined && book.created_by_user_id === userId

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-3 py-4 sm:px-6">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Link
          to={deskBookUrl(book.id)}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-md px-2 text-[0.84em] text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ArrowLeft aria-hidden="true" className="size-4 rtl:rotate-180" />
          {t('ledgerBook.composer.back')}
        </Link>
        <h1 className="me-auto text-lg font-semibold">
          {t('ledgerBook.composer.content.title', { ref: bidi(book.ref_number) })}
        </h1>
      </header>
      {editable
        // Keyed by Revision, not content hash: a background refetch must not
        // remount the form and drop what the writer has typed.
        ? <ContentForm key={latest.version_id} book={book} />
        : (
          <>
            <p role="note" className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-[0.84em]">
              <Lock aria-hidden="true" className="size-4 shrink-0" />
              {t('ledgerBook.composer.content.locked')}
            </p>
            <LedgerBookActions bookId={book.id} />
            <LedgerPaperPdf url={api.ledgerBookPaperPdfUrl(book.id, latest?.version_id)} title={t('ledgerBook.composer.paper.title')} className="h-[calc(100dvh-12rem)] min-h-96" />
          </>
        )}
    </div>
  )
}

function ContentForm({ book }: { book: LedgerBookRead }): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const bodyErrorId = useId()
  const form = useForm<ContentValues>({
    resolver: zodResolver(contentSchema),
    defaultValues: { subjects: book.subjects.length > 0 ? book.subjects : [''], body_html: book.body_html },
  })
  const { errors, isDirty } = form.formState
  const { reset } = form
  // Content that changed on the server replaces an untouched form only.
  useEffect(() => {
    if (form.formState.isDirty) return
    reset({ subjects: book.subjects.length > 0 ? book.subjects : [''], body_html: book.body_html })
  }, [book.body_html, book.content_sha256, book.subjects, form, reset])
  const keepEditingButton = useRef<HTMLButtonElement>(null)
  const dialogOpener = useRef<HTMLElement | null>(null)
  // Set once leaving is allowed: the edit is saved, or the writer chose to discard it.
  const leaveAllowed = useRef(false)
  const save = useMutation({
    mutationFn: (values: ContentValues) => api.updateLedgerBookContent(book.id, values),
    onSuccess: (accepted, submitted) => {
      // The desk's routing rows and record detail carry the subject too.
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['ledger', 'books', book.id] })
      if (leaveAllowed.current) return
      toast.success(t('ledgerBook.composer.content.saved'))
      // A completed request does not include text entered while it was pending.
      const current = form.getValues()
      if (JSON.stringify(current) !== JSON.stringify(submitted)) {
        reset({ subjects: accepted.subjects, body_html: accepted.body_html }, { keepValues: true })
        form.setValue('subjects', current.subjects, { shouldDirty: true })
        form.setValue('body_html', current.body_html, { shouldDirty: true })
        return
      }
      leaveAllowed.current = true
      navigate(deskBookUrl(book.id))
    },
    // A failed save keeps the form and its edits; leaving still asks first.
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const hasUnsavedChanges = isDirty || save.isPending
  const blocker = useBlocker(({ currentLocation, nextLocation }) => (
    !leaveAllowed.current && hasUnsavedChanges && currentLocation.pathname !== nextLocation.pathname
  ))
  useEffect(() => {
    if (!hasUnsavedChanges) return
    const warn = (event: BeforeUnloadEvent): void => {
      if (leaveAllowed.current) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasUnsavedChanges])
  const blocked = blocker.state === 'blocked'
  const keepEditing = (): void => { if (blocker.state === 'blocked') blocker.reset() }
  const discard = (): void => {
    if (blocker.state !== 'blocked') return
    leaveAllowed.current = true
    blocker.proceed()
  }

  return (
    <form className="flex flex-col gap-4" noValidate onSubmit={form.handleSubmit((values) => save.mutate(values))}>
      <Controller
        control={form.control}
        name="subjects"
        render={({ field }) => (
          <SubjectLines
            value={field.value}
            onChange={field.onChange}
            error={errors.subjects?.message && t(errors.subjects.message)}
          />
        )}
      />
      <div className="flex flex-col gap-1">
        <span className="text-[0.78em] font-semibold text-muted-foreground">{t('ledgerBook.composer.body.label')}</span>
        <Controller
          control={form.control}
          name="body_html"
          render={({ field }) => (
            <LedgerBodyEditor
              value={field.value}
              onChange={field.onChange}
              label={t('ledgerBook.composer.body.label')}
              invalid={Boolean(errors.body_html)}
              describedBy={errors.body_html ? bodyErrorId : undefined}
            />
          )}
        />
        {errors.body_html?.message && (
          <p id={bodyErrorId} role="alert" className="text-[0.78em] text-destructive">{t(errors.body_html.message)}</p>
        )}
        <p className="text-[0.76em] text-muted-foreground">{t('ledgerBook.composer.content.imagesNote')}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={save.isPending}>{t('ledgerBook.composer.content.save')}</Button>
        <Button type="button" variant="outline" onClick={() => navigate(deskBookUrl(book.id))}>{t('ledgerBook.composer.content.cancel')}</Button>
      </div>
      <AlertDialog open={blocked} onOpenChange={(open) => { if (!open && !leaveAllowed.current) keepEditing() }}>
        <AlertDialogContent
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            dialogOpener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
            keepEditingButton.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (!leaveAllowed.current && dialogOpener.current?.isConnected) dialogOpener.current.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>{t('ledgerBook.composer.content.discardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('ledgerBook.composer.content.discardBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button type="button" variant="destructive" onClick={discard}>{t('ledgerBook.composer.content.discardConfirm')}</Button>
            <Button ref={keepEditingButton} type="button" variant="secondary" onClick={keepEditing}>{t('ledgerBook.composer.content.keepEditing')}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </form>
  )
}
