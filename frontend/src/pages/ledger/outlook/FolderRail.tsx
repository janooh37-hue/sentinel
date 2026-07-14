/**
 * FolderRail — the left folder rail of the Ledger Outlook shell (Phase 4, Task 6).
 *
 * Matches the prototype's `.rail` (docs/prototypes/ledger-outlook-redesign.html):
 *   [collapse toggle] → [＋ New email] → [account header] → personal folders
 *   (Inbox badge · Drafts · Sent · Starred · Trash) → a divider where the future
 *   Smart-folders section will go.
 *
 * (The Correspondence-Log accordion + ⚙️ Rules stub were removed 2026-06-25 —
 * see docs/superpowers/specs/2026-06-25-ledger-fixes-and-smart-folders-design.md
 * §A. A single divider is kept below the personal folders so Phase 3's
 * Smart-folders section has its slot.)
 *
 * Collapse: the rail folds to a 60px icon-only strip (Outlook-style). Labels and
 * the email line hide; emoji centre and carry `title`/`aria-label` tooltips so
 * they stay identifiable. State persists in localStorage so it survives
 * navigation. Pinned LTR by the shell (`[data-ledger-chrome] dir=ltr`), so the
 * rail never mirrors in Arabic — width + logical utilities keep it on the start
 * (left) edge.
 *
 * The emoji are wayfinding aids per CLAUDE.md principle #1 — keep them. Rail
 * colours use the `--rail*` semantic tokens (Task 2), never hardcoded hex.
 */

import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft } from 'lucide-react'

import { api } from '@/lib/api'
import { useIdentity } from '@/lib/useIdentity'
import { cn } from '@/lib/utils'
import { PERSONAL_FOLDERS, type MailboxView, type PersonalFolder } from './mailboxTypes'
import { SmartFolders } from './SmartFolders'

/** localStorage key for the rail's collapsed state (persists across navigation). */
const RAIL_COLLAPSED_KEY = 'ledger.railCollapsed'

interface FolderRailProps {
  activeView: MailboxView
  onSelectView: (view: MailboxView) => void
  /** Called when the ＋ New email button is clicked (Phase 6). */
  onNewEmail?: () => void
  /** Phase 6 — admin "All mail" toggle state (shell-owned). */
  allMail?: boolean
  /** Phase 6 — callback when the admin toggles All mail. */
  onToggleAllMail?: (next: boolean) => void
  /** Phase 3 — open the "Review suggestions" sheet (shell-owned). */
  onReviewSuggestions?: () => void
  /** Phase 3 — pending smart-folder suggestion count (drives the ✨ pill). */
  suggestionCount?: number
}

export function FolderRail({ activeView, onSelectView, onNewEmail, allMail, onToggleAllMail, onReviewSuggestions, suggestionCount = 0 }: FolderRailProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const { identity, isAdmin } = useIdentity()
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(RAIL_COLLAPSED_KEY) === '1'
    } catch {
      return false
    }
  })

  const applyCollapsed = (next: boolean): void => {
    setCollapsed(next)
    try {
      localStorage.setItem(RAIL_COLLAPSED_KEY, next ? '1' : '0')
    } catch {
      /* storage unavailable (private mode) — in-memory state still works */
    }
  }

  const unread = useQuery({
    queryKey: ['ledger-unread-count'],
    queryFn: () => api.getLedgerUnreadCount(),
  })
  const unreadCount = unread.data?.count ?? 0

  // Phase 2 (D3b) — the current user's follow-up flag count drives the
  // 🚩 Follow-ups badge (shares its key with the NavBell flag count).
  const flagCount = useQuery({
    queryKey: ['ledger-flag-count'],
    queryFn: () => api.getLedgerFlagCount(),
  })
  const flaggedCount = flagCount.data?.count ?? 0

  const name =
    (i18n.language === 'ar' ? identity?.name_ar : identity?.name_en) ??
    identity?.name_en ??
    identity?.email ??
    ''

  return (
    <nav
      aria-label={t('ledger.title')}
      className={cn(
        'flex flex-none flex-col gap-0.5 overflow-y-auto overflow-x-hidden bg-rail p-2.5 text-rail-text',
        'transition-[width] duration-200 ease-[var(--ease-out-expo)] motion-reduce:transition-none',
        collapsed ? 'w-[60px]' : 'w-[236px]',
      )}
    >
      {/* Collapse / expand the folder pane (Outlook-style; state persists). */}
      <button
        type="button"
        onClick={() => applyCollapsed(!collapsed)}
        aria-expanded={!collapsed}
        aria-label={collapsed ? t('ledger.outlook.expandFolders') : t('ledger.outlook.collapseFolders')}
        title={collapsed ? t('ledger.outlook.expandFolders') : t('ledger.outlook.collapseFolders')}
        className={cn(
          'mb-1.5 flex items-center gap-2 rounded-md px-2 py-1.5 text-[0.7em] font-semibold uppercase tracking-[0.07em] text-rail-faint transition-colors hover:bg-rail-2 hover:text-rail-text',
          collapsed && 'justify-center px-0',
        )}
      >
        <ChevronLeft
          className={cn(
            'h-3.5 w-3.5 flex-none transition-transform duration-200 motion-reduce:transition-none',
            collapsed && 'rotate-180',
          )}
          aria-hidden
        />
        {!collapsed && <span>{t('ledger.outlook.collapseFolders')}</span>}
      </button>

      {/* ＋ New email — opens a new blank compose (Phase 6). */}
      <button
        type="button"
        onClick={() => onNewEmail?.()}
        aria-label={t('ledger.outlook.newEmail')}
        title={collapsed ? t('ledger.outlook.newEmail') : undefined}
        className={cn(
          'mb-2.5 flex w-full items-center gap-2.5 rounded-md bg-info px-2.5 py-2 text-start text-[0.82em] font-semibold text-white transition-colors hover:bg-info/90 active:translate-y-px',
          collapsed ? 'justify-center px-0' : 'justify-start',
        )}
      >
        <span
          className="grid h-[26px] w-[26px] flex-none place-items-center rounded-sm bg-white/20 text-[1.05em] font-bold leading-none"
          aria-hidden
        >
          ＋
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1 truncate text-start" dir="auto">
            {t('ledger.outlook.newEmail')}
          </span>
        )}
      </button>

      {/* Account header — the signed-in user (name + status dot + email). */}
      <div className={cn('flex items-center gap-2 px-2 py-0.5 text-[0.75em] text-rail-faint', collapsed && 'justify-center px-0')}>
        <span
          className="h-[7px] w-[7px] flex-none rounded-full bg-success ring-2 ring-success/20"
          aria-hidden
        />
        {!collapsed && (
          <b className="min-w-0 truncate font-semibold text-rail-text" dir="auto">
            {name}
          </b>
        )}
      </div>
      {!collapsed && identity?.email && (
        <div className="mb-2 truncate px-2 text-[0.7em] font-mono text-rail-faint" dir="ltr">
          {identity.email}
        </div>
      )}

      {/* Personal mailbox folders. */}
      {PERSONAL_FOLDERS.map((folder) => (
        <FolderButton
          key={folder.key}
          emoji={folder.emoji}
          label={t(`ledger.outlook.folders.${folder.i18nKey}`)}
          collapsed={collapsed}
          active={activeView.kind === 'folder' && activeView.folder === folder.key}
          badge={folder.key === 'inbox' && unreadCount > 0 ? unreadCount : undefined}
          onClick={() => onSelectView({ kind: 'folder', folder: folder.key as PersonalFolder })}
        />
      ))}

      {/* Phase 6 — "All mail" toggle: admin-only, visible only when expanded. */}
      {isAdmin && !collapsed && (
        <button
          type="button"
          role="switch"
          aria-checked={!!allMail}
          aria-label={t('ledger.outlook.allMail')}
          title={t('ledger.outlook.allMailHint')}
          onClick={() => onToggleAllMail?.(!allMail)}
          className={cn(
            'mt-1 flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-[0.78em] transition-colors',
            allMail ? 'bg-rail-3 font-semibold text-white' : 'text-rail-text hover:bg-rail-2',
          )}
        >
          <span className="flex items-center gap-2" dir="auto">
            <span className="w-[18px] flex-none text-center" aria-hidden>🏢</span>
            {t('ledger.outlook.allMail')}
          </span>
          <span
            aria-hidden
            className={cn(
              'relative h-4 w-7 flex-none rounded-full transition-colors',
              allMail ? 'bg-info' : 'bg-rail-2',
            )}
          >
            <span className={cn(
              'absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all',
              allMail ? 'start-3.5' : 'start-0.5',
            )} />
          </span>
        </button>
      )}

      {/* 🚩 Follow-ups — the current user's flagged entries (Phase 2, D3b). */}
      <FolderButton
        emoji="🚩"
        label={t('ledger.followups.title')}
        collapsed={collapsed}
        active={activeView.kind === 'followups'}
        badge={flaggedCount > 0 ? flaggedCount : undefined}
        onClick={() => onSelectView({ kind: 'followups' })}
      />

      {/* Divider before the ✨ Smart-folders section (Phase 3). */}
      <div className="mx-1 my-2.5 h-px bg-rail-line" />

      {/* ✨ Smart folders — per-user saved subject filters + the suggested pill. */}
      <SmartFolders
        activeView={activeView}
        onSelectView={onSelectView}
        collapsed={collapsed}
        onReviewSuggestions={() => onReviewSuggestions?.()}
        suggestionCount={suggestionCount}
      />
    </nav>
  )
}

interface FolderButtonProps {
  emoji: string
  label: string
  active: boolean
  badge?: number
  collapsed?: boolean
  onClick: () => void
}

function FolderButton({ emoji, label, active, badge, collapsed, onClick }: FolderButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={collapsed ? label : undefined}
      title={collapsed ? label : undefined}
      className={cn(
        'flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-start text-[0.82em] transition-colors',
        collapsed && 'justify-center px-0',
        active ? 'bg-rail-3 font-semibold text-white' : 'text-rail-text hover:bg-rail-2',
      )}
    >
      <span className="relative w-[18px] flex-none text-center text-[1em]" aria-hidden>
        {emoji}
        {collapsed && badge != null && (
          <span className="absolute -end-1 -top-1 h-2 w-2 rounded-full bg-info ring-2 ring-rail" />
        )}
      </span>
      {!collapsed && (
        <span className="flex-1 truncate" dir="auto">
          {label}
        </span>
      )}
      {!collapsed && badge != null && (
        <span className="flex-none rounded-full bg-info px-[7px] py-[3px] text-[0.68em] font-bold leading-none text-white">
          {badge}
        </span>
      )}
    </button>
  )
}

