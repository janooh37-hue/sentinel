import { useTranslation } from 'react-i18next'

import type { BookRead } from '@/lib/api'

/** A record sent to me that I have not opened yet (`my_inbox.read_at` null). */
export function InboxUnreadDot({ book }: { book: BookRead }): React.JSX.Element | null {
  const { t } = useTranslation()
  if (!book.my_inbox || book.my_inbox.read_at) return null
  return (
    <>
      <span aria-hidden className="me-1.5 inline-block h-2 w-2 shrink-0 rounded-full bg-primary align-middle" />
      <span className="sr-only">{t('books.inbox.unreadRow')} </span>
    </>
  )
}
