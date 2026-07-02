/**
 * RecipientChips — the reading pane's To / Cc (/ Bcc) recipient block.
 *
 * Renders EVERY recipient as a `.rc` chip — no "+N more" truncation, the full
 * list as sent. Each chip carries a save-to-address-book dot: ＋ when the
 * address isn't yet in the user's address book, ★ (`.rc.saved`) when it is.
 * Clicking ＋ calls `addLedgerContact`, optimistically flips the chip to ★, and
 * invalidates the contacts query so the truth re-settles from the server.
 *
 * Bcc only renders when present (i.e. sent mail). Clicking the chip BODY to
 * start a new mail is Phase 6 — the chip body is inert here.
 */

import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage } from '@/lib/api'
import type { LedgerAddress, LedgerEntryRead } from '@/lib/api'

const CONTACTS_KEY = ['ledger-contacts'] as const

interface RecipientChipsProps {
  entry: LedgerEntryRead
}

export function RecipientChips({
  entry,
}: RecipientChipsProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const qc = useQueryClient()

  // Addresses the user added in this session before the query re-settles —
  // keeps the ★ flip instant even though the contacts list refetches.
  const [optimistic, setOptimistic] = useState<Set<string>>(new Set())

  const contactsQuery = useQuery({
    queryKey: CONTACTS_KEY,
    queryFn: () => api.listLedgerContacts(),
    staleTime: 60_000,
  })

  const savedAddresses = new Set(
    (contactsQuery.data ?? []).map((c) => c.address.toLowerCase()),
  )

  const addMutation = useMutation({
    mutationFn: (body: { display_name: string; address: string }) =>
      api.addLedgerContact(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: CONTACTS_KEY })
    },
    onError: (err, body) => {
      // Roll back the optimistic flip on failure.
      setOptimistic((prev) => {
        const next = new Set(prev)
        next.delete(body.address.toLowerCase())
        return next
      })
      toast.error(apiErrorMessage(err))
    },
  })

  function isSaved(address: string): boolean {
    const key = address.toLowerCase()
    return savedAddresses.has(key) || optimistic.has(key)
  }

  function handleSave(addr: LedgerAddress): void {
    if (isSaved(addr.address)) return
    setOptimistic((prev) => new Set(prev).add(addr.address.toLowerCase()))
    addMutation.mutate({
      display_name: addr.name || addr.address,
      address: addr.address,
    })
  }

  const to = entry.to_recipients ?? []
  const cc = entry.cc_recipients ?? []
  const bcc = entry.bcc_recipients ?? []

  // Nothing to show (e.g. non-email channels) → render nothing.
  if (to.length === 0 && cc.length === 0 && bcc.length === 0) return null

  function renderLine(
    label: string,
    list: LedgerAddress[],
  ): React.JSX.Element | null {
    if (list.length === 0) return null
    return (
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="w-6 flex-none text-end text-[11px] font-semibold text-muted-foreground">
          {label}
        </span>
        <div className="flex flex-1 flex-wrap gap-1.5">
          {list.map((r, i) => {
            const saved = isSaved(r.address)
            return (
              <span
                key={`${r.address}-${i}`}
                className={
                  saved
                    ? 'inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success-soft py-0.5 pe-1 ps-2.5 text-[11.5px] text-success'
                    : 'inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-tinted py-0.5 pe-1 ps-2.5 text-[11.5px] text-muted-foreground transition-colors hover:bg-surface'
                }
              >
                <span dir="auto">{r.name || r.address}</span>
                <button
                  type="button"
                  title={addr_title(saved)}
                  aria-label={r.address}
                  onClick={() => handleSave(r)}
                  className={
                    saved
                      ? 'grid h-[17px] w-[17px] flex-none place-items-center rounded-full text-[11px] leading-none text-success'
                      : 'grid h-[17px] w-[17px] flex-none place-items-center rounded-full text-[11px] leading-none text-muted-foreground transition-colors hover:bg-info-soft hover:text-info'
                  }
                >
                  {saved ? '★' : '＋'}
                </button>
              </span>
            )
          })}
        </div>
      </div>
    )
  }

  function addr_title(saved: boolean): string {
    return saved ? t('ledger.outlook.savedContact') : t('ledger.outlook.saveContact')
  }

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      {renderLine(t('ledger.outlook.recipients.to'), to)}
      {renderLine(t('ledger.outlook.recipients.cc'), cc)}
      {renderLine(t('ledger.outlook.recipients.bcc'), bcc)}
    </div>
  )
}
