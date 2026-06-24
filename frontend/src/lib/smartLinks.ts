/**
 * Smart-link decoration for rendered email bodies.
 *
 * Walks the text nodes of a container and replaces:
 *   - `G\d{3,4}`                       → employee link (e.g. G2838, G3082)
 *   - `(GS|HR|NAT|SC|\d{1,2})-\d{3,4}` → book reference link. Matches both the
 *     legacy lettered refs (GS-0005, HR-0003) AND the real numeric refs the
 *     ref allocator emits as `{category-id}-{NNNN}` (e.g. 1-0042, 9-0007).
 *
 * The employee shape is the canonical no-hyphen G-number — see
 * `lib/gnumber.ts`, the shared source of truth also used by the suggestion
 * banner's detector.
 *
 * Linked nodes are inert anchors carrying `data-smart-*` attributes; the
 * caller wires a click handler to the container that reads those attributes
 * and routes accordingly. Operating on text nodes (not the raw HTML string)
 * keeps existing markup intact and avoids breaking quoted-reply blocks or
 * inline images.
 */

import { gNumberRegex } from './gnumber'

const BOOK_REF_SOURCE = String.raw`\b(?:GS|HR|NAT|SC|\d{1,2})-\d{3,4}\b`

const MAX_BOOK_REFS = 5

/**
 * Pure extractor for book references in an HTML body — the string counterpart
 * of the DOM `decorateSmartLinks` book branch, sharing `BOOK_REF_SOURCE` so the
 * two can't drift (mirrors `extractGNumbers`). Tags are stripped before
 * matching; results are de-duped (case-preserving on first sight) and capped.
 */
export function extractBookRefs(html: string): string[] {
  if (!html) return []
  const text = html.replace(/<[^>]*>/g, ' ')
  const matches = text.match(new RegExp(BOOK_REF_SOURCE, 'g')) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of matches) {
    if (seen.has(m)) continue
    seen.add(m)
    out.push(m)
    if (out.length >= MAX_BOOK_REFS) break
  }
  return out
}

type Kind = 'employee' | 'book'

/** Run the decoration pass over ``root``. Idempotent — skips text inside
 * existing smart-link spans. */
export function decorateSmartLinks(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      // Skip text already inside a smart-link, or inside <a>/<script>/<style>.
      const parent = node.parentElement
      if (!parent) return NodeFilter.FILTER_REJECT
      if (parent.closest('[data-smart-link]')) return NodeFilter.FILTER_REJECT
      const tag = parent.tagName.toLowerCase()
      if (tag === 'a' || tag === 'script' || tag === 'style') {
        return NodeFilter.FILTER_REJECT
      }
      return NodeFilter.FILTER_ACCEPT
    },
  })

  const targets: Text[] = []
  let n = walker.nextNode()
  while (n) {
    targets.push(n as Text)
    n = walker.nextNode()
  }

  for (const textNode of targets) {
    decorateTextNode(textNode)
  }
}

function decorateTextNode(node: Text): void {
  const text = node.nodeValue ?? ''
  if (!text) return

  // Fresh regex instances per call — stateful `lastIndex` is never shared
  // across nodes, so an early return can't leave a dirty cursor that silently
  // skips the first match of the next body.
  const gNumber = gNumberRegex()
  const bookRef = new RegExp(BOOK_REF_SOURCE, 'g')

  type Match = { start: number; end: number; value: string; kind: Kind }
  const matches: Match[] = []
  let m: RegExpExecArray | null

  while ((m = gNumber.exec(text)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, value: m[0], kind: 'employee' })
  }
  while ((m = bookRef.exec(text)) !== null) {
    matches.push({ start: m.index, end: m.index + m[0].length, value: m[0], kind: 'book' })
  }
  if (matches.length === 0) return
  matches.sort((a, b) => a.start - b.start)

  // Deduplicate overlaps — prefer the earlier match.
  const accepted: Match[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.start < cursor) continue
    accepted.push(match)
    cursor = match.end
  }
  if (accepted.length === 0) return

  const frag = document.createDocumentFragment()
  cursor = 0
  for (const match of accepted) {
    if (match.start > cursor) {
      frag.appendChild(document.createTextNode(text.slice(cursor, match.start)))
    }
    const span = document.createElement('a')
    span.setAttribute('data-smart-link', match.kind)
    span.setAttribute('data-smart-value', match.value)
    span.setAttribute('href', '#')
    span.setAttribute('role', 'button')
    span.textContent = match.value
    // Visual: light tinted chip — final colour is themed in index.css via
    // [data-smart-link] selectors so dark mode stays consistent.
    span.style.cursor = 'pointer'
    frag.appendChild(span)
    cursor = match.end
  }
  if (cursor < text.length) {
    frag.appendChild(document.createTextNode(text.slice(cursor)))
  }

  node.parentNode?.replaceChild(frag, node)
}
