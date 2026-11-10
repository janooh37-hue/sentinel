import { useState, type ReactNode } from 'react'
import { CopyPlus, Reply } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/authContext'
import type { BookRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { DeriveRecordDialog } from './DeriveRecordDialog'

// The fifteen record categories (backend classifications.CLASSIFICATIONS: tabs 1–15).
const RECORD_CATEGORY_CODES = Array.from({ length: 15 }, (_, index) => `${index + 1}/1`)

export function useReplyActions(book: BookRead | null | undefined, openOverlay?: (key: string) => void): {
  actions: { key: 'reply' | 'createFrom'; label: string; icon: ReactNode; onSelect: () => void }[]
  dialog: ReactNode
} {
  const { user } = useAuth()
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const [selection, setSelection] = useState<{ bookId: number; kind: 'reply' | 'based_on' } | null>(null)
  // Derive creates a General Book: mirror the server's record-type checks. A classified
  // original keeps its classification; an unclassified one takes the classification
  // picked in the dialog, which offers only the categories the user may create in.
  const canCreateInCategory = book?.classification_code
    ? has(`books.category.${book.classification_code}`)
    : RECORD_CATEGORY_CODES.some((code) => has(`books.category.${code}`))
  const canCreateGeneralBook = has('books.service.General Book') && canCreateInCategory
  if (!book || !user || user.role === 'inmate_reporter' || book.access_scope !== 'full' || !has('books.create') || !has('books.view') || !canCreateGeneralBook) return { actions: [], dialog: null }
  return {
    actions: [
      { key: 'reply', label: t('books.thread.reply'), icon: <Reply className="h-4 w-4 rtl:-scale-x-100" aria-hidden />, onSelect: () => openOverlay ? openOverlay('reply') : setSelection({ bookId: book.id, kind: 'reply' }) },
      { key: 'createFrom', label: t('books.thread.createFrom'), icon: <CopyPlus className="h-4 w-4" aria-hidden />, onSelect: () => openOverlay ? openOverlay('createFrom') : setSelection({ bookId: book.id, kind: 'based_on' }) },
    ],
    dialog: !openOverlay && selection?.bookId === book.id ? <DeriveRecordDialog book={book} kind={selection.kind} open onOpenChange={(open) => { if (!open) setSelection(null) }} /> : null,
  }
}
