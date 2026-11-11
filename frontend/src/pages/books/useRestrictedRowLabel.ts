import { useTranslation } from 'react-i18next'

import { bidi } from '@/lib/bidi'

/** The accessible name of a restricted (metadata-only) row, to put on a `role="group"` container. */
export function useRestrictedRowLabel(): (ref: string) => string {
  const { t } = useTranslation()
  return (ref) => t('books.restricted.rowLabel', { ref: bidi(ref) })
}
