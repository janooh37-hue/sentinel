/**
 * Rewrite inline `cid:` image references in email HTML so they resolve against
 * the ledger attachments endpoint.
 *
 * Email MIME bodies reference inline parts as `src="cid:abc"`. The backend
 * exposes those parts as ordered attachments under
 * `GET /api/v1/ledger/{id}/attachments/by-index/{index}`, so we translate each
 * `cid:` token to the matching index via the `inline_images` map (cid → rel
 * path) and the entry's `attachment_paths`.
 *
 * Unmapped cids are left alone — rendering a broken image is safer than
 * silently routing it to the wrong attachment.
 */

const CID_SRC_RE = /(<img\b[^>]*\bsrc\s*=\s*)(["'])cid:([^"'\s>]+)\2/gi

export function rewriteCidReferences(
  html: string,
  inlineImages: Record<string, string>,
  entryId: number,
  attachmentPaths: string[],
): string {
  if (!html || Object.keys(inlineImages).length === 0) return html
  return html.replace(CID_SRC_RE, (match, prefix, quote, cid) => {
    const relPath = inlineImages[cid]
    if (relPath === undefined) return match
    const index = attachmentPaths.indexOf(relPath)
    if (index < 0) return match
    return `${prefix}${quote}/api/v1/ledger/${entryId}/attachments/by-index/${index}${quote}`
  })
}
