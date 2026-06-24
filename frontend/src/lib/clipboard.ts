/**
 * copyToClipboard — copy text in a way that also works on the LAN.
 *
 * `navigator.clipboard` only exists in a *secure context* (HTTPS or
 * localhost). GSSG is served over plain HTTP on the office network
 * (http://gssgit:8765), where `navigator.clipboard` is `undefined`, so every
 * copy button silently failed or threw. This falls back to a hidden
 * `<textarea>` + `document.execCommand('copy')`, which works on HTTP.
 *
 * Returns true on success, false if both paths fail.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  // Preferred path — only available in secure contexts.
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      // fall through to the legacy path
    }
  }

  // Legacy fallback — works over HTTP.
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    // Keep it out of view and avoid scrolling the page on focus.
    ta.style.position = 'fixed'
    ta.style.top = '-9999px'
    ta.style.opacity = '0'
    document.body.appendChild(ta)
    ta.focus()
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}
