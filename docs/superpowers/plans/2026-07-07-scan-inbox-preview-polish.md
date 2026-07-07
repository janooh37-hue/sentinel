# Scan Inbox Preview Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Scan Inbox triage's tiny 180px-square, WebView2-blank PDF preview with a readable A4-portrait pane (pdf.js canvas) that clicks through to the existing full-screen zoom viewer, and polish the surrounding triage interaction.

**Architecture:** A new shared `ScanPreview` component renders an A4-portrait frame — `<img>` for images, a lazy single-page pdf.js canvas for PDFs (fetched as `?encoding=base64` to survive packaged Edge WebView2). Both the triage card and the match dialog use it; clicking opens the existing `DocumentViewerDialog`. A small additive backend change teaches the scan-document endpoint the `encoding=base64` trick every other file endpoint already speaks.

**Tech Stack:** React 18 + TypeScript, TailwindCSS, TanStack Query, react-i18next, Vitest + Testing Library (frontend); FastAPI + SQLAlchemy, pytest (backend); pdf.js (`pdfjs-dist`).

## Global Constraints

- **Bilingual parity:** every user-facing string exists in BOTH `frontend/src/locales/en.json` and `frontend/src/locales/ar.json` under the same key. English must never leak into Arabic. (This app's #1 recurring bug.)
- **RTL:** use logical properties already in the codebase (`border-e`, `text-start`, `ps-*`/`pe-*`) — never `left`/`right`.
- **WebView2:** PDFs must render via pdf.js canvas, never `<iframe>`/`<object>`; PDF bytes are fetched via `?encoding=base64` (text/plain).
- **Confidence tiers** are exactly `"auto"`, `"confirm"`, `"manual"` (backend `scan_triage_service.py`).
- **Auth unchanged:** the scan-document endpoint stays gated on `require_capability("documents.scan")`.
- **Commit style:** end messages with `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. This checkout is live — the executor commits but does NOT push unless asked.

---

### Task 1: Backend — `encoding=base64` for the scan document endpoint

**Files:**
- Modify: `backend/app/api/v1/scan_inbox.py:128-154` (`get_scan_document`) and imports at top (`:1-22`)
- Test: `backend/tests/test_scan_inbox_document.py` (add one test)

**Interfaces:**
- Produces: `GET /scan-inbox/{item_id}/document?encoding=base64` → `200 text/plain`, body is `base64(file bytes)`, header `X-Content-Type-Options: nosniff`. Without the param, behavior is unchanged.

- [ ] **Step 1: Write the failing test**

Add to `backend/tests/test_scan_inbox_document.py`:

```python
def test_get_scan_document_base64_returns_text_plain(db_session, tmp_path, monkeypatch):
    import base64

    from app.api.v1 import scan_inbox as api_mod
    from app.services import scan_inbox_service as svc

    user = _user(db_session, "b64@x.ae")
    f = tmp_path / "scan.pdf"
    f.write_bytes(b"%PDF-1.4 hello")
    monkeypatch.setattr(svc, "abs_file_path", lambda item: f)
    row = ScanInbox(
        source="email",
        file_path="/s/x.pdf",
        filename="scan.pdf",
        state="unrouted",
        owner_user_id=user.id,
    )
    db_session.add(row)
    db_session.flush()

    resp = api_mod.get_scan_document(
        item_id=row.id, db=db_session, user=user, encoding="base64"
    )
    assert resp.media_type == "text/plain"
    assert resp.headers["x-content-type-options"] == "nosniff"
    assert base64.b64decode(resp.body) == b"%PDF-1.4 hello"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_scan_inbox_document.py::test_get_scan_document_base64_returns_text_plain -v`
Expected: FAIL — `get_scan_document() got an unexpected keyword argument 'encoding'`.

- [ ] **Step 3: Add imports**

In `backend/app/api/v1/scan_inbox.py`, change the FastAPI import (line 8) and add the shared helper import after line 12:

```python
from fastapi import APIRouter, Depends, HTTPException, Query, Response
```
```python
from app.api._responses import maybe_base64
```

- [ ] **Step 4: Add the param + base64 branch**

Replace the signature and body of `get_scan_document` (`scan_inbox.py:128-154`) with:

```python
@router.get("/{item_id}/document")
def get_scan_document(
    item_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("documents.scan"))],
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    """Stream the scanned file inline so the triage card can preview it.

    ``encoding=base64`` returns the bytes base64-encoded as ``text/plain`` so
    the in-app pdf.js canvas can fetch them without the packaged Edge WebView2
    PDF handler (or Internet Download Manager) intercepting the response —
    same trick as ``GET /books/{id}/attachments/{index}``.
    """
    item = scan_inbox_service.get_item(db, item_id, user=user)
    abs_path = scan_inbox_service.abs_file_path(item)
    if not abs_path.exists():
        raise HTTPException(status_code=404, detail="scan file missing")
    if (b64 := maybe_base64(abs_path.read_bytes(), encoding)) is not None:
        return b64
    guessed = mimetypes.guess_type(item.filename)[0] or "application/octet-stream"
    if guessed in _INLINE_SAFE_TYPES:
        return FileResponse(
            abs_path,
            filename=item.filename,
            media_type=guessed,
            content_disposition_type="inline",
            headers={"X-Content-Type-Options": "nosniff"},
        )
    return FileResponse(
        abs_path,
        filename=item.filename,
        media_type="application/octet-stream",
        content_disposition_type="attachment",
        headers={"X-Content-Type-Options": "nosniff"},
    )
```

- [ ] **Step 5: Run the scan-document tests to verify they pass**

Run: `cd backend && python -m pytest tests/test_scan_inbox_document.py -v`
Expected: PASS — the new base64 test plus all four existing tests (inline, foreign-404, missing-404, unsafe-download).

- [ ] **Step 6: Commit**

```bash
git add backend/app/api/v1/scan_inbox.py backend/tests/test_scan_inbox_document.py
git commit -m "feat(scan-inbox): serve scan document as base64 for WebView2-safe preview

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Frontend — `ScanPdfCanvas` (lazy single-page pdf.js renderer)

**Files:**
- Create: `frontend/src/pages/scanInbox/ScanPdfCanvas.tsx`

**Interfaces:**
- Produces: `export default function ScanPdfCanvas({ pdfUrl, onError }: { pdfUrl: string; onError?: () => void }): React.JSX.Element` — renders page 1 of `pdfUrl` to a width-driven canvas. `pdfUrl` is the plain document URL; the component itself appends `?encoding=base64`. Calls `onError` if the fetch/render fails.

This mirrors `frontend/src/pages/application/DocPdfCanvas.tsx` but renders only page 1 at the container's width (recognition + header reading; full multi-page reading happens in the zoom viewer). It has no unit test of its own — pdf.js + canvas don't render under jsdom, matching how `DocPdfCanvas`/`PdfViewer` are left untested; Task 3 mocks this module.

- [ ] **Step 1: Create the component**

Create `frontend/src/pages/scanInbox/ScanPdfCanvas.tsx`:

```tsx
/**
 * ScanPdfCanvas — renders page 1 of a scanned PDF with pdf.js (canvas).
 *
 * `<object>/<iframe>` PDF embedding blanks/downloads inside the packaged Edge
 * WebView2 (see application/DocPdfCanvas.tsx, ledger/PdfViewer.tsx). This paints
 * the first page to a canvas instead. Only page 1 — enough to recognise the doc
 * and read its header during triage; full reading is one click away in
 * DocumentViewerDialog. Lazy default export so pdf.js only ships when a preview
 * shows. Fetches `?encoding=base64` (text/plain) so the WebView2/IDM PDF handler
 * can't hijack the response.
 */

import { useEffect, useRef, useState } from 'react'
import { Loader2 } from 'lucide-react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

import { base64ToBytes, toBase64Url } from '@/lib/pdf'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl

export default function ScanPdfCanvas({
  pdfUrl,
  onError,
}: {
  pdfUrl: string
  onError?: () => void
}): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch(toBase64Url(pdfUrl), { credentials: 'same-origin' })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = base64ToBytes(await res.text())
        if (cancelled) return
        const doc = await pdfjsLib.getDocument({ data, disableFontFace: true }).promise
        const page = await doc.getPage(1)
        const canvas = canvasRef.current
        if (cancelled || !canvas) return
        const dpr = window.devicePixelRatio || 1
        const cssWidth = canvas.parentElement?.clientWidth ?? 240
        const base = page.getViewport({ scale: 1 })
        const scale = cssWidth / base.width
        const viewport = page.getViewport({ scale })
        canvas.width = Math.floor(viewport.width * dpr)
        canvas.height = Math.floor(viewport.height * dpr)
        canvas.style.width = `${Math.floor(viewport.width)}px`
        canvas.style.height = 'auto'
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('no 2d context')
        await page.render({
          canvas,
          canvasContext: ctx,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        }).promise
        if (!cancelled) setLoading(false)
      } catch (err) {
        console.error('ScanPdfCanvas render failed:', err)
        if (!cancelled) onError?.()
      }
    })()
    return () => {
      cancelled = true
    }
  }, [pdfUrl, onError])

  return (
    <div className="flex h-full w-full items-start justify-center">
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      )}
      <canvas ref={canvasRef} className="block w-full" />
    </div>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS (no type errors). Confirms `base64ToBytes`, `toBase64Url` imports resolve.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/scanInbox/ScanPdfCanvas.tsx
git commit -m "feat(scan-inbox): add single-page pdf.js canvas for scan previews

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Frontend — `ScanPreview` shared component

**Files:**
- Create: `frontend/src/pages/scanInbox/ScanPreview.tsx`
- Test: `frontend/src/pages/scanInbox/ScanPreview.test.tsx`

**Interfaces:**
- Consumes: `ScanPdfCanvas` (Task 2, lazy); `DocumentViewerDialog` + `DocViewerItem` from `@/components/ui/document-viewer-dialog`; `fileKindFromName` from `@/lib/fileTypes`; `toBase64Url` from `@/lib/pdf`; `api.scanDocumentUrl` from `@/lib/api`; `isPdf` from `./scanPreview`.
- Produces: `export function ScanPreview({ itemId, filename, variant }: { itemId: number; filename: string; variant: 'card' | 'dialog' }): React.JSX.Element` — an A4-portrait preview frame that opens `DocumentViewerDialog` on click.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/pages/scanInbox/ScanPreview.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScanPreview } from './ScanPreview'
import * as apiMod from '../../lib/api'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

// pdf.js won't render under jsdom — stub the lazy canvas.
vi.mock('./ScanPdfCanvas', () => ({
  default: () => <div data-testid="pdf-canvas" />,
}))

describe('ScanPreview', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.spyOn(apiMod.api, 'scanDocumentUrl').mockReturnValue('/api/v1/scan-inbox/7/document')
  })

  it('renders an <img> for an image scan', () => {
    render(<ScanPreview itemId={7} filename="scan.jpg" variant="card" />)
    const img = screen.getByRole('img')
    expect(img).toHaveAttribute('src', '/api/v1/scan-inbox/7/document')
  })

  it('renders the pdf canvas for a pdf scan', async () => {
    render(<ScanPreview itemId={7} filename="scan.pdf" variant="card" />)
    expect(await screen.findByTestId('pdf-canvas')).toBeInTheDocument()
  })

  it('opens the full-screen viewer when the frame is clicked', () => {
    render(<ScanPreview itemId={7} filename="scan.jpg" variant="card" />)
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'scanInbox.openZoom' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/scanInbox/ScanPreview.test.tsx`
Expected: FAIL — cannot find module `./ScanPreview`.

- [ ] **Step 3: Create the component**

Create `frontend/src/pages/scanInbox/ScanPreview.tsx`:

```tsx
/**
 * ScanPreview — a readable A4-portrait preview of one scanned document, shared
 * by the triage card and the match dialog.
 *
 * Images render via <img>; PDFs via a lazy single-page pdf.js canvas
 * (WebView2-safe). Clicking the frame opens the full-screen DocumentViewerDialog
 * (zoom/rotate/pan) for fine reading. On render failure it shows a clean
 * "open document" fallback rather than a blank frame.
 */

import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Maximize2 } from 'lucide-react'

import { api } from '@/lib/api'
import { cn } from '@/lib/utils'
import { toBase64Url } from '@/lib/pdf'
import { fileKindFromName } from '@/lib/fileTypes'
import { DocumentViewerDialog, type DocViewerItem } from '@/components/ui/document-viewer-dialog'
import { isPdf } from './scanPreview'

const ScanPdfCanvas = lazy(() => import('./ScanPdfCanvas'))

export function ScanPreview({
  itemId,
  filename,
  variant,
}: {
  itemId: number
  filename: string
  variant: 'card' | 'dialog'
}): React.JSX.Element {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [failed, setFailed] = useState(false)
  const url = api.scanDocumentUrl(itemId)
  const pdf = isPdf(filename)

  const viewerItem: DocViewerItem = {
    name: filename,
    kind: fileKindFromName(filename),
    imageUrl: pdf ? undefined : url,
    pdfBase64Url: pdf ? toBase64Url(url) : undefined,
    openUrl: url,
    downloadUrl: url,
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('scanInbox.openZoom')}
        className={cn(
          'group relative block w-full overflow-hidden rounded-md border border-border bg-white',
          'aspect-[210/297]',
          variant === 'card' ? 'sm:max-w-[240px]' : 'max-w-[300px]',
        )}
      >
        {failed ? (
          <span className="flex h-full w-full flex-col items-center justify-center gap-2 bg-surface-tinted text-muted-foreground">
            <FileText className="h-7 w-7" aria-hidden />
            <span className="text-[0.72em]">{t('scanInbox.openFullDoc')}</span>
          </span>
        ) : pdf ? (
          <Suspense fallback={<span className="block h-full w-full animate-pulse bg-surface-tinted" />}>
            <ScanPdfCanvas pdfUrl={url} onError={() => setFailed(true)} />
          </Suspense>
        ) : (
          <img
            src={url}
            alt={filename}
            className="h-full w-full object-contain"
            onError={() => setFailed(true)}
          />
        )}
        <span className="pointer-events-none absolute bottom-1.5 end-1.5 rounded bg-black/55 p-1 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100">
          <Maximize2 className="h-3.5 w-3.5" aria-hidden />
        </span>
      </button>
      {open && <DocumentViewerDialog items={[viewerItem]} onClose={() => setOpen(false)} />}
    </>
  )
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npx vitest run src/pages/scanInbox/ScanPreview.test.tsx`
Expected: PASS — all three tests (image `<img>`, pdf canvas stub, click opens dialog).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/scanInbox/ScanPreview.tsx frontend/src/pages/scanInbox/ScanPreview.test.tsx
git commit -m "feat(scan-inbox): shared A4-portrait ScanPreview with click-to-zoom

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Frontend — wire `ScanPreview` into `ScanInboxCard` + auto-expand + confidence cue

**Files:**
- Modify: `frontend/src/pages/scanInbox/ScanInboxCard.tsx` (`:27` state, `:96-116` header, `:118-151` expand block)
- Test: `frontend/src/pages/scanInbox/ScanInboxCard.test.tsx` (add two tests)

**Interfaces:**
- Consumes: `ScanPreview` (Task 3); i18n keys `scanInbox.confidence.auto|confirm` (Task 6).

- [ ] **Step 1: Write the failing tests**

Add to `frontend/src/pages/scanInbox/ScanInboxCard.test.tsx` inside the `describe` block:

```tsx
  it('auto-expands an awaiting_confirmation item (preview visible without a click)', () => {
    renderCard(base({
      state: 'awaiting_confirmation', filename: 'scan.jpg',
      proposed_route: 'employee_doc', proposed_employee_id: 'G5',
      proposed_employee_name_en: 'Sara Omar', confidence_tier: 'confirm',
    }))
    expect(screen.getByRole('button', { name: 'scanInbox.openZoom' })).toBeInTheDocument()
  })

  it('keeps an unrouted item collapsed until the chevron is clicked', () => {
    renderCard(base({ state: 'unrouted', filename: 'scan.jpg' }))
    expect(screen.queryByRole('button', { name: 'scanInbox.openZoom' })).toBeNull()
    fireEvent.click(screen.getByLabelText('scanInbox.showDetails'))
    expect(screen.getByRole('button', { name: 'scanInbox.openZoom' })).toBeInTheDocument()
  })
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && npx vitest run src/pages/scanInbox/ScanInboxCard.test.tsx`
Expected: FAIL — no `scanInbox.openZoom` button (preview still the old `<object>`/`<img>` square; `expanded` starts `false`).

- [ ] **Step 3: Auto-expand from state**

In `ScanInboxCard.tsx`, replace line 27:

```tsx
  const [expanded, setExpanded] = useState(item.state === 'awaiting_confirmation')
```

- [ ] **Step 4: Add the confidence cue to the header**

In `ScanInboxCard.tsx`, replace the headline paragraph (`:106`) with the paragraph plus a cue pill:

```tsx
          <p className="mt-2 text-[0.95em] text-foreground" dir="auto">{headline}</p>
          {(item.confidence_tier === 'auto' || item.confidence_tier === 'confirm') && (
            <span className={cn(
              'mt-1.5 inline-block rounded-full px-2 py-0.5 text-[0.7em] font-medium',
              item.confidence_tier === 'auto'
                ? 'bg-primary-soft text-primary'
                : 'bg-surface-tinted text-muted-foreground',
            )}>
              {t(`scanInbox.confidence.${item.confidence_tier}`)}
            </span>
          )}
```

Add `cn` to the imports at the top of the file:

```tsx
import { cn } from '@/lib/utils'
```

- [ ] **Step 5: Swap the preview block for `ScanPreview`**

In `ScanInboxCard.tsx`, replace the preview `<div>` (`:120-126`) — the `h-[180px]` block with the `<object>`/`<img>` — with:

```tsx
          <ScanPreview itemId={item.id} filename={item.filename} variant="card" />
```

Update the grid column (`:119`) so the preview column matches the new width:

```tsx
        <div className="mt-3 grid gap-3 rounded-lg border border-hairline bg-surface-raised p-3 sm:grid-cols-[minmax(0,240px)_1fr]">
```

Add the import and remove the now-unused `isPdf` import:

```tsx
import { ScanPreview } from './ScanPreview'
```
Delete: `import { isPdf } from './scanPreview'` and the now-unused `url` const (`:92`) if no longer referenced — the "open full document" link at `:145` still uses `url`, so keep `const url = api.scanDocumentUrl(item.id)` and only remove the `isPdf` import.

- [ ] **Step 6: Run the card tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/scanInbox/ScanInboxCard.test.tsx`
Expected: PASS — the two new tests plus the three existing (chip file, auto-filed deep-link, re-match).

- [ ] **Step 7: Commit**

```bash
git add frontend/src/pages/scanInbox/ScanInboxCard.tsx frontend/src/pages/scanInbox/ScanInboxCard.test.tsx
git commit -m "feat(scan-inbox): readable preview + auto-expand + confidence cue on triage card

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Frontend — wire `ScanPreview` into `ScanMatchDialog` (incl. mobile)

**Files:**
- Modify: `frontend/src/pages/scanInbox/ScanMatchDialog.tsx` (`:75-83` preview pane, `:19` import, `:62` url)
- Test: `frontend/src/pages/scanInbox/ScanMatchDialog.test.tsx` (add one test)

**Interfaces:**
- Consumes: `ScanPreview` (Task 3).

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/pages/scanInbox/ScanMatchDialog.test.tsx` inside the `describe` block:

```tsx
  it('shows the scan preview inside the dialog', () => {
    renderDialog()
    expect(screen.getByRole('button', { name: 'scanInbox.openZoom' })).toBeInTheDocument()
  })
```

Note: `ScanPreview` mounts the lazy `ScanPdfCanvas` for the `scan.pdf` fixture. Add the same stub mock near the top of this test file (after the existing `vi.mock('react-i18next', …)`):

```tsx
vi.mock('./ScanPdfCanvas', () => ({ default: () => <div data-testid="pdf-canvas" /> }))
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/pages/scanInbox/ScanMatchDialog.test.tsx`
Expected: FAIL — no `scanInbox.openZoom` button (pane is still the raw `<object>`).

- [ ] **Step 3: Replace the preview pane**

In `ScanMatchDialog.tsx`, replace the preview `<div>` (`:76-83`) with a wrapper that shows on mobile (above search) and as a side pane on `md+`:

```tsx
        {/* Scan preview: strip above search on mobile, side pane on md+ */}
        <div className="flex-none border-b border-hairline bg-surface-raised p-3 md:w-[45%] md:border-b-0 md:border-e">
          <div className="mx-auto max-w-[220px] md:max-w-none">
            <ScanPreview itemId={item.id} filename={item.filename} variant="dialog" />
          </div>
        </div>
```

Change the dialog flex container (`:75`) to stack on mobile and row on `md+`:

```tsx
      <div className="flex max-h-[85vh] w-full max-w-[820px] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl md:flex-row">
```

- [ ] **Step 4: Update imports**

In `ScanMatchDialog.tsx`, replace `import { isPdf } from './scanPreview'` (`:19`) with:

```tsx
import { ScanPreview } from './ScanPreview'
```

Remove the now-unused `const url = api.scanDocumentUrl(item.id)` (`:62`) — `ScanPreview` builds its own URL.

- [ ] **Step 5: Run the dialog tests to verify they pass**

Run: `cd frontend && npx vitest run src/pages/scanInbox/ScanMatchDialog.test.tsx`
Expected: PASS — the new preview test plus the existing search-and-route test.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/scanInbox/ScanMatchDialog.tsx frontend/src/pages/scanInbox/ScanMatchDialog.test.tsx
git commit -m "feat(scan-inbox): readable preview in match dialog, visible on mobile

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: i18n — new keys in `en` + `ar`, reviewer pass

**Files:**
- Modify: `frontend/src/locales/en.json` (`scanInbox` block, `:2188-2248`)
- Modify: `frontend/src/locales/ar.json` (matching `scanInbox` block)

**Interfaces:**
- Produces: keys `scanInbox.openZoom`, `scanInbox.confidence.auto`, `scanInbox.confidence.confirm` in both locales.

- [ ] **Step 1: Add English keys**

In `frontend/src/locales/en.json`, inside the `scanInbox` object (e.g. after `"openFullDoc"` at `:2212`), add:

```json
    "openZoom": "Open document — zoom & rotate",
    "confidence": {
      "auto": "High confidence",
      "confirm": "Please verify"
    },
```

- [ ] **Step 2: Add Arabic keys**

In `frontend/src/locales/ar.json`, inside the matching `scanInbox` object, add:

```json
    "openZoom": "افتح المستند — تكبير وتدوير",
    "confidence": {
      "auto": "ثقة عالية",
      "confirm": "يرجى المراجعة"
    },
```

- [ ] **Step 2b: Verify JSON is valid**

Run: `cd frontend && node -e "JSON.parse(require('fs').readFileSync('src/locales/en.json','utf8')); JSON.parse(require('fs').readFileSync('src/locales/ar.json','utf8')); console.log('ok')"`
Expected: prints `ok` (no trailing-comma / syntax errors in either file).

- [ ] **Step 3: i18n + notification reviewer pass**

Dispatch the `i18n-rtl-reviewer` agent over the changed scanInbox files and locale diffs (`ScanPreview.tsx`, `ScanInboxCard.tsx`, `ScanMatchDialog.tsx`, `en.json`, `ar.json`) to confirm key parity, no English-in-Arabic leaks, correct RTL (logical properties, mirrored two-column/dialog layouts), and natural Arabic wording. Apply any fixes it reports.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "i18n(scan-inbox): add preview zoom + confidence-cue strings (en/ar)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Frontend typecheck**

Run: `cd frontend && npx tsc --noEmit`
Expected: PASS — no unused-import errors from the swapped `isPdf`/`url`, no type errors.

- [ ] **Step 2: Frontend lint**

Run: `cd frontend && npx eslint src/pages/scanInbox`
Expected: PASS (no errors). Confirms no dangling imports/vars.

- [ ] **Step 3: Full scan-inbox frontend test suite**

Run: `cd frontend && npx vitest run src/pages/scanInbox`
Expected: PASS — `ScanPreview`, `ScanInboxCard`, `ScanMatchDialog` suites all green.

- [ ] **Step 4: Backend scan tests**

Run: `cd backend && python -m pytest tests/test_scan_inbox_document.py -v`
Expected: PASS — 5 tests.

- [ ] **Step 5: Manual smoke (requesting-code-review before merge)**

Run the app (`scripts\mng.ps1 status` / dev server per project norms), open `/scan-inbox`, and confirm on a real PDF item: preview shows a readable portrait page (not blank, not a 180px square), clicking it opens the zoom viewer, the Match dialog shows the preview on both desktop and a narrow viewport. Then invoke `superpowers:requesting-code-review`.

---

## Self-Review

**Spec coverage:**
- Backend `encoding=base64` → Task 1. ✓
- Shared `ScanPreview` (A4 portrait, image + pdf.js page-1, loading/fallback, click→viewer) → Tasks 2 (canvas) + 3 (preview). ✓
- Card: readable preview, two-column/stacked, auto-expand awaiting_confirmation, confidence cue → Task 4. ✓
- Match dialog: ScanPreview + mobile-visible → Task 5. ✓
- i18n parity en+ar, RTL, reviewer → Task 6. ✓
- Testing (backend base64, ScanPreview branches, card expand, dialog preview, parity) → Tasks 1,3,4,5,6 + Task 7 full run. ✓
- Reused DocumentViewerDialog / pdf.js pattern / toBase64Url / fileTypes; no routing/OCR changes. ✓

**Placeholder scan:** No TBD/TODO; every code step has complete code and exact commands. Confidence-cue wording is now concrete (`High confidence` / `Please verify`), resolving the spec's one deferred item.

**Type consistency:** `ScanPreview({ itemId, filename, variant })` is defined in Task 3 and consumed with those exact props in Tasks 4 & 5. `ScanPdfCanvas({ pdfUrl, onError })` defined Task 2, consumed Task 3. `DocViewerItem` fields (`name`, `kind`, `imageUrl?`, `pdfBase64Url?`, `openUrl?`, `downloadUrl`) match the interface in `document-viewer-dialog.tsx`. Confidence tiers `auto|confirm|manual` match backend. i18n keys `scanInbox.openZoom` / `scanInbox.confidence.{auto,confirm}` are produced in Task 6 and referenced in Tasks 3–5.
