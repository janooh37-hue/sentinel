import { api, type OutlookHandoffCreated, type OutlookHandoffRead } from './api'
import { clearBasket, type BasketKey } from './emailBasket'
import { gNumberRegex } from './gnumber'
import type { ComposeReference } from './composeReference'

export interface BasketPrefill {
  to: string[]
  subject: string
  bodyHtml: string
  references: ComposeReference[]
  attachRefPdf: true
  basketKey: BasketKey
}

export type OutlookTerminalStatus = 'completed' | 'failed' | 'expired'

export class OutlookBridgeError extends Error {
  readonly code: string

  constructor(message: string, code = 'OUTLOOK_HANDOFF_FAILED') {
    super(message)
    this.name = 'OutlookBridgeError'
    this.code = code
  }
}

export interface OutlookPollingOptions {
  pollIntervalMs?: number
  maxWaitMs?: number
}

export interface OutlookLaunchOptions extends OutlookPollingOptions {
  launch?: (protocolUrl: string) => void
}

const DEFAULT_POLL_INTERVAL_MS = 1_000
const MAX_HANDOFF_WAIT_MS = 5 * 60_000
const PROTOCOL_PREFIX = 'gssg-outlook://'

/** Open the signed classic-Outlook protocol without leaving a stale anchor in the DOM. */
export function launchOutlook(protocolUrl: string): void {
  if (!protocolUrl.startsWith(PROTOCOL_PREFIX)) {
    throw new OutlookBridgeError('Invalid Outlook protocol URL', 'INVALID_PROTOCOL_URL')
  }
  if (typeof document === 'undefined' || !document.body) {
    throw new OutlookBridgeError('Outlook can only be launched from the desktop app', 'DESKTOP_REQUIRED')
  }
  const anchor = document.createElement('a')
  anchor.href = protocolUrl
  anchor.hidden = true
  anchor.setAttribute('aria-hidden', 'true')
  document.body.append(anchor)
  try {
    anchor.click()
  } finally {
    anchor.remove()
  }
}

function employeeIdIsValid(employeeId: string): boolean {
  const value = employeeId.trim()
  if (!value) return false
  const matches = [...value.matchAll(gNumberRegex())]
  return matches.length === 1 && matches[0]?.[0].toUpperCase() === value.toUpperCase()
}

function assertEmployeeId(employeeId: string | undefined): void {
  if (employeeId !== undefined && !employeeIdIsValid(employeeId)) {
    throw new OutlookBridgeError('The employee ID is not a valid G-number', 'INVALID_EMPLOYEE_ID')
  }
}

function protocolUrl(created: OutlookHandoffCreated): string {
  return created.protocol_url ?? `${PROTOCOL_PREFIX}${created.kind}/${encodeURIComponent(created.token)}`
}

function terminalError(status: OutlookHandoffRead): OutlookBridgeError {
  const code = status.failure_code ?? (status.status === 'expired' ? 'HANDOFF_EXPIRED' : 'OUTLOOK_HANDOFF_FAILED')
  return new OutlookBridgeError(
    status.failure_code ?? (status.status === 'expired' ? 'The Outlook handoff expired' : 'Outlook could not complete the handoff'),
    code,
  )
}
/** Poll the authenticated handoff until Outlook has finished or the five-minute bound expires. */
export async function waitForOutlookHandoff(
  handoffId: number,
  options: OutlookPollingOptions = {},
): Promise<OutlookHandoffRead> {
  const intervalMs = Math.max(1, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
  const maxWaitMs = Math.min(MAX_HANDOFF_WAIT_MS, Math.max(1, options.maxWaitMs ?? MAX_HANDOFF_WAIT_MS))
  const deadline = Date.now() + maxWaitMs

  while (Date.now() <= deadline) {
    const status = await api.getOutlookHandoff(handoffId)
    if (status.status === 'completed') return status
    if (status.status === 'failed' || status.status === 'expired') throw terminalError(status)

    const remaining = deadline - Date.now()
    if (remaining <= 0) break
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, Math.min(intervalMs, remaining))
    })
  }

  throw new OutlookBridgeError('Outlook handoff timed out', 'HANDOFF_TIMEOUT')
}

function composeAttachments(prefill: BasketPrefill): Array<{
  kind: 'document_pdf'
  document_id: number
  filename: string
}> {
  return prefill.references.map((reference) => {
    if (reference.kind !== 'book' || reference.docId == null || !reference.fileName) {
      throw new OutlookBridgeError('Every basket reference must have a PDF document', 'ATTACHMENT_MISSING')
    }
    assertEmployeeId(reference.employeeId)
    return {
      kind: 'document_pdf' as const,
      document_id: reference.docId,
      filename: reference.fileName,
    }
  })
}

/** Create an Outlook draft and clear its basket only after terminal completion. */
export async function prepareBasketInOutlook(
  prefill: BasketPrefill,
  options: OutlookLaunchOptions = {},
): Promise<OutlookHandoffRead> {
  const created = await api.createOutlookHandoff({
    kind: 'compose',
    payload: {
      to: prefill.to,
      cc: [],
      subject: prefill.subject,
      body_html: prefill.bodyHtml,
      basket_key: prefill.basketKey,
      attachments: composeAttachments(prefill),
    },
  })
  ;(options.launch ?? launchOutlook)(protocolUrl(created))
  const terminal = await waitForOutlookHandoff(created.id, options)
  clearBasket(prefill.basketKey)
  return terminal
}

/** Open one historical email in classic Outlook; non-email rows never call this helper. */
export async function openCorrespondenceInOutlook(
  entryId: number,
  employeeId?: string,
  options: OutlookLaunchOptions = {},
): Promise<OutlookHandoffRead> {
  assertEmployeeId(employeeId)
  if (!Number.isSafeInteger(entryId) || entryId <= 0) {
    throw new OutlookBridgeError('The correspondence ID is invalid', 'INVALID_CORRESPONDENCE_ID')
  }
  const created = await api.createOutlookHandoff({
    kind: 'open',
    payload: { ledger_entry_id: entryId },
  })
  ;(options.launch ?? launchOutlook)(protocolUrl(created))
  return waitForOutlookHandoff(created.id, options)
}
