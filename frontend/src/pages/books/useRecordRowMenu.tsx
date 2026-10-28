/**
 * Records page — the row menu's items and the dialogs they open. The page owns
 * this hook so Send / Change level outlive the closed menu (and its row).
 */
import { useState } from 'react'
import { Copy, Download, ExternalLink, Lock, Printer, Send, SquareArrowOutUpRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/lib/toast'

import { api } from '@/lib/api'
import type { BookRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { copyToClipboard } from '@/lib/clipboard'
import { cn } from '@/lib/utils'
import { ChangeGradeDialog } from '@/components/books/ChangeGradeDialog'
import { SendRecordDialog } from '@/components/books/SendRecordDialog'
import { useReplyActions } from '@/components/books/useReplyActions'
import { useInboxActions } from '@/components/books/useInboxActions'
import type { RowMenuItem } from './RecordRowMenu'
import { defaultPaperKey, downloadPaper, paperKey, papersOf } from './recordPapers'

const icon = 'h-3.5 w-3.5'

/** Row-menu items for a record plus the dialogs they open (render `dialogs` once on the page). */
export function useRecordRowMenu({
  open,
  isInmateReporter,
  extraItems,
}: {
  open: (id: number) => void
  isInmateReporter: boolean
  /** Other features' items (Reply, Create from, Mark done, Archive …), appended last. */
  extraItems?: (book: BookRead) => RowMenuItem[]
}): {
  itemsFor: (book: BookRead) => RowMenuItem[]
  dialogs: React.ReactNode
  /** The row whose menu opened last (kept after it closes, so dialogs it started stay bound). */
  target: BookRead | null
  onMenuOpen: (book: BookRead) => void
} {
  const { t } = useTranslation()
  const userId = useAuth().user?.id
  const navigate = useNavigate()
  const [dialog, setDialog] = useState<{ kind: 'send' | 'level'; book: BookRead } | null>(null)
  const [menuBook, setMenuBook] = useState<BookRead | null>(null)
  const detail = useQuery({
    queryKey: ['books', 'detail-peek', menuBook?.id],
    queryFn: () => api.getBook(menuBook!.id, undefined, { markRead: false }),
    enabled: menuBook !== null,
  })
  const target = detail.isError ? null : detail.data ?? menuBook
  const reply = useReplyActions(target)
  const inbox = useInboxActions(target)

  const itemsFor = (row: BookRead): RowMenuItem[] => {
    if (row.metadata_only) return []
    if (menuBook?.id === row.id && detail.isError) return []
    const book = target?.id === row.id ? target : row
    const papers = papersOf(book, { inmateReporter: isInmateReporter })
    const mainKey = defaultPaperKey(book, papers)
    const pdf = papers.find((p) => paperKey(p) === mainKey && p.isPdf) ?? papers.find((p) => p.isPdf)
    const items: (RowMenuItem | false)[] = [
      {
        key: 'open',
        label: t('books.pane.openRecord'),
        icon: <ExternalLink className={cn(icon, 'rtl:-scale-x-100')} aria-hidden />,
        onSelect: () => open(book.id),
      },
      {
        key: 'openNewTab',
        label: t('books.list.openNewTab'),
        icon: <SquareArrowOutUpRight className={cn(icon, 'rtl:-scale-x-100')} aria-hidden />,
        onSelect: () => window.open(`/books/${book.id}`, '_blank', 'noopener'),
      },
      book.can_send === true && ((book.grade !== 'top_secret' && book.grade !== 'addressee_only') || (userId !== undefined && book.created_by_user_id === userId)) && {
        key: 'send',
        label: t('books.send.menu'),
        icon: <Send className={icon} aria-hidden />,
        onSelect: () => setDialog({ kind: 'send', book }),
      },
      book.can_change_grade === true && {
        key: 'level',
        label: t('books.grade.menu'),
        icon: <Lock className={icon} aria-hidden />,
        onSelect: () => setDialog({ kind: 'level', book }),
      },
      pdf !== undefined && {
        key: 'downloadPdf',
        label: t('books.list.downloadPdf'),
        icon: <Download className={icon} aria-hidden />,
        onSelect: () => downloadPaper(pdf),
      },
      pdf !== undefined && {
        key: 'print',
        label: t('books.record.print'),
        icon: <Printer className={icon} aria-hidden />,
        onSelect: () => {
          // Reuse the record's paint-all-pages print mode, never print the list.
          const url = `/books/${book.id}?print=1&paper=${paperKey(pdf)}`
          const opened = window.open(url, '_blank')
          if (opened) opened.opener = null
          else navigate(url)
        },
      },
      {
        key: 'copyRef',
        label: t('books.record.copyRef'),
        icon: <Copy className={icon} aria-hidden />,
        onSelect: () => {
          void copyToClipboard(book.ref_number).then((ok) => {
            if (ok) toast.success(t('books.record.copiedRef'), { reference: book.ref_number })
            else toast.error(t('common.copyFailed'))
          })
        },
      },
      ...(target?.id === row.id ? [...reply.actions, ...inbox] : []),
      ...(extraItems?.(book) ?? []),
    ]
    return items.filter((item): item is RowMenuItem => item !== false)
  }

  const close = (o: boolean): void => {
    if (!o) setDialog(null)
  }
  const dialogs = (
    <>
      {reply.dialog}
      {dialog && (
        <>
          <SendRecordDialog book={dialog.book} open={dialog.kind === 'send'} onOpenChange={close} />
          <ChangeGradeDialog book={dialog.book} open={dialog.kind === 'level' && dialog.book.can_change_grade} onOpenChange={close} />
        </>
      )}
    </>
  )
  return { itemsFor, dialogs, target, onMenuOpen: setMenuBook }
}
