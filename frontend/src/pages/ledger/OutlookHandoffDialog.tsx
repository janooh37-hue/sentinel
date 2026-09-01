/**
 * OutlookHandoffDialog — the ledger's compose surface after the SMTP composer
 * was retired. It never sends: it hands the message to the operator's real
 * Outlook and records a pending ledger row that the 5-minute Sent-folder sync
 * later confirms.
 *
 * Two modes, always explicit (never a hidden default):
 *   draft   POST /email/handoff (mode=draft) → the backend IMAP-APPENDs a full
 *           MIME draft (HTML, signature, attachments) into the user's Drafts
 *           folder. The operator opens Outlook and presses Send.
 *   mailto  the pending row is still written, then the browser navigates to a
 *           `mailto:` URL so Outlook opens immediately. Plain text, no
 *           attachments, capped at MAILTO_MAX characters.
 *
 * Adaptive: attachments (including reference PDFs) force draft; an over-long
 * mailto URL forces draft; no configured mailbox leaves mailto as the only
 * option. Every switch is announced inline — the radios are never silently
 * overridden without a visible reason.
 *
 * Hosted inside `ComposeWindow`, so the desktop drag/minimize chrome and the
 * mobile full-screen page chrome are unchanged from the old composer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm, FormProvider, Controller } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  ArrowLeft,
  Check,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Paperclip,
  Plus,
  Send,
  X,
} from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import type { EmployeeListItem, LedgerEntryRead } from '@/lib/api'
import { cn } from '@/lib/utils'
import { base64PdfToFile, desiredRefPdfDocIds, mergeFiles } from '@/lib/refPdfAttachments'
import { useIdentity } from '@/lib/useIdentity'
import { pickEmployeeName } from '@/lib/employeeName'
import { pushRecentRecipient, recordRecipientsForForm } from '@/lib/recentRecipients'
import { clearBasket } from '@/lib/emailBasket'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RecipientChipsInput } from '@/components/ledger/RecipientChipsInput'
import { RecipientListsMenu } from '@/components/ledger/RecipientListsMenu'
import { ReferencePicker, type ComposeReference } from '@/components/ledger/ReferencePicker'
import { RichEditor } from '@/components/ui/rich-editor'
import type { ComposeWindowControls } from './outlook/ComposeWindow'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogAction,
  AlertDialogCancel,
} from '@/components/ui/alert-dialog'
import {
  browserNavigation,
  buildMailtoUrl,
  htmlToPlainText,
  MAILTO_MAX,
  QUOTE_ATTR,
  stripQuote,
} from './outlookHandoffUtils'

/** Handoff mechanism. Not the compose mode (`new`/`reply`/…). */
export type HandoffMode = 'draft' | 'mailto'


/** Attachment guard — the draft is APPENDed over IMAP, same ballpark as SMTP. */
const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024

const SIGNATURE_MARKER = '<!-- gssg-signature -->'


const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type ComposeMode = 'new' | 'reply' | 'replyall' | 'forward'

export interface OutlookHandoffPrefill {
  to?: string[]
  cc?: string[]
  subject?: string
  bodyHtml?: string
  references?: ComposeReference[]
  attachRefPdf?: boolean
  basketKey?: string
}

interface OutlookHandoffDialogProps {
  mode: ComposeMode
  source?: LedgerEntryRead
  prefill?: OutlookHandoffPrefill
  /** 'page' (mobile/full-screen) or 'window' (desktop frame). */
  chrome?: 'page' | 'window'
  windowControls?: ComposeWindowControls
  onClose: () => void
  onHandedOff: (entryId: number) => void
}

interface FormValues {
  to: string[]
  cc: string[]
  subject: string
  body: string
}

// ─── pure helpers ────────────────────────────────────────────────────────────

function extractAddress(counterparty: string): string {
  const m = counterparty.match(/<([^>]+)>/)
  if (m) return m[1].trim()
  if (EMAIL_LIKE.test(counterparty.trim())) return counterparty.trim()
  return ''
}

/** Dedupe case-insensitively and drop the operator's own address. */
function withoutSelf(addresses: string[], self: string | undefined): string[] {
  const me = self?.trim().toLowerCase()
  const seen = new Set<string>()
  const out: string[] = []
  for (const addr of addresses) {
    const key = addr.trim().toLowerCase()
    if (!key || key === me || seen.has(key)) continue
    seen.add(key)
    out.push(addr.trim())
  }
  return out
}

/** Drop a legacy auto-inserted signature block so replies don't stack them. */
function stripSignatureBlock(html: string): string {
  if (!html.includes('data-gssg-signature') && !html.includes(SIGNATURE_MARKER)) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelector('[data-gssg-signature]')?.remove()
  return doc.body.innerHTML.split(SIGNATURE_MARKER).join('')
}

/** The quoted original, tagged so `stripQuote` can find it again. */
function quoteOriginal(
  entry: LedgerEntryRead,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const header = t('ledger.composeQuoteHeader', {
    when: entry.entry_date,
    from: entry.counterparty,
    defaultValue: 'On {{when}}, {{from}} wrote:',
  })
  return (
    `<br><br><div ${QUOTE_ATTR} style="border-inline-start:3px solid #ccc;padding-inline-start:12px;margin-top:12px;color:#555;">` +
    `<div style="margin-bottom:6px;font-size:0.85em;">${header}</div>` +
    stripSignatureBlock(entry.notes_html ?? '') +
    `</div>`
  )
}


function prefixOnce(subject: string, prefix: string): string {
  return subject.match(/^\s*(re|fwd?|fw|رد|توجيه):/i) ? subject : `${prefix} ${subject}`
}


function formatBytes(b: number): string {
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / 1024 / 1024).toFixed(1)} MB`
}


function refTokenLine(ref: ComposeReference, label: string): string {
  return `<div data-gssg-ref="${ref.kind}:${ref.id}">${label}: ${ref.token}</div>`
}

function stripRefToken(body: string, ref: ComposeReference): string {
  return body.replace(
    new RegExp(`<div data-gssg-ref="${ref.kind}:${ref.id}">[^<]*</div>`, 'g'),
    '',
  )
}

function tagToMessageId(tags: string[]): string | null {
  const tag = tags.find((x) => x.startsWith('msgid:'))
  return tag ? `<${tag.slice('msgid:'.length)}>` : null
}

// ─── component ───────────────────────────────────────────────────────────────

export function OutlookHandoffDialog({
  mode,
  source,
  prefill,
  chrome = 'page',
  windowControls,
  onClose,
  onHandedOff,
}: OutlookHandoffDialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { identity } = useIdentity()
  const selfAddress = identity?.email ?? undefined

  const initial: FormValues = useMemo(() => {
    if (mode === 'reply' && source) {
      const addr = extractAddress(source.counterparty)
      return {
        to: addr ? [addr] : [],
        cc: [],
        subject: prefixOnce(source.subject, 'RE:'),
        body: quoteOriginal(source, t),
      }
    }
    if (mode === 'replyall' && source) {
      const sender = extractAddress(source.counterparty)
      return {
        to: withoutSelf(
          [...(sender ? [sender] : []), ...(source.to_recipients ?? []).map((a) => a.address)],
          selfAddress,
        ),
        cc: withoutSelf((source.cc_recipients ?? []).map((a) => a.address), selfAddress),
        subject: prefixOnce(source.subject, 'RE:'),
        body: quoteOriginal(source, t),
      }
    }
    if (mode === 'forward' && source) {
      return {
        to: [],
        cc: [],
        subject: prefixOnce(source.subject, 'FW:'),
        body: quoteOriginal(source, t),
      }
    }
    return {
      to: prefill?.to ?? [],
      cc: prefill?.cc ?? [],
      subject: prefill?.subject ?? '',
      body: prefill?.bodyHtml ?? '',
    }
    // `t` is stable per language; the prefill/source pair is fixed for the life
    // of one dialog (the shell mounts a new one per compose).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const methods = useForm<FormValues>({ defaultValues: initial })
  const {
    control,
    register,
    handleSubmit,
    formState: { errors },
    setValue,
    getValues,
    watch,
  } = methods

  const [files, setFiles] = useState<File[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [useSignature, setUseSignature] = useState(true)
  const [showCc, setShowCc] = useState<boolean>(initial.cc.length > 0)
  const [chosenMode, setChosenMode] = useState<HandoffMode>('draft')
  const [discardOpen, setDiscardOpen] = useState(false)
  const ccRevealedByUser = useRef(false)
  const ccRowRef = useRef<HTMLDivElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  // ── recipient autocomplete ────────────────────────────────────────────────
  const contactsQuery = useQuery({
    queryKey: ['ledger-contacts'],
    queryFn: () => api.listLedgerContacts(),
    staleTime: 60_000,
  })
  const contacts = contactsQuery.data ?? []

  const [empQuery, setEmpQuery] = useState('')
  const debounceRef = useRef<number | null>(null)
  const requestEmployees = useCallback((q: string) => {
    const trimmed = q.trim()
    if (trimmed.length === 0) return
    if (debounceRef.current != null) window.clearTimeout(debounceRef.current)
    debounceRef.current = window.setTimeout(() => setEmpQuery(trimmed), 200)
  }, [])
  const employeesQuery = useQuery({
    queryKey: ['compose-employees', empQuery],
    queryFn: () => api.listEmployees({ q: empQuery, limit: 6 }),
    enabled: empQuery.length > 0,
    staleTime: 30_000,
  })
  const employeeResults = useMemo(
    () => employeesQuery.data?.items ?? [],
    [employeesQuery.data],
  )
  const employeeLookup = useCallback(
    (q: string): EmployeeListItem[] => {
      requestEmployees(q)
      return q.trim().length === 0 ? [] : employeeResults
    },
    [requestEmployees, employeeResults],
  )

  // ── references + their PDFs ───────────────────────────────────────────────
  const [references, setReferences] = useState<ComposeReference[]>(prefill?.references ?? [])
  const [refPickerOpen, setRefPickerOpen] = useState(false)
  const [attachRefPdf, setAttachRefPdf] = useState(prefill?.attachRefPdf ?? true)
  const [refPdfFiles, setRefPdfFiles] = useState<Map<number, File>>(new Map())
  const refPdfInFlight = useRef<Set<number>>(new Set())
  const addRefBtnRef = useRef<HTMLButtonElement>(null)

  const refLabel = t('ledger.outlook.ref.label', { defaultValue: 'Ref' })

  const addReference = useCallback(
    (ref: ComposeReference) => {
      let added = false
      setReferences((prev) => {
        if (prev.some((r) => r.kind === ref.kind && r.id === ref.id)) return prev
        added = true
        return [...prev, ref]
      })
      if (added) {
        const current = getValues('body') ?? ''
        setValue('body', `${current}${refTokenLine(ref, refLabel)}`, { shouldDirty: true })
      }
    },
    [getValues, setValue, refLabel],
  )

  const removeReference = useCallback(
    (ref: ComposeReference) => {
      setReferences((prev) => prev.filter((r) => !(r.kind === ref.kind && r.id === ref.id)))
      setValue('body', stripRefToken(getValues('body') ?? '', ref), { shouldDirty: true })
    },
    [getValues, setValue],
  )

  // Book reference → its PDF, fetched client-side. The backend never resolves
  // book PDFs: it only stores what this dialog uploads. (Ported verbatim in
  // spirit from the retired composer, including the base64 IDM bypass.)
  useEffect(() => {
    const desired = desiredRefPdfDocIds(references, attachRefPdf)
    const desiredSet = new Set(desired)

    setRefPdfFiles((prev) => {
      let changed = false
      const next = new Map(prev)
      for (const id of [...next.keys()]) {
        if (!desiredSet.has(id)) {
          next.delete(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
    for (const id of [...refPdfInFlight.current]) {
      if (!desiredSet.has(id)) refPdfInFlight.current.delete(id)
    }

    for (const id of desired) {
      if (refPdfFiles.has(id) || refPdfInFlight.current.has(id)) continue
      refPdfInFlight.current.add(id)
      const ref = references.find((r) => r.kind === 'book' && r.docId === id)
      const fileName =
        ref && ref.kind === 'book' && ref.fileName ? ref.fileName : `reference-${id}.pdf`
      void (async () => {
        try {
          const res = await fetch(`${api.documentDownloadUrl(id, 'pdf')}&encoding=base64`, {
            credentials: 'same-origin',
          })
          if (!res.ok) return
          const file = base64PdfToFile(await res.text(), fileName)
          setRefPdfFiles((prev) => new Map(prev).set(id, file))
        } catch {
          // A companion PDF must never block the handoff.
        } finally {
          refPdfInFlight.current.delete(id)
        }
      })()
    }
  }, [references, attachRefPdf, refPdfFiles])

  const refPdfList = useMemo(() => [...refPdfFiles.values()], [refPdfFiles])
  const allFiles = useMemo(() => mergeFiles(files, refPdfList), [files, refPdfList])

  const handlePickEmployee = useCallback(
    (emp: EmployeeListItem) => {
      addReference({
        kind: 'employee',
        id: emp.id,
        label: pickEmployeeName(emp, i18n.language),
        token: emp.id,
      })
    },
    [addReference, i18n.language],
  )

  // ── mode availability ─────────────────────────────────────────────────────
  // A draft is an IMAP APPEND, so it needs the operator's configured mailbox.
  const accountQuery = useQuery({
    queryKey: ['email-account'],
    queryFn: () => api.getEmailAccount(),
    staleTime: 60_000,
  })
  const draftAvailable = Boolean(accountQuery.data?.enabled)

  // Reply-all builds its recipient set at mount, from the source thread, before
  // `getEmailAccount` has resolved — so the mailbox this reply will be sent
  // FROM can still be sitting in To or Cc. Prune it once, as soon as the
  // address is known. Only that one address is removed, case-insensitively, so
  // anything the operator typed in the meantime survives.
  const accountEmail = accountQuery.data?.email
  const prunedSelf = useRef(false)
  useEffect(() => {
    if (mode !== 'replyall' || prunedSelf.current) return
    const me = accountEmail?.trim().toLowerCase()
    if (!me) return
    prunedSelf.current = true
    for (const field of ['to', 'cc'] as const) {
      const current = getValues(field) ?? []
      const next = current.filter((address) => address.trim().toLowerCase() !== me)
      if (next.length !== current.length) {
        setValue(field, next, { shouldDirty: false })
      }
    }
  }, [mode, accountEmail, getValues, setValue])

  const watchedTo = watch('to') ?? []
  const watchedCc = watch('cc') ?? []
  const watchedSubject = watch('subject') ?? ''
  const watchedBody = watch('body') ?? ''

  const mailtoUrl = useMemo(
    () =>
      buildMailtoUrl(
        watchedTo.filter(Boolean),
        watchedCc.filter(Boolean),
        watchedSubject,
        htmlToPlainText(stripQuote(watchedBody)),
      ),
    [watchedTo, watchedCc, watchedSubject, watchedBody],
  )

  const hasAttachments = allFiles.length > 0
  const mailtoTooLong = mailtoUrl.length > MAILTO_MAX
  const forcedDraftReason: 'attachments' | 'length' | null = hasAttachments
    ? 'attachments'
    : mailtoTooLong
      ? 'length'
      : null

  // Resolution order: no mailbox beats everything (a draft is impossible), then
  // the forcing rules, then whatever the operator picked.
  const effectiveMode: HandoffMode = !draftAvailable
    ? 'mailto'
    : forcedDraftReason
      ? 'draft'
      : chosenMode

  // ── window chrome focus handling (unchanged behaviour) ────────────────────
  const prevWinState = useRef(windowControls?.state)
  useEffect(() => {
    const prev = prevWinState.current
    const next = windowControls?.state
    prevWinState.current = next
    if (prev === undefined || next === undefined || prev === next) return
    const root = rootRef.current
    if (!root) return
    if (next === 'minimized') {
      root.querySelector<HTMLElement>('#ledger-handoff-title')?.focus()
    } else if (prev === 'minimized') {
      root.querySelector<HTMLElement>('input, textarea, [contenteditable="true"]')?.focus()
    }
  }, [windowControls?.state])

  useEffect(() => {
    if (!showCc || !ccRevealedByUser.current) return
    ccRevealedByUser.current = false
    ccRowRef.current?.querySelector('input')?.focus()
  }, [showCc])

  // ── submit ────────────────────────────────────────────────────────────────
  const handoffMutation = useMutation({
    mutationFn: async (values: FormValues): Promise<{ entryId: number; url: string | null }> => {
      const to = (values.to ?? []).filter(Boolean)
      const cc = (values.cc ?? []).filter(Boolean)
      if (to.length === 0) {
        throw new Error(
          t('compose.toRequired', { defaultValue: 'At least one recipient is required' }),
        )
      }
      const totalBytes = allFiles.reduce((sum, f) => sum + f.size, 0)
      if (totalBytes > MAX_ATTACHMENTS_BYTES) {
        throw new Error(
          t('compose.attachmentsTooLarge', {
            max: formatBytes(MAX_ATTACHMENTS_BYTES),
            defaultValue: 'Attachments exceed the {{max}} limit',
          }),
        )
      }
      const isMailto = effectiveMode === 'mailto'
      // Mailto is plain text and thread-less: the quote would only be noise.
      const html = isMailto ? stripQuote(values.body ?? '') : (values.body ?? '')
      const firstBook = references.find((r) => r.kind === 'book')
      const firstEmployee = references.find((r) => r.kind === 'employee')
      const result = await api.emailHandoff(
        {
          to,
          cc,
          subject: values.subject,
          html,
          mode: effectiveMode,
          related_book_id: firstBook ? Number(firstBook.id) : null,
          related_employee_id: firstEmployee ? String(firstEmployee.id) : null,
          in_reply_to: source ? tagToMessageId(source.tags) : null,
          references: source?.email_references ?? null,
          // Mailto relies on Outlook's own signature.
          use_signature: isMailto ? false : useSignature,
        },
        isMailto ? [] : allFiles,
      )
      return {
        entryId: result.ledger_entry_id,
        url: isMailto
          ? buildMailtoUrl(to, cc, values.subject, htmlToPlainText(html))
          : null,
      }
    },
    onSuccess: ({ entryId, url }) => {
      const values = getValues()
      for (const addr of [...(values.to ?? []), ...(values.cc ?? [])]) pushRecentRecipient(addr)
      if (prefill?.basketKey) {
        recordRecipientsForForm(prefill.basketKey, (values.to ?? []).filter(Boolean))
        clearBasket(prefill.basketKey)
      }
      void queryClient.invalidateQueries({ queryKey: ['ledger'] })
      if (url) {
        browserNavigation.assign(url)
      } else {
        toast.success(t('ledger.outlook.handoff.draftCreated'))
      }
      onHandedOff(entryId)
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : (err as Error).message),
  })

  const hasContent = useCallback((): boolean => {
    const v = getValues()
    const doc = new DOMParser().parseFromString(v.body ?? '', 'text/html')
    const bodyText = (doc.body.textContent ?? '').replace(/\u00a0/g, ' ').trim()
    return (
      (v.subject ?? '').trim().length > 0 ||
      bodyText.length > 0 ||
      (v.to ?? []).some(Boolean) ||
      (v.cc ?? []).some(Boolean)
    )
  }, [getValues])

  const handleClose = useCallback(() => {
    if (hasContent()) {
      setDiscardOpen(true)
      return
    }
    onClose()
  }, [hasContent, onClose])

  function addFiles(list: FileList | null): void {
    if (!list) return
    const next = [...files]
    for (const f of Array.from(list)) {
      if (!next.some((x) => x.name === f.name && x.size === f.size)) next.push(f)
    }
    if (next.reduce((sum, f) => sum + f.size, 0) > MAX_ATTACHMENTS_BYTES) {
      toast.error(
        t('compose.attachmentsTooLarge', {
          max: formatBytes(MAX_ATTACHMENTS_BYTES),
          defaultValue: 'Attachments exceed the {{max}} limit',
        }),
      )
      return
    }
    setFiles(next)
  }

  const title =
    mode === 'reply'
      ? t('compose.title.reply', { defaultValue: 'Reply' })
      : mode === 'replyall'
        ? t('compose.title.replyAll', { defaultValue: 'Reply All' })
        : mode === 'forward'
          ? t('compose.title.forward', { defaultValue: 'Forward' })
          : t('compose.title.new', { defaultValue: 'New email' })

  const notice = !draftAvailable
    ? t('ledger.outlook.handoff.noAccount')
    : forcedDraftReason === 'attachments'
      ? t('ledger.outlook.handoff.forcedByAttachments')
      : forcedDraftReason === 'length'
        ? t('ledger.outlook.handoff.forcedByLength')
        : null

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 flex-1 flex-col bg-background"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !e.defaultPrevented) handleClose()
      }}
    >
      {chrome === 'window' ? (
        <div
          className={cn(
            'flex shrink-0 items-center gap-2 bg-surface px-4 py-2.5',
            windowControls?.state !== 'minimized' && 'border-b border-hairline',
            windowControls &&
              windowControls.state !== 'minimized' &&
              'cursor-grab active:cursor-grabbing',
          )}
          {...(windowControls?.dragHandleProps ?? {})}
        >
          {windowControls?.state === 'minimized' ? (
            <button
              type="button"
              id="ledger-handoff-title"
              onClick={windowControls.restore}
              className="min-w-0 flex-1 truncate rounded-md text-start text-sm font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {title}
              {source && ` — ${source.subject}`}
            </button>
          ) : (
            <h2
              id="ledger-handoff-title"
              className="min-w-0 flex-1 truncate text-sm font-semibold tracking-tight text-foreground"
            >
              {title}
              {source && ` — ${source.subject}`}
            </h2>
          )}
          {windowControls && windowControls.state !== 'minimized' && (
            <>
              <WinBtn
                label={t('compose.window.minimize', { defaultValue: 'Minimize' })}
                onClick={windowControls.minimize}
              >
                <Minus className="h-4 w-4" strokeWidth={1.8} />
              </WinBtn>
              <WinBtn
                label={
                  windowControls.state === 'maximized'
                    ? t('compose.window.restore', { defaultValue: 'Restore' })
                    : t('compose.window.maximize', { defaultValue: 'Maximize' })
                }
                onClick={windowControls.maximize}
              >
                {windowControls.state === 'maximized' ? (
                  <Minimize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
                )}
              </WinBtn>
            </>
          )}
          {windowControls?.state === 'minimized' && (
            <WinBtn
              label={t('compose.window.restore', { defaultValue: 'Restore' })}
              onClick={windowControls.restore}
            >
              <Maximize2 className="h-3.5 w-3.5" strokeWidth={1.8} />
            </WinBtn>
          )}
          <WinBtn label={t('common.close', { defaultValue: 'Close' })} onClick={handleClose}>
            <X className="h-4 w-4" strokeWidth={1.8} />
          </WinBtn>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-3 border-b border-hairline bg-surface px-6 py-4">
          <button
            type="button"
            onClick={handleClose}
            className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm text-muted-foreground hover:bg-surface-tinted hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.5} />
            <span>{t('common.back', { defaultValue: 'Back' })}</span>
          </button>
          <span className="text-border">/</span>
          <h2 className="text-lg font-semibold tracking-tight text-foreground">
            {title}
            {source && ` — ${source.subject}`}
          </h2>
        </div>
      )}

      {windowControls?.state !== 'minimized' && (
        <FormProvider {...methods}>
          <form
            onSubmit={handleSubmit((values) => handoffMutation.mutate(values))}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-3">
              <div
                className={
                  chrome === 'window'
                    ? 'flex min-h-0 w-full flex-1 flex-col gap-2.5'
                    : 'mx-auto flex min-h-0 w-full max-w-5xl flex-1 flex-col gap-2.5 rounded-2xl bg-surface p-6'
                }
              >
                {/* To row — chips + inline Cc / Lists ▾ / ＋ Ref controls */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-start gap-2">
                    <div className="flex min-h-9 flex-1 rounded-md border border-input bg-surface px-2 py-1 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background">
                      <Controller
                        control={control}
                        name="to"
                        rules={{ validate: (v) => v.length > 0 }}
                        render={({ field }) => (
                          <RecipientChipsInput
                            value={field.value}
                            onChange={field.onChange}
                            contacts={contacts}
                            employeeQuery={employeeLookup}
                            onPickEmployee={handlePickEmployee}
                            label={t('compose.to', { defaultValue: 'To' })}
                            placeholder="name@example.com"
                          />
                        )}
                      />
                    </div>
                    <div className="flex flex-none items-center gap-1.5 pt-1.5">
                      {!showCc && (
                        <button
                          type="button"
                          onClick={() => {
                            ccRevealedByUser.current = true
                            setShowCc(true)
                          }}
                          className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground"
                        >
                          {t('compose.cc', { defaultValue: 'Cc' })}
                        </button>
                      )}
                      <RecipientListsMenu
                        current={{ to: watchedTo, cc: watchedCc }}
                        onApply={(next) => {
                          setValue('to', next.to, { shouldDirty: true })
                          setValue('cc', next.cc, { shouldDirty: true })
                          if (next.cc.length > 0) setShowCc(true)
                        }}
                      />
                      <button
                        ref={addRefBtnRef}
                        type="button"
                        aria-label={t('ledger.outlook.ref.add', { defaultValue: 'Add reference' })}
                        title={t('ledger.outlook.ref.add', { defaultValue: 'Add reference' })}
                        onClick={() => setRefPickerOpen((v) => !v)}
                        className="inline-flex items-center gap-1 rounded-full border border-dashed border-primary/40 px-2 py-0.5 text-[11px] font-semibold text-primary transition-colors hover:bg-primary-soft/70"
                      >
                        <Plus className="h-3 w-3" strokeWidth={2.4} aria-hidden />
                        {refLabel}
                      </button>
                    </div>
                  </div>
                  {errors.to && (
                    <span className="text-xs text-accent">
                      {t('compose.toRequired', {
                        defaultValue: 'At least one recipient is required',
                      })}
                    </span>
                  )}
                  {refPickerOpen && (
                    <ReferencePicker
                      anchorRef={addRefBtnRef}
                      onClose={() => setRefPickerOpen(false)}
                      onPick={(ref) => {
                        addReference(ref)
                        setRefPickerOpen(false)
                      }}
                    />
                  )}
                </div>

                {showCc && (
                  <div
                    ref={ccRowRef}
                    className="flex min-h-9 w-full rounded-md border border-input bg-surface px-2 py-1 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background"
                  >
                    <Controller
                      control={control}
                      name="cc"
                      render={({ field }) => (
                        <RecipientChipsInput
                          value={field.value}
                          onChange={field.onChange}
                          contacts={contacts}
                          employeeQuery={employeeLookup}
                          onPickEmployee={handlePickEmployee}
                          label={t('compose.cc', { defaultValue: 'Cc' })}
                        />
                      )}
                    />
                  </div>
                )}

                <div className="flex flex-col gap-1">
                  <Input
                    type="text"
                    aria-label={t('compose.subject', { defaultValue: 'Subject' })}
                    placeholder={t('compose.subject', { defaultValue: 'Subject' })}
                    {...register('subject', { required: true })}
                    className="text-sm font-medium"
                    dir="auto"
                  />
                  {errors.subject && (
                    <span className="text-xs text-accent">
                      {t('compose.subjectRequired', { defaultValue: 'Subject is required' })}
                    </span>
                  )}
                </div>

                {/* Mode — the one decision this surface exists to make. */}
                <fieldset className="flex flex-col gap-1.5 rounded-lg border border-hairline bg-surface-tinted/50 px-3 py-2.5">
                  <legend className="px-1 text-[0.72em] font-semibold uppercase tracking-[0.1em] text-muted-foreground rtl:tracking-normal">
                    {t('ledger.outlook.handoff.modeLegend')}
                  </legend>
                  <ModeOption
                    id="handoff-mode-draft"
                    checked={effectiveMode === 'draft'}
                    disabled={!draftAvailable}
                    label={t('ledger.outlook.handoff.modeDraft')}
                    hint={t('ledger.outlook.handoff.modeDraftHint')}
                    onSelect={() => setChosenMode('draft')}
                  />
                  <ModeOption
                    id="handoff-mode-mailto"
                    checked={effectiveMode === 'mailto'}
                    disabled={draftAvailable && forcedDraftReason !== null}
                    label={t('ledger.outlook.handoff.modeMailto')}
                    hint={t('ledger.outlook.handoff.modeMailtoHint')}
                    onSelect={() => setChosenMode('mailto')}
                  />
                  {notice && (
                    <p
                      role="status"
                      className="mt-0.5 flex items-start gap-1.5 px-1 text-[0.76em] leading-snug text-muted-foreground"
                    >
                      <span aria-hidden="true">↳</span>
                      <span dir="auto">{notice}</span>
                    </p>
                  )}
                </fieldset>

                {references.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    {references.map((ref) => (
                      <span
                        key={`${ref.kind}-${ref.id}`}
                        className={cn(
                          'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11.5px] font-semibold',
                          ref.kind === 'employee'
                            ? 'bg-primary-soft text-primary'
                            : 'bg-accent-soft text-accent',
                        )}
                      >
                        <span aria-hidden="true">{ref.kind === 'employee' ? '👤' : '📕'}</span>
                        <span className="font-mono">{ref.token}</span>
                        <button
                          type="button"
                          aria-label={`${t('common.remove', { defaultValue: 'Remove' })} ${ref.token}`}
                          onClick={() => removeReference(ref)}
                          className="opacity-60 transition-opacity hover:opacity-100"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    {references.some((r) => r.kind === 'book') && (
                      <RefPdfToggle
                        on={attachRefPdf}
                        onToggle={() => setAttachRefPdf((v) => !v)}
                        label={t('ledger.outlook.ref.attachPdf', {
                          defaultValue: 'Attach the reference’s PDF when available',
                        })}
                        pdfLabel={t('ledger.outlook.ref.pdf', { defaultValue: 'PDF' })}
                      />
                    )}
                  </div>
                )}

                <RichEditor
                  name="body"
                  variant="full"
                  fillHeight
                  minHeightPx={220}
                  label_en={t('compose.body', { defaultValue: 'Message' })}
                  label_ar={t('compose.body', { defaultValue: 'Message' })}
                  defaultValue={initial.body}
                />

                {/* Attachments — draft-only cargo, so hidden in mailto mode. */}
                {effectiveMode === 'draft' && (
                  <div className="flex shrink-0 flex-col gap-2">
                    <Label className="flex items-center gap-1.5 text-xs">
                      <Paperclip className="h-3.5 w-3.5" />
                      {t('compose.attachments', { defaultValue: 'Attachments' })}
                      {allFiles.length > 0 && (
                        <span className="text-muted-foreground">({allFiles.length})</span>
                      )}
                    </Label>
                    <div
                      onDragOver={(e) => {
                        e.preventDefault()
                        setDragOver(true)
                      }}
                      onDragLeave={() => setDragOver(false)}
                      onDrop={(e) => {
                        e.preventDefault()
                        setDragOver(false)
                        addFiles(e.dataTransfer.files)
                      }}
                      onClick={() => fileInputRef.current?.click()}
                      className={cn(
                        'flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-4 text-sm transition-colors',
                        dragOver
                          ? 'border-primary bg-primary-soft text-primary'
                          : 'border-border bg-surface-tinted text-muted-foreground hover:border-primary/60',
                      )}
                    >
                      <Paperclip className="h-4 w-4" strokeWidth={1.5} />
                      <span>
                        {t('compose.dropFiles', {
                          defaultValue: 'Drop files here or click to browse',
                        })}
                      </span>
                      <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        className="hidden"
                        onChange={(e) => {
                          addFiles(e.target.files)
                          e.target.value = ''
                        }}
                      />
                    </div>
                    {files.length > 0 && (
                      <ul className="flex flex-col gap-1.5">
                        {files.map((f, i) => (
                          <li
                            key={`${f.name}-${f.size}-${i}`}
                            className="flex items-center gap-2 rounded-lg bg-surface-tinted px-3 py-2 text-sm"
                          >
                            <Paperclip
                              className="h-3.5 w-3.5 shrink-0 text-muted-foreground"
                              strokeWidth={1.5}
                            />
                            <span className="min-w-0 flex-1 truncate">{f.name}</span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {formatBytes(f.size)}
                            </span>
                            <button
                              type="button"
                              onClick={() => setFiles(files.filter((_, x) => x !== i))}
                              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                              aria-label={t('common.remove', { defaultValue: 'Remove' })}
                            >
                              <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                    {refPdfList.map((f) => (
                      <div
                        key={`refpdf-${f.name}`}
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <Paperclip className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                        <span className="min-w-0 truncate" dir="auto">
                          {f.name}
                        </span>
                        <span className="flex-none rounded-sm bg-primary-soft px-1 py-0.5 text-[10px] font-semibold uppercase text-primary-on-soft">
                          {refLabel}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-hairline bg-surface px-6 py-3">
              {effectiveMode === 'draft' && (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={useSignature}
                    onChange={(e) => setUseSignature(e.target.checked)}
                    className="h-3.5 w-3.5 accent-primary"
                  />
                  {t('compose.includeSignature')}
                </label>
              )}
              <Button type="button" variant="secondary" className="rounded-full" onClick={handleClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" className="rounded-full" disabled={handoffMutation.isPending}>
                {handoffMutation.isPending ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Send className="h-3.5 w-3.5" />
                )}
                {t('ledger.outlook.handoff.submit')}
              </Button>
            </div>
          </form>
        </FormProvider>
      )}

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('ledger.outlook.handoff.discardTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('ledger.outlook.handoff.discardDesc')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction
              onClick={() => {
                setDiscardOpen(false)
                onClose()
              }}
              className="bg-accent text-white hover:bg-accent/90"
            >
              {t('ledger.draftCompose.discard', { defaultValue: 'Discard' })}
            </AlertDialogAction>
            <AlertDialogCancel onClick={() => setDiscardOpen(false)}>
              {t('ledger.draftCompose.keepEditing', { defaultValue: 'Keep editing' })}
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

// ─── local presentational pieces ─────────────────────────────────────────────

/**
 * One handoff mode. A real radio (not a styled div) so the group is a single
 * arrow-key stop and screen readers announce "1 of 2"; the checkmark backs the
 * colour up so selection is never colour-only.
 *
 * The wrapping <label> would otherwise fold the consequence line into the
 * radio's accessible name ("Draft in Outlook Full formatting, your signature…").
 * An explicit `aria-label` keeps the name exactly the visible mode label and
 * `aria-describedby` hands the consequence over as a description, which is
 * where assistive tech expects it.
 */
function ModeOption({
  id,
  checked,
  disabled,
  label,
  hint,
  onSelect,
}: {
  id: string
  checked: boolean
  disabled: boolean
  label: string
  hint: string
  onSelect: () => void
}): React.JSX.Element {
  const hintId = `${id}-hint`
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 transition-colors',
        disabled ? 'cursor-not-allowed opacity-55' : 'hover:bg-surface-tinted',
      )}
    >
      <input
        type="radio"
        name="handoff-mode"
        checked={checked}
        disabled={disabled}
        onChange={onSelect}
        aria-label={label}
        aria-describedby={hintId}
        className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
      />
      <span className="min-w-0">
        <span className="flex items-center gap-1.5 text-[0.86em] font-semibold text-foreground">
          {label}
          {checked && <Check className="h-3 w-3 text-primary" strokeWidth={2.6} aria-hidden />}
        </span>
        <span
          id={hintId}
          className="mt-px block text-[0.76em] leading-snug text-muted-foreground"
          dir="auto"
        >
          {hint}
        </span>
      </span>
    </label>
  )
}

function RefPdfToggle({
  on,
  onToggle,
  label,
  pdfLabel,
}: {
  on: boolean
  onToggle: () => void
  label: string
  pdfLabel: string
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      title={label}
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-semibold transition-colors',
        on
          ? 'bg-primary text-primary-foreground hover:bg-primary-hover'
          : 'bg-surface-tinted text-muted-foreground hover:bg-surface-tinted/70',
      )}
    >
      <Paperclip className="h-3 w-3" strokeWidth={2} aria-hidden />
      {pdfLabel}
    </button>
  )
}

function WinBtn({
  label,
  onClick,
  children,
}: {
  label: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="grid h-7 w-7 flex-none place-items-center rounded-md text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  )
}
