/**
 * LedgerEmailCompose — full-page email composer (new / reply / forward).
 *
 * Reuses the RichEditor (minimal variant) for the body. On send, hits POST
 * /api/v1/email/send which:
 *   - posts the message via SMTP,
 *   - persists a LedgerEntry with direction=outgoing (or internal if all
 *     parties are on the operator's domain) so it shows up in the timeline
 *     immediately.
 *
 * Tagged addresses are entered as a token input (Enter / comma to commit).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useForm, FormProvider, Controller } from 'react-hook-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ArrowLeft, Send, Loader2, Paperclip, X, Check, Plus, Minus, Maximize2, Minimize2 } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import type { DraftWrite, EmployeeListItem, LedgerEntryRead } from '@/lib/api'
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
import {
  ReferencePicker,
  type ComposeReference,
} from '@/components/ledger/ReferencePicker'
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

const SIGNATURE_MARKER = '<!-- gssg-signature -->'

function wrapSignature(html: string): string {
  if (!html.trim()) return ''
  if (html.includes(SIGNATURE_MARKER)) return html
  return `${SIGNATURE_MARKER}<div data-gssg-signature>${html}</div>`
}

/** Prepend the signature block to a body (no-op if empty or already present). */
function addSignatureBlock(html: string, sigHtml: string, mode: string): string {
  if (!sigHtml.trim() || html.includes(SIGNATURE_MARKER)) return html
  const wrapped = wrapSignature(sigHtml)
  return mode === 'new' ? `${wrapped}${html}` : `${wrapped}<br>${html}`
}

/** Remove the auto-inserted signature block (and its marker comment) from a body. */
function stripSignatureBlock(html: string): string {
  if (!html.includes('data-gssg-signature') && !html.includes(SIGNATURE_MARKER)) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelector('[data-gssg-signature]')?.remove()
  return doc.body.innerHTML.split(SIGNATURE_MARKER).join('')
}

/**
 * A reference's body token line. Tagged with `data-gssg-ref` so we can find and
 * strip it precisely on chip removal without disturbing the rest of the body.
 * The bare token (the book ref / G-number) is what `decorateSmartLinks`
 * recognises on the reading-pane side.
 */
function refTokenLine(ref: ComposeReference, label: string): string {
  return `<div data-gssg-ref="${ref.kind}:${ref.id}">${label}: ${ref.token}</div>`
}

/** Append a reference's token line to the body html. */
function appendRefToken(body: string, line: string): string {
  return `${body}${line}`
}

/** Remove a reference's token line (matched by its data-gssg-ref attribute). */
function stripRefToken(body: string, ref: ComposeReference): string {
  const re = new RegExp(
    `<div data-gssg-ref="${ref.kind}:${ref.id}">[^<]*</div>`,
    'g',
  )
  return body.replace(re, '')
}

type ComposeMode = 'new' | 'reply' | 'replyall' | 'forward' | 'draft-edit'

interface LedgerEmailComposeProps {
  mode: ComposeMode
  source?: LedgerEntryRead
  /** When mode === 'draft-edit', the existing draft entry to resume. */
  draft?: LedgerEntryRead
  /** Optional pre-fill for `new`-mode composes (e.g. from Leaves batch confirm
   *  or the email basket). */
  prefill?: {
    to?: string[]
    cc?: string[]
    subject?: string
    bodyHtml?: string
    references?: ComposeReference[]
    attachRefPdf?: boolean
    basketKey?: string
  }
  /** 'page' (mobile/full-screen): ← Back header + page card. 'window'
   *  (desktop modal): title-bar + ✕, flush body. Defaults to 'page'. */
  chrome?: 'page' | 'window'
  /** Window frame controls (desktop only); provided by ComposeWindow. */
  windowControls?: ComposeWindowControls
  onClose: () => void
  onSent: (entryId: number) => void
}

interface FormValues {
  to: string[]
  cc: string[]
  subject: string
  body: string
}

const EMAIL_LIKE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function extractAddress(counterparty: string): string {
  // "Name <addr@example>"  → "addr@example"; "addr@example" → "addr@example";
  // "Display Name only" → "" (no usable address).
  const m = counterparty.match(/<([^>]+)>/)
  if (m) return m[1].trim()
  if (EMAIL_LIKE.test(counterparty.trim())) return counterparty.trim()
  return ''
}

/** Recipients addresses (chip arrays), minus the operator's own address. */
function withoutSelf(addresses: string[], self: string | undefined): string[] {
  const me = self?.trim().toLowerCase()
  const seen = new Set<string>()
  const out: string[] = []
  for (const addr of addresses) {
    const key = addr.trim().toLowerCase()
    if (!key) continue
    if (me && key === me) continue
    if (seen.has(key)) continue
    seen.add(key)
    out.push(addr.trim())
  }
  return out
}

// Attachment guard — keep total payload well under typical SMTP limits.
const MAX_ATTACHMENTS_BYTES = 20 * 1024 * 1024

function quoteOriginal(
  entry: LedgerEntryRead,
  t: (key: string, options?: Record<string, unknown>) => string,
): string {
  const when = entry.entry_date
  const from = entry.counterparty
  const header = t('ledger.composeQuoteHeader', {
    when,
    from,
    defaultValue: 'On {{when}}, {{from}} wrote:',
  })
  return (
    `<br><br><div style="border-inline-start:3px solid #ccc;padding-inline-start:12px;margin-top:12px;color:#555;">` +
    `<div style="margin-bottom:6px;font-size:0.85em;">${header}</div>` +
    (entry.notes_html ?? '') +
    `</div>`
  )
}

function buildReplySubject(orig: string): string {
  return orig.match(/^\s*(re|fwd?|رد|توجيه):/i) ? orig : `Re: ${orig}`
}

function buildForwardSubject(orig: string): string {
  return orig.match(/^\s*(re|fwd?|رد|توجيه):/i) ? orig : `Fwd: ${orig}`
}

export function LedgerEmailCompose({
  mode,
  source,
  draft,
  prefill,
  chrome = 'page',
  windowControls,
  onClose,
  onSent,
}: LedgerEmailComposeProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const { identity } = useIdentity()
  const selfAddress = identity?.email ?? undefined

  // Pre-fill from `source`/`draft` based on the compose mode.
  const initial: FormValues = (() => {
    if (mode === 'draft-edit' && draft) {
      const meta = draft.draft_meta ?? {}
      return {
        to: meta.to ?? [],
        cc: meta.cc ?? [],
        subject: draft.subject,
        body: draft.notes_html ?? '',
      }
    }
    if (mode === 'reply' && source) {
      const addr = extractAddress(source.counterparty)
      return {
        to: addr ? [addr] : [],
        cc: [],
        subject: buildReplySubject(source.subject),
        body: quoteOriginal(source, t),
      }
    }
    if (mode === 'replyall' && source) {
      // To = the original sender + all original To recipients; Cc = the
      // original Cc — both minus the operator's own address (dedup).
      const sender = extractAddress(source.counterparty)
      const to = withoutSelf(
        [
          ...(sender ? [sender] : []),
          ...(source.to_recipients ?? []).map((a) => a.address),
        ],
        selfAddress,
      )
      const cc = withoutSelf(
        (source.cc_recipients ?? []).map((a) => a.address),
        selfAddress,
      )
      return {
        to,
        cc,
        subject: buildReplySubject(source.subject),
        body: quoteOriginal(source, t),
      }
    }
    if (mode === 'forward' && source) {
      return {
        to: [],
        cc: [],
        subject: buildForwardSubject(source.subject),
        body: quoteOriginal(source, t),
      }
    }
    // `new` mode with an optional prefill (e.g. from Leaves batch-confirmation).
    // The signature-prepend effect fires after mount and does `${wrapped}${current}`,
    // so placing the prefilled table in `body` here means the signature ends up
    // BEFORE the table — matching the standard `new` behaviour (signature first,
    // content below). An empty prefill body falls through to '' just as before.
    return {
      to: prefill?.to ?? [],
      cc: prefill?.cc ?? [],
      subject: prefill?.subject ?? '',
      body: prefill?.bodyHtml ?? '',
    }
  })()

  const methods = useForm<FormValues>({ defaultValues: initial })
  const { control, register, handleSubmit, formState: { errors }, setValue, getValues, watch } = methods
  const [files, setFiles] = useState<File[]>([])
  const [attachOpen, setAttachOpen] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const [useSignature, setUseSignature] = useState(true)
  // Cc row is on-demand (To-row "Cc" control) but always shown when prefilled
  // (draft-edit / reply-all with an original Cc).
  const [showCc, setShowCc] = useState<boolean>((initial.cc ?? []).length > 0)
  const ccRevealedByUser = useRef(false)
  const ccRowRef = useRef<HTMLDivElement>(null)
  const signaturePrependedRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // --- recipient autocomplete data ---------------------------------------
  // Saved address-book contacts feed the autocomplete's "Address book" group.
  const contactsQuery = useQuery({
    queryKey: ['ledger-contacts'],
    queryFn: () => api.listLedgerContacts(),
    staleTime: 60_000,
  })
  const contacts = contactsQuery.data ?? []

  // Debounced employee search backing the chip-input's "Employees" group. The
  // chip input calls `employeeQuery(q)` synchronously, so we keep the latest
  // results keyed by the debounced query.
  const [empQuery, setEmpQuery] = useState('')
  const debounceRef = useRef<number | null>(null)
  const requestEmployees = useCallback((q: string) => {
    // To and Cc share this one debounce; an idle (empty) field must not clobber
    // the active field's query, so empty input is a no-op (the chip input shows
    // `[]` locally for an empty draft anyway).
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

  // --- references (Ref row + Add-reference picker) -----------------------
  // The entry model holds ONE related_book_id + ONE related_employee_id; we
  // structurally link the first of each on send (below) and keep every ref as a
  // body smartlink token (which still resolves on read). See plan §Out-of-scope.
  const [references, setReferences] = useState<ComposeReference[]>(
    prefill?.references ?? [],
  )
  const [refPickerOpen, setRefPickerOpen] = useState(false)
  // Attach-reference-PDF toggle (default ON, matching the accepted live variant).
  const [attachRefPdf, setAttachRefPdf] = useState(prefill?.attachRefPdf ?? true)
  // PDFs auto-attached from book references, keyed by backing document id.
  const [refPdfFiles, setRefPdfFiles] = useState<Map<number, File>>(new Map())
  const refPdfInFlight = useRef<Set<number>>(new Set())
  const addRefBtnRef = useRef<HTMLButtonElement>(null)

  const refLabel = t('ledger.outlook.ref.label', { defaultValue: 'Ref' })

  const addReference = useCallback(
    (ref: ComposeReference) => {
      // De-dupe by kind+id; don't double-insert a token.
      let added = false
      setReferences((prev) => {
        if (prev.some((r) => r.kind === ref.kind && r.id === ref.id)) return prev
        added = true
        return [...prev, ref]
      })
      if (added) {
        const current = getValues('body') ?? ''
        setValue('body', appendRefToken(current, refTokenLine(ref, refLabel)), {
          shouldDirty: true,
        })
      }
    },
    [getValues, setValue, refLabel],
  )

  const removeReference = useCallback(
    (ref: ComposeReference) => {
      setReferences((prev) =>
        prev.filter((r) => !(r.kind === ref.kind && r.id === ref.id)),
      )
      const current = getValues('body') ?? ''
      setValue('body', stripRefToken(current, ref), { shouldDirty: true })
    },
    [getValues, setValue],
  )

  // Keep `refPdfFiles` in sync with the book references + toggle: fetch each
  // referenced book's PDF once when the toggle is on; drop PDFs whose ref was
  // removed or when the toggle goes off. Fetch failures / books without a doc
  // are skipped silently — attaching a companion PDF must never block send.
  //
  // No per-activation "cancelled" guard: results are always kept. A PDF whose
  // ref was removed mid-fetch is pruned by the drop-stale pass on the next run
  // (the add itself changes `refPdfFiles`, re-running this effect). `refPdfFiles`
  // stays in the deps so that prune pass fires; `refPdfInFlight` (a ref) prevents
  // double-fetching the same doc across re-runs (and StrictMode double-invoke).
  useEffect(() => {
    const desired = desiredRefPdfDocIds(references, attachRefPdf)
    const desiredSet = new Set(desired)

    // Drop PDFs (and in-flight markers) no longer desired.
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

    // Fetch desired-but-missing PDFs (skip ones already attached or in flight).
    for (const id of desired) {
      if (refPdfFiles.has(id) || refPdfInFlight.current.has(id)) continue
      refPdfInFlight.current.add(id)
      const ref = references.find((r) => r.kind === 'book' && r.docId === id)
      const fileName =
        ref && ref.kind === 'book' && ref.fileName ? ref.fileName : `reference-${id}.pdf`
      void (async () => {
        try {
          // Fetch as base64 text (not binary) so Internet Download Manager
          // doesn't intercept the application/pdf response — same bypass as the
          // Records viewer.
          const res = await fetch(`${api.documentDownloadUrl(id, 'pdf')}&encoding=base64`, {
            credentials: 'same-origin',
          })
          if (!res.ok) return
          const file = base64PdfToFile(await res.text(), fileName)
          setRefPdfFiles((prev) => {
            const n = new Map(prev)
            n.set(id, file)
            return n
          })
        } catch {
          // skip — never block send on a companion-PDF fetch failure
        } finally {
          refPdfInFlight.current.delete(id)
        }
      })()
    }
  }, [references, attachRefPdf, refPdfFiles])

  const refPdfList = useMemo(() => [...refPdfFiles.values()], [refPdfFiles])
  const allFiles = useMemo(() => mergeFiles(files, refPdfList), [files, refPdfList])

  // Picking an employee from the To/Cc autocomplete is a *reference* affordance
  // (employees carry no email in the schema), not an address — route it to the
  // Ref row as a 👤 employee reference (G-number chip + body token).
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

  // Phase 16 — auto-save as draft.
  // `draftId` starts non-null when resuming an existing draft.
  const [draftId, setDraftId] = useState<number | null>(
    mode === 'draft-edit' && draft ? draft.id : null,
  )
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)

  const upsertDraft = useMutation({
    mutationFn: (body: DraftWrite) => api.upsertDraft(draftId, body),
    onSuccess: (entry) => {
      setDraftId(entry.id)
      setLastSavedAt(new Date())
    },
    // Hook-level onSettled still runs after unmount (TanStack v5), so a
    // close-time save refreshes the shell's Drafts list once the write lands.
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['ledger'] })
    },
    // Auto-save errors stay silent; the operator should still be able to send.
  })

  // Phase 15 — preload the operator's signature into the editor on mount.
  // For `new`, prepend before any default body. For `reply`/`forward`, splice
  // the signature in *before* the existing quoted-original block so replies
  // read top-down: greeting, signature, then quote.
  const signatureQuery = useQuery({
    queryKey: ['email-signature'],
    queryFn: () => api.getEmailSignature(),
    staleTime: 60_000,
  })

  useEffect(() => {
    if (signaturePrependedRef.current) return
    // Wait until the signature query has actually resolved (even to an empty
    // string) before unlocking the auto-save effect — otherwise a brand-new
    // compose would save before mount stabilises.
    if (signatureQuery.data === undefined) return
    const sigHtml = signatureQuery.data?.value ?? ''
    if (!sigHtml.trim()) {
      signaturePrependedRef.current = true
      return
    }
    const wrapped = wrapSignature(sigHtml)
    const current = getValues('body') ?? ''
    if (current.includes(SIGNATURE_MARKER)) {
      signaturePrependedRef.current = true
      return
    }
    const next =
      mode === 'new'
        ? `${wrapped}${current}`
        : `${wrapped}<br>${current}`
    setValue('body', next, { shouldDirty: false })
    signaturePrependedRef.current = true
  }, [signatureQuery.data, mode, setValue, getValues])

  // "Include signature" toggle — the signature is baked into the editor body
  // (not just a send-time flag), so checking/unchecking must add/remove the
  // block in-place, otherwise unchecking leaves the signature visible + sent.
  const handleToggleSignature = useCallback(
    (enabled: boolean) => {
      setUseSignature(enabled)
      const sigHtml = signatureQuery.data?.value ?? ''
      if (!sigHtml.trim()) return
      const current = getValues('body') ?? ''
      const next = enabled
        ? addSignatureBlock(current, sigHtml, mode)
        : stripSignatureBlock(current)
      if (next !== current) setValue('body', next, { shouldDirty: true })
    },
    [signatureQuery.data, mode, getValues, setValue],
  )

  // Auto-save: subscribe to form changes via the RHF callback API (no `watch()`
  // call during render). Each meaningful change schedules a 1s debounce; the
  // operator stopping triggers the upsert. Once `draftId` is set the next
  // upsertDraft call becomes a PATCH automatically.
  const upsertDraftMutate = upsertDraft.mutate
  useEffect(() => {
    let timeout: number | null = null
    // eslint-disable-next-line react-hooks/incompatible-library
    const subscription = methods.watch((values) => {
      if (!signaturePrependedRef.current) return
      const subject = values.subject ?? ''
      const body = values.body ?? ''
      const toList = (values.to ?? []).filter((a): a is string => Boolean(a))
      const ccList = (values.cc ?? []).filter((a): a is string => Boolean(a))
      if (
        !subject.trim() &&
        !body.trim() &&
        toList.length === 0 &&
        ccList.length === 0
      ) {
        return
      }
      if (timeout != null) window.clearTimeout(timeout)
      timeout = window.setTimeout(() => {
        upsertDraftMutate({
          to: toList,
          cc: ccList,
          subject,
          html: body,
          in_reply_to:
            mode === 'reply' && source ? tagToMessageId(source.tags) : null,
          references: null,
        })
      }, 1000)
    })
    return () => {
      subscription.unsubscribe()
      if (timeout != null) window.clearTimeout(timeout)
    }
  }, [methods, mode, source, upsertDraftMutate])

  // Discard helper used by the close-prompt + empty-close cleanup.
  const deleteDraftMutation = useMutation({
    mutationFn: (id: number) => api.deleteDraft(id),
    // Runs even after unmount — the shell's list invalidation must not race
    // a close-time delete (see upsertDraft.onSettled).
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['ledger'] })
    },
  })

  // The compose has user content worth keeping if any recipient/subject is set
  // or the body has text beyond the auto-prepended signature block.
  const hasContent = useCallback((): boolean => {
    const v = getValues()
    // DOM-based strip: survives nested <div>s inside the signature and the
    // editor re-serializing the bare attribute as data-gssg-signature="".
    // textContent drops tags and decodes entities (&nbsp; becomes U+00A0).
    const doc = new DOMParser().parseFromString(v.body ?? '', 'text/html')
    doc.querySelector('[data-gssg-signature]')?.remove()
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
    // Nothing worth keeping — drop any (empty) auto-saved backing draft and close.
    if (draftId != null) deleteDraftMutation.mutate(draftId)
    onClose()
  }, [hasContent, draftId, deleteDraftMutation, onClose])

  const handleSaveAndClose = useCallback(() => {
    setDiscardOpen(false)
    const v = getValues()
    upsertDraft.mutate({
      to: (v.to ?? []).filter(Boolean),
      cc: (v.cc ?? []).filter(Boolean),
      subject: v.subject ?? '',
      html: v.body ?? '',
      in_reply_to: mode === 'reply' && source ? tagToMessageId(source.tags) : null,
      references: null,
    })
    onClose()
  }, [getValues, upsertDraft, mode, source, onClose])

  const handleDiscardConfirm = useCallback(() => {
    setDiscardOpen(false)
    if (draftId != null) deleteDraftMutation.mutate(draftId)
    onClose()
  }, [draftId, deleteDraftMutation, onClose])

  // Escape is handled on the compose ROOT (onKeyDown below), not on window —
  // the window is non-modal, so a window-level listener would close the compose
  // while the operator works the mailbox behind it.

  // Focus management: minimizing/restoring swaps the title-bar control set,
  // which would otherwise drop focus to <body>. On an actual state TRANSITION
  // (never on first mount — ComposeWindow owns mount focus) move focus to the
  // strip title when minimizing, and back into the first form field on restore.
  const rootRef = useRef<HTMLDivElement>(null)
  const prevWinState = useRef(windowControls?.state)
  useEffect(() => {
    const prev = prevWinState.current
    const next = windowControls?.state
    prevWinState.current = next
    if (prev === undefined || next === undefined || prev === next) return
    const root = rootRef.current
    if (!root) return
    if (next === 'minimized') {
      root.querySelector<HTMLElement>('#ledger-compose-title')?.focus()
    } else if (prev === 'minimized') {
      root
        .querySelector<HTMLElement>('input, textarea, [contenteditable="true"]')
        ?.focus()
    }
  }, [windowControls?.state])

  // Focus the Cc chips input when the operator explicitly reveals the Cc row.
  // We must NOT do this on initial seeding (replyall prefill) or list-apply —
  // only when the user clicked the "Cc" toggle button.
  useEffect(() => {
    if (!showCc || !ccRevealedByUser.current) return
    ccRevealedByUser.current = false
    ccRowRef.current?.querySelector('input')?.focus()
  }, [showCc])

  // After the entry is created, structurally link the first book + first
  // employee reference via PATCH /ledger/{id} (the send/draft endpoints don't
  // accept related_*). Extra refs remain as body smartlink tokens.
  const linkReferences = useCallback(
    async (entryId: number): Promise<void> => {
      if (references.length === 0) return
      const firstBook = references.find((r) => r.kind === 'book')
      const firstEmployee = references.find((r) => r.kind === 'employee')
      if (!firstBook && !firstEmployee) return
      await api.updateLedgerEntry(entryId, {
        related_book_id: firstBook ? firstBook.id : null,
        related_employee_id: firstEmployee ? String(firstEmployee.id) : null,
      })
    },
    [references],
  )

  const sendMutation = useMutation({
    mutationFn: async (values: FormValues): Promise<number> => {
      const totalBytes = allFiles.reduce((sum, f) => sum + f.size, 0)
      if (totalBytes > MAX_ATTACHMENTS_BYTES) {
        throw new Error(
          t('compose.attachmentsTooLarge', {
            max: formatBytes(MAX_ATTACHMENTS_BYTES),
            defaultValue: 'Attachments exceed the {{max}} limit',
          }),
        )
      }
      const to = (values.to ?? []).filter(Boolean)
      const cc = (values.cc ?? []).filter(Boolean)
      if (to.length === 0) {
        throw new Error(
          t('compose.toRequired', {
            defaultValue: 'At least one recipient is required',
          }),
        )
      }
      // Drafts can only be promoted server-side when there are no
      // newly-staged file attachments — those don't live in the draft. If the
      // operator attached files locally, we must fall back to the standard
      // multipart send path.
      if (draftId != null && allFiles.length === 0) {
        // Flush the latest changes into the draft before promoting it.
        await api.upsertDraft(draftId, {
          to,
          cc,
          subject: values.subject,
          html: values.body,
          in_reply_to:
            mode === 'reply' && source ? tagToMessageId(source.tags) : null,
          references: null,
        })
        const entry = await api.sendDraft(draftId)
        await linkReferences(entry.id)
        return entry.id
      }
      // If we'd previously buffered a draft but the operator added files,
      // promoting via the draft path is the wrong call. Delete the draft and
      // route through the standard email-send path.
      if (draftId != null) {
        try {
          await api.deleteDraft(draftId)
        } catch {
          // ignore — promote-by-send is more important than draft cleanup.
        }
      }
      const r = await api.sendEmail(
        {
          to,
          cc,
          subject: values.subject,
          html: values.body,
          in_reply_to:
            mode === 'reply' && source ? tagToMessageId(source.tags) : null,
          references: null,
          use_signature: useSignature,
        },
        allFiles,
      )
      await linkReferences(r.ledger_entry_id)
      return r.ledger_entry_id
    },
    onSuccess: (entryId) => {
      // Once Send succeeds the draft is gone server-side; clear local state.
      setDraftId(null)
      // Record recipients for recency ranking (no UI reads this yet — future frequency-ranked suggestions).
      const vals = methods.getValues()
      for (const addr of [...(vals.to ?? []), ...(vals.cc ?? [])]) {
        pushRecentRecipient(addr)
      }
      if (prefill?.basketKey) {
        recordRecipientsForForm(prefill.basketKey, (vals.to ?? []).filter(Boolean))
        clearBasket(prefill.basketKey)
      }
      toast.success(t('compose.sent', { defaultValue: 'Email sent' }))
      onSent(entryId)
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : (err as Error).message),
  })

  function onSubmit(values: FormValues): void {
    sendMutation.mutate(values)
  }

  function addFiles(list: FileList | null): void {
    if (!list) return
    const next = [...files]
    for (const f of Array.from(list)) {
      // Dedup by name+size — good enough for the dialog.
      if (!next.some((x) => x.name === f.name && x.size === f.size)) {
        next.push(f)
      }
    }
    const total = next.reduce((sum, f) => sum + f.size, 0)
    if (total > MAX_ATTACHMENTS_BYTES) {
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

  function removeFile(idx: number): void {
    setFiles(files.filter((_, i) => i !== idx))
  }

  function formatBytes(b: number): string {
    if (b < 1024) return `${b} B`
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
    return `${(b / 1024 / 1024).toFixed(1)} MB`
  }

  const title =
    mode === 'reply'
      ? t('compose.title.reply', { defaultValue: 'Reply' })
      : mode === 'replyall'
        ? t('compose.title.replyAll', { defaultValue: 'Reply All' })
        : mode === 'forward'
          ? t('compose.title.forward', { defaultValue: 'Forward' })
          : t('compose.title.new', { defaultValue: 'New email' })

  return (
    <div
      ref={rootRef}
      className="flex h-full min-h-0 flex-1 flex-col bg-background"
      onKeyDown={(e) => {
        // Scoped Escape-to-close: fires only when focus is inside the compose
        // (the window is non-modal — see comment at the focus effect above).
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
              id="ledger-compose-title"
              onClick={windowControls.restore}
              className="min-w-0 flex-1 truncate rounded-md text-start text-sm font-semibold tracking-tight text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {title}
              {source && ` — ${source.subject}`}
            </button>
          ) : (
            <h2
              id="ledger-compose-title"
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
          onSubmit={handleSubmit(onSubmit)}
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
                      current={{ to: watch('to') ?? [], cc: watch('cc') ?? [] }}
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
                      {t('ledger.outlook.ref.label', { defaultValue: 'Ref' })}
                    </button>
                  </div>
                </div>
                {errors.to && (
                  <span className="text-xs text-accent">
                    {t('compose.toRequired', { defaultValue: 'At least one recipient is required' })}
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

              {/* Cc row — on demand or when prefilled */}
              {showCc && (
                <div ref={ccRowRef} className="flex min-h-9 w-full rounded-md border border-input bg-surface px-2 py-1 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-1 focus-within:ring-offset-background">
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

              {/* Subject */}
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

              {/* Chip line — applied references + PDF toggle (only when present) */}
              {references.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  {references.map((ref) => (
                    <span
                      key={`${ref.kind}-${ref.id}`}
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11.5px] font-semibold',
                        ref.kind === 'employee' ? 'bg-primary-soft text-primary' : 'bg-accent-soft text-accent',
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
                      label={t('ledger.outlook.ref.attachPdf', { defaultValue: 'Attach the reference’s PDF when available' })}
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

              {/* Attachments — collapsed to a slim bar until used (reclaims body height). */}
              <div className="flex shrink-0 flex-col gap-2">
                {!attachOpen && files.length === 0 && refPdfList.length === 0 ? (
                  <button
                    type="button"
                    onClick={() => setAttachOpen(true)}
                    className="inline-flex w-fit items-center gap-1.5 rounded-md border border-border bg-surface-tinted px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
                  >
                    <Paperclip className="h-3.5 w-3.5" strokeWidth={1.7} />
                    {t('compose.attachments', { defaultValue: 'Attachments' })}
                  </button>
                ) : (
                  <>
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
                      className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed px-4 py-5 text-sm transition-colors ${
                        dragOver
                          ? 'border-primary bg-primary-soft text-primary'
                          : 'border-border bg-surface-tinted text-muted-foreground hover:border-primary/60'
                      }`}
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
                            <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                            <span className="min-w-0 flex-1 truncate">{f.name}</span>
                            <span className="font-mono text-xs text-muted-foreground">
                              {formatBytes(f.size)}
                            </span>
                            <button
                              type="button"
                              onClick={() => removeFile(i)}
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
                      <div key={`refpdf-${f.name}`} className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Paperclip className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                        <span className="min-w-0 truncate" dir="auto">{f.name}</span>
                        <span className="flex-none rounded-sm bg-primary-soft px-1 py-0.5 text-[10px] font-semibold uppercase text-primary-on-soft">
                          {t('ledger.outlook.ref.label', { defaultValue: 'Ref' })}
                        </span>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center justify-end gap-3 border-t border-hairline bg-surface px-6 py-3">
            <DraftSaveIndicator
              isSaving={upsertDraft.isPending}
              savedAt={lastSavedAt}
            />
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={useSignature}
                onChange={(e) => handleToggleSignature(e.target.checked)}
                className="h-3.5 w-3.5 accent-primary"
              />
              {t('compose.includeSignature')}
            </label>
            <Button
              type="button"
              variant="secondary"
              className="rounded-full"
              onClick={handleClose}
            >
              {t('common.cancel')}
            </Button>
            <Button
              type="submit"
              className="rounded-full"
              disabled={sendMutation.isPending}
            >
              {sendMutation.isPending ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              {t('compose.send', { defaultValue: 'Send' })}
            </Button>
          </div>
        </form>
      </FormProvider>
      )}

      {/* Close prompt — Save draft / Discard / Keep editing (3-way) */}
      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('ledger.draftCompose.saveTitle', {
                defaultValue: 'Save this as a draft?',
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('ledger.draftCompose.saveDesc', {
                defaultValue: 'Keep it in Drafts to finish later, or discard it.',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction onClick={handleSaveAndClose}>
              {t('ledger.draftCompose.saveAndClose', {
                defaultValue: 'Save draft',
              })}
            </AlertDialogAction>
            <AlertDialogAction
              onClick={handleDiscardConfirm}
              className="bg-accent text-white hover:bg-accent/90"
            >
              {t('ledger.draftCompose.discard', { defaultValue: 'Discard' })}
            </AlertDialogAction>
            <AlertDialogCancel onClick={() => setDiscardOpen(false)}>
              {t('ledger.draftCompose.keepEditing', {
                defaultValue: 'Keep editing',
              })}
            </AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )

}

function tagToMessageId(tags: string[]): string | null {
  const t = tags.find((x) => x.startsWith('msgid:'))
  return t ? `<${t.slice('msgid:'.length)}>` : null
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

interface DraftSaveIndicatorProps {
  isSaving: boolean
  savedAt: Date | null
}

function DraftSaveIndicator({
  isSaving,
  savedAt,
}: DraftSaveIndicatorProps): React.JSX.Element | null {
  const { t } = useTranslation()
  if (!isSaving && !savedAt) return null
  if (isSaving) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" strokeWidth={1.7} />
        {t('ledger.draftCompose.saving')}
      </span>
    )
  }
  const hh = String(savedAt!.getHours()).padStart(2, '0')
  const mm = String(savedAt!.getMinutes()).padStart(2, '0')
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Check className="h-3 w-3 text-success" strokeWidth={2} />
      {t('ledger.draftCompose.lastSaved', { time: `${hh}:${mm}` })}
    </span>
  )
}
