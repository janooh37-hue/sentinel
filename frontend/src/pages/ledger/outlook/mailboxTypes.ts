/**
 * Mailbox-view model for the Ledger Outlook shell — the shell's active
 * selection, a small discriminated union, plus the personal-folder definitions
 * (key · emoji · i18n label key).
 *
 * Pure types/data only (no React, no side effects) so the folder→query mapping
 * in `mailboxQuery.ts` stays testable. The emoji are wayfinding aids per
 * CLAUDE.md principle #1 — keep them.
 */

/** The five personal mailbox folders in the rail. */
export type PersonalFolder = 'inbox' | 'drafts' | 'sent' | 'starred' | 'trash'

/**
 * The shell's active selection: either one of the personal folders, or a
 * Correspondence-Log category (`categoryId: null` = all log entries).
 */
export type MailboxView =
  | { kind: 'folder'; folder: PersonalFolder }
  | { kind: 'log'; categoryId: number | null }

/** Static metadata for a personal folder: emoji + the `ledger.outlook.*` i18n key. */
export interface PersonalFolderDef {
  key: PersonalFolder
  emoji: string
  /** i18n key under `ledger.outlook.folders` (e.g. 'inbox'). */
  i18nKey: string
}

/** Personal folders in rail order (Inbox first), with their wayfinding emoji. */
export const PERSONAL_FOLDERS: readonly PersonalFolderDef[] = [
  { key: 'inbox', emoji: '📥', i18nKey: 'inbox' },
  { key: 'drafts', emoji: '📝', i18nKey: 'drafts' },
  { key: 'sent', emoji: '📤', i18nKey: 'sent' },
  { key: 'starred', emoji: '⭐', i18nKey: 'starred' },
  { key: 'trash', emoji: '🗑️', i18nKey: 'trash' },
] as const

/** The default view when the Ledger opens. */
export const DEFAULT_MAILBOX_VIEW: MailboxView = { kind: 'folder', folder: 'inbox' }
