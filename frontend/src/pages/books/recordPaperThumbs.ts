/**
 * First-page thumbnails (+ page count) for the film-strip.
 *
 * Every thumbnail needs the whole PDF fetched and parsed, so builds run one at
 * a time through a module-level queue (the doc cache holds only a few
 * documents; a burst of parallel builds would evict the paper being read) and
 * the strip only asks for thumbnails that scrolled into view. A paper whose
 * bytes change gets a new URL (see `recordPapers`), and `purgePdfCaches`
 * empties this cache on logout and after record mutations.
 */
import { registerPdfCachePurger } from '@/lib/pdfCachePurge'
import { leasePdfUrl } from '@/lib/pdfDocCache'

export interface ThumbInfo {
  src: string | null
  pages: number | null
}

const THUMB_CACHE_MAX = 40
const THUMB_WIDTH = 64

const thumbCache = new Map<string, ThumbInfo>()
// Bumped by a purge so a build that was in flight does not store pre-purge bytes.
let generation = 0

registerPdfCachePurger(() => {
  thumbCache.clear()
  generation += 1
})

export function cachedThumb(url: string): ThumbInfo | undefined {
  return thumbCache.get(url)
}

function rememberThumb(url: string, info: ThumbInfo): void {
  thumbCache.delete(url)
  thumbCache.set(url, info)
  if (thumbCache.size > THUMB_CACHE_MAX) {
    const oldest = thumbCache.keys().next().value
    if (oldest !== undefined) thumbCache.delete(oldest)
  }
}

async function buildThumb(url: string, signal: AbortSignal): Promise<ThumbInfo> {
  const lease = await leasePdfUrl(url, signal)
  try {
    const page = await lease.doc.getPage(1)
    const base = page.getViewport({ scale: 1 })
    const scale = (THUMB_WIDTH * Math.min(window.devicePixelRatio || 1, 2)) / base.width
    const viewport = page.getViewport({ scale })
    const canvas = document.createElement('canvas')
    canvas.width = Math.floor(viewport.width)
    canvas.height = Math.floor(viewport.height)
    const ctx = canvas.getContext('2d')
    if (!ctx) return { src: null, pages: lease.doc.numPages }
    await page.render({ canvas, canvasContext: ctx, viewport }).promise
    return { src: canvas.toDataURL('image/jpeg', 0.7), pages: lease.doc.numPages }
  } finally {
    lease.release()
  }
}

let tail: Promise<unknown> = Promise.resolve()

/**
 * Build (and cache) the thumbnail of `url`, after every earlier request has
 * settled. Aborting `signal` drops a queued request without fetching anything.
 */
export function loadThumb(url: string, signal: AbortSignal): Promise<ThumbInfo> {
  const run = async (): Promise<ThumbInfo> => {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
    const started = generation
    const info = await buildThumb(url, signal)
    if (started === generation) rememberThumb(url, info)
    return info
  }
  const result = tail.then(run, run)
  tail = result.catch(() => undefined)
  return result
}
