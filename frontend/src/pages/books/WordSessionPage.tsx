import { lazy, Suspense, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, ApiError, apiErrorMessage } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { useCapabilities } from '@/lib/useCapabilities'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DialogRoot, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { SavedRecordActions } from '@/components/books/SavedRecordActions'
import { WordSteps } from './WordSteps'

const DocPdfCanvas = lazy(() => import('@/pages/application/DocPdfCanvas'))

export function WordSessionPage(): React.JSX.Element {
  const { id } = useParams()
  const bookId = Number(id)
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const locale = i18n.language.startsWith('ar') ? 'ar-AE' : 'en-GB'
  const { has } = useCapabilities()
  const qc = useQueryClient()
  const [discardOpen, setDiscardOpen] = useState(false)
  const [opened, setOpened] = useState(false)
  const [templateAction, setTemplateAction] = useState<'save' | 'new' | null>(null)
  const [templateName, setTemplateName] = useState('')
  const bookQuery = useQuery({ queryKey: ['books', bookId], queryFn: () => api.getBook(bookId) })
  const sessionQuery = useQuery({
    queryKey: ['word-session', bookId],
    queryFn: () => api.getWordSession(bookId),
    retry: false,
  })
  const session = sessionQuery.data
  const finishMutation = useMutation({
    mutationFn: () => api.finishWordSession(bookId),
    onSuccess: (book) => {
      qc.setQueryData(['books', bookId], book)
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['word-session', bookId] })
      toast.success(t('books.word.finished', { ref: bidi(book.ref_number) }))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const noActiveSession = sessionQuery.error instanceof ApiError && sessionQuery.error.status === 409 && sessionQuery.error.code === 'NO_ACTIVE_SESSION'
  const finishedBook = finishMutation.data ?? (noActiveSession ? bookQuery.data : undefined)
  const active = Boolean(session) && !finishedBook && !noActiveSession
  const saveStatusQuery = useQuery({
    queryKey: ['word-save-status', session?.token],
    queryFn: () => api.getWordSaveStatus(bookId),
    enabled: active,
    refetchInterval: active ? 1000 : false,
  })
  const lastPutAt = saveStatusQuery.data?.last_put_at ?? session?.last_put_at ?? null
  const hasSave = lastPutAt != null
  // ponytail: history is per visit; refresh retains only the latest save. Upgrade to a server-side log for a durable history.
  const [saveHistory, setSaveHistory] = useState<{ token: string | undefined; times: string[] }>({ token: undefined, times: [] })
  if (saveHistory.token !== session?.token) {
    setSaveHistory({ token: session?.token, times: lastPutAt ? [lastPutAt] : [] })
  } else if (lastPutAt && !saveHistory.times.includes(lastPutAt)) {
    setSaveHistory({ ...saveHistory, times: [...saveHistory.times, lastPutAt] })
  }
  useEffect(() => {
    if (active && lastPutAt && lastPutAt !== session?.last_put_at) {
      void qc.invalidateQueries({ queryKey: ['word-session', bookId] })
    }
  }, [active, bookId, lastPutAt, qc, session?.last_put_at])
  const classificationsQuery = useQuery({
    queryKey: ['books', 'classifications'], queryFn: () => api.listBookClassifications(), staleTime: Infinity,
  })
  const classification = classificationsQuery.data?.items.find((c) => c.code === bookQuery.data?.classification_code)
  const goBack = () => { if (window.history.state?.idx > 0) navigate(-1); else navigate('/books') }
  const discardMutation = useMutation({
    mutationFn: () => api.discardWordSession(bookId),
    onSuccess: (book) => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      toast.success(t(book.voided_at ? 'books.toast.voided' : 'books.toast.wordSessionDiscarded'))
      goBack()
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const saveTemplateMutation = useMutation({
    mutationFn: () => api.saveBookAsTemplate(bookId, templateName.trim()),
    onSuccess: (tpl) => {
      setTemplateAction(null)
      void qc.invalidateQueries({ queryKey: ['word-templates'] })
      toast.success(t('books.word.savedAsTemplate', { name: tpl.name.replace(/\.docx$/i, '') }))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const newTemplateMutation = useMutation({
    mutationFn: () => api.createTemplateSession(templateName.trim()),
    onSuccess: (s) => navigate(`/books/word-templates/${s.id}`),
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const book = finishedBook ?? bookQuery.data
  const latest = finishedBook?.versions?.at(-1)
  const signedPdf = latest?.signed_pdf_url
  const pdfUrl = signedPdf ? `${signedPdf}${signedPdf.includes('?') ? '&' : '?'}rev=signed` : latest?.pdf_url
  const canSaveTemplate = has('books.templates') && (finishedBook
    ? latest?.template_id === 'General Book' || latest?.template_id === 'Security Permit'
    : book?.service_id === 'General Book')
  const openTemplateDialog = (action: 'save' | 'new') => {
    setTemplateName(action === 'save' ? (session?.subject ?? book?.subject ?? '') : '')
    setTemplateAction(action)
  }
  const error = bookQuery.error ?? (!noActiveSession ? sessionQuery.error : null)
  if (error) return <p role="alert" className="p-6 text-destructive">{apiErrorMessage(error)}</p>
  if (!book || (!session && !finishedBook)) return <p className="p-6 text-muted-foreground">{t('common.loading')}</p>

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background lg:overflow-hidden" dir={i18n.language.startsWith('ar') ? 'rtl' : 'ltr'}>
      <div className="h-2 shrink-0 bg-[#0d2845]" aria-hidden />
      <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b border-hairline bg-surface px-4 py-3 sm:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1">
          <h1 className="text-lg font-semibold">{t(finishedBook ? 'books.word.finishedPageTitle' : 'books.word.sessionTitle')}</h1>
          <bdi dir="ltr" className="rounded-lg border border-red-600/30 bg-red-50 px-3 py-0.5 font-mono text-xl font-black tracking-tight text-red-600 dark:bg-red-950/30">{session?.ref_number ?? book.ref_number}</bdi>
        </div>
        <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center lg:ms-auto">
          {!finishedBook && <>
            {/* Word launches from a REAL anchor (user gesture), never a location.href write: Chrome's protocol prompt can otherwise swallow clicks. */}
            <a href={session!.word_url} onClick={() => setOpened(true)} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#185abd] px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('books.word.openInWord')}</a>
            <Button variant="commit" size="commit" disabled={!hasSave || finishMutation.isPending || discardMutation.isPending} onClick={() => finishMutation.mutate()}>{t('books.word.finish')}</Button>
            <Button variant="ghost" disabled={finishMutation.isPending || discardMutation.isPending} className="col-span-2 border border-accent/50 text-accent hover:bg-accent/10" onClick={() => setDiscardOpen(true)}>{t('books.word.discard')}</Button>
            {has('books.templates') && <span className="mx-1 hidden h-6 w-px bg-hairline sm:block" aria-hidden />}
          </>}
          {/* Templates are desk work: hidden on phones to keep the bar to the session's own actions. */}
          {canSaveTemplate && <Button variant="outline" className="hidden sm:inline-flex" disabled={(!finishedBook && !hasSave) || saveTemplateMutation.isPending} onClick={() => openTemplateDialog('save')}>{t(finishedBook ? 'books.word.saveAsTemplate' : 'books.word.saveDraftAsTemplate')}</Button>}
          {has('books.templates') && <Button variant="outline" className="hidden sm:inline-flex" onClick={() => openTemplateDialog('new')}>{t('books.word.newTemplateInWord')}</Button>}
        </div>
      </header>
      {/* DOM order is the phone order (status → paper → details); lg places status and details in one side column. */}
      <div className="grid flex-1 lg:min-h-0 lg:grid-cols-[minmax(300px,360px)_1fr] lg:grid-rows-[auto_1fr]">
        <section aria-label={t(finishedBook ? 'books.word.finishedPageTitle' : 'books.word.sessionTitle')} className="border-hairline px-4 pb-2 pt-5 sm:px-6 lg:col-start-1 lg:row-start-1 lg:border-e lg:pb-5">
          {finishedBook
            ? <SavedRecordActions bookId={bookId} refNumber={book.ref_number} detail={book.subject ?? undefined} />
            : <WordSteps opened={opened} saveTimes={saveHistory.times} finishLabel={t('books.word.finish')} />}
        </section>
        <section aria-label={t('books.word.preview')} className={`${(finishedBook ? pdfUrl : lastPutAt) ? 'h-[75vh] min-h-[400px]' : 'h-40'} p-3 sm:p-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:h-auto lg:min-h-0`}>
          {finishedBook ? (
            pdfUrl ? (
              <Suspense fallback={<p className="p-4">{t('common.loading')}</p>}>
                <DocPdfCanvas key={pdfUrl} pdfUrl={pdfUrl} docxUrl={latest?.docx_url ?? undefined} />
              </Suspense>
            ) : (
              <p className="flex h-full items-center justify-center gap-1 rounded-md border border-dashed border-hairline p-6 text-sm text-muted-foreground">
                {t('books.word.pdfPending')}{' '}
                {latest?.docx_url && <a href={latest.docx_url} className="text-primary underline">DOCX</a>}
              </p>
            )
          ) : lastPutAt ? (
            <Suspense fallback={<p className="p-4">{t('common.loading')}</p>}>
              <DocPdfCanvas key={lastPutAt} pdfUrl={api.wordSessionPreviewUrl(bookId, lastPutAt)} />
            </Suspense>
          ) : (
            <p className="flex h-full items-center justify-center rounded-md border border-dashed border-hairline p-6 text-center text-sm text-muted-foreground">{t('books.word.previewAfterSave')}</p>
          )}
        </section>
        <section aria-labelledby="word-details-heading" className="border-t border-hairline px-4 pb-8 pt-5 sm:px-6 lg:col-start-1 lg:row-start-2 lg:overflow-auto lg:border-e">
          <h2 id="word-details-heading" className="mb-3 text-xs font-semibold text-muted-foreground">{t('books.word.details')}</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-3 text-sm [&_dt]:text-muted-foreground">
            <div className="contents"><dt>{t('books.word.subject')}</dt><dd className="font-semibold"><bdi dir="auto">{(finishedBook ? book.subject : session?.subject) || '—'}</bdi></dd></div>
            {book.classification_code && <div className="contents"><dt>{t('books.word.classification')}</dt><dd>
              <span className="font-medium"><bdi dir="ltr">{book.classification_code}</bdi>{classification && <> · <bdi lang="ar" dir="rtl">{classification.name_ar}</bdi></>}</span>
              {classification && <span className="block text-xs text-muted-foreground"><bdi lang="en" dir="ltr">{classification.name_en}</bdi> · <bdi lang="ar" dir="rtl">{classification.unit_ar}</bdi></span>}
            </dd></div>}
            {!finishedBook && <>
              <div className="contents"><dt>{t('books.word.recipient')}</dt><dd><bdi dir="auto">{session?.recipient_name || '—'}</bdi></dd></div>
              {session?.cc.length ? <div className="contents"><dt>{t('books.word.cc')}</dt><dd><ul>{session.cc.map((name, index) => <li key={index}><bdi dir="auto">{name}</bdi></li>)}</ul></dd></div> : null}
              <div className="contents"><dt>{t('books.word.templateUsed')}</dt><dd><bdi dir="auto">{session?.template_name?.replace(/\.docx$/i, '') ?? t('books.word.templateNone')}</bdi></dd></div>
            </>}
            <div className="contents"><dt>{t('books.word.preparedBy')}</dt><dd><bdi dir="auto">{book.submitted_by_name}</bdi></dd></div>
            <div className="contents"><dt>{t('books.word.createdAt')}</dt><dd><bdi dir="auto">{new Date(book.created_at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</bdi></dd></div>
          </dl>
        </section>
      </div>
      <ConfirmDialog open={discardOpen} onOpenChange={setDiscardOpen} title={t('books.word.discardConfirmLabel')} description={t(book.versions?.length ? 'books.word.discardReopenConfirm' : 'books.word.discardConfirm')} confirmLabel={t('books.word.discardConfirmLabel')} onConfirm={() => discardMutation.mutate()} destructive />
      <DialogRoot open={templateAction != null} onOpenChange={(open) => { if (!open) setTemplateAction(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t(templateAction === 'new' ? 'books.word.newTemplateInWord' : 'books.word.saveAsTemplate')}</DialogTitle>
            <DialogDescription>{t(templateAction === 'new' ? 'books.word.templateSessionHint' : 'books.word.saveAsTemplateHint')}</DialogDescription>
          </DialogHeader>
          <form
            className="flex flex-col gap-3 px-4 py-3"
            onSubmit={(event) => {
              event.preventDefault()
              if (!templateName.trim()) return
              if (templateAction === 'new') newTemplateMutation.mutate()
              else saveTemplateMutation.mutate()
            }}
          >
            <input
              autoFocus dir="auto"
              aria-label={t('books.word.saveAsTemplateName')}
              value={templateName}
              onChange={(event) => setTemplateName(event.target.value)}
              className="rounded-lg border border-hairline bg-transparent px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setTemplateAction(null)}>{t('common.cancel')}</Button>
              <Button type="submit" disabled={!templateName.trim() || saveTemplateMutation.isPending || newTemplateMutation.isPending}>
                {t(templateAction === 'new' ? 'books.word.createTemplateSession' : 'common.save')}
              </Button>
            </div>
          </form>
        </DialogContent>
      </DialogRoot>
    </div>
  )
}
