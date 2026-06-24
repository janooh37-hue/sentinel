/**
 * Theme + font-scale persistence helpers.
 *
 * - Theme is stored in localStorage ('gssg.theme') and applied as
 *   `data-theme="dark|light"` on <html>.
 * - Font scale is stored in localStorage ('gssg.font-scale') as an integer
 *   snapped to one of the discrete stops in `FONT_SCALE_STOPS`, and applied
 *   as `data-font-scale="<N>"` on <html>.
 */

import type { Theme } from './api'

export type FontScale = number

/**
 * Discrete font-scale stops (in px) the UI offers. The AaSlider snaps to
 * these and the backend schema accepts any integer in the inclusive range
 * [min, max] of this array — the client is responsible for snapping.
 */
export const FONT_SCALE_STOPS = [16, 19, 22, 24] as const
const MIN_STOP = FONT_SCALE_STOPS[0]
const MAX_STOP = FONT_SCALE_STOPS[FONT_SCALE_STOPS.length - 1]

/** Snap an arbitrary numeric value to the nearest valid stop. */
export function snapFontScale(value: number): FontScale {
  if (!Number.isFinite(value)) return MIN_STOP
  if (value <= MIN_STOP) return MIN_STOP
  if (value >= MAX_STOP) return MAX_STOP
  let best: FontScale = MIN_STOP
  let bestDist = Math.abs(value - MIN_STOP)
  for (const stop of FONT_SCALE_STOPS) {
    const dist = Math.abs(value - stop)
    if (dist < bestDist) {
      best = stop
      bestDist = dist
    }
  }
  return best
}

export function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
}

export function getStoredTheme(): Theme | null {
  return (localStorage.getItem('gssg.theme') as Theme | null) ?? null
}

export function persistTheme(theme: Theme): void {
  localStorage.setItem('gssg.theme', theme)
  applyTheme(theme)
}

export function applyFontScale(scale: FontScale): void {
  const snapped = snapFontScale(scale)
  document.documentElement.setAttribute('data-font-scale', String(snapped))
}

export function migrateLegacyFontScale(value: unknown): FontScale {
  if (typeof value === 'number') return snapFontScale(value)
  if (value === 'sm') return 16
  if (value === 'md') return 19
  if (value === 'lg') return 22
  return MIN_STOP
}

export function getStoredFontScale(): FontScale | null {
  const raw = localStorage.getItem('gssg.font-scale')
  if (raw === null) return null
  // Migrate legacy 'sm'/'md'/'lg' values transparently.
  const parsed = Number(raw)
  if (Number.isFinite(parsed)) return migrateLegacyFontScale(parsed)
  return migrateLegacyFontScale(raw)
}

export function persistFontScale(scale: FontScale): void {
  const snapped = snapFontScale(scale)
  localStorage.setItem('gssg.font-scale', String(snapped))
  applyFontScale(snapped)
}
