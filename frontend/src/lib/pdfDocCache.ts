/**
 * pdfDocCache — a small URL-keyed LRU of pdf.js `PDFDocumentProxy` objects.
 *
 * Before this, every zoom step, paper switch and remount re-fetched the bytes
 * and re-parsed the document (and nothing ever called `destroy()`, so each
 * parse leaked a worker-side document). Viewers now *lease* a document:
 *
 *   const lease = await leasePdfUrl(url)   // same proxy for the same URL
 *   … render lease.doc …
 *   lease.release()                        // on cleanup / unmount
 *
 * A document is destroyed when it is evicted (more than `PDF_DOC_CACHE_SIZE`
 * loaded entries, least-recently-used idle one first) — never while a lease is
 * still held. Idle entries older than `IDLE_TTL_MS` are dropped instead of
 * reused, so bytes regenerated under the same URL (adjusted signature, Word
 * save) are not served stale for long. A failed load is never cached, so a
 * "Retry" refetches.
 */
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'

import { base64ToBytes, pdfWorkerUrl, toBase64Url } from '@/lib/pdf'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export const PDF_DOC_CACHE_SIZE = 3
const IDLE_TTL_MS = 30_000

export interface PdfDocLease {
  readonly doc: PDFDocumentProxy
  /** Idempotent. The document stays cached (idle) until evicted. */
  release: () => void
}

interface Entry {
  key: string
  refs: number
  controller: AbortController
  promise: Promise<PDFDocumentProxy>
  doc: PDFDocumentProxy | null
  releasedAt: number
}

// Map insertion order = recency (oldest first); a touch re-inserts.
const entries = new Map<string, Entry>()

function destroyDoc(doc: PDFDocumentProxy): void {
  try {
    // Best-effort cleanup: a rejected destroy (or a test stub without one) is ignored.
    void Promise.resolve(doc.destroy()).catch(() => undefined)
  } catch {
    // ignore
  }
}

function drop(entry: Entry): void {
  if (entries.get(entry.key) === entry) entries.delete(entry.key)
  if (entry.doc) destroyDoc(entry.doc)
  else entry.controller.abort()
}

/** Evict least-recently-used idle documents until at most N are loaded. */
function trim(): void {
  let loaded = 0
  for (const e of entries.values()) if (e.doc) loaded += 1
  if (loaded <= PDF_DOC_CACHE_SIZE) return
  for (const e of [...entries.values()]) {
    if (loaded <= PDF_DOC_CACHE_SIZE) break
    if (e.doc && e.refs === 0) {
      drop(e)
      loaded -= 1
    }
  }
}

/**
 * Lease the document cached under `key`, loading it with `load` (which returns
 * the raw PDF bytes) on a miss. Concurrent leases of one key share one load.
 * Aborting `signal` before the document resolves releases the lease and
 * rejects with an `AbortError`.
 */
export function leasePdfDoc(
  key: string,
  load: (signal: AbortSignal) => Promise<Uint8Array>,
  signal?: AbortSignal,
): Promise<PdfDocLease> {
  let entry = entries.get(key)
  if (entry?.doc && entry.refs === 0 && Date.now() - entry.releasedAt > IDLE_TTL_MS) {
    drop(entry)
    entry = undefined
  }
  if (!entry) {
    const controller = new AbortController()
    const created: Entry = {
      key,
      refs: 0,
      controller,
      doc: null,
      releasedAt: Date.now(),
      promise: Promise.resolve(null as unknown as PDFDocumentProxy),
    }
    created.promise = load(controller.signal)
      .then((data) => pdfjsLib.getDocument({ data, disableFontFace: true }).promise)
      .then((doc) => {
        if (entries.get(key) !== created) {
          // Every lease was released while loading — nothing wants it.
          destroyDoc(doc)
          throw new DOMException('Aborted', 'AbortError')
        }
        created.doc = doc
        trim()
        return doc
      })
      .catch((err: unknown) => {
        if (entries.get(key) === created) entries.delete(key)
        throw err
      })
    entries.set(key, created)
    entry = created
  } else {
    // touch → most recently used
    entries.delete(key)
    entries.set(key, entry)
  }

  const held = entry
  held.refs += 1
  let released = false
  const release = (): void => {
    if (released) return
    released = true
    held.refs -= 1
    held.releasedAt = Date.now()
    if (held.refs > 0) return
    if (!held.doc) {
      // Nobody is waiting on the in-flight load any more.
      held.controller.abort()
      if (entries.get(held.key) === held) entries.delete(held.key)
      return
    }
    trim()
  }

  return new Promise<PdfDocLease>((resolve, reject) => {
    const onAbort = (): void => {
      release()
      reject(new DOMException('Aborted', 'AbortError'))
    }
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
    held.promise.then(
      (doc) => {
        signal?.removeEventListener('abort', onAbort)
        if (signal?.aborted) return
        resolve({ doc, release })
      },
      (err: unknown) => {
        signal?.removeEventListener('abort', onAbort)
        release()
        reject(err instanceof Error ? err : new Error(String(err)))
      },
    )
  })
}

/** Class of load failure the caller can tell apart (404 = never generated). */
export class PdfFetchError extends Error {
  readonly status: number
  constructor(status: number) {
    super(`HTTP ${status}`)
    this.name = 'PdfFetchError'
    this.status = status
  }
}

/**
 * Lease a PDF by its inline-view URL. The bytes are fetched as
 * `?encoding=base64` text so IDM / the browser PDF handler cannot claim them.
 */
export function leasePdfUrl(url: string, signal?: AbortSignal): Promise<PdfDocLease> {
  return leasePdfDoc(
    url,
    async (loadSignal) => {
      const res = await fetch(toBase64Url(url), { credentials: 'same-origin', signal: loadSignal })
      if (!res.ok) throw new PdfFetchError(res.status)
      return base64ToBytes(await res.text())
    },
    signal,
  )
}

/** Lease a PDF whose base64 bytes are already in memory (`sourceKey` = identity). */
export function leasePdfBase64(
  sourceKey: string,
  base64: string,
  signal?: AbortSignal,
): Promise<PdfDocLease> {
  return leasePdfDoc(`base64:${sourceKey}`, () => Promise.resolve(base64ToBytes(base64)), signal)
}

/** Test seam: destroy and forget every entry. */
export function clearPdfDocCache(): void {
  for (const e of [...entries.values()]) drop(e)
  entries.clear()
}
