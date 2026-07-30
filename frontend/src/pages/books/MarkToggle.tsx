/**
 * MarkToggle — arms/disarms the annotation overlay from the record header.
 *
 * Extracted out of BookRecordPage (same reason as QueueNav): the page never
 * renders in tests, so the toggle's bilingual label swap had zero coverage.
 */
import { MapPin } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { HeaderBtn } from './HeaderBtn'

export function MarkToggle({
  armed,
  onToggle,
}: {
  armed: boolean
  onToggle: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <HeaderBtn
      icon={<MapPin className="h-3.5 w-3.5" />}
      label={armed ? t('books.annotations.markingOn') : t('books.annotations.mark')}
      tone={armed ? 'amber' : 'plain'}
      onClick={onToggle}
      testId="mark-toggle"
    />
  )
}
