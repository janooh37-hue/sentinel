/**
 * SelectionBar — bulk actions over a multi-row selection (Phase 2, D4).
 *
 * Matches the prototype's `.selbar`:
 *   [N selected]  ✓ Read · ✉ Unread · ⭐ Star · 🚩 Flag · 🗑 Trash   ✕
 *
 * Each action applies an existing per-entry mutation over the whole selection
 * set via a small sequential batch helper (`runBatch`) — there is no bulk
 * endpoint, and the sets are small (a screenful of rows). NO "Move to folder"
 * (smart folders are filters, not containers — spec §E). Esc / ✕ clears the
 * selection (Esc is wired by the parent list).
 *
 * Ledger CHROME — lives inside `[data-ledger-chrome] dir="ltr"`, must NOT mirror
 * in Arabic. Logical utilities only; emoji are wayfinding aids.
 */

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { CheckCheck, Flag, Mail, Star, Trash2, X } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import { cn } from '@/lib/utils'

interface SelectionBarProps {
  /** Selected entry ids. */
  ids: number[]
  onClear: () => void
  /** Soft-delete (Trash) — defers to the shell's existing deferred-delete so a
   * bulk trash gets the same Undo affordance per entry. */
  onTrash: (ids: number[]) => void
}

/** Run an async op over every id, swallowing per-item failures into a toast. */
async function runBatch(ids: number[], op: (id: number) => Promise<unknown>): Promise<void> {
  const results = await Promise.allSettled(ids.map((id) => op(id)))
  const failed = results.filter((r) => r.status === 'rejected')
  if (failed.length > 0) {
    const first = failed[0] as PromiseRejectedResult
    const reason = first.reason
    throw reason instanceof ApiError ? reason : new Error(String(reason))
  }
}

export function SelectionBar({ ids, onClear, onTrash }: SelectionBarProps): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['ledger'] })
    void qc.invalidateQueries({ queryKey: ['ledger-unread-count'] })
    void qc.invalidateQueries({ queryKey: ['ledger-flag-count'] })
  }

  const apply = async (op: (id: number) => Promise<unknown>): Promise<void> => {
    if (busy || ids.length === 0) return
    setBusy(true)
    try {
      await runBatch(ids, op)
      invalidate()
      onClear()
    } catch (err) {
      invalidate()
      toast.error(err instanceof ApiError ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      role="toolbar"
      aria-label={t('ledger.bulk.label')}
      className="flex items-center gap-1 border-b border-info/30 bg-info-soft px-3 py-2 text-info"
    >
      <span className="me-1 text-[0.78em] font-semibold" dir="auto">
        {t('ledger.bulk.selected', { count: ids.length })}
      </span>
      <Action
        icon={CheckCheck}
        label={t('ledger.bulk.read')}
        disabled={busy}
        onClick={() => void apply((id) => api.markLedgerEntryRead(id))}
      />
      <Action
        icon={Mail}
        label={t('ledger.bulk.unread')}
        disabled={busy}
        onClick={() => void apply((id) => api.markLedgerEntryUnread(id))}
      />
      <Action
        icon={Star}
        label={t('ledger.bulk.star')}
        disabled={busy}
        onClick={() => void apply((id) => api.toggleLedgerStar(id))}
      />
      <Action
        icon={Flag}
        label={t('ledger.bulk.flag')}
        disabled={busy}
        onClick={() => void apply((id) => api.flagLedgerEntry(id, null))}
      />
      <Action
        icon={Trash2}
        label={t('ledger.bulk.trash')}
        disabled={busy}
        onClick={() => {
          onTrash(ids)
          onClear()
        }}
      />
      <button
        type="button"
        onClick={onClear}
        aria-label={t('ledger.bulk.clear')}
        title={t('ledger.bulk.clear')}
        className="ms-auto inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-info/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <X className="h-4 w-4" strokeWidth={1.8} />
      </button>
    </div>
  )
}

interface ActionProps {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  label: string
  onClick: () => void
  disabled?: boolean
}

function Action({ icon: Icon, label, onClick, disabled }: ActionProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[0.78em] font-medium transition-colors',
        'hover:bg-info/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        'disabled:cursor-not-allowed disabled:opacity-50',
      )}
    >
      <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />
      <span dir="auto">{label}</span>
    </button>
  )
}
