import { useCallback, useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * `?print=1` is the record's "paint every page, then print" mode: the desk's
 * `DocPdfCanvas` goes `eager`, and this callback — wired to its `onReady` —
 * opens the print dialog once all pages are painted, then clears the param.
 */
export function useRecordPrintMode(): () => void {
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = searchParams.get('print') === '1'
  const printed = useRef(false)

  useEffect(() => {
    if (!requested) printed.current = false
  }, [requested])

  return useCallback(() => {
    if (!requested || printed.current) return
    printed.current = true
    window.print()
    const next = new URLSearchParams(searchParams)
    next.delete('print')
    setSearchParams(next, { replace: true })
  }, [requested, searchParams, setSearchParams])
}

/** The desk's PDF canvas (`DocPdfCanvas` stamps `data-pdf-canvas`) while it is loading or showing pages. */
const DESK_PDF_SELECTOR = '[data-record-paper] [data-pdf-canvas]'

/**
 * Manual Print (Tools menu, phone More sheet). pdf.js paints lazily and a
 * `beforeprint` handler cannot await it, so while the desk shows a PDF this
 * requests print mode (`?print=1`, replace) and `useRecordPrintMode` prints
 * once every page has painted. With no PDF on the desk (image paper, nothing
 * produced, load failed) there is nothing to wait for: print immediately.
 */
export function useRecordPrint(): () => void {
  const [searchParams, setSearchParams] = useSearchParams()

  return useCallback(() => {
    const requested = searchParams.get('print') === '1'
    if (document.querySelector(DESK_PDF_SELECTOR) === null) {
      window.print()
      if (requested) {
        const next = new URLSearchParams(searchParams)
        next.delete('print')
        setSearchParams(next, { replace: true })
      }
      return
    }
    if (requested) return // a print is already waiting for the pages
    const next = new URLSearchParams(searchParams)
    next.set('print', '1')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])
}

/**
 * Ctrl+P / Cmd+P on the record page. The browser's own print would snapshot
 * the lazily painted pages (blank boxes for the far ones), so the shortcut is
 * taken over and routed through the same paint-all-then-print path as the
 * Print buttons.
 */
export function useRecordPrintShortcut(): void {
  const print = useRecordPrint()

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.repeat) return
      if (e.key.toLowerCase() !== 'p' || e.altKey || e.shiftKey || e.ctrlKey === e.metaKey) return
      e.preventDefault()
      print()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [print])
}
