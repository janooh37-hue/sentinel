import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { messageTemplatesApi, type MsgLang, type NotifyPreviewRequest } from '@/lib/messageTemplates'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import { normalizeDigits } from '@/lib/utils'

interface NotifyMessagePreviewProps {
  body: NotifyPreviewRequest
  notifyEmployee: boolean
}

/** Uses the same unsaved fields as generation; preview failures never gate saving. */
export function NotifyMessagePreview({ body, notifyEmployee }: NotifyMessagePreviewProps): React.JSX.Element {
  const { t } = useTranslation()
  const [language, setLanguage] = useState<MsgLang | null>(null)
  // Debounce by content, not object identity: the parent rebuilds its payload on render.
  const serialized = JSON.stringify(body)
  const debounced = useDebouncedValue(serialized, 500)
  const debouncedBody = useMemo<NotifyPreviewRequest>(() => JSON.parse(debounced), [debounced])
  const preview = useQuery({
    queryKey: ['notify-preview', debouncedBody],
    queryFn: () => messageTemplatesApi.preview(debouncedBody),
    enabled: serialized === debounced,
    retry: false,
  })

  if (preview.isPending || serialized !== debounced) {
    return (
      <div className="mt-3 space-y-2" role="status" aria-label={t('msgTemplates.preview.loading')}>
        <Skeleton className="h-3 w-1/2" />
        <Skeleton className="h-16 w-full bg-surface" />
      </div>
    )
  }
  if (preview.isError) {
    return <p className="mt-3 text-xs text-muted-foreground">{t('msgTemplates.preview.error')}</p>
  }
  if (!preview.data.text) {
    return <p className="mt-3 text-xs text-muted-foreground">{t('msgTemplates.preview.empty')}</p>
  }

  const selectedLanguage = language ?? preview.data.language
  const segments = preview.data.segments?.[selectedLanguage]
  const text = normalizeDigits(preview.data.text[selectedLanguage])
  const timing = t(`msgTemplates.preview.timing.${preview.data.timing}`, { defaultValue: '' })

  return (
    <div className="mt-3 min-w-0 border-t border-hairline pt-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">{t('msgTemplates.preview.title')}</p>
        <div className="flex flex-wrap gap-1" role="group" aria-label={t('msgTemplates.preview.language')}>
          {([preview.data.language, preview.data.language === 'ar' ? 'en' : 'ar'] as const).map((lang) => (
            <Button
              key={lang}
              type="button"
              size="sm"
              variant={selectedLanguage === lang ? 'secondary' : 'ghost'}
              className="min-h-11"
              aria-pressed={selectedLanguage === lang}
              onClick={() => setLanguage(lang)}
            >
              {t(`msgTemplates.preview.${lang}`)}
            </Button>
          ))}
        </div>
      </div>
      <div className={notifyEmployee ? undefined : 'opacity-60'}>
        <p
          className="mt-2 whitespace-pre-wrap break-words text-start text-sm leading-relaxed tabular-nums [overflow-wrap:anywhere]"
          dir={selectedLanguage === 'ar' ? 'rtl' : 'ltr'}
          lang={selectedLanguage}
        >
          {text}
        </p>
        <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <p>{notifyEmployee ? timing : t('msgTemplates.preview.notSending')}</p>
          {segments != null && <p>{t('msgTemplates.preview.segments', { count: segments })}</p>}
        </div>
      </div>
    </div>
  )
}
