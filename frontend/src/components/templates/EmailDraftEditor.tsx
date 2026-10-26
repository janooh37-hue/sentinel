import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from '@/lib/toast'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { defaultDraftText, renderDraftSample } from '@/lib/draftTemplates'
import {
  draftTokensFor, TEMPLATES_CAP, useDraftTemplates, useResetDraftTemplate, useSaveDraftTemplate,
} from '@/lib/messageTemplates'
import type { DraftTemplateFields, DraftTemplatesRead } from '@/lib/messageTemplates'
import { useCapabilities } from '@/lib/useCapabilities'
import { normalizeDigits } from '@/lib/utils'
import { TemplateTokens } from './TemplateTokens'
import { templateErrorMessage, useTokenInsertion } from './templateEditing'

const fields = ['subject', 'intro', 'closing'] as const
const editableValues = (value?: DraftTemplateFields) => ({
  subject: value?.subject ?? '', intro: value?.intro ?? '', closing: value?.closing ?? '',
})

export function EmailDraftEditor({ draftKey, label }: { draftKey: string; label: string }) {
  const query = useDraftTemplates()
  const { t } = useTranslation()
  if (query.isPending) return <p role="status" className="text-sm text-muted-foreground">{t('msgTemplates.editor.loading')}</p>
  if (query.isError) return <div role="alert" className="space-y-2 text-sm"><p>{templateErrorMessage(query.error, t)}</p><Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => void query.refetch()}>{t('msgTemplates.editor.retry')}</Button></div>
  return <DraftEditor key={JSON.stringify([draftKey, query.data.overrides?.[draftKey]])} draftKey={draftKey} label={label} data={query.data} />
}

function DraftEditor({ draftKey, label, data }: { draftKey: string; label: string; data: DraftTemplatesRead }) {
  const { t } = useTranslation()
  const id = useId()
  const canEdit = useCapabilities().has(TEMPLATES_CAP)
  const [currentOverride, setCurrentOverride] = useState(data.overrides?.[draftKey])
  const [values, setValues] = useState(() => editableValues(currentOverride))
  const [confirmReset, setConfirmReset] = useState(false)
  const baseline = editableValues(currentOverride)
  const defaults = defaultDraftText(draftKey)
  const insertion = useTokenInsertion<(typeof fields)[number]>(values, setValues, 'intro')
  const save = useSaveDraftTemplate()
  const reset = useResetDraftTemplate()
  const pending = save.isPending || reset.isPending
  const dirty = fields.some((field) => values[field] !== baseline[field])
  const unsaved: DraftTemplateFields = {}
  for (const field of fields) if (values[field].trim()) unsaved[field] = values[field]
  const preview = renderDraftSample(draftKey, { ...(data.overrides ?? {}), [draftKey]: unsaved })
  const error = save.error ?? reset.error
  const accept = (next: DraftTemplatesRead) => {
    setCurrentOverride(next.overrides?.[draftKey])
    setValues(editableValues(next.overrides?.[draftKey]))
    setConfirmReset(false)
    toast.success(t('msgTemplates.editor.saved'))
  }

  return (
    <section className="min-w-0 space-y-4 text-start" aria-labelledby={`${id}-title`}>
      <header className="flex flex-wrap items-center gap-2">
        <h3 id={`${id}-title`} className="font-semibold text-foreground">{label}</h3>
        {currentOverride !== undefined && <span className="rounded-full bg-primary-soft px-2 py-1 text-xs text-primary">{t('msgTemplates.editor.modified')}</span>}
        {canEdit && dirty && <span className="text-xs text-muted-foreground">{t('msgTemplates.editor.dirty')}</span>}
      </header>
      <div className="space-y-4">
        {fields.map((field) => (
          <div key={field} className="min-w-0 space-y-2">
            <label htmlFor={`${id}-${field}`} className="block text-sm font-medium">{t(`msgTemplates.editor.fields.${field}`)}</label>
            {canEdit ? field === 'subject' ? (
              <Input {...insertion.field(field)} id={`${id}-${field}`} dir="rtl" lang="ar" className="min-h-11" value={values[field]} placeholder={defaults[field]} disabled={pending} onChange={(event) => { setValues((previous) => ({ ...previous, [field]: event.target.value })); save.reset(); reset.reset() }} />
            ) : (
              <Textarea {...insertion.field(field)} id={`${id}-${field}`} dir="rtl" lang="ar" rows={4} value={values[field]} placeholder={defaults[field]} disabled={pending} onChange={(event) => { setValues((previous) => ({ ...previous, [field]: event.target.value })); save.reset(); reset.reset() }} />
            ) : <p dir="rtl" lang="ar" className="whitespace-pre-wrap break-words rounded-md bg-surface-tinted p-3 text-sm">{values[field].trim() ? values[field] : defaults[field]}</p>}
            {!values[field].trim() && <p className="text-xs text-muted-foreground">{t('msgTemplates.editor.defaultNote')}</p>}
          </div>
        ))}
      </div>
      {canEdit && <TemplateTokens disabled={pending} tokens={draftTokensFor(data.tokens, draftKey).map((name) => ({ name, label: t(`msgTemplates.draftTokens.${name}`) }))} onInsert={insertion.insert} />}
      <div className="space-y-2">
        <h4 className="text-sm font-semibold">{t('msgTemplates.editor.preview')}</h4>
        <p dir="rtl" lang="ar" className="break-words text-sm font-medium">{normalizeDigits(preview.subject)}</p>
        <div dir="rtl" lang="ar" className="max-h-[50vh] overflow-auto rounded-md border border-hairline bg-white p-4 text-black" dangerouslySetInnerHTML={{ __html: normalizeDigits(preview.bodyHtml) }} />
      </div>
      {error && <p role="alert" className="text-sm text-danger">{templateErrorMessage(error, t)}</p>}
      {canEdit && (
        <div className="space-y-3 border-t border-hairline pt-3">
          {confirmReset && <p className="text-sm">{t('msgTemplates.editor.resetConfirm')}</p>}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            {confirmReset ? <>
              <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={pending} onClick={() => setConfirmReset(false)}>{t('msgTemplates.editor.cancel')}</Button>
              <Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" disabled={pending} onClick={() => { save.reset(); reset.mutate(draftKey, { onSuccess: accept }) }}>{t('msgTemplates.editor.confirmReset')}</Button>
            </> : <Button type="button" variant="outline" className="min-h-11 w-full sm:me-auto sm:w-auto" disabled={pending || currentOverride === undefined} onClick={() => setConfirmReset(true)}>{t('msgTemplates.editor.reset')}</Button>}
            <Button type="button" className="min-h-11 w-full sm:w-auto" disabled={pending || !dirty || confirmReset} onClick={() => { reset.reset(); save.mutate({ key: draftKey, body: values }, { onSuccess: accept }) }}>{t(pending ? 'msgTemplates.editor.saving' : 'msgTemplates.editor.save')}</Button>
          </div>
        </div>
      )}
    </section>
  )
}
