import { useTranslation } from 'react-i18next'
import { localized, type Snapshot } from './studioModel'

export function SettingLabel({ snapshot, capability }: { snapshot: Snapshot; capability: string }) {
  const { t, i18n } = useTranslation()
  const catalogItem = snapshot.items.find((item) => item.resource.kind === 'capability' && item.resource.id === capability)
  if (catalogItem) return <>{localized(catalogItem.label, i18n.language)}</>
  const bindings = snapshot.items.flatMap((item) => item.actions.filter((action) => action.setting_capabilities.includes(capability)).map((action) => ({ item, action })))
  if (bindings.length !== 1) return <>{t('access.studio.accountSetting')}</>
  const { item, action } = bindings[0]
  return <>{t(`access.studio.actions.${action.action}`)} · {localized(item.label, i18n.language)}</>
}

/** Keep reviewed patches identifiable without making canonical IDs the label. */
export function SettingIdentity({ snapshot, capability }: { snapshot: Snapshot; capability: string }) {
  const { t } = useTranslation()
  return <div className="min-w-0">
    <p className="font-medium"><SettingLabel snapshot={snapshot} capability={capability} /></p>
    <details className="text-xs text-muted-foreground">
      <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-sm focus-visible:outline-2 focus-visible:outline-ring">{t('access.studio.why.technical')}</summary>
      <p className="break-all font-mono"><bdi dir="ltr">{capability}</bdi></p>
    </details>
  </div>
}

export function LocalDateTime({ value }: { value: string }) {
  const { i18n } = useTranslation()
  return <time dateTime={value}>{new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short', numberingSystem: 'latn' }).format(new Date(value))}</time>
}
