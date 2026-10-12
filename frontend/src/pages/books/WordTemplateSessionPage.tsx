import { lazy, Suspense, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'

const DocPdfCanvas = lazy(() => import('@/pages/application/DocPdfCanvas'))

export function WordTemplateSessionPage(): React.JSX.Element {
  const { sessionId } = useParams()
  const id = Number(sessionId)
  const navigate = useNavigate()
  const { t, i18n } = useTranslation()
  const locale = i18n.language.startsWith('ar') ? 'ar-AE' : 'en-GB'
  const qc = useQueryClient()
  const [discardOpen, setDiscardOpen] = useState(false)
  const goBack = () => { if (window.history.state?.idx > 0) navigate(-1); else navigate('/books') }
  const finishMutation = useMutation({
    mutationFn: () => api.finishTemplateSession(id),
    onSuccess: (tpl) => {
      void qc.invalidateQueries({ queryKey: ['word-templates'] })
      qc.removeQueries({ queryKey: ['word-template-session', id] })
      toast.success(t('books.word.savedAsTemplate', { name: tpl.name.replace(/\.docx$/i, '') }))
      goBack()
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const discardMutation = useMutation({
    mutationFn: () => api.discardTemplateSession(id),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ['word-template-session', id] })
      toast.success(t('books.word.templateSessionDiscarded'))
      goBack()
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })
  const active = !finishMutation.isSuccess && !discardMutation.isSuccess
  const sessionQuery = useQuery({
    queryKey: ['word-template-session', id],
    queryFn: () => api.getTemplateSession(id),
    enabled: active,
    refetchInterval: active ? 1000 : false,
    retry: false,
  })
  const session = sessionQuery.data
  const lastPutAt = session?.last_put_at ?? null
  // ponytail: history is per visit; refresh retains only the latest save. Upgrade to a server-side log for a durable history.
  const [saveHistory, setSaveHistory] = useState<{ token: string | undefined; times: string[] }>({ token: undefined, times: [] })
  if (saveHistory.token !== session?.token) {
    setSaveHistory({ token: session?.token, times: lastPutAt ? [lastPutAt] : [] })
  } else if (lastPutAt && !saveHistory.times.includes(lastPutAt)) {
    setSaveHistory({ ...saveHistory, times: [...saveHistory.times, lastPutAt] })
  }
  if (sessionQuery.error) return <p role="alert" className="p-6 text-destructive">{apiErrorMessage(sessionQuery.error)}</p>
  if (!session) return <p className="p-6 text-muted-foreground">{t('common.loading')}</p>
  const busy = finishMutation.isPending || discardMutation.isPending

  return (
    <div className="flex flex-1 flex-col overflow-auto bg-background lg:overflow-hidden" dir={i18n.language.startsWith('ar') ? 'rtl' : 'ltr'}>
      <div className="h-2 shrink-0 bg-[#0d2845]" aria-hidden />
      <header className="flex shrink-0 flex-wrap items-center gap-x-6 gap-y-3 border-b border-hairline bg-surface px-4 py-3 sm:px-6">
        <h1 className="min-w-0 text-lg font-semibold"><bdi dir="auto">{session.name.replace(/\.docx$/i, '')}</bdi></h1>
        <div className="flex flex-wrap items-center gap-2 lg:ms-auto">
          {/* Word launches from a REAL anchor (user gesture), never a location.href write: Chrome's protocol prompt can otherwise swallow clicks. */}
          <a href={session.word_url} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#185abd] px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('books.word.openInWord')}</a>
          <Button variant="commit" size="commit" disabled={!lastPutAt || busy} onClick={() => finishMutation.mutate()}>{t('books.word.finishTemplate')}</Button>
          <Button variant="ghost" disabled={busy} className="border border-accent/50 text-accent hover:bg-accent/10" onClick={() => setDiscardOpen(true)}>{t('books.word.discard')}</Button>
        </div>
      </header>
      <div className="grid flex-1 lg:min-h-0 lg:grid-cols-[minmax(300px,360px)_1fr]">
        <section className="space-y-6 border-hairline px-4 py-5 sm:px-6 lg:overflow-auto lg:border-e" aria-label={t('books.word.details')}>
          <div className="space-y-2">
            <p className="text-sm">{t('books.word.templateSessionHint')}</p>
            <p className="text-xs text-muted-foreground">{t('books.word.createdAt')}: <bdi dir="ltr">{new Date(session.created_at).toLocaleString(locale)}</bdi></p>
          </div>
          <div className="space-y-2 border-t border-hairline pt-5">
            <h2 className="text-sm font-semibold">{t('books.word.saveHistory', { count: saveHistory.times.length })}</h2>
            {lastPutAt ? (
              <ol className="space-y-1 text-sm text-emerald-700 dark:text-emerald-400">
                {saveHistory.times.map((time) => (
                  <li key={time}><bdi dir="ltr">{new Date(time).toLocaleString(locale)}</bdi></li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-amber-700 dark:text-amber-400">{t('books.word.noSavesYet')}</p>
            )}
          </div>
          <div className="space-y-3 border-t border-hairline pt-5">
            <p className="text-sm">{t('books.word.step2')}</p>
            <p className="text-xs text-muted-foreground">{t('books.word.protocolHint')}</p>
          </div>
        </section>
        <section aria-label={t('books.word.preview')} className="h-[75vh] min-h-[400px] p-3 sm:p-4 lg:h-auto lg:min-h-0">
          {lastPutAt ? (
            <Suspense fallback={<p className="p-4">{t('common.loading')}</p>}>
              <DocPdfCanvas key={lastPutAt} pdfUrl={api.templateSessionPreviewUrl(id, lastPutAt)} />
            </Suspense>
          ) : (
            <p className="flex h-full items-center justify-center rounded-md border border-dashed border-hairline p-6 text-center text-sm text-muted-foreground">{t('books.word.previewAfterSave')}</p>
          )}
        </section>
      </div>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={t('books.word.discardConfirmLabel')}
        description={t('books.word.discardTemplateConfirm')}
        confirmLabel={t('books.word.discardConfirmLabel')}
        onConfirm={() => discardMutation.mutate()}
        destructive
      />
    </div>
  )
}
