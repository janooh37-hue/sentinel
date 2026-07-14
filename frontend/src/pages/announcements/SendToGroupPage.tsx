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

  // Group selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Message
  const [message, setMessage] = useState('')

  // Attachment
  const [attachMode, setAttachMode] = useState<AttachMode>('none')
  const [bookId, setBookId] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [hasFile, setHasFile] = useState(false)
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
      if (message.trim()) {
        form.append('text', message.trim())
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

  const handleFileChange = useCallback(() => {
    setHasFile((fileRef.current?.files?.length ?? 0) > 0)
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
    <div className="mx-auto max-w-2xl px-4 py-6">
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

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Groups section */}
        <section>
          <p className="mb-2 text-[0.9em] font-semibold text-foreground">{t('sendToGroup.groups')}</p>
          {gatewayLoading || groupsLoading ? (
            <p className="text-[0.85em] text-muted-foreground" dir="auto">
              {t('sendToGroup.statusChecking')}
            </p>
          ) : showBanner ? null : groups && groups.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface/60 px-4 py-3 text-[0.85em] text-muted-foreground" dir="auto">
              {t('sendToGroup.noGroupsForNumber')}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {(groups ?? []).map((g) => {
                const checked = selectedIds.has(g.id)
                return (
                  <li key={g.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface/60 px-3 py-2 hover:bg-surface-tinted">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleGroup(g.id)}
                        className="h-4 w-4 accent-primary"
                      />
                      <span className="text-[0.88em] text-foreground" dir="auto">
                        {g.name}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* Message section */}
        <section>
          <label className="mb-2 block text-[0.9em] font-semibold text-foreground">
            {t('sendToGroup.message')}
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={t('sendToGroup.messagePlaceholder')}
            dir="auto"
            rows={4}
            className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[0.88em] text-foreground placeholder:text-faint focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
          />
        </section>

        {/* Attachment section */}
        <section>
          <p className="mb-2 text-[0.9em] font-semibold text-foreground">{t('sendToGroup.attachment')}</p>
          <div className="flex flex-wrap gap-4">
            {(['none', 'book', 'upload'] as const).map((mode) => (
              <label key={mode} className="flex cursor-pointer items-center gap-2 text-[0.88em] text-foreground">
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
        <div className="flex items-center gap-4">
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
          <p className="text-[0.8em] text-muted-foreground">{t('sendToGroup.pickGroup')}</p>
        )}
        {!showBanner && hasGroup && !hasContent && !sendMut.isPending && (
          <p className="text-[0.8em] text-muted-foreground">{t('sendToGroup.needContent')}</p>
        )}
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
  )
}
