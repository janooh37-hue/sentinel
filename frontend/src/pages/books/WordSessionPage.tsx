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
    <div className="flex-1 overflow-auto bg-background" dir={i18n.language.startsWith('ar') ? 'rtl' : 'ltr'}>
      <div className="h-2 bg-[#0d2845]" aria-hidden />
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-8">
        <h1 className="mb-5 text-xl font-semibold">{t(finishedBook ? 'books.word.finishedPageTitle' : 'books.word.sessionTitle')}</h1>
        <div className="grid gap-6 lg:grid-cols-[minmax(320px,380px)_1fr]">
          <section aria-label={t('books.word.details')} className="space-y-5">
            <div className="rounded-xl border-2 border-red-600/30 bg-red-50 py-4 text-center dark:bg-red-950/30">
              <bdi dir="ltr" className="font-mono text-2xl font-black tracking-tight text-red-600">{session?.ref_number ?? book.ref_number}</bdi>
            </div>
            <dl className="space-y-4 text-sm">
              <div><dt className="text-muted-foreground">{t('books.word.classification')}</dt><dd className="font-medium"><bdi dir="ltr">{book.classification_code}</bdi>{classification && <><span className="block" lang="ar">{classification.name_ar}</span><span className="block" lang="en">{classification.name_en}</span><span className="block text-muted-foreground" lang="ar">{classification.unit_ar}</span></>}</dd></div>
              <div><dt className="text-muted-foreground">{t('books.word.createdAt')}</dt><dd><bdi dir="ltr">{new Date(book.created_at).toLocaleString(locale)}</bdi></dd></div>
              <div><dt className="text-muted-foreground">{t('books.word.preparedBy')}</dt><dd><bdi dir="auto">{book.submitted_by_name}</bdi></dd></div>
              <div><dt className="text-muted-foreground">{t('books.word.subject')}</dt><dd dir="auto">{finishedBook ? book.subject : session?.subject}</dd></div>
              {!finishedBook && <>
                <div><dt className="text-muted-foreground">{t('books.word.recipient')}</dt><dd dir="auto">{session?.recipient_name}</dd></div>
                <div><dt className="text-muted-foreground">{t('books.word.cc')}</dt><dd><ul>{session?.cc.map((name, index) => <li key={index} dir="auto">{name}</li>)}</ul></dd></div>
                <div><dt className="text-muted-foreground">{t('books.word.templateUsed')}</dt><dd dir="auto">{session?.template_name?.replace(/\.docx$/i, '') ?? t('books.word.templateNone')}</dd></div>
              </>}
            </dl>
            {!finishedBook && <>
              <h2 className="text-sm font-semibold">{t('books.word.saveHistory', { count: saveHistory.times.length })}</h2>
              {hasSave ? <ol className="space-y-1 text-sm text-emerald-700 dark:text-emerald-400">{saveHistory.times.map((time) => <li key={time}><bdi dir="ltr">{new Date(time).toLocaleString(locale)}</bdi></li>)}</ol> : <p className="text-sm text-amber-700 dark:text-amber-400">{t('books.word.noSavesYet')}</p>}
              <ol className="space-y-2 text-sm">{['step1', 'step2', 'step3'].map((step, index) => <li key={step}>{index + 1}. {t(`books.word.${step}`)}</li>)}</ol>
              <p className="text-xs text-muted-foreground">{t('books.word.protocolHint')}</p>
            </>}
            <div className="flex flex-wrap gap-2 border-t border-hairline pt-4">
              {finishedBook ? <SavedRecordActions bookId={bookId} refNumber={book.ref_number} detail={book.subject ?? undefined} /> : <>
                {/* Word launches from a REAL anchor (user gesture), never a location.href write: Chrome's protocol prompt can otherwise swallow clicks. */}
                <a href={session!.word_url} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#185abd] px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('books.word.openInWord')}</a>
                <Button variant="commit" size="commit" disabled={!hasSave || finishMutation.isPending || discardMutation.isPending} onClick={() => finishMutation.mutate()}>{t('books.word.finish')}</Button>
                <Button variant="ghost" disabled={finishMutation.isPending || discardMutation.isPending} className="border border-accent/50 text-accent hover:bg-accent/10" onClick={() => setDiscardOpen(true)}>{t('books.word.discard')}</Button>
              </>}
              {canSaveTemplate && <Button variant="outline" disabled={(!finishedBook && !hasSave) || saveTemplateMutation.isPending} onClick={() => openTemplateDialog('save')}>{t(finishedBook ? 'books.word.saveAsTemplate' : 'books.word.saveDraftAsTemplate')}</Button>}
              {has('books.templates') && <Button variant="outline" onClick={() => openTemplateDialog('new')}>{t('books.word.newTemplateInWord')}</Button>}
            </div>
          </section>
          <section aria-label={t('books.word.preview')} className="h-[60vh] min-h-[400px] overflow-hidden rounded-lg border border-hairline lg:h-[75vh]">
            {finishedBook ? (
              pdfUrl ? (
                <Suspense fallback={<p className="p-4">{t('common.loading')}</p>}>
                  <DocPdfCanvas key={pdfUrl} pdfUrl={pdfUrl} docxUrl={latest?.docx_url ?? undefined} />
                </Suspense>
              ) : (
                <p className="p-4 text-sm text-muted-foreground">
                  {t('books.word.pdfPending')}{' '}
                  {latest?.docx_url && <a href={latest.docx_url} className="text-primary underline">DOCX</a>}
                </p>
              )
            ) : lastPutAt ? (
              <Suspense fallback={<p className="p-4">{t('common.loading')}</p>}>
                <DocPdfCanvas key={lastPutAt} pdfUrl={api.wordSessionPreviewUrl(bookId, lastPutAt)} />
              </Suspense>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">{t('books.word.previewAfterSave')}</p>
            )}
          </section>
        </div>
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
