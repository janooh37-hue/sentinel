import { useEffect, useRef } from 'react'

/**
 * The filename **Save as PDF** suggests, which the browser reads off
 * `document.title`.
 *
 * Swapped on `beforeprint` and put back on `afterprint`, because the tab is a
 * wall-mounted dashboard on some desks — a title permanently renamed to a
 * register would be wrong everywhere except inside the dialog. `beforeprint`
 * fires before the preview is generated, so the dialog reads the new title;
 * unmounting mid-dialog restores it rather than stranding the register's name
 * on the tab. See `printFilename.ts` for the shape.
 */
export function usePrintFilename(filename: string): void {
  // Read through a ref so the listeners are registered exactly once. Keyed on
  // the filename instead, a background refetch landing while the dialog is open
  // would run the cleanup — and therefore the restore — mid-print, and Save as
  // PDF would be handed the app's own title back. The day is refetched on a
  // 30-second staleTime, so that window is real.
  const current = useRef(filename)
  useEffect(() => {
    current.current = filename
  }, [filename])

  const previous = useRef<string | null>(null)
  useEffect(() => {
    const swap = (): void => {
      previous.current ??= document.title
      document.title = current.current
    }
    const restore = (): void => {
      if (previous.current === null) return
      document.title = previous.current
      previous.current = null
    }
    window.addEventListener('beforeprint', swap)
    window.addEventListener('afterprint', restore)
    return () => {
      window.removeEventListener('beforeprint', swap)
      window.removeEventListener('afterprint', restore)
      restore()
    }
  }, [])
}
