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
  host.tabIndex = -1
  host.style.position = 'fixed'
  host.style.inset = '0 auto auto 0'
  host.style.opacity = '0'
  host.style.pointerEvents = 'none'
  host.innerHTML = html

  const selection = window.getSelection()
  const previousRanges = selection
    ? Array.from({ length: selection.rangeCount }, (_, index) =>
        selection.getRangeAt(index).cloneRange(),
      )
    : []
  const previousActiveElement =
    document.activeElement instanceof HTMLElement ? document.activeElement : null
  let copyEventFired = false
  let clipboardDataPresent = false
  let bothFlavorsSet = false
  const handleCopy = (event: ClipboardEvent): void => {
    copyEventFired = true
    if (!event.clipboardData) return
    clipboardDataPresent = true
    try {
      event.clipboardData.setData('text/html', html)
      event.clipboardData.setData('text/plain', text)
      const types = Array.from(event.clipboardData.types)
      bothFlavorsSet = types.includes('text/html') && types.includes('text/plain')
      event.preventDefault()
    } catch {
      bothFlavorsSet = false
    }
  }

  document.body.appendChild(host)
  document.addEventListener('copy', handleCopy, { once: true })
  try {
    host.focus()
    const range = document.createRange()
    range.selectNodeContents(host)
    selection?.removeAllRanges()
    selection?.addRange(range)

    let commandSucceeded = false
    try {
      commandSucceeded = document.execCommand('copy')
    } catch {
      throw new Error('COPY_FAILED')
    }
    if (
      !commandSucceeded ||
      !copyEventFired ||
      !clipboardDataPresent ||
      !bothFlavorsSet
    ) {
      throw new Error('COPY_FAILED')
    }
  } finally {
    document.removeEventListener('copy', handleCopy)
    host.remove()
    try {
      if (previousActiveElement?.isConnected) previousActiveElement.focus()
    } catch {
      // A detached or inert prior target cannot be restored.
    }
    try {
      selection?.removeAllRanges()
      previousRanges.forEach((range) => selection?.addRange(range))
    } catch {
      // A prior range can become stale while copy is in progress.
    }
  }
}
