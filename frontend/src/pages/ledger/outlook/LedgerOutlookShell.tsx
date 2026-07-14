/**
 * LedgerOutlookShell — the 3-pane Outlook shell for the Ledger (Phase 4, Task 9).
 *
 * Composes the panes built in Tasks 5–8:
 *   [FolderRail] · [MessageList] · [ReadingPaneSlot]
 * and owns the shell state machine + per-view data wiring.
 *
 * STATE MACHINE
 *   - activeView: MailboxView      — default Inbox (rail's onSelectView).
 *   - tab: 'all' | 'unread'        — All/Unread tab on the list.
 *   - selectedId: number | null    — set by MessageList.onSelect; the reading
 *                                    pane consuming it is Phase 5 (for now a
 *                                    click just marks the row selected).
 *   - search: string               — FTS input; results bubble up to swap items.
 *
 * DATA WIRING (one list query off activeView):
 *   - personal folder → api.listLedger(mailboxToLedgerParams(view))  → ['ledger', params]
 * The resolved items + isLoading + tab + selectedId + view feed into MessageList.
 *
 * ── RTL EXCEPTION (Ledger-only) ──────────────────────────────────────────────
 * The chrome must NOT mirror in Arabic — folder rail stays LEFT, message list
 * MIDDLE, reading-pane area RIGHT, identical to LTR. We enforce this by pinning
 * the structural grid container to `dir="ltr"` (the `data-ledger-chrome`
 * wrapper below) so child order never flips, while each pane's TEXT re-flows to
 * Arabic (`dir="auto"` on the leaf nodes inside the panes). This is the one page
 * in the app that deliberately breaks app-wide RTL mirroring — Outlook
 * orientation is direction-independent. Do NOT "fix" this. See the prototype's
 * CSS note (docs/prototypes/ledger-outlook-redesign.html lines 474–538) and
 * CLAUDE.md's RTL note.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useLocation, useNavigate } from 'react-router-dom'
import { ArrowLeft, FolderOpen, Users } from 'lucide-react'

import { api } from '@/lib/api'
import type { LedgerEntryRead, LedgerListItem, LedgerSearchResponse } from '@/lib/api'
import { useIsMobile } from '@/lib/useIsMobile'
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { LedgerEmailCompose } from '../LedgerEmailCompose'
import { ContextPanel } from './ContextPanel'
import { useContextSource } from './useContextSource'
import { useSyncStatus } from './useSyncStatus'
import { FolderRail } from './FolderRail'
import { MessageList, type MessageListTab } from './MessageList'
import { ReadingPaneSlot } from './ReadingPaneSlot'
import { ComposeWindow } from './ComposeWindow'
import { SuggestionBanner } from './SuggestionBanner'
import { ReviewSuggestionsSheet } from './ReviewSuggestionsSheet'
import { CreateSmartFolderDialog } from './CreateSmartFolderDialog'
import type { SmartFolder, SmartFolderSuggestion } from '@/lib/api'
import { toast } from 'sonner'
import { useDeferredDelete, type PendingDelete } from './useDeferredDelete'
import {
  DEFAULT_MAILBOX_VIEW,
  type MailboxView,
} from './mailboxTypes'
import {
  applyQuickFilters,
  mailboxToLedgerParams,
  EMPTY_QUICK_FILTERS,
  type QuickFilters,
} from './mailboxQuery'

type NavigatePage =
  | 'employees'
  | 'books'
  | 'settings'
  | 'application'
  | 'leaves'
  | 'dashboard'
  | 'ledger'

interface LedgerOutlookShellProps {
  /** Smart-link navigation, passed down for Phase 5's reading pane. */
  onNavigate?: (page: NavigatePage, id?: string) => void
}

/** The compose overlay state. `source` is optional for `new`-mode composes. */
interface ComposeState {
  mode: 'new' | 'reply' | 'replyall' | 'forward' | 'draft-edit'
  source?: LedgerEntryRead
  /** When mode === 'draft-edit', the existing draft entry to resume. */
  draft?: LedgerEntryRead
  /** Optional prefill for `new`-mode composes (e.g. from Leaves batch confirm
   *  or the email basket). */
  prefill?: {
    to?: string[]
    cc?: string[]
    subject?: string
    bodyHtml?: string
    references?: import('@/components/ledger/ReferencePicker').ComposeReference[]
    attachRefPdf?: boolean
    basketKey?: string
  }
}

/**
 * Deferred-delete window. The Undo toast MUST stay visible for exactly this long:
 * the destructive commit fires at `delayMs`, so a shorter toast (sonner defaults
 * to 4s) would hide Undo while the delete is still cancelable. One constant feeds
 * both the hook's `delayMs` and the toast `duration` so they can't drift.
 */
const UNDO_DELAY_MS = 6000

export function LedgerOutlookShell({ onNavigate }: LedgerOutlookShellProps = {}): React.JSX.Element {
  const { t } = useTranslation()
  const isMobile = useIsMobile()
  const queryClient = useQueryClient()

  const location = useLocation()
  const navigate = useNavigate()

  const [activeView, setActiveView] = useState<MailboxView>(DEFAULT_MAILBOX_VIEW)
  const [tab, setTab] = useState<MessageListTab>('all')
  // Phase 2 (D1) — quick-filter chips (reset when the folder/view changes).
  const [filters, setFilters] = useState<QuickFilters>(EMPTY_QUICK_FILTERS)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [compose, setCompose] = useState<ComposeState | null>(null)
  const [search, setSearch] = useState('')
  const [searchResponse, setSearchResponse] = useState<LedgerSearchResponse | null>(null)
  const [searchPending, setSearchPending] = useState(false)
  // Phase 6: admin-only All-mail toggle. When true the list + search see the
  // whole-office mailbox (scope=all); non-admins always see their own mail.
  const [allMail, setAllMail] = useState(false)
  // Derive the scope string once; threaded into every email-read query and
  // search so FTS respects the same gate as the list.
  const scope: 'mine' | 'all' | undefined = allMail ? 'all' : undefined
  // Mobile: the folder rail lives behind a Sheet drawer (the 3-pane grid can't
  // fit a phone). Controlled so picking a folder/category closes the drawer.
  const [folderDrawerOpen, setFolderDrawerOpen] = useState(false)
  // Mobile: the context panel ("People in this email") is a Sheet behind a
  // per-mail "People (N)" header button — never a squeezed 4th column.
  const [peopleSheetOpen, setPeopleSheetOpen] = useState(false)
  // Phase 3 — smart-folder suggestion review sheet + create dialog state.
  const [reviewOpen, setReviewOpen] = useState(false)
  const [createSuggestion, setCreateSuggestion] = useState<SmartFolderSuggestion | null>(null)

  const isDrafts = activeView.kind === 'folder' && activeView.folder === 'drafts'
  const isSearching = search.trim().length > 0
  // Suggestions only need surfacing on a normal folder view (not inside a smart
  // folder, not mid-search). Fetched once; drives the rail pill + list banner.
  const smartSuggestions = useQuery({
    queryKey: ['ledger-smart-suggestions'],
    queryFn: () => api.getSmartFolderSuggestions(),
  })
  const suggestions = smartSuggestions.data ?? []
  const topSuggestion = suggestions[0] ?? null
  const showBanner =
    !isSearching && activeView.kind === 'folder' && topSuggestion != null

  // Resolve the open mail's people for the MOBILE "People (N)" button (the
  // desktop column owns its own copy of this hook — TanStack de-dupes the
  // underlying entry query). The button hides when no people resolve. We also
  // read the open entry's linked employee G-number to gate the "This employee"
  // quick filter (D1).
  const { peopleCount, entry: openEntry } = useContextSource(
    selectedId,
    selectedId == null ? null : 'mail',
  )
  const contextEmployeeId = openEntry?.related_employee_id ?? null

  // Personal-folder query → ['ledger', params, scope]. Disabled while an FTS
  // search is active (the search results replace the list). `scope` is threaded
  // so the admin All-mail toggle re-fetches from a fresh key. Quick filters (D1)
  // are layered on the view's base params so the open folder re-fetches scoped.
  const ledgerParams = applyQuickFilters(
    mailboxToLedgerParams(activeView),
    filters,
    contextEmployeeId,
  )
  const ledgerQuery = useQuery({
    queryKey: ['ledger', ledgerParams, scope],
    queryFn: () => api.listLedger({ ...ledgerParams, limit: 500, scope }),
    enabled: !isSearching,
  })

  // Sync status — polls /email/sync/status and auto-invalidates the ledger
  // queries when a sync (manual or scheduler) lands new mail. Mounted ONCE
  // here (the hook tracks last_synced_at per instance); the rail only gets
  // the status payload as a prop.
  const { status: syncStatus } = useSyncStatus()

  // FTS results take over the list when a search is active. The hit's `entry`
  // is a `LedgerEntryRead` plus a separate `snippet` — project it onto the
  // `LedgerListItem` shape the flat list renders.
  const searchItems: LedgerListItem[] = isSearching
    ? (searchResponse?.hits.map((h): LedgerListItem => {
        const e = h.entry
        return {
          id: e.id,
          entry_date: e.entry_date,
          direction: e.direction,
          channel: e.channel,
          counterparty: e.counterparty,
          subject: e.subject,
          tags: e.tags,
          attachment_count: e.attachment_paths?.length ?? 0,
          related_book_id: e.related_book_id,
          related_employee_id: e.related_employee_id,
          created_at: e.created_at,
          updated_at: e.updated_at,
          deleted_at: null,
          read_at: null,
          flagged: e.flagged,
          followup_due: e.followup_due,
          snippet: h.snippet,
        }
      }) ?? [])
    : []

  const mailItems: LedgerListItem[] = isSearching
    ? searchItems
    : (ledgerQuery.data?.items ?? [])

  const isLoading = isSearching ? searchPending : ledgerQuery.isPending

  const handleSelectView = useCallback((view: MailboxView) => {
    setActiveView(view)
    setSelectedId(null)
    // Quick filters are folder-scoped — reset them when the view changes so a
    // chip from Inbox doesn't silently narrow the next folder. The Follow-ups
    // view IS the flagged filter, so don't pre-set the chip there.
    setFilters(EMPTY_QUICK_FILTERS)
    // Picking a folder/category from the mobile drawer dismisses it so the
    // list comes back full-bleed. No-op on desktop (drawer stays closed).
    setFolderDrawerOpen(false)
  }, [])

  // Phase 3 — review → create flow. Opening the create dialog closes the sheet
  // so the modal isn't stacked under it.
  const handleCreateFromSuggestion = useCallback((s: SmartFolderSuggestion) => {
    setReviewOpen(false)
    setCreateSuggestion(s)
  }, [])
  // On create: jump straight into the new folder so the operator sees it work.
  const handleSmartFolderCreated = useCallback((folder: SmartFolder) => {
    setActiveView({ kind: 'smart', folderId: folder.id })
    setSelectedId(null)
    setFilters(EMPTY_QUICK_FILTERS)
  }, [])

  const handleSearchResults = useCallback(
    (response: LedgerSearchResponse | null, pending: boolean) => {
      setSearchResponse(response)
      setSearchPending(pending)
    },
    [],
  )

  // Selection kind drives the reading pane. Every row (folders + search hits,
  // which project LedgerEntryRead) is an email. (The open entry + peopleCount
  // are resolved above via useContextSource, near the list query.)
  const selectedKind: 'mail' | null = selectedId == null ? null : 'mail'

  // ONE compose window at a time (spec: keep the existing compose instead of
  // replacing it — replacing silently destroys an in-progress draft).
  // Guard directly on `compose` state; put it in deps so the closure is always
  // fresh (these are user-event callbacks, never batched render-phase calls).
  const openCompose = useCallback(
    (next: ComposeState) => {
      if (compose) {
        toast(
          t('ledger.outlook.composeBusy', {
            defaultValue: 'Finish or close your current draft first.',
          }),
        )
        return
      }
      setCompose(next)
      setFolderDrawerOpen(false)
    },
    [compose, t],
  )

  // Reply / Reply All / Forward open the compose over the pane.
  const handleReply = useCallback(
    (entry: LedgerEntryRead) => openCompose({ mode: 'reply', source: entry }),
    [openCompose],
  )
  // Reply All — pre-fills To from source.to_recipients and Cc from source.cc_recipients.
  const handleReplyAll = useCallback(
    (entry: LedgerEntryRead) => openCompose({ mode: 'replyall', source: entry }),
    [openCompose],
  )
  const handleForward = useCallback(
    (entry: LedgerEntryRead) => openCompose({ mode: 'forward', source: entry }),
    [openCompose],
  )
  // New email — opens a blank compose (no source entry). On mobile this is
  // triggered from the folder drawer; openCompose already closes the drawer.
  const handleNewEmail = useCallback(() => openCompose({ mode: 'new' }), [openCompose])

  // Consume a compose prefill from `location.state.composePrefill` once on
  // mount (or when the shell re-renders after a navigate-with-state from
  // another page, e.g. the Leaves batch-confirmation button). The ref guard
  // makes repeated renders harmless; `navigate` clears the state so Back/F5
  // don't re-open the compose window.
  const consumedPrefill = useRef(false)
  useEffect(() => {
    if (consumedPrefill.current) return
    const prefill = (
      location.state as { composePrefill?: ComposeState['prefill'] } | null
    )?.composePrefill
    if (!prefill) return
    consumedPrefill.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot navigation-state hydration (the BooksPage pattern)
    openCompose({ mode: 'new', prefill })
    navigate(location.pathname, { replace: true, state: null })
  }, [location, navigate, openCompose])

  // Deep-link the Follow-ups view from `location.state.ledgerView` (the bell's
  // Follow-ups row). One-shot, then clear the state so Back/F5 don't re-trigger.
  const consumedView = useRef(false)
  useEffect(() => {
    if (consumedView.current) return
    const view = (location.state as { ledgerView?: 'followups' } | null)?.ledgerView
    if (view !== 'followups') return
    consumedView.current = true
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-shot navigation-state hydration
    handleSelectView({ kind: 'followups' })
    navigate(location.pathname, { replace: true, state: null })
  }, [location, navigate, handleSelectView])

  // Resume a draft: the list rows are lightweight `LedgerListItem`s, so fetch the
  // full entry (subject + draft_meta to/cc + notes_html body) and open compose in
  // `draft-edit` mode — restoring the pre-Outlook click-to-edit behaviour the
  // shell redesign dropped. Routes through openCompose so clicking a draft row
  // while another compose is open shows the toast instead of clobbering.
  // NOTE: editDraftMut is defined AFTER openCompose (which depends on `compose`
  // state). The mutation's onSuccess is a stable closure that calls openCompose —
  // this is fine because mutations fire asynchronously (user event → network →
  // callback), so openCompose is always re-captured from the latest render.
  const editDraftMut = useMutation({
    mutationFn: (id: number) => api.getLedgerEntry(id),
    onSuccess: (draft) => openCompose({ mode: 'draft-edit', draft }),
    onError: () =>
      toast.error(
        t('ledger.outlook.draftOpenError', { defaultValue: "Couldn't open this draft" }),
      ),
  })

  // Row click: a draft (tag=draft) resumes editing in the compose window;
  // everything else opens read-only in the reading pane. Plain fn — `messageList`
  // is rebuilt every render anyway, so a stable identity buys nothing and a
  // useCallback dep on the per-render `mailItems` array would only churn.
  const handleSelectRow = (id: number): void => {
    const item = mailItems.find((m) => m.id === id)
    if (item?.tags.includes('draft')) {
      editDraftMut.mutate(id)
      return
    }
    setSelectedId(id)
  }

  // EmailBody gives us ('employees', G-number) or ('books', book-ref). Employees
  // route directly; books resolve ref→id first (coarse fallback on 404).
  const handleNavigate = useCallback(
    async (page: 'employees' | 'books', value?: string) => {
      if (page === 'books' && value) {
        try {
          const book = await api.getBookByRef(value)
          onNavigate?.('books', String(book.id))
        } catch {
          onNavigate?.('books')
        }
        return
      }
      onNavigate?.(page, value) // employees: value IS the employee id
    },
    [onNavigate],
  )

  // Context-panel "Open record" → the specific employee; "Generate" stays coarse.
  const handleContextNavigate = useCallback(
    (page: 'employees' | 'application', id?: string) => onNavigate?.(page, id),
    [onNavigate],
  )
  const handleContextEmail = useCallback(() => {
    // Phase-7 follow-on: pre-seed employee as a 👤 reference once
    // LedgerEmailCompose exposes an `initialRef` prop.
    openCompose({ mode: 'new' })
  }, [openCompose])

  const handleComposeSent = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['ledger'] })
    setCompose(null)
  }, [queryClient])

  // Closing compose may leave a freshly auto-saved (or edited) draft behind —
  // refresh so the Drafts list reflects it.
  const handleComposeClose = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['ledger'] })
    setCompose(null)
  }, [queryClient])

  const { pendingIds, scheduleDelete } = useDeferredDelete({
    delayMs: UNDO_DELAY_MS,
    onCommit: async (p: PendingDelete) => {
      try {
        if (p.kind === 'draft') await api.deleteDraft(p.id)
        else await api.deleteLedgerEntry(p.id)
      } finally {
        void queryClient.invalidateQueries({ queryKey: ['ledger'] })
      }
    },
    notify: ({ pending, onUndo }) => {
      toast(
        pending.kind === 'draft'
          ? t('ledger.outlook.draftDeleted', { defaultValue: 'Draft deleted' })
          : t('ledger.outlook.movedToTrash', { defaultValue: 'Moved to Trash' }),
        {
          duration: UNDO_DELAY_MS,
          action: { label: t('common.undo', { defaultValue: 'Undo' }), onClick: onUndo },
        },
      )
    },
  })

  const handleDelete = useCallback(
    (entry: { id: number }) => {
      scheduleDelete({ id: entry.id, kind: isDrafts ? 'draft' : 'entry' })
      // If the deleted entry is the one open in the pane, clear the selection.
      setSelectedId((cur) => (cur === entry.id ? null : cur))
    },
    [scheduleDelete, isDrafts],
  )

  // Bulk Trash (D4) — schedule each id through the same deferred-delete so every
  // entry gets its own Undo toast, identical to the per-row Trash.
  const handleBulkTrash = useCallback(
    (ids: number[]) => {
      ids.forEach((id) => scheduleDelete({ id, kind: isDrafts ? 'draft' : 'entry' }))
      setSelectedId((cur) => (cur != null && ids.includes(cur) ? null : cur))
    },
    [scheduleDelete, isDrafts],
  )

  // Hide optimistically-deleted rows from the list until the timer commits.
  const visibleMailItems = mailItems.filter((it) => !pendingIds.has(it.id))

  const messageList = (
    <MessageList
      view={activeView}
      items={visibleMailItems}
      isLoading={isLoading}
      tab={tab}
      onTabChange={setTab}
      selectedId={selectedId}
      onSelect={handleSelectRow}
      onDelete={handleDelete}
      search={search}
      onSearchChange={setSearch}
      onSearchResults={handleSearchResults}
      syncStatus={syncStatus}
      scope={scope}
      filters={filters}
      onFiltersChange={setFilters}
      employeeInContext={contextEmployeeId != null}
      onBulkTrash={handleBulkTrash}
      banner={
        showBanner && topSuggestion ? (
          <SuggestionBanner
            suggestion={topSuggestion}
            total={suggestions.length}
            onReview={() => setReviewOpen(true)}
          />
        ) : undefined
      }
    />
  )

  const readingPaneSlot = (
    <ReadingPaneSlot
      selectedId={selectedId}
      selectedKind={selectedKind}
      onReply={handleReply}
      onReplyAll={handleReplyAll}
      onForward={handleForward}
      onDelete={handleDelete}
      onNavigate={handleNavigate}
      onOpenEntry={setSelectedId}
    />
  )

  // Phase 3 — the review sheet + create dialog portal to body, so one instance
  // serves both desktop and mobile branches.
  const smartOverlays = (
    <>
      <ReviewSuggestionsSheet
        open={reviewOpen}
        onOpenChange={setReviewOpen}
        onCreate={handleCreateFromSuggestion}
      />
      <CreateSmartFolderDialog
        suggestion={createSuggestion}
        open={createSuggestion != null}
        onOpenChange={(o) => {
          if (!o) setCreateSuggestion(null)
        }}
        onCreated={handleSmartFolderCreated}
      />
    </>
  )

  // Desktop: a non-modal Outlook-style window docked bottom-right (the mailbox
  // behind stays clickable); the render-prop hands min/max/restore controls to
  // the compose surface. Mobile: full-screen page chrome (header + Back).
  const composeOverlay = compose && (
    <ComposeWindow fullScreen={isMobile}>
      {(win) => (
        <LedgerEmailCompose
          mode={compose.mode}
          source={compose.source}
          draft={compose.draft}
          prefill={compose.prefill}
          chrome={isMobile ? 'page' : 'window'}
          windowControls={win}
          onClose={handleComposeClose}
          onSent={handleComposeSent}
        />
      )}
    </ComposeWindow>
  )

  // ── Mobile (< md): list is full-bleed; the folder rail lives behind a Sheet
  // drawer opened from a "Folders" header button (the prior Ledger mobile
  // pattern — a dominant list, secondary nav behind a sheet). The reading-pane
  // slot is hidden (Phase 5 makes the selected row full-screen). ─────────────
  if (isMobile) {
    // ── Mobile full-screen pane: selecting a row covers the list with the
    // reading-pane / record view; a Back button clears the selection and
    // restores the list. (Phase 4 hid the slot on mobile; Phase 5 fills it.) ──
    if (selectedId != null) {
      return (
        // RTL-no-mirror still applies — pin the chrome `dir="ltr"`.
        <div data-ledger-chrome dir="ltr" className="relative flex flex-1 flex-col overflow-hidden bg-background">
          <div className="flex flex-none items-center gap-2 border-b border-border bg-surface px-3 py-2">
            <button
              type="button"
              onClick={() => {
                setSelectedId(null)
                setPeopleSheetOpen(false)
              }}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface-tinted px-3 py-1.5 text-[0.8em] font-medium text-foreground transition-colors hover:bg-border"
            >
              <ArrowLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.8} aria-hidden />
              {t('ledger.outlook.back')}
            </button>

            {/* People (N) — opens the context panel in a Sheet (no 4th column
                on mobile). Hidden when the open mail resolves no people. */}
            {peopleCount > 0 && (
              <Sheet open={peopleSheetOpen} onOpenChange={setPeopleSheetOpen}>
                <SheetTrigger
                  type="button"
                  className="ms-auto inline-flex items-center gap-1.5 rounded-full bg-surface-tinted px-3 py-1.5 text-[0.8em] font-medium text-foreground transition-colors hover:bg-border"
                >
                  <Users className="h-4 w-4" strokeWidth={1.8} aria-hidden />
                  {t('ledger.outlook.peopleSheet', { count: peopleCount })}
                </SheetTrigger>
                <SheetContent className="w-[320px] max-w-[88vw] bg-surface-raised p-0">
                  <SheetTitle className="sr-only">
                    {t('ledger.outlook.peopleIn', { count: peopleCount })}
                  </SheetTitle>
                  {/* Pin LTR so the panel stays Outlook-oriented; leaf text re-flows. */}
                  <div dir="ltr" className="flex h-full min-h-0">
                    <ContextPanel
                      selectedId={selectedId}
                      selectedKind={selectedKind}
                      onNavigate={handleContextNavigate}
                      onEmail={handleContextEmail}
                      variant="sheet"
                    />
                  </div>
                </SheetContent>
              </Sheet>
            )}
          </div>
          <div className="flex min-h-0 flex-1">{readingPaneSlot}</div>
          {composeOverlay}
          {smartOverlays}
        </div>
      )
    }

    return (
      // RTL-no-mirror still applies on mobile — pin the chrome `dir="ltr"`.
      // `relative` so a `new`-mode compose overlay (absolute inset-0) anchors
      // here even with no row selected.
      <div data-ledger-chrome dir="ltr" className="relative flex flex-1 flex-col overflow-hidden bg-background">
        <div className="flex flex-none items-center gap-2 border-b border-border bg-surface px-3 py-2">
          <Sheet open={folderDrawerOpen} onOpenChange={setFolderDrawerOpen}>
            <SheetTrigger
              type="button"
              aria-label={t('ledger.outlook.foldersTrigger')}
              className="inline-flex items-center gap-1.5 rounded-full bg-surface-tinted px-3 py-1.5 text-[0.8em] font-medium text-foreground transition-colors hover:bg-border"
            >
              <FolderOpen className="h-4 w-4" strokeWidth={1.8} aria-hidden />
              {t('ledger.outlook.foldersTrigger')}
            </SheetTrigger>
            <SheetContent className="w-[236px] p-0">
              <SheetTitle className="sr-only">{t('ledger.outlook.foldersTrigger')}</SheetTitle>
              {/* The rail re-flows its own colours; pin LTR so it stays Outlook-oriented. */}
              <div dir="ltr" className="flex h-full min-h-0">
                <FolderRail activeView={activeView} onSelectView={handleSelectView} onNewEmail={handleNewEmail} allMail={allMail} onToggleAllMail={setAllMail} onReviewSuggestions={() => setReviewOpen(true)} suggestionCount={suggestions.length} />
              </div>
            </SheetContent>
          </Sheet>
        </div>
        {messageList}
        {composeOverlay}
        {smartOverlays}
      </div>
    )
  }

  return (
    // RTL-no-mirror: structural chrome is pinned `dir="ltr"` so rail/list/pane
    // never flip in Arabic. Leaf text inside each pane re-flows via `dir="auto"`.
    // Ledger-only exception — see the file header + CLAUDE.md. Do not remove.
    <div
      data-ledger-chrome
      dir="ltr"
      className="relative grid flex-1 grid-cols-[auto_312px_1fr_auto] overflow-hidden bg-background"
    >
      {/* Folder rail (desktop middle column is the list, right is the slot). */}
      <div className="flex min-h-0">
        <FolderRail activeView={activeView} onSelectView={handleSelectView} onNewEmail={handleNewEmail} allMail={allMail} onToggleAllMail={setAllMail} onReviewSuggestions={() => setReviewOpen(true)} suggestionCount={suggestions.length} />
      </div>

      {/* Message list — the middle pane. */}
      {messageList}

      {/* Reading-pane slot — empty state or reading pane. */}
      <div className="flex min-h-0">{readingPaneSlot}</div>

      {/* Context panel — 4th column. The `auto` track lets the panel own its
          own width (312px expanded / 42px collapsed). It is the 4th child of
          the pinned `dir="ltr"` container, so it stays right-most in Arabic too
          — only its leaf text re-flows (RTL-no-mirror preserved). */}
      <ContextPanel
        selectedId={selectedId}
        selectedKind={selectedKind}
        onNavigate={handleContextNavigate}
        onEmail={handleContextEmail}
      />

      {/* Reply / Forward compose floats over the whole shell. */}
      {composeOverlay}

      {/* Smart-folder review sheet + create dialog (portal to body). */}
      {smartOverlays}
    </div>
  )
}
