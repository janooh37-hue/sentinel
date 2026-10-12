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
    <div className="flex-1 overflow-auto bg-background" dir={i18n.language.startsWith('ar') ? 'rtl' : 'ltr'}>
      <div className="h-2 bg-[#0d2845]" aria-hidden />
      <div className="mx-auto max-w-[1600px] px-4 py-6 sm:px-8">
        <h1 className="mb-5 text-xl font-semibold"><bdi dir="auto">{session.name.replace(/\.docx$/i, '')}</bdi></h1>
        <div className="grid gap-6 lg:grid-cols-[minmax(320px,380px)_1fr]">
          <section className="space-y-5" aria-label={t('books.word.details')}>
            <p className="text-sm">{t('books.word.templateSessionHint')}</p>
            <p className="text-sm text-muted-foreground">{t('books.word.createdAt')}: <bdi dir="ltr">{new Date(session.created_at).toLocaleString(locale)}</bdi></p>
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
            <p className="text-sm">{t('books.word.step2')}</p>
            <div className="flex flex-wrap gap-2 border-t border-hairline pt-4">
              {/* Word launches from a REAL anchor (user gesture), never a location.href write: Chrome's protocol prompt can otherwise swallow clicks. */}
              <a href={session.word_url} className="inline-flex min-h-10 items-center justify-center rounded-lg bg-[#185abd] px-4 text-sm font-semibold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('books.word.openInWord')}</a>
              <Button variant="commit" size="commit" disabled={!lastPutAt || busy} onClick={() => finishMutation.mutate()}>{t('books.word.finishTemplate')}</Button>
              <Button variant="ghost" disabled={busy} className="border border-accent/50 text-accent hover:bg-accent/10" onClick={() => setDiscardOpen(true)}>{t('books.word.discard')}</Button>
            </div>
            <p className="text-xs text-muted-foreground">{t('books.word.protocolHint')}</p>
          </section>
          <section aria-label={t('books.word.preview')} className="h-[60vh] min-h-[400px] overflow-hidden rounded-lg border border-hairline lg:h-[75vh]">
            {lastPutAt ? (
              <Suspense fallback={<p className="p-4">{t('common.loading')}</p>}>
                <DocPdfCanvas key={lastPutAt} pdfUrl={api.templateSessionPreviewUrl(id, lastPutAt)} />
              </Suspense>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">{t('books.word.previewAfterSave')}</p>
            )}
          </section>
        </div>
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
