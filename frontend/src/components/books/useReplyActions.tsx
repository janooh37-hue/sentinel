import { useState, type ReactNode } from 'react'
import { CopyPlus, Reply } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/authContext'
import type { BookRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { DeriveRecordDialog } from './DeriveRecordDialog'

export function useReplyActions(book: BookRead | null | undefined, openOverlay?: (key: string) => void): {
  actions: { key: 'reply' | 'createFrom'; label: string; icon: ReactNode; onSelect: () => void }[]
  dialog: ReactNode
} {
  const { user } = useAuth()
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const [selection, setSelection] = useState<{ bookId: number; kind: 'reply' | 'based_on' } | null>(null)
  // Derive creates a General Book in the original's classification: mirror the server's record-type checks.
  const canCreateGeneralBook = has('books.service.General Book') && (!book?.classification_code || has(`books.category.${book.classification_code}`))
  if (!book || !user || user.role === 'inmate_reporter' || book.access_scope !== 'full' || !has('books.create') || !has('books.view') || !canCreateGeneralBook) return { actions: [], dialog: null }
  return {
    actions: [
      { key: 'reply', label: t('books.thread.reply'), icon: <Reply className="h-4 w-4 rtl:-scale-x-100" aria-hidden />, onSelect: () => openOverlay ? openOverlay('reply') : setSelection({ bookId: book.id, kind: 'reply' }) },
      { key: 'createFrom', label: t('books.thread.createFrom'), icon: <CopyPlus className="h-4 w-4" aria-hidden />, onSelect: () => openOverlay ? openOverlay('createFrom') : setSelection({ bookId: book.id, kind: 'based_on' }) },
    ],
    dialog: !openOverlay && selection?.bookId === book.id ? <DeriveRecordDialog book={book} kind={selection.kind} open onOpenChange={(open) => { if (!open) setSelection(null) }} /> : null,
  }
}
