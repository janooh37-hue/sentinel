/**
 * copyTable — put a rich (HTML) table on the clipboard with a plain-text twin.
 *
 * The register's Copy button targets Excel/Word: the HTML flavor keeps the
 * blue header and cell borders on paste; the text flavor is TSV so a plain
 * editor still gets usable columns. ClipboardItem is unavailable or
 * HTML-less in some shells (pywebview's WebView2 exposes it, older gecko
 * does not), so fall back to a hidden contentEditable + execCommand copy,
 * which preserves the HTML flavor.
 */

export interface CopyTableOptions {
  /** Rendered <table> HTML, copied as the text/html flavor. */
  html: string
  /** TSV rows (header included), copied as the text/plain flavor. */
  text: string
}

export async function copyTable({ html, text }: CopyTableOptions): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          'text/html': new Blob([html], { type: 'text/html' }),
          'text/plain': new Blob([text], { type: 'text/plain' }),
        }),
      ])
      return
    } catch {
      // Permission denied or flavor rejected — fall through to execCommand.
    }
  }

  const host = document.createElement('div')
  host.contentEditable = 'true'
  host.setAttribute('aria-hidden', 'true')
  host.style.position = 'fixed'
  host.style.inset = '0 auto auto 0'
  host.style.opacity = '0'
  host.style.pointerEvents = 'none'
  host.innerHTML = html
  document.body.appendChild(host)
  const range = document.createRange()
  range.selectNodeContents(host)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  document.execCommand('copy')
  selection?.removeAllRanges()
  host.remove()
}
