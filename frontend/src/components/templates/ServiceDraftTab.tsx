import { useTranslation } from 'react-i18next'

import { draftKeysForService, useDraftVariants } from '@/lib/draftTemplates'
import { EmailDraftEditor } from './EmailDraftEditor'

export function ServiceDraftTab({ service }: { service: string }) {
  const { t, i18n } = useTranslation()
  const variants = useDraftVariants()
  const keys = draftKeysForService(variants, service)
  const lang = i18n.language.startsWith('ar') ? 'ar' : 'en'
  if (!keys.length) return <p className="p-4 text-sm text-muted-foreground">{t('msgTemplates.tabs.draftsEmpty')}</p>
  return <div className="space-y-4">{keys.map((key) => <div key={key} className="min-w-0 rounded-lg border border-hairline bg-surface p-4 sm:p-5"><EmailDraftEditor draftKey={key} label={variants.find((variant) => variant.key === key)!.label[lang]} /></div>)}</div>
}
