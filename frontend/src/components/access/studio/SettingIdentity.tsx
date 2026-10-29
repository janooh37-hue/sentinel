import { useTranslation } from 'react-i18next'
import { settingLabel, type Snapshot } from './studioModel'


export function SettingLabel({ snapshot, capability }: { snapshot: Snapshot; capability: string }) {
  const { t, i18n } = useTranslation()
  return <>{settingLabel(snapshot, capability, i18n.language, t)}</>
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
