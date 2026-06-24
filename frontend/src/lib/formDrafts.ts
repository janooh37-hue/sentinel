/**
 * formDrafts — per-template localStorage persistence for the Services form.
 *
 * Keyed by ``template_id`` so each form keeps its own draft independently;
 * the same key is loaded on mount and cleared on save. Storage exceptions
 * (private browsing, quota exceeded, JSON corruption) all degrade silently
 * to "no draft" rather than blocking the form.
 *
 * Convention: ``gssg.draft.<template_id>``. Values are the RHF form values
 * as JSON. We never persist file blobs or signature data URLs (RHF carries
 * them in state, but they're large and ephemeral); callers can opt in by
 * passing the full values object and the draft will just be larger.
 *
 * Why localStorage and not the backend: the product owner asked for "if a
 * draft is saved and another book is generated, the next ref goes to the
 * new save" — i.e. drafts must NOT touch the global ref counter. The
 * simplest way to honour that is to keep drafts entirely client-side until
 * Save fires the ``commit=true`` request.
 */

const KEY_PREFIX = 'gssg.draft.'

function keyFor(templateId: string): string {
  return `${KEY_PREFIX}${templateId}`
}

export function loadDraft(templateId: string): Record<string, unknown> | null {
  try {
    const raw = window.localStorage.getItem(keyFor(templateId))
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

export function saveDraft(
  templateId: string,
  values: Record<string, unknown>,
): void {
  try {
    window.localStorage.setItem(keyFor(templateId), JSON.stringify(values))
  } catch {
    // Quota exceeded / private mode / serialisation error — give up silently.
  }
}

export function clearDraft(templateId: string): void {
  try {
    window.localStorage.removeItem(keyFor(templateId))
  } catch {
    // ignore
  }
}

/**
 * Clear every in-progress form autosave (all ``gssg.draft.*`` keys). Called when
 * the user leaves the Services page so a returning visit starts with a fresh form
 * rather than stale typed-but-unsaved input. Explicitly-saved drafts live in the
 * backend (Records), not here, so they are unaffected.
 */
export function clearAllDrafts(): void {
  try {
    const keys: string[] = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(KEY_PREFIX)) keys.push(k)
    }
    keys.forEach((k) => window.localStorage.removeItem(k))
  } catch {
    // ignore
  }
}

/** Returns the localStorage key for a template — exported for tests. */
export function draftKeyFor(templateId: string): string {
  return keyFor(templateId)
}
