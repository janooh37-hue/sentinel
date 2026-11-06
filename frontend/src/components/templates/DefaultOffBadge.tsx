import { useTranslation } from 'react-i18next'

import type { MessageTemplateRead } from '@/lib/messageTemplates'

/** Neutral marker for an event whose employee message is off by default. Renders nothing when on. */
export function DefaultOffBadge({ template }: { template: Pick<MessageTemplateRead, 'default_enabled' | 'default_mode'> }) {
  const { t } = useTranslation()
  if (template.default_enabled) return null
  return (
    <span className="shrink-0 rounded-full border border-hairline px-2 py-0.5 text-xs font-medium text-muted-foreground">
      {t(`msgTemplates.editor.defaultSend.${template.default_mode}.badge`)}
    </span>
  )
}
