/**
 * Canonical signature-appearance ranges — the frontend mirror of
 * backend `core/signature_render.py`. Keep these in sync with that module
 * (size 18–70 mm, boldness 0–3). Boldness == dilation radius: 0 None / 1 Light
 * / 2 Medium / 3 Bold.
 */
export const SIG_SIZE_MIN_MM = 18
export const SIG_SIZE_MAX_MM = 70
export const SIG_SIZE_DEFAULT_MM = 45

export const SIG_BOLDNESS_MIN = 0
export const SIG_BOLDNESS_MAX = 3
export const SIG_BOLDNESS_DEFAULT = 1

/**
 * Page width the live preview scales against (A4 usable text width, mm) — a
 * signature `size_mm` wide renders at `size_mm / SIG_PREVIEW_REFERENCE_MM` of
 * the preview frame, so dragging the Size slider shows true on-page proportion.
 */
export const SIG_PREVIEW_REFERENCE_MM = 180

export const BOLDNESS_LABELS = ['none', 'light', 'medium', 'bold'] as const
