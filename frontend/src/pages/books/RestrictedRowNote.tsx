import { Lock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

/**
 * Why a metadata-only row cannot be opened. Shared by the desk, the Records
 * list and the mobile cards so the wording is the same everywhere.
 */
export function RestrictedHint(): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <span className="inline-flex items-center gap-1 text-muted-foreground" title={t('books.restricted.explain')}>
      <Lock className="h-3 w-3 shrink-0" aria-hidden />
      {t('books.restricted.hint')}
    </span>
  )
}
