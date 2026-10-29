/** Settings overview shares the service editors and their per-template view gates. */
import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'

import { MessageTemplateEditor } from '@/components/templates/MessageTemplateEditor'
import { EmailDraftEditor } from '@/components/templates/EmailDraftEditor'
import { Skeleton } from '@/components/ui/skeleton'
import { useMessageTemplates, type MessageTemplateRead } from '@/lib/messageTemplates'
import { useDraftVariants } from '@/lib/draftTemplates'
import { useServiceLabel } from '@/pages/books/serviceLabels'

const messageGroups: MessageTemplateRead['group'][] = ['leaves', 'forms', 'violations', 'reminders']
const draftGroups = ['leaves', 'forms', 'classifications', 'absences'] as const

function TemplateRow({ id, label, children }: { id: string; label: string; children: ReactNode }) {
  const [visited, setVisited] = useState(false)
  return (
    <details
      id={id}
      className="group min-w-0 border-b border-hairline last:border-0"
      onToggle={(event) => { if (event.currentTarget.open) setVisited(true) }}
    >
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-sm px-2 py-3 text-start text-sm font-medium text-foreground hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 break-words">{label}</span>
        <ChevronDown aria-hidden className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none" />
      </summary>
      {/* Mount on first expansion, then retain unsaved edits when collapsed. */}
      {visited && <div className="min-w-0 pb-4 pt-2">{children}</div>}
    </details>
  )
}

export function MessageTemplatesSection(): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language.startsWith('ar') ? 'ar' : 'en'
  const messages = useMessageTemplates()
  const allMessages = messages.data ?? []
  const variants = useDraftVariants()
  const serviceLabel = useServiceLabel()

  return (
    <div className="min-w-0 space-y-8 p-4 sm:p-6" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
      <p className="text-sm text-muted-foreground">{t('msgTemplates.settings.description')}</p>
      <section aria-labelledby="employee-message-templates" className="min-w-0 space-y-4">
        <h3 id="employee-message-templates" className="text-lg font-semibold tracking-tight text-foreground">{t('msgTemplates.settings.employeeMessages')}</h3>
        {messages.isLoading ? (
          <div role="status" aria-label={t('msgTemplates.settings.loading')} className="space-y-3">
            <Skeleton className="h-11 w-full" />
            <Skeleton className="h-11 w-full" />
          </div>
        ) : messages.isError ? (
          <div role="alert" className="space-y-2 text-sm">
            <p className="text-accent">{t('msgTemplates.settings.loadError')}</p>
            <button type="button" className="min-h-11 text-primary underline" onClick={() => void messages.refetch()}>{t('msgTemplates.settings.retry')}</button>
          </div>
        ) : !allMessages.length ? (
          <p className="text-sm text-muted-foreground">{t('msgTemplates.settings.noMessages')}</p>
        ) : messageGroups.map((group) => {
          const templates = allMessages.filter((template) => template.group === group)
          if (!templates.length) return null
          const services = group === 'forms'
            ? [...new Set(templates.map((template) => template.services.join('|')))]
            : ['']
          return (
            <section key={group} aria-label={t(`msgTemplates.settings.groups.${group}`)} className="min-w-0">
              <h4 className="border-b border-hairline pb-2 text-sm font-semibold text-muted-foreground">{t(`msgTemplates.settings.groups.${group}`)}</h4>
              {services.map((service) => (
                <div key={service} className="min-w-0">
                  {group === 'forms' && service && <h5 className="pt-4 text-sm font-semibold text-foreground">{service.split('|').map(serviceLabel).join(' / ')}</h5>}
                  {templates.filter((template) => group !== 'forms' || template.services.join('|') === service).map((template) => (
                    <TemplateRow key={template.event} id={template.event} label={template.label[lang]}>
                      <MessageTemplateEditor template={template} />
                    </TemplateRow>
                  ))}
                </div>
              ))}
            </section>
          )
        })}
      </section>
      <section aria-labelledby="email-draft-templates" className="min-w-0 space-y-4">
        <h3 id="email-draft-templates" className="text-lg font-semibold tracking-tight text-foreground">{t('msgTemplates.settings.emailDrafts')}</h3>
        {!variants.length && <p className="text-sm text-muted-foreground">{t('msgTemplates.settings.noDrafts')}</p>}
        {draftGroups.map((group) => {
          const drafts = variants.filter(({ key }) => {
            const family = key.startsWith('leave:') ? 'leaves'
              : key.startsWith('absence:') ? 'absences'
              : key.startsWith('classification:') || key === 'General Book' || key === 'General Book:transfer' ? 'classifications'
              : 'forms'
            return family === group
          })
          if (!drafts.length) return null
          return (
            <section key={group} aria-label={t(`msgTemplates.settings.groups.${group}`)} className="min-w-0">
              <h4 className="border-b border-hairline pb-2 text-sm font-semibold text-muted-foreground">{t(`msgTemplates.settings.groups.${group}`)}</h4>
              {drafts.map((variant) => (
                <TemplateRow key={variant.key} id={variant.key} label={variant.label[lang]}>
                  <EmailDraftEditor draftKey={variant.key} label={variant.label[lang]} />
                </TemplateRow>
              ))}
            </section>
          )
        })}
      </section>
    </div>
  )
}
