import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { useMessageTemplates } from '@/lib/messageTemplates'
import { MessageTemplateEditor } from './MessageTemplateEditor'
import { templateErrorMessage } from './templateEditing'

/** `service` is a template_id or a page key (`leaves`, `violations`) from the catalog's `services`. */
export function ServiceNotificationTab({ service }: { service: string }) {
  const { t } = useTranslation()
  const query = useMessageTemplates()
  if (query.isPending) return <p role="status" className="p-4 text-sm text-muted-foreground">{t('msgTemplates.tabs.loading')}</p>
  if (query.isError) return <div role="alert" className="space-y-3 p-4 text-sm"><p>{templateErrorMessage(query.error, t)}</p><Button type="button" variant="outline" className="min-h-11 w-full sm:w-auto" onClick={() => void query.refetch()}>{t('msgTemplates.tabs.retry')}</Button></div>
  const templates = query.data.filter((template) => template.services.includes(service))
  if (!templates.length) return <p className="p-4 text-sm text-muted-foreground">{t('msgTemplates.tabs.notificationEmpty')}</p>
  return <div className="space-y-4">{templates.map((template) => <div key={template.event} className="min-w-0 rounded-lg border border-hairline bg-surface p-4 sm:p-5"><MessageTemplateEditor template={template} /></div>)}</div>
}
