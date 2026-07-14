/**
 * ReadingPaneSlot — the right pane of the Ledger Outlook shell.
 *
 * Branches on `selectedKind`:
 *   null → empty state (✉️ + heading + description + RotatingTip)
 *   'mail' → ReadingPane (email message view)
 *
 * The `selectedId` prop carries the id of the selected row; it is forwarded
 * to ReadingPane as `entryId`.
 *
 * (The Correspondence-Log `'log'` → LogRecordView branch was removed
 * 2026-06-25.)
 *
 * Prototype reference: `.read-empty` / `.empty-inner` / `.tipcard`
 *   (docs/prototypes/ledger-outlook-redesign.html lines 200–215).
 */

import { useTranslation } from 'react-i18next'

import type { LedgerEntryRead } from '@/lib/api'
import { RotatingTip } from './RotatingTip'
import { ReadingPane } from './ReadingPane'

/** Coarse page targets the shell's `onNavigate` seam understands. */
type NavPage = 'employees' | 'books'

interface ReadingPaneSlotProps {
  /** The id of the currently selected ledger entry/log record, or null when
   *  nothing is selected. */
  selectedId: number | null
  /**
   * The kind of the selected row:
   *   null  → show the empty state (the default when absent)
   *   'mail' → render ReadingPane
   */
  selectedKind?: 'mail' | null
  /** Reply/forward callbacks — passed through to ReadingPane (mail only). */
  onReply?: (entry: LedgerEntryRead) => void
  onReplyAll?: (entry: LedgerEntryRead) => void
  onForward?: (entry: LedgerEntryRead) => void
  /** Delete the open email — passed through to ReadingPane (mail only). */
  onDelete?: (entry: LedgerEntryRead) => void
  /** Smart-link navigation — passed through to ReadingPane. */
  onNavigate?: (page: NavPage, id?: string) => void
  /** Open a sibling thread entry — passed through to ReadingPane. */
  onOpenEntry?: (id: number) => void
}

export function ReadingPaneSlot({
  selectedId,
  selectedKind,
  onReply,
  onReplyAll,
  onForward,
  onDelete,
  onNavigate,
  onOpenEntry,
}: ReadingPaneSlotProps) {
  const { t } = useTranslation()

  // Branch: only render content when both selectedId and selectedKind are set.
  if (selectedId != null && selectedKind === 'mail') {
    return (
      <ReadingPane
        entryId={selectedId}
        onReply={onReply}
        onReplyAll={onReplyAll}
        onForward={onForward}
        onDelete={onDelete}
        onNavigate={onNavigate}
        onOpenEntry={onOpenEntry}
      />
    )
  }

  // Empty state — shown when selectedId is null, selectedKind is null/absent,
  // or the combination is indeterminate.
  return (
    <div
      className="flex-1 min-w-0 bg-[--surface] flex flex-col overflow-hidden"
      role="region"
      aria-label={t('ledger.outlook.empty.heading')}
    >
      <div className="flex-1 grid place-items-center text-[--text-faint] text-sm text-center p-10">
        <div className="flex flex-col items-center max-w-[380px]">
          {/* ✉️ big envelope glyph */}
          <span
            className="text-[34px] mb-3 opacity-85"
            aria-hidden
          >
            ✉️
          </span>

          {/* Heading */}
          <h2 className="text-base font-bold text-[--text-muted] m-0 tracking-tight">
            {t('ledger.outlook.empty.heading')}
          </h2>

          {/* Description */}
          <p className="text-[--text-faint] text-[0.8em] leading-relaxed mt-[9px] mb-0">
            {t('ledger.outlook.empty.desc')}
          </p>

          {/* Rotating tip card */}
          <RotatingTip className="mt-6" />
        </div>
      </div>
    </div>
  )
}
