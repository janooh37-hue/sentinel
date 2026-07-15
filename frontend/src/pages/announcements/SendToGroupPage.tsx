/**
 * SendToGroupPage — broadcast a message or attachment to one or more
 * WhatsApp groups via the OpenWA gateway.
 *
 * Capability-gated: messages.broadcast (enforced at the route level in App.tsx
 * via RequireCapability; also gates the nav item).
 *
 * Bilingual (AR/EN) via useTranslation(); logical CSS (ms-/me-, text-start);
 * dir="auto" on free-text inputs and the textarea.
 */

import { useRef, useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { AlertTriangle, MessageCircle, QrCode, Unlink } from 'lucide-react'

import { api, type AnnouncementOut, type GroupSendOut } from '@/lib/api'
import { useCapabilities } from '@/lib/useCapabilities'
import { useGatewayStatus, type GatewayState } from '@/lib/useGatewayStatus'
import { GatewayConnectDialog } from './GatewayConnectDialog'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { RecordAnnouncePicker, type PickedBook } from './RecordAnnouncePicker'
import { EmployeeMentionField } from './EmployeeMentionField'
import { PhonePreview, WebChatWindow, type PreviewAttachment } from './MessagePreview'
import { applyMentions, type MentionTarget } from './mention'

type AttachMode = 'none' | 'book' | 'upload'

export function SendToGroupPage(): React.JSX.Element {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const isAdmin = has('settings.edit')

  // QR connect dialog (admin only)
  const [qrOpen, setQrOpen] = useState(false)

  // Unlink confirm dialog + mutation (admin only)
  const qc = useQueryClient()
  const [unlinkOpen, setUnlinkOpen] = useState(false)
  const unlinkMut = useMutation({
    mutationFn: api.unlinkGateway,
    onSuccess: (res) => {
      if (res.ok) {
        toast.success(t('sendToGroup.unlinked'))
        void qc.invalidateQueries({ queryKey: ['gateway-status'] })
        void qc.invalidateQueries({ queryKey: ['announce-groups'] })
        setQrOpen(true) // switch-numbers flow: unlink → scan new QR
      } else {
        toast.error(t('sendToGroup.unlinkFailed'))
      }
    },
    onError: () => toast.error(t('sendToGroup.unlinkFailed')),
  })

  // Gateway status query — shared hook (staleTime 30s, capability-gated)
  const { data: gatewayData, isLoading: gatewayLoading } = useGatewayStatus()
  const gatewayState = (gatewayData?.state ?? 'disconnected') as GatewayState
  const isConnected = !gatewayLoading && gatewayState === 'connected'

  // Composer view: Normal (side phone preview) vs Extended (WA-Web surface)
  const [view, setView] = useState<'normal' | 'extended'>('normal')

  // Group selection + client-side search filter
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [groupQuery, setGroupQuery] = useState('')

  // Message + collected @mention targets
  const [message, setMessage] = useState('')
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const [mentions, setMentions] = useState<MentionTarget[]>([])

  // Attachment
  const [attachMode, setAttachMode] = useState<AttachMode>('none')
  const [bookId, setBookId] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [hasFile, setHasFile] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickedBook, setPickedBook] = useState<PickedBook | null>(null)

  // Result
  const [result, setResult] = useState<AnnouncementOut | null>(null)

  // Load groups — only meaningful when connected; we still fire the query so
  // error state is available if needed.
  const {
    data: groups,
    isLoading: groupsLoading,
    isError: groupsError,
  } = useQuery({
    queryKey: ['announce-groups'],
    queryFn: api.listGroups,
  })

  // Show blocked banner when gateway isn't connected OR groups query errored
  const showBanner = (!gatewayLoading && gatewayState !== 'connected') || groupsError

  // Derived: is submit enabled?
  const hasGroup = selectedIds.size > 0
  const hasContent =
    message.trim().length > 0 ||
    (attachMode === 'book' && bookId.trim().length > 0) ||
    (attachMode === 'upload' && hasFile)
  const canSubmit = isConnected && hasGroup && hasContent

  const sendMut = useMutation({
    onMutate: () => setResult(null),
    mutationFn: () => {
      const form = new FormData()
      for (const id of selectedIds) {
        form.append('group_ids', id)
      }
      const applied = applyMentions(message.trim(), mentions)
      if (applied.text) {
        form.append('text', applied.text)
      }
      for (const n of applied.numbers) {
        form.append('mentions', n)
      }
      if (attachMode === 'book' && bookId.trim()) {
        form.append('book_id', bookId.trim())
      }
      if (attachMode === 'upload' && fileRef.current?.files?.[0]) {
        form.append('file', fileRef.current.files[0])
      }
      return api.sendAnnouncement(form)
    },
    onSuccess: (data) => {
      setResult(data)
    },
    onError: () => {
      toast.error(t('sendToGroup.sendError'))
    },
  })

  function toggleGroup(id: string): void {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  // Client-side, case-insensitive filter on group name.
  const filteredGroups = (groups ?? []).filter((g) =>
    g.name.toLowerCase().includes(groupQuery.trim().toLowerCase()),
  )
  const allFilteredSelected =
    filteredGroups.length > 0 && filteredGroups.every((g) => selectedIds.has(g.id))

  function toggleSelectAll(): void {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (allFilteredSelected) {
        for (const g of filteredGroups) next.delete(g.id)
      } else {
        for (const g of filteredGroups) next.add(g.id)
      }
      return next
    })
  }

  const insertMention = useCallback((text: string, mention?: MentionTarget): void => {
    const el = messageRef.current
    setMessage((prev) => {
      if (!el) return prev ? `${prev} ${text}` : text
      const start = el.selectionStart ?? prev.length
      const end = el.selectionEnd ?? prev.length
      return prev.slice(0, start) + text + prev.slice(end)
    })
    if (mention) {
      // Dedupe by display name: "@Name" tokens are name-keyed, so two employees
      // sharing one localized display name would collide — first insert wins.
      setMentions((prev) =>
        prev.some((m) => m.name === mention.name) ? prev : [...prev, mention],
      )
    }
  }, [])

  // Mentions whose "@Name" token still appears in the message drive the preview.
  const activeMentionNames = mentions
    .filter((m) => message.includes(`@${m.name}`))
    .map((m) => m.name)

  const previewAttachment: PreviewAttachment | null =
    attachMode === 'book' && pickedBook
      ? { title: pickedBook.ref, subtitle: pickedBook.subject }
      : attachMode === 'upload' && hasFile
        ? { title: fileName ?? 'file' }
        : null

  const firstGroupName = (groups ?? []).find((g) => selectedIds.has(g.id))?.name ?? null

  const handleFileChange = useCallback(() => {
    const f = fileRef.current?.files?.[0] ?? null
    setHasFile(f !== null)
    setFileName(f?.name ?? null)
  }, [])

  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!canSubmit) return
    sendMut.mutate()
  }

  /** Derive the per-state banner message key. */
  function bannerMessageKey(): string {
    // Check genuine gateway failure states first.
    switch (gatewayState) {
      case 'disabled':
        return 'sendToGroup.gatewayDisabled'
      case 'unreachable':
        return 'sendToGroup.gatewayUnreachable'
      case 'disconnected':
        return 'sendToGroup.gatewayDisconnected'
    }
    // Gateway is connected (or still loading) but the groups fetch failed —
    // that's a network/API error, not a WhatsApp connectivity issue.
    if (groupsError) return 'sendToGroup.groupsLoadError'
    return 'sendToGroup.gatewayDisconnected'
  }

  return (
    // The shell's <main> is a flex container with overflow-hidden: the page must
    // stretch (flex-1) and own its scrolling (overflow-auto), like every other
    // page root — otherwise it content-sizes and the bottom gets clipped.
    <div className="flex flex-1 flex-col overflow-auto bg-background">
      <div className="mx-auto w-full max-w-[1360px] px-4 py-6">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-[1.3em] font-bold text-foreground">{t('sendToGroup.title')}</h1>
        <p className="mt-0.5 text-[0.88em] text-muted-foreground">{t('sendToGroup.subtitle')}</p>
      </div>

      {/* ── Connected status row (admin only) ── */}
      {isConnected && isAdmin && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-border bg-surface/60 px-4 py-3">
          <span className="inline-flex items-center gap-2 text-[0.85em] font-semibold text-green-700 dark:text-green-400">
            <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden />
            {t('sendToGroup.connectedTitle')}
          </span>
          <div className="ms-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setQrOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-[0.82em] font-medium text-foreground hover:bg-surface-tinted"
            >
              <QrCode className="h-3.5 w-3.5" aria-hidden />
              {t('sendToGroup.rescanQr')}
            </button>
            <button
              type="button"
              onClick={() => setUnlinkOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-accent/40 px-3 py-1.5 text-[0.82em] font-medium text-accent hover:bg-accent/10"
            >
              <Unlink className="h-3.5 w-3.5" aria-hidden />
              {t('sendToGroup.unlink')}
            </button>
          </div>
        </div>
      )}

      {/* ── Blocked banner ── */}
      {showBanner && (
        <div
          role="alert"
          className="mb-6 flex flex-col gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-4 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200"
        >
          <div className="flex items-start gap-3">
            <AlertTriangle
              className="mt-0.5 h-5 w-5 shrink-0 text-amber-500"
              aria-hidden
            />
            <div className="space-y-1">
              <p className="text-[0.9em] font-semibold" dir="auto">
                {t('sendToGroup.blockedTitle')}
              </p>
              <p className="text-[0.85em]" dir="auto">
                {t(bannerMessageKey())}
              </p>
              <p className="text-[0.82em] text-amber-700 dark:text-amber-300" dir="auto">
                {t('sendToGroup.blockedGroupsHint')}
              </p>
            </div>
          </div>

          {/* Reconnect / ask-admin area — only for disconnected state (QR won't fix a groups-fetch error) */}
          {gatewayState === 'disconnected' && (
            <div className="ms-8">
              {isAdmin ? (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 rounded-md bg-amber-600 px-3 py-1.5 text-[0.82em] font-semibold text-white hover:bg-amber-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
                  onClick={() => setQrOpen(true)}
                >
                  <MessageCircle className="h-3.5 w-3.5" aria-hidden />
                  {t('sendToGroup.reconnect')}
                </button>
              ) : (
                <p className="text-[0.82em] text-amber-700 dark:text-amber-300" dir="auto">
                  {t('sendToGroup.askAdmin')}
                </p>
              )}
            </div>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div
          className={`grid items-start gap-4 transition-[grid-template-columns] duration-500 motion-reduce:transition-none max-lg:[grid-template-columns:1fr] ${
            view === 'extended'
              ? '[grid-template-columns:minmax(280px,340px)_1fr_0px]'
              : '[grid-template-columns:minmax(280px,340px)_1fr_320px]'
          }`}
        >
          {/* ── Column 1: Recipients rail + reach meter ── */}
          <aside className="min-w-0 space-y-4">
            <div className="rounded-xl border border-border bg-surface/60 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <p className="text-[0.9em] font-semibold text-foreground">
                  {t('sendToGroup.recipients')}
                </p>
                {groups && groups.length > 0 && (
                  <span className="rounded-full bg-surface-tinted px-2 py-0.5 text-[0.72em] font-medium text-muted-foreground">
                    {t('sendToGroup.groupsAvailable', { count: groups.length })}
                  </span>
                )}
              </div>

              {gatewayLoading || groupsLoading ? (
                <p className="text-[0.85em] text-muted-foreground" dir="auto">
                  {t('sendToGroup.statusChecking')}
                </p>
              ) : showBanner ? null : groups && groups.length === 0 ? (
                <p
                  className="rounded-lg border border-border bg-surface/60 px-4 py-3 text-[0.85em] text-muted-foreground"
                  dir="auto"
                >
                  {t('sendToGroup.noGroupsForNumber')}
                </p>
              ) : (
                <>
                  <input
                    type="text"
                    value={groupQuery}
                    onChange={(e) => setGroupQuery(e.target.value)}
                    placeholder={t('sendToGroup.searchGroups')}
                    aria-label={t('sendToGroup.searchGroups')}
                    dir="auto"
                    className="mb-2 h-9 w-full rounded-md border border-border bg-surface px-3 text-[0.85em] text-foreground placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  />

                  <label className="mb-2 flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 hover:bg-surface-tinted">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={toggleSelectAll}
                      className="h-4 w-4 accent-primary"
                    />
                    <span className="text-[0.8em] font-medium text-muted-foreground">
                      {t('sendToGroup.selectAll')}
                    </span>
                  </label>

                  <ul className="space-y-1.5">
                    {filteredGroups.map((g) => {
                      const checked = selectedIds.has(g.id)
                      return (
                        <li key={g.id}>
                          <label className="flex cursor-pointer items-center gap-2.5 rounded-lg border border-border bg-surface px-2.5 py-2 hover:bg-surface-tinted">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => toggleGroup(g.id)}
                              className="h-4 w-4 accent-primary"
                            />
                            <span
                              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#25d366] to-[#128c4b] text-[0.72em] font-bold text-white"
                              aria-hidden
                            >
                              {g.name.slice(0, 2).toUpperCase()}
                            </span>
                            <span className="truncate text-[0.85em] text-foreground" dir="auto">
                              {g.name}
                            </span>
                          </label>
                        </li>
                      )
                    })}
                  </ul>
                </>
              )}
            </div>

            {/* Reach meter — selected-groups count only (API has no member counts) */}
            <div className="rounded-xl bg-gradient-to-br from-primary to-primary-hover p-4 text-primary-foreground">
              <div className="text-[2.2em] font-bold leading-none">{selectedIds.size}</div>
              <div className="mt-1 text-[0.8em] opacity-90">
                {t('sendToGroup.reach.groups', { count: selectedIds.size })}
              </div>
            </div>
          </aside>

          {/* ── Column 2: Composer ── */}
          <div className="min-w-0 rounded-xl border border-border bg-surface/60 p-4">
            {/* Header: message label + Normal/Extended view switch */}
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="text-[0.9em] font-semibold text-foreground">
                {t('sendToGroup.message')}
              </p>
              <div className="inline-flex rounded-full border border-border bg-surface p-0.5">
                {(['normal', 'extended'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={`rounded-full px-2.5 py-1 text-[0.78em] font-semibold transition-colors motion-reduce:transition-none ${
                      view === v
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {t(v === 'normal' ? 'sendToGroup.viewNormal' : 'sendToGroup.viewExtended')}
                  </button>
                ))}
              </div>
            </div>

            {/* Collapsible WA-Web preview zone (Extended only) */}
            <div
              className={`overflow-hidden transition-[height,opacity] duration-500 motion-reduce:transition-none ${
                view === 'extended' ? 'h-[min(54vh,480px)] opacity-100' : 'h-0 opacity-0'
              }`}
            >
              <WebChatWindow
                groupName={firstGroupName}
                text={message}
                mentionNames={activeMentionNames}
                attachment={previewAttachment}
              />
            </div>

            {/* Textarea — plain (Normal) or wrapped in a WA-Web composer bar (Extended) */}
            <div
              className={
                view === 'extended'
                  ? 'flex items-center gap-2.5 rounded-b-xl border border-t-0 border-border bg-[var(--wa-web-bar)] px-3 py-2'
                  : ''
              }
            >
              <span aria-hidden className={view === 'extended' ? 'text-[1.1em]' : 'hidden'}>
                😊
              </span>
              <span aria-hidden className={view === 'extended' ? 'text-[1.1em]' : 'hidden'}>
                📎
              </span>
              <textarea
                ref={messageRef}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                aria-label={t('sendToGroup.message')}
                placeholder={t('sendToGroup.messagePlaceholder')}
                dir="auto"
                className={`w-full border border-border bg-surface px-3 py-2 text-[0.88em] text-foreground placeholder:text-faint transition-[height] duration-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 motion-reduce:transition-none ${
                  view === 'extended' ? 'h-[52px] rounded-lg' : 'h-[200px] rounded-md'
                }`}
              />
              <span aria-hidden className={view === 'extended' ? 'text-[1.1em]' : 'hidden'}>
                🎤
              </span>
            </div>

            <EmployeeMentionField onInsert={insertMention} />

            {/* Attachment section */}
            <section className="mt-4">
              <p className="mb-2 text-[0.9em] font-semibold text-foreground">
                {t('sendToGroup.attachment')}
              </p>
              <div className="flex flex-wrap gap-4">
                {(['none', 'book', 'upload'] as const).map((mode) => (
                  <label
                    key={mode}
                    className="flex cursor-pointer items-center gap-2 text-[0.88em] text-foreground"
                  >
                    <input
                      type="radio"
                      name="attachMode"
                      value={mode}
                      checked={attachMode === mode}
                      onChange={() => setAttachMode(mode)}
                      className="accent-primary"
                    />
                    {mode === 'none'
                      ? t('sendToGroup.attachNone')
                      : mode === 'book'
                        ? t('sendToGroup.attachBook')
                        : t('sendToGroup.attachUpload')}
                  </label>
                ))}
              </div>

              {attachMode === 'book' && (
                <div className="mt-3">
                  {pickedBook ? (
                    <div className="flex items-center gap-3 rounded-md border border-border bg-surface/60 px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-[0.85em] font-medium text-foreground" dir="auto">
                          {pickedBook.ref}
                        </p>
                        <p className="truncate text-[0.78em] text-muted-foreground" dir="auto">
                          {pickedBook.subject}
                        </p>
                      </div>
                      <div className="ms-auto flex gap-2">
                        <button
                          type="button"
                          onClick={() => setPickerOpen(true)}
                          className="rounded-md border border-border px-3 py-1.5 text-[0.8em] font-medium text-foreground hover:bg-surface-tinted"
                        >
                          {t('sendToGroup.picker.change')}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setPickedBook(null)
                            setBookId('')
                          }}
                          className="rounded-md border border-accent/40 px-3 py-1.5 text-[0.8em] font-medium text-accent hover:bg-accent/10"
                        >
                          {t('sendToGroup.picker.clear')}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      className="rounded-md border border-border px-4 py-2 text-[0.85em] font-medium text-foreground hover:bg-surface-tinted"
                    >
                      {t('sendToGroup.picker.choose')}
                    </button>
                  )}
                </div>
              )}

              {attachMode === 'upload' && (
                <div className="mt-3">
                  <input
                    ref={fileRef}
                    type="file"
                    onChange={handleFileChange}
                    className="text-[0.85em] text-foreground"
                  />
                </div>
              )}
            </section>

            {/* Confirm + submit */}
            <div className="mt-4 flex items-center gap-4">
              <button
                type="submit"
                disabled={!canSubmit || sendMut.isPending}
                className="rounded-md bg-primary px-5 py-2 text-[0.9em] font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 disabled:opacity-50"
              >
                {sendMut.isPending ? t('sendToGroup.sending') : t('sendToGroup.send')}
              </button>
              {selectedIds.size > 0 && (
                <span className="text-[0.82em] text-muted-foreground">
                  {t('sendToGroup.confirm', { count: selectedIds.size })}
                </span>
              )}
            </div>

            {/* Validation hints */}
            {!showBanner && !hasGroup && !sendMut.isPending && (
              <p className="mt-2 text-[0.8em] text-muted-foreground">{t('sendToGroup.pickGroup')}</p>
            )}
            {!showBanner && hasGroup && !hasContent && !sendMut.isPending && (
              <p className="mt-2 text-[0.8em] text-muted-foreground">
                {t('sendToGroup.needContent')}
              </p>
            )}
          </div>

          {/* ── Column 3: Live phone preview ── */}
          <div
            data-testid="phone-column"
            className={`min-w-0 overflow-hidden transition-all duration-400 motion-reduce:transition-none ${
              view === 'extended'
                ? 'pointer-events-none translate-x-4 opacity-0 rtl:-translate-x-4 max-lg:hidden'
                : ''
            }`}
          >
            <div className="mb-2 flex items-center gap-2">
              <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[0.72em] font-semibold text-green-700 dark:text-green-400">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" aria-hidden />
                {t('sendToGroup.preview.live')}
              </span>
              <span className="text-[0.72em] text-muted-foreground">
                {t('sendToGroup.preview.firstGroup')}
              </span>
            </div>
            <PhonePreview
              groupName={firstGroupName}
              text={message}
              mentionNames={activeMentionNames}
              attachment={previewAttachment}
            />
          </div>
        </div>
      </form>

      {/* QR connect dialog (admin only) */}
      <GatewayConnectDialog open={qrOpen} onOpenChange={setQrOpen} />

      <RecordAnnouncePicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={(b) => {
          setPickedBook(b)
          setBookId(String(b.id))
          setPickerOpen(false)
        }}
      />

      {/* Unlink confirm dialog (admin only) */}
      <ConfirmDialog
        open={unlinkOpen}
        onOpenChange={setUnlinkOpen}
        title={t('sendToGroup.unlinkTitle')}
        description={t('sendToGroup.unlinkDesc')}
        confirmLabel={t('sendToGroup.unlinkConfirm')}
        onConfirm={() => unlinkMut.mutate()}
        destructive
      />

      {/* Result panel */}
      {result && (
        <div className="mt-8 rounded-lg border border-border bg-surface p-4">
          <div className="mb-3 flex gap-4 text-[0.88em] font-semibold">
            <span className="text-green-600">{t('sendToGroup.resultSent', { count: result.sent })}</span>
            {result.failed > 0 && (
              <span className="text-destructive">{t('sendToGroup.resultFailed', { count: result.failed })}</span>
            )}
          </div>
          <ul className="space-y-1">
            {result.results.map((row: GroupSendOut) => (
              <li
                key={row.group_id}
                className="flex items-center gap-2 text-[0.82em]"
              >
                <span
                  className={row.ok ? 'text-green-600' : 'text-destructive'}
                  aria-hidden
                >
                  {row.ok ? '✓' : '✗'}
                </span>
                <span dir="auto" className="text-foreground">
                  {row.group_name}
                </span>
                {!row.ok && (
                  <span className="text-muted-foreground" title={row.error ?? undefined}>
                    — {t('sendToGroup.groupSendFailed')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      </div>
    </div>
  )
}
