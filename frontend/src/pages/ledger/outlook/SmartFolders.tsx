/**
 * SmartFolders — the ✨ Smart-folders rail section (Phase 3, E3).
 *
 * Mounts below the rail divider where the old Correspondence-Log accordion sat
 * (removed 2026-06-25). Renders the prototype's `.eyebrow-rail ✨ Smart folders`
 * heading, the current user's folders (`📂 name · count`, name by language),
 * and a quiet `✨ N suggested` pill that opens the review sheet. Each folder row
 * has a hover/focus ⋯ context action (rename / delete-with-confirm).
 *
 * Smart folders are per-user saved subject filters (no membership). Selecting a
 * folder sets the shell's `{kind:'smart'}` view.
 *
 * Ledger CHROME — lives inside `[data-ledger-chrome] dir="ltr"`, never mirrors
 * in Arabic. Logical utilities only; emoji are wayfinding aids (✨/📂).
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { api, ApiError, type SmartFolder } from '@/lib/api'
import { cn } from '@/lib/utils'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DEFAULT_MAILBOX_VIEW, type MailboxView } from './mailboxTypes'
import { RenameSmartFolderDialog } from './RenameSmartFolderDialog'

interface SmartFoldersProps {
  activeView: MailboxView
  onSelectView: (view: MailboxView) => void
  /** Collapsed rail — render icon-only, hide labels/section heading. */
  collapsed?: boolean
  /** Open the "Review suggestions" sheet (shell owns the sheet state). */
  onReviewSuggestions: () => void
  /** Count of pending suggestions (drives the ✨ N pill); 0 hides it. */
  suggestionCount: number
}

export function SmartFolders({
  activeView,
  onSelectView,
  collapsed,
  onReviewSuggestions,
  suggestionCount,
}: SmartFoldersProps): React.JSX.Element | null {
  const { t, i18n } = useTranslation()

  const folders = useQuery({
    queryKey: ['ledger-smart-folders'],
    queryFn: () => api.listSmartFolders(),
  })
  const list = folders.data ?? []

  // Nothing to show until there's at least one folder or a suggestion.
  if (list.length === 0 && suggestionCount === 0) return null

  const nameOf = (f: SmartFolder): string =>
    (i18n.language === 'ar' ? f.name_ar : f.name_en) || f.name_en || f.name_ar

  return (
    <div className="flex flex-col gap-0.5">
      {/* ✨ Smart folders eyebrow + suggested pill. Hidden when collapsed. */}
      {!collapsed && (
        <div className="mt-1 flex items-center gap-2 px-2 py-1 text-[0.62em] font-semibold uppercase tracking-[0.07em] text-rail-faint">
          <span className="flex items-center gap-1.5" dir="auto">
            <span aria-hidden>✨</span>
            {t('ledger.smart.section')}
          </span>
          {suggestionCount > 0 && (
            <button
              type="button"
              onClick={onReviewSuggestions}
              className="ms-auto rounded-full bg-smart-soft px-2 py-0.5 text-[0.92em] font-semibold normal-case tracking-normal text-smart transition-colors hover:brightness-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              title={t('ledger.smart.reviewTitle')}
            >
              ✨ {t('ledger.smart.suggestedPill', { count: suggestionCount })}
            </button>
          )}
        </div>
      )}

      {/* Collapsed: a single ✨ pill button stands in for the section. */}
      {collapsed && suggestionCount > 0 && (
        <button
          type="button"
          onClick={onReviewSuggestions}
          aria-label={t('ledger.smart.suggestedPill', { count: suggestionCount })}
          title={t('ledger.smart.suggestedPill', { count: suggestionCount })}
          className="relative mx-auto my-1 grid h-7 w-7 place-items-center rounded-md text-rail-text transition-colors hover:bg-rail-2"
        >
          <span aria-hidden>✨</span>
          <span className="absolute -end-0.5 -top-0.5 h-2 w-2 rounded-full bg-smart ring-2 ring-rail" />
        </button>
      )}

      {list.map((folder) => (
        <SmartFolderRow
          key={folder.id}
          folder={folder}
          name={nameOf(folder)}
          active={activeView.kind === 'smart' && activeView.folderId === folder.id}
          collapsed={collapsed}
          onSelect={() => onSelectView({ kind: 'smart', folderId: folder.id })}
          onDeleted={() => onSelectView(DEFAULT_MAILBOX_VIEW)}
        />
      ))}
    </div>
  )
}

interface SmartFolderRowProps {
  folder: SmartFolder
  name: string
  active: boolean
  collapsed?: boolean
  onSelect: () => void
  /** Called after this folder is deleted while it was the active view, so the
   *  shell can reset off the now-dead smart view (back to Inbox). */
  onDeleted: () => void
}

function SmartFolderRow({
  folder,
  name,
  active,
  collapsed,
  onSelect,
  onDeleted,
}: SmartFolderRowProps): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [renaming, setRenaming] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  const deleteMut = useMutation({
    mutationFn: () => api.deleteSmartFolder(folder.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ledger-smart-folders'] })
      void qc.invalidateQueries({ queryKey: ['ledger-smart-suggestions'] })
      // If we deleted the folder we were viewing, leave the now-dead smart view.
      if (active) onDeleted()
      toast(t('ledger.smart.deleted'))
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  return (
    <div className="group/row relative">
      <button
        type="button"
        onClick={onSelect}
        aria-label={collapsed ? name : undefined}
        title={collapsed ? name : undefined}
        className={cn(
          'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-start text-[0.82em] transition-colors',
          collapsed && 'justify-center px-0',
          active ? 'bg-rail-3 font-semibold text-white' : 'text-rail-text hover:bg-rail-2',
        )}
      >
        <span className="w-[18px] flex-none text-center text-[1em]" aria-hidden>
          📂
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1 truncate" dir="auto">
            {name}
          </span>
        )}
        {!collapsed && (
          <span className="flex-none text-[0.82em] font-mono text-rail-faint group-hover/row:opacity-0">
            {folder.count}
          </span>
        )}
      </button>

      {/* Hover/focus ⋯ context action (rename / delete). Hidden when collapsed. */}
      {!collapsed && (
        <DropdownMenu>
          <DropdownMenuTrigger
            aria-label={t('ledger.smart.rowActions', { name })}
            className="absolute end-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-rail-faint opacity-0 transition-opacity hover:bg-rail-2 hover:text-rail-text focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring group-hover/row:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.8} aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setRenaming(true)}>
              <Pencil className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
              <span dir="auto">{t('ledger.smart.rename')}</span>
            </DropdownMenuItem>
            <DropdownMenuItem variant="danger" onSelect={() => setConfirmingDelete(true)}>
              <Trash2 className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
              <span dir="auto">{t('ledger.smart.delete')}</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      <RenameSmartFolderDialog folder={folder} open={renaming} onOpenChange={setRenaming} />

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t('ledger.smart.deleteTitle')}
        description={t('ledger.smart.deleteBody', { name })}
        confirmLabel={t('ledger.smart.delete')}
        destructive
        onConfirm={() => deleteMut.mutate()}
      />
    </div>
  )
}
