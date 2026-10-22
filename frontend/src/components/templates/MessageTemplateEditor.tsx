import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useCapabilities } from '@/lib/useCapabilities'
import { useDebouncedValue } from '@/lib/useDebouncedValue'
import {
  messageTemplatesApi, TEMPLATES_CAP, useResetMessageTemplate, useSaveMessageTemplate,
} from '@/lib/messageTemplates'
import type { MessageTemplateRead, MsgLang } from '@/lib/messageTemplates'
import { normalizeDigits } from '@/lib/utils'
import { TemplateTokens } from './TemplateTokens'
import { templateErrorMessage, useTokenInsertion } from './templateEditing'

export function MessageTemplateEditor({ template }: { template: MessageTemplateRead }) {
  return <MessageEditor key={JSON.stringify([template.event, template.default, template.override])} template={template} />
}

function MessageEditor({ template }: { template: MessageTemplateRead }) {
  const { t, i18n } = useTranslation()
  const id = useId()
  const uiLang = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const canEdit = useCapabilities().has(TEMPLATES_CAP)
  const [current, setCurrent] = useState(template)
  const baseline = current.override ?? current.default
  const [values, setValues] = useState(baseline)
  const [confirmReset, setConfirmReset] = useState(false)
  const insertion = useTokenInsertion<MsgLang>(values, setValues, 'ar')
  const save = useSaveMessageTemplate()
  const reset = useResetMessageTemplate()
  const pending = save.isPending || reset.isPending
  const dirty = values.ar !== baseline.ar || values.en !== baseline.en
  const debounced = useDebouncedValue(values, 400)
  const preview = useQuery({
    queryKey: ['notify-template-render', template.event, debounced],
    queryFn: () => messageTemplatesApi.render(template.event, debounced),
    retry: false,
  })
  const previewCurrent = values.ar === debounced.ar && values.en === debounced.en
  const error = save.error ?? reset.error
  const accept = (next: MessageTemplateRead) => {
    setCurrent(next)
    setValues(next.override ?? next.default)
    setConfirmReset(false)
    toast.success(t('msgTemplates.editor.saved'))
  }

  return (
    <section className="min-w-0 space-y-4 text-start" aria-labelledby={`${id}-title`}>
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={`${id}-title`} className="font-semibold text-foreground">{template.label[uiLang]}</h3>
          {current.override !== null && <span className="rounded-full bg-primary-soft px-2 py-1 text-xs text-primary">{t('msgTemplates.editor.modified')}</span>}
          {dirty && canEdit && <span className="text-xs text-muted-foreground">{t('msgTemplates.editor.dirty')}</span>}
        </div>
        <p className="text-sm text-muted-foreground">{t(`msgTemplates.editor.timing.${template.timing}`)}</p>
      </header>
      <div className="grid min-w-0 gap-4 lg:grid-cols-2">
        {(['ar', 'en'] as const).map((lang: MsgLang) => (
          <div key={lang} className="min-w-0 space-y-2">
            <label htmlFor={`${id}-${lang}`} className="block text-sm font-medium">{t(`msgTemplates.editor.languages.${lang}`)}</label>
            {canEdit ? (
              <Textarea {...insertion.field(lang)} id={`${id}-${lang}`} dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} rows={7} value={values[lang]} disabled={pending} onChange={(event) => {
                setValues((previous) => ({ ...previous, [lang]: event.target.value }))
                save.reset()
                reset.reset()
              }} />
            ) : (
              <p dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} className="whitespace-pre-wrap break-words rounded-md bg-surface-tinted p-3 text-sm">{values[lang]}</p>
            )}
          </div>
        ))}
      </div>
      {canEdit && <TemplateTokens disabled={pending} tokens={template.variables.map((variable) => ({ name: variable.name, label: uiLang === 'ar' ? variable.label_ar : variable.label_en }))} onInsert={insertion.insert} />}
      <div className="space-y-2" aria-busy={preview.isFetching || !previewCurrent}>
        <h4 className="text-sm font-semibold">{t('msgTemplates.editor.preview')}</h4>
        {!previewCurrent || preview.isPending ? <p role="status" className="text-sm text-muted-foreground">{t('msgTemplates.editor.previewLoading')}</p> : preview.isError ? <p role="alert" className="text-sm text-danger">{templateErrorMessage(preview.error, t)}</p> : (
          <div className="grid min-w-0 gap-4 lg:grid-cols-2">
            {(['ar', 'en'] as const).map((lang) => (
              <div key={lang} className="min-w-0 space-y-2">
                <p className="text-xs font-medium text-muted-foreground">{t(`msgTemplates.editor.languages.${lang}`)}</p>
                <p dir={lang === 'ar' ? 'rtl' : 'ltr'} lang={lang} className="whitespace-pre-wrap break-words rounded-md bg-surface-tinted p-3 text-sm">{normalizeDigits(preview.data.text[lang])}</p>
                <p className="text-xs tabular-nums text-muted-foreground">{t('msgTemplates.editor.counts', { chars: String(preview.data.text[lang].length), segments: String(preview.data.segments[lang]) })}</p>
              </div>
            ))}
          </div>
        )}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{templateErrorMessage(error, t)}</p>}
      {canEdit && (
        <div className="space-y-3 border-t border-hairline pt-3">
          {confirmReset && <p className="text-sm">{t('msgTemplates.editor.resetConfirm')}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            {confirmReset ? <>
              <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={pending} onClick={() => setConfirmReset(false)}>{t('msgTemplates.editor.cancel')}</Button>
              <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={pending} onClick={() => { save.reset(); reset.mutate(template.event, { onSuccess: accept }) }}>{t('msgTemplates.editor.confirmReset')}</Button>
            </> : <Button type="button" variant="outline" className="min-h-11 w-full sm:me-auto sm:w-auto" disabled={pending || current.override === null} onClick={() => setConfirmReset(true)}>{t('msgTemplates.editor.reset')}</Button>}
            <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={pending || !dirty || confirmReset} onClick={() => { reset.reset(); save.mutate({ event: template.event, body: values }, { onSuccess: accept }) }}>{t(pending ? 'msgTemplates.editor.saving' : 'msgTemplates.editor.save')}</Button>
          </div>
        </div>
      )}
    </section>
  )
}
