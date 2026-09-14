/** Pure/browser seams shared by the Outlook handoff UI and its tests. */

/** Practical ceiling before Windows or the browser can truncate a mailto URL. */
export const MAILTO_MAX = 1800

/** Marks the quoted-original block so mailto mode can drop it again. */
export const QUOTE_ATTR = 'data-gssg-quote'

/** Mailto carries no quote — Outlook has the thread already. */
export function stripQuote(html: string): string {
  if (!html.includes(QUOTE_ATTR)) return html
  const doc = new DOMParser().parseFromString(html, 'text/html')
  doc.querySelector(`[${QUOTE_ATTR}]`)?.remove()
  return doc.body.innerHTML
}

/** Convert HTML to readable plain text while preserving block boundaries. */
export function htmlToPlainText(html: string): string {
  const holder = document.createElement('div')
  holder.innerHTML = html
  for (const br of Array.from(holder.querySelectorAll('br'))) br.replaceWith('\n')
  for (const block of Array.from(
    holder.querySelectorAll('p, div, tr, li, h1, h2, h3, h4, h5, h6'),
  )) {
    block.append('\n')
  }
  return (holder.textContent ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}


/** Build an RFC 6068 mailto URL with independently encoded address segments. */
export function buildMailtoUrl(
  to: string[],
  cc: string[],
  subject: string,
  body: string,
): string {
  const params: string[] = []
  if (cc.length > 0) {
    params.push(
      `cc=${cc
        .map((address) => encodeURIComponent(address.trim()).replace(/%40/g, '@'))
        .join(',')}`,
    )
  }
  if (subject) params.push(`subject=${encodeURIComponent(subject)}`)
  if (body) params.push(`body=${encodeURIComponent(body)}`)
  const query = params.length > 0 ? `?${params.join('&')}` : ''
  return `mailto:${to
    .map((address) => encodeURIComponent(address.trim()).replace(/%40/g, '@'))
    .join(',')}${query}`
}

/** Browser navigation seam so jsdom tests do not invoke an external protocol. */
export const browserNavigation = {
  assign(url: string): void {
    window.location.href = url
  },
}
