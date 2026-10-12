import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Forward } from 'lucide-react'

import { SendRecordDialog } from '@/components/books/SendRecordDialog'
import { Button } from '@/components/ui/button'
import { permitBookQuery } from './permitUtils'

/** "Send to user" for a permit's generated letter; hidden unless the caller may send it. */
export function PermitSendButton({ bookId }: { bookId: number }): React.JSX.Element | null {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const { data: book } = useQuery(permitBookQuery(bookId))
  if (!book?.can_send) return null
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)}>
        <Forward className="me-1.5 h-4 w-4 rtl:-scale-x-100" aria-hidden />
        {t('books.send.menu')}
      </Button>
      <SendRecordDialog book={book} open={open} onOpenChange={setOpen} />
    </>
  )
}
