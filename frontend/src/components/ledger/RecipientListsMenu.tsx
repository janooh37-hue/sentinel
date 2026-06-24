/**
 * RecipientListsMenu — compact "Lists ▾" dropdown for the compose To row.
 * Replaces the always-visible RecipientListsBar: saved per-user distribution
 * lists apply on click (merge into To/Cc); "Save current…" snapshots the
 * draft's recipients into a new list; "Manage lists…" opens the builder.
 * Nothing renders until the trigger is clicked (no auto-popup).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, Users } from 'lucide-react'

import { api } from '@/lib/api'
import type { RecipientListMember } from '@/lib/api'
import { applyListToFields, summarizeMembers } from '@/lib/recipientLists'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { RecipientListDialog } from './RecipientListDialog'

export interface RecipientListsMenuProps {
  /** Current To/Cc — for "Save current" + dedupe on apply. */
  current: { to: string[]; cc: string[] }
  /** Apply merged To/Cc back into the form. */
  onApply: (next: { to: string[]; cc: string[] }) => void
}

export function RecipientListsMenu({ current, onApply }: RecipientListsMenuProps): React.JSX.Element {
  const { t } = useTranslation()
  const [dialogOpen, setDialogOpen] = useState(false)
  const [initialDraft, setInitialDraft] =
    useState<{ name: string; members: RecipientListMember[] } | null>(null)

  const listsQuery = useQuery({
    queryKey: ['ledger-recipient-lists'],
    queryFn: () => api.listRecipientLists(),
    staleTime: 60_000,
  })
  const lists = listsQuery.data ?? []

  const contactsQuery = useQuery({
    queryKey: ['ledger-contacts'],
    queryFn: () => api.listLedgerContacts(),
    staleTime: 60_000,
  })
  const contactAddresses = (contactsQuery.data ?? []).map((c) => c.address)
  const canSaveCurrent = current.to.length > 0 || current.cc.length > 0

  function saveCurrent(): void {
    const members: RecipientListMember[] = [
      ...current.to.map((a) => ({ field: 'to' as const, address: a, display_name: '' })),
      ...current.cc.map((a) => ({ field: 'cc' as const, address: a, display_name: '' })),
    ]
    setInitialDraft({ name: '', members })
    setDialogOpen(true)
  }

  function openManage(): void {
    setInitialDraft(null)
    setDialogOpen(true)
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={t('ledger.lists.label', { defaultValue: 'Lists' })}
          className="inline-flex items-center gap-1 rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-semibold text-primary-on-soft transition-colors hover:bg-primary-soft/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Users className="h-3 w-3" strokeWidth={1.8} aria-hidden />
          <span>{t('ledger.lists.label', { defaultValue: 'Lists' })}</span>
          <ChevronDown className="h-3 w-3" strokeWidth={2} aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {!listsQuery.isPending && lists.length === 0 && (
            <div className="px-2 py-1.5 text-xs text-muted-foreground">
              {t('ledger.lists.empty', { defaultValue: 'No saved lists yet' })}
            </div>
          )}
          {lists.map((l) => {
            const c = summarizeMembers(l.members)
            return (
              <DropdownMenuItem
                key={l.id}
                onSelect={() => onApply(applyListToFields(current.to, current.cc, l.members))}
                className="gap-2"
              >
                <span aria-hidden>👥</span>
                <span dir="auto" className="min-w-0 truncate">{l.name}</span>
                <span className="ms-auto text-[0.7em] text-muted-foreground">
                  {t('ledger.lists.applyTitle', {
                    defaultValue: 'To: {{to}} · Cc: {{cc}}',
                    to: c.to,
                    cc: c.cc,
                  })}
                </span>
              </DropdownMenuItem>
            )
          })}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            disabled={!canSaveCurrent}
            onSelect={saveCurrent}
          >
            {t('ledger.lists.saveCurrent', { defaultValue: 'Save current' })}…
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={openManage}>
            {t('ledger.lists.manage', { defaultValue: 'Manage lists' })}…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <RecipientListDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        initialDraft={initialDraft}
        contactAddresses={contactAddresses}
      />
    </>
  )
}
