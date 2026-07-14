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
import { useQuery, useMutation } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, type AnnouncementOut, type GroupSendOut } from '@/lib/api'

type AttachMode = 'none' | 'book' | 'upload'

export function SendToGroupPage(): React.JSX.Element {
  const { t } = useTranslation()

  // Group selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Message
  const [message, setMessage] = useState('')

  // Attachment
  const [attachMode, setAttachMode] = useState<AttachMode>('none')
  const [bookId, setBookId] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const [hasFile, setHasFile] = useState(false)

  // Result
  const [result, setResult] = useState<AnnouncementOut | null>(null)

  // Load groups
  const { data: groups, isLoading } = useQuery({
    queryKey: ['announce-groups'],
    queryFn: api.listGroups,
  })

  // Derived: is submit enabled?
  const hasGroup = selectedIds.size > 0
  const hasContent =
    message.trim().length > 0 ||
    (attachMode === 'book' && bookId.trim().length > 0) ||
    (attachMode === 'upload' && hasFile)
  const canSubmit = hasGroup && hasContent

  const sendMut = useMutation({
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

  return (
    <div className="mx-auto max-w-2xl px-4 py-6">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-[1.3em] font-bold text-foreground">{t('sendToGroup.title')}</h1>
        <p className="mt-0.5 text-[0.88em] text-muted-foreground">{t('sendToGroup.subtitle')}</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Groups section */}
        <section>
          <p className="mb-2 text-[0.9em] font-semibold text-foreground">{t('sendToGroup.groups')}</p>
          {isLoading ? null : !groups || groups.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface/60 px-4 py-3 text-[0.85em] text-muted-foreground">
              {t('sendToGroup.noGroups')}
            </p>
          ) : (
            <ul className="space-y-1.5">
              {groups.map((g) => {
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
              <label className="mb-1 block text-[0.82em] text-muted-foreground">
                {t('sendToGroup.bookIdLabel')}
              </label>
              <input
                type="number"
                value={bookId}
                onChange={(e) => setBookId(e.target.value)}
                min={1}
                className="h-9 w-40 rounded-md border border-border bg-surface px-3 text-[0.85em] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
              />
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
        {!hasGroup && !sendMut.isPending && (
          <p className="text-[0.8em] text-muted-foreground">{t('sendToGroup.pickGroup')}</p>
        )}
        {hasGroup && !hasContent && !sendMut.isPending && (
          <p className="text-[0.8em] text-muted-foreground">{t('sendToGroup.needContent')}</p>
        )}
      </form>

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
                {!row.ok && row.error && (
                  <span className="text-muted-foreground">— {row.error}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
