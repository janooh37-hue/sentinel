/**
 * A pdf.js-free hook for dropping every cached PDF document and thumbnail.
 *
 * `pdfDocCache` and the record thumbnail cache live in the lazy pdf.js chunk,
 * which the main chunk (auth, mutation hooks) must not import. They register a
 * purger here when their chunk loads; callers anywhere call `purgePdfCaches()`.
 * Before the chunk has loaded there is nothing cached, so nothing to purge.
 */
const purgers = new Set<() => void>()

/** Register a cache's "forget everything" callback. Returns an unregister function. */
export function registerPdfCachePurger(purge: () => void): () => void {
  purgers.add(purge)
  return () => {
    purgers.delete(purge)
  }
}

/**
 * Forget every cached PDF document and thumbnail so the next view refetches.
 * Call after a mutation that changes a record's papers, and on login/logout.
 */
export function purgePdfCaches(): void {
  for (const purge of purgers) purge()
}
