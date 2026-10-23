/**
 * Does a message fit Sileo's one-line pill, and where can a long one be split?
 *
 * The pill is at most 350px (Sileo's WIDTH). Its header loses 16px of padding
 * and Sileo's 10px of spare room; the badge takes 24px and an 8px gap. What
 * remains for the title, less a little slack for font fallback, is the budget.
 */
const TITLE_BUDGET_PX = 284

/** Character fallback when nothing can be measured (no layout, e.g. jsdom). */
export const TOAST_TITLE_MAX_CHARS = 36

let probe: HTMLSpanElement | null = null

/**
 * Renders the text the way Sileo renders a title (0.825rem, weight 500, the
 * page's inherited font, so Lenos in Arabic and Inter in English) and reads its
 * width. Returns 0 when the document has no layout.
 */
function measure(text: string): number {
  if (typeof document === 'undefined' || !document.body) return 0
  if (!probe || !probe.isConnected) {
    probe = document.createElement('span')
    probe.setAttribute('aria-hidden', 'true')
    probe.dataset.printHide = ''
    Object.assign(probe.style, {
      position: 'absolute',
      top: '0',
      left: '-10000px',
      visibility: 'hidden',
      pointerEvents: 'none',
      whiteSpace: 'pre',
      fontSize: '0.825rem',
      fontWeight: '500',
      lineHeight: '1rem',
    })
    document.body.append(probe)
  }
  probe.textContent = text
  const width = probe.getBoundingClientRect().width
  probe.textContent = ''
  return width
}

export function fitsPill(text: string): boolean {
  if (text.includes('\n')) return false
  const width = measure(text)
  if (width === 0) return text.length <= TOAST_TITLE_MAX_CHARS
  return width <= TITLE_BUDGET_PX
}

// A full stop, colon or semicolon (Latin or Arabic) or a spaced dash ends a
// clause; a question or exclamation mark ends one and stays with it.
const CLAUSE_END = /[.:;؛]\s+|[?!؟]\s+|\s+[—–]\s+/u
const KEPT_MARK = /[?!؟]/u

/** Splits a message after its first clause, or returns null when it has one. */
export function splitClause(message: string): { head: string; rest: string } | null {
  const match = CLAUSE_END.exec(message)
  if (!match) return null
  const mark = KEPT_MARK.exec(match[0])?.[0] ?? ''
  const head = message.slice(0, match.index).trim() + mark
  const rest = message.slice(match.index + match[0].length).trim()
  return head && rest ? { head, rest } : null
}
