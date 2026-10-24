import { useState, type ReactNode } from 'react'
import { CopyPlus, Reply, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/authContext'
import type { BookRead } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { DeriveRecordDialog } from './DeriveRecordDialog'
import { DistributeDialog } from './DistributeDialog'
import { departmentName } from '@/lib/departments'

export function useReplyActions(book: BookRead | null | undefined, openOverlay?: (key: string) => void): {
  actions: { key: string; label: string; icon: ReactNode; onSelect: () => void }[]
  dialog: ReactNode
} {
  const { user } = useAuth()
  const { t, i18n } = useTranslation()
  const { has } = useCapabilities()
  const [selection, setSelection] = useState<{ bookId: number; kind: 'reply' | 'based_on' } | null>(null)
  const [distribution, setDistribution] = useState<{ bookId: number; sendId: number } | null>(null)
  // Derive creates a General Book in the original's classification: mirror the server's record-type checks.
  const canCreateGeneralBook = has('books.service.General Book') && (!book?.classification_code || has(`books.category.${book.classification_code}`))
  if (!book || !user || user.role === 'inmate_reporter' || book.access_scope !== 'full') return { actions: [], dialog: null }
  const canDerive = has('books.create') && has('books.view') && canCreateGeneralBook
  const sends = (book.department_sends ?? []).filter((send) => send.can_distribute)
  const selectedSend = distribution?.bookId === book.id ? sends.find((send) => send.id === distribution.sendId) : undefined
  return {
    actions: [
      ...sends.map((send) => ({
        key: `distribute:${send.id}`,
        label: sends.length === 1 ? t('books.distribute.title') : t('books.distribute.forDepartment', { name: departmentName({ name_en: send.department_name_en, name_ar: send.department_name_ar }, i18n.language) }),
        icon: <Users className="h-4 w-4" aria-hidden />,
        onSelect: () => openOverlay ? openOverlay(`distribute:${send.id}`) : setDistribution({ bookId: book.id, sendId: send.id }),
      })),
      ...(canDerive ? [
        { key: 'reply', label: t('books.thread.reply'), icon: <Reply className="h-4 w-4 rtl:-scale-x-100" aria-hidden />, onSelect: () => openOverlay ? openOverlay('reply') : setSelection({ bookId: book.id, kind: 'reply' }) },
        { key: 'createFrom', label: t('books.thread.createFrom'), icon: <CopyPlus className="h-4 w-4" aria-hidden />, onSelect: () => openOverlay ? openOverlay('createFrom') : setSelection({ bookId: book.id, kind: 'based_on' }) },
      ] : []),
    ],
    dialog: !openOverlay ? <>
      {selectedSend && <DistributeDialog book={book} send={selectedSend} open onOpenChange={(open) => { if (!open) setDistribution(null) }} />}
      {canDerive && selection?.bookId === book.id && <DeriveRecordDialog book={book} kind={selection.kind} open onOpenChange={(open) => { if (!open) setSelection(null) }} />}
    </> : null,
  }
}
