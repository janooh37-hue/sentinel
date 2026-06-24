/**
 * EmailBody — renders an email's HTML body exactly as sent, with cid inline
 * images rewritten and G-number / book-ref smart-link chips decorated.
 *
 * Extracted verbatim from LedgerEntryDrawer (Phase 15 body renderer) so both
 * the drawer and the Phase-5 reading pane share one implementation.
 *
 * The HTML is written imperatively via useLayoutEffect rather than
 * dangerouslySetInnerHTML: doing the write here (not as a React-managed prop)
 * means React never re-commits this node and wipes the chips when an unrelated
 * re-render fires (e.g. the mark-read refetch). useLayoutEffect runs before
 * paint, so the body and its chips appear together with no empty-content flash.
 */

import { useLayoutEffect, useRef } from 'react'

import { decorateSmartLinks } from '@/lib/smartLinks'
import { rewriteCidReferences } from '@/lib/cidRewrite'
import { inferSourceDir } from '@/lib/bodyDirection'

export type SmartLinkKind = 'employee' | 'book'

interface EmailBodyProps {
  /** Raw email HTML (`entry.notes_html`). */
  html: string
  /** Inline cid → data-url map (`entry.inline_images`). */
  inlineImages?: Record<string, string>
  /** Owning entry id — used to address cid attachments. */
  entryId: number
  /** Attachment paths for cid fallback (`entry.attachment_paths`). */
  attachmentPaths?: string[]
  /** Fired when a decorated smart-link chip is clicked. */
  onSmartLinkClick?: (kind: SmartLinkKind, value: string) => void
}

export function EmailBody({
  html,
  inlineImages,
  entryId,
  attachmentPaths,
  onSmartLinkClick,
}: EmailBodyProps): React.JSX.Element {
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // Phase 15 — rewrite `cid:` inline-image references before rendering. Must
  // run before any sanitisation step downstream — broken cid hits would render
  // as 404 boxes otherwise.
  const renderedHtml = html
    ? rewriteCidReferences(html, inlineImages ?? {}, entryId, attachmentPaths)
    : ''

  // Phase 5 — render the body in its OWN source direction "as sent", not the
  // chrome's. The wrapper lives inside `[data-ledger-chrome] dir="ltr"`, so set
  // dir explicitly (never inherited): honour the source's own `dir`, else infer
  // from the first strong character.
  const srcDir = inferSourceDir(html)

  useLayoutEffect(() => {
    const el = bodyRef.current
    if (!el) return
    el.innerHTML = renderedHtml
    decorateSmartLinks(el)
  }, [renderedHtml])

  function handleBodyClick(e: React.MouseEvent<HTMLDivElement>): void {
    const link = (e.target as HTMLElement).closest('[data-smart-link]')
    if (!link) return
    e.preventDefault()
    const kind = link.getAttribute('data-smart-link')
    const value = link.getAttribute('data-smart-value') ?? ''
    if (kind === 'employee') onSmartLinkClick?.('employee', value)
    else if (kind === 'book') onSmartLinkClick?.('book', value)
  }

  return (
    <div
      ref={bodyRef}
      onClick={handleBodyClick}
      dir={srcDir}
      style={{ textAlign: srcDir === 'rtl' ? 'right' : 'left' }}
      className="email-body w-full overflow-hidden rounded-2xl bg-surface px-6 py-6 text-sm text-foreground
        break-words
        [&_*]:max-w-full
        [&_[style*='width']]:!max-w-full
        [&_[style*='min-width']]:!min-w-0
        [&_table]:!max-w-full [&_table:not([dir])]:[direction:ltr] [&_table]:!mx-auto [&_table]:!text-[13px]
        [&_img]:!h-auto [&_img]:!max-w-full
        [&_a]:text-primary [&_a]:underline
        [&_pre]:whitespace-pre-wrap [&_pre]:font-sans
        [&_p]:my-2 [&_p]:leading-relaxed
        [&_td_p]:!my-0 [&_td_p]:!leading-tight [&_th_p]:!my-0 [&_th_p]:!leading-tight
        [&_blockquote]:my-2 [&_blockquote]:border-s-4 [&_blockquote]:border-border [&_blockquote]:ps-3 [&_blockquote]:text-muted-foreground"
    />
  )
}
