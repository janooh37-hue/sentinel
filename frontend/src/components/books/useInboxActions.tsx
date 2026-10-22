import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Archive, ArchiveRestore, CheckCheck, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage } from '@/lib/api'
import type { BookInboxRead, BookRead } from '@/lib/api'

export interface InboxAction {
  key: string
  label: string
  icon: React.ReactNode
  onSelect: () => void
  pending: boolean
}

type Action = 'done' | 'undoDone' | 'archive' | 'unarchive'

const methods = {
  done: api.markBookInboxDone,
  undoDone: api.undoBookInboxDone,
  archive: api.archiveBookInbox,
  unarchive: api.unarchiveBookInbox,
}

/** Recipient tools shared by the record strip and desktop/mobile menus. */
export function useInboxActions(
  book: BookRead | null | undefined,
  onUpdated?: (id: number, inbox: BookInboxRead) => void,
): InboxAction[] {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: number; action: Action }) => methods[action](id),
    onSuccess: (inbox, { id, action }) => {
      onUpdated?.(id, inbox)
      // Detail, lists, recipient rows and inbox summary all live under this key.
      void qc.invalidateQueries({ queryKey: ['books'] })
      void qc.invalidateQueries({ queryKey: ['notifications', 'counts'] })
      toast.success(t(`books.inbox.toast.${action}`))
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  if (!book?.my_inbox) return []
  const done = Boolean(book.my_inbox.done_at)
  const archived = Boolean(book.my_inbox.archived_at)
  const action = (key: Action, icon: React.ReactNode): InboxAction => ({
    key,
    label: t(`books.inbox.${key}`),
    icon,
    pending: mutation.isPending,
    onSelect: () => {
      if (!mutation.isPending) mutation.mutate({ id: book.id, action: key })
    },
  })
  return [
    action(done ? 'undoDone' : 'done', done
      ? <Undo2 className="h-3.5 w-3.5 rtl:-scale-x-100" aria-hidden />
      : <CheckCheck className="h-3.5 w-3.5" aria-hidden />),
    action(archived ? 'unarchive' : 'archive', archived
      ? <ArchiveRestore className="h-3.5 w-3.5" aria-hidden />
      : <Archive className="h-3.5 w-3.5" aria-hidden />),
  ]
}
