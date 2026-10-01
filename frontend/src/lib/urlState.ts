/**
 * URL-as-state helpers (navigation plan P1).
 *
 * - Tabs, filters, search: `useSearchParam` → replace, so Back does not step
 *   through keystrokes or chips.
 * - Dialogs, sheets, drawers: `useUrlOverlay` → push, so Back (and Android
 *   hardware Back) closes the overlay and stays on the page.
 *
 * A URL only ever opens an overlay; it never performs a mutation.
 */
import { useCallback, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'

/**
 * One search param as `[value, set]`. Setting `fallback` (or `null`) removes the
 * key so URLs stay short. Replaces by default; `push: true` adds a history entry.
 */
export function useSearchParam(
  key: string,
  { fallback = '', push = false }: { fallback?: string; push?: boolean } = {},
): [string, (value: string | null) => void] {
  const location = useLocation()
  const navigate = useNavigate()
  const value = new URLSearchParams(location.search).get(key) ?? fallback
  const set = useCallback(
    (next: string | null) => {
      const params = new URLSearchParams(location.search)
      if (next === null || next === fallback) params.delete(key)
      else params.set(key, next)
      const search = params.toString()
      if (search === location.search.replace(/^\?/, '')) return
      // Keep the entry's state on replace so an open overlay keeps its marker.
      navigate(
        { search: search ? `?${search}` : '' },
        push ? undefined : { replace: true, state: location.state },
      )
    },
    [fallback, key, location.search, location.state, navigate, push],
  )
  return [value, set]
}

/**
 * A dialog/sheet bound to `?<key>=<value>`. `open` pushes a history entry
 * marked `state.overlay`; `close` pops it when it was pushed in-app, otherwise
 * (direct or shared link) removes the params with replace so Close never
 * leaves the app. `linked` keys (e.g. `fine`, `doc`) are cleared with it.
 */
export function useUrlOverlay(
  key = 'action',
  linked: readonly string[] = [],
): {
  value: string | null
  open: (value: string, extra?: Record<string, string>) => void
  close: () => void
} {
  const location = useLocation()
  const navigate = useNavigate()
  const value = new URLSearchParams(location.search).get(key)
  const pushedInApp = (location.state as { overlay?: boolean } | null)?.overlay === true
  // Radix fires onOpenChange(false) and callers often close() on success too;
  // a second navigate(-1) for the same entry would leave the page.
  const closedEntry = useRef<string | null>(null)
  const linkedKeys = linked.join('\n')

  const open = useCallback(
    (next: string, extra?: Record<string, string>) => {
      const params = new URLSearchParams(location.search)
      params.set(key, next)
      for (const [k, v] of Object.entries(extra ?? {})) params.set(k, v)
      // Switching overlays replaces, so one Back always returns to the page.
      const replace = value !== null && pushedInApp
      navigate({ search: `?${params}` }, { replace, state: { overlay: true } })
    },
    [key, location.search, navigate, pushedInApp, value],
  )

  const close = useCallback(() => {
    if (value === null || closedEntry.current === location.key) return
    closedEntry.current = location.key
    if (pushedInApp) {
      navigate(-1)
      return
    }
    const params = new URLSearchParams(location.search)
    params.delete(key)
    for (const k of linkedKeys ? linkedKeys.split('\n') : []) params.delete(k)
    const search = params.toString()
    navigate({ search: search ? `?${search}` : '' }, { replace: true, state: location.state })
  }, [key, linkedKeys, location.key, location.search, location.state, navigate, pushedInApp, value])

  return { value, open, close }
}
