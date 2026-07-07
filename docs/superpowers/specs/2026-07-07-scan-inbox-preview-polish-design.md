# Scan Inbox — readable document preview & triage polish

**Date:** 2026-07-07
**Status:** Approved design, ready for implementation plan
**Area:** `frontend/src/pages/scanInbox/*`, `backend/app/api/v1/scan_inbox.py`

## Problem

The OCR Scan Inbox triage flow asks an operator to verify what the OCR read against
the actual scanned document before filing it. The current preview defeats that:

1. **Squished / unreadable size.** The expand-in-place card renders the scan into a
   fixed **180×180 px square** (`ScanInboxCard.tsx:120`). An A4 page (portrait, 0.71
   ratio) fit into a square via `object-contain` collapses to ~127 px wide — too small
   to read without opening the file separately.
2. **Blank PDFs in the packaged app.** PDFs render via
   `<object type="application/pdf">` (`ScanInboxCard.tsx:122`, `ScanMatchDialog.tsx:79`).
   Inside the packaged **Edge WebView2** the app ships in, embedded `<object>/<iframe>`
   PDFs **blank out or force a download** — the exact failure the document-generation
   and ledger teams already fixed by rendering with a **pdf.js canvas**
   (`DocPreview.tsx:9-13`, `components/ledger/PdfViewer.tsx`). Scan Inbox was never
   migrated, so its PDF preview is effectively broken in production.
3. **Match dialog has the same two problems**, plus its preview pane is
   `hidden md:block` (`ScanMatchDialog.tsx:77`) — no document at all on mobile.

Net effect: "preview is too small, landscape-in-a-square, requires zoom and too much
focus to read the details."

## Goals

- The scanned document is **readable at a glance** in a proper A4-portrait pane, with
  one click to a full zoom/rotate viewer for fine detail.
- PDFs render reliably in the packaged WebView2 build (no blank/download).
- The triage interaction reads-then-acts with less friction (auto-expand the section
  that requires verification; clearer copy; a confidence cue).
- Reuse existing, proven building blocks rather than inventing new viewers.

## Non-goals

- No changes to routing/matching logic, the OCR pipeline, candidate ranking, or any
  other document-preview surface (application, ledger, employee docs).
- No new full-screen viewer — the existing `DocumentViewerDialog` is reused as-is.

## Reading model (decided)

Readable **A4-portrait pane inline**, OCR fields beside it on wide screens and stacked
below (page on top) on mobile. Clicking the page opens the existing full-screen
`DocumentViewerDialog` (zoom 25–400 %, rotate, pan) for fine reading.

```
┌ Card (needs confirmation) ───────────────┐
│ From: hr@… · Subject line               ▲ │
│ File to: Ahmed Ali                         │
│ ┌──────────────┐  OCR READ                 │
│ │              │  Name   Ahmed Ali         │
│ │   A4 page    │  ID     10231             │
│ │  (readable,  │  Date   2026-07-01        │
│ │   portrait)  │                           │
│ │           ⤢  │  ⤢ click page = full zoom │
│ └──────────────┘                           │
│ [File to Ahmed Ali] [Match…] [Dismiss]     │
└────────────────────────────────────────────┘
```

## Architecture

### Reused, not rebuilt
- **`DocumentViewerDialog`** (`components/ui/document-viewer-dialog.tsx`) — the
  click-to-zoom target. Takes `DocViewerItem[]` (`{ name, kind, imageUrl?,
  pdfBase64Url?, openUrl?, downloadUrl }`).
- **pdf.js canvas pattern** (`DocPdfCanvas` / ledger `PdfViewer`) — WebView2-safe
  rendering via `?encoding=base64` bytes.
- **`toBase64Url`** (`lib/pdf.ts`), **`fileTypes`** kind mapping, `isPdf`.

### Component A — backend: base64 support for the scan document endpoint

`get_scan_document` (`backend/app/api/v1/scan_inbox.py:128`) currently only streams the
file inline (safe types) or as an attachment. Add:

- Query param `encoding: Literal["base64"] | None = None`.
- When `encoding == "base64"`: read the bytes, base64-encode, return as
  `text/plain` with `X-Content-Type-Options: nosniff` (and inline disposition). This
  mirrors the existing endpoints (`/leaves/{id}/certificate`, vault download,
  `/signatures/me`) so the pdf.js canvas can fetch bytes without the WebView2/IDM PDF
  stream handler intercepting them.
- Unset/other → unchanged behavior (inline stream for safe types, attachment
  otherwise).
- **Why PDFs only need this:** images don't trigger the PDF-stream handler; they keep
  using the plain inline URL in an `<img>`.

**Test:** `encoding=base64` returns `text/plain`, body decodes to the original bytes;
foreign-item 404 and missing-file 404 paths still hold.

### Component B — `ScanPreview` (new, shared)

`frontend/src/pages/scanInbox/ScanPreview.tsx` — the single portrait preview used by
both the card and the dialog.

**Props**
- `itemId: number`, `filename: string`
- `variant: 'card' | 'dialog'` — controls sizing only.

**Behavior**
- Renders an **A4-portrait frame** (`aspect-[210/297]`, width-driven, `max-h` guard so
  cards never grow absurd) on a white page background inside a rounded bordered box.
- **Images** (`!isPdf`) → `<img object-contain>` against the inline document URL
  (`api.scanDocumentUrl(id)`).
- **PDFs** → a lazy pdf.js canvas rendering **page 1 only** at the frame's pixel width,
  fetching `toBase64Url(scanDocumentUrl(id))`. First page is enough for recognition +
  reading the header; full multi-page reading happens in the zoom viewer.
- **States:** loading skeleton; on render failure or a non-previewable type, a clean
  fallback (file icon + label + the Open-document action) — never a blank frame.
- The frame is a **button** (with a small ⤢ / `Maximize` affordance, `aria-label`)
  that opens `DocumentViewerDialog` with a single `DocViewerItem` built from the scan:
  - `kind` from the filename via `fileTypes`.
  - Images → `imageUrl = scanDocumentUrl(id)`.
  - PDFs → `pdfBase64Url = toBase64Url(scanDocumentUrl(id))`.
  - `downloadUrl` / `openUrl = scanDocumentUrl(id)`.
- The lightweight inline page-1 canvas lives inside `ScanPreview` (kept separate from
  `DocPdfCanvas`, which renders all pages at `min-h-[400px]` and is tuned for the
  application preview). It follows the same fetch/`disableFontFace`/dpr conventions.

### Component C — `ScanInboxCard`

- Replace the 180 px square block (`ScanInboxCard.tsx:119-126`) with `ScanPreview`
  (`variant="card"`):
  - `sm+`: two columns — portrait preview (~240 px) + OCR fields beside.
  - mobile: stacked, **preview on top**, OCR below.
- **Auto-expand** items whose `state === 'awaiting_confirmation'` (initialize
  `expanded` from state). Other sections start collapsed. The chevron still toggles.
- Keep the OCR-read field list and the secondary "open in new tab" link; the preview
  click is now the primary path to the in-app zoom viewer.
- **Copy/labels polish** + a subtle **confidence cue** derived from
  `item.confidence_tier` (e.g. a small muted pill: high / needs a look / manual). Exact
  wording finalized during implementation with the notification/i18n reviewers.

### Component D — `ScanMatchDialog`

- Replace the `<object>` pane (`ScanMatchDialog.tsx:77-83`) with `ScanPreview`
  (`variant="dialog"`).
- **Show the preview on mobile**: instead of `hidden w-[45%] md:block`, render a
  compact preview strip above the search panel on small screens and the side pane on
  `md+`. The operator should never match a document they can't see.

### Component E — i18n

- All new/changed strings added to **both** `en` and `ar` locale files with key parity
  (English leaking into Arabic is this app's #1 recurring bug). New keys likely under
  `scanInbox.*`: preview open/zoom labels, can't-preview fallback, confidence-cue
  labels, any reworded headlines/buttons.
- RTL check: the two-column card layout and the dialog preview strip must mirror
  correctly.

## Data flow

1. Card/dialog renders `ScanPreview` with `itemId` + `filename`.
2. `ScanPreview` picks image vs PDF by extension.
   - Image → `<img src={scanDocumentUrl(id)}>` (existing inline stream).
   - PDF → fetch `scanDocumentUrl(id)?encoding=base64` → decode → paint page 1 to a
     canvas.
3. Click the frame → build one `DocViewerItem` → mount `DocumentViewerDialog`.
4. Backend `get_scan_document` serves inline bytes (image/`<img>`) or base64 text
   (PDF/canvas), unchanged auth (`documents.scan`) and 404 handling.

## Error handling

- **Backend:** missing file → 404 (existing); foreign item → 404 (existing); base64
  path shares those guards.
- **`ScanPreview`:** fetch/render failure → fallback panel with file icon + "Open
  document" (routes to the viewer / new tab), never a blank or spinning frame.
- **`DocumentViewerDialog`:** already handles image `onError` and PDF render failure
  with its own fallbacks.

## Testing

- **Backend:** `encoding=base64` returns `text/plain` decoding to original bytes; 404
  paths unchanged.
- **`ScanPreview`:** renders an `<img>` for image filenames; renders the canvas/loader
  path for PDFs; renders the fallback on error; the frame click opens the viewer.
- **`ScanInboxCard`:** `awaiting_confirmation` starts expanded; other states start
  collapsed; chevron still toggles; preview present when expanded. Update existing
  `ScanInboxCard.test.tsx`.
- **`ScanMatchDialog`:** preview present on `md+` and on mobile; routing still fires on
  result click. Update existing `ScanMatchDialog.test.tsx`.
- **i18n parity** + RTL reviewed by the `i18n-rtl-reviewer` and
  `notification-template-reviewer` agents where copy changes.

## Rollout / risk

- The backend change is additive and mirrors an established pattern — low risk.
- Primary risk is the pdf.js worker asset in the packaged build; the shared fallback
  (Open-document) keeps the operator un-blocked if page-1 render fails, matching the
  escape hatch `DocPdfCanvas` already provides.
- No migration, no schema change.
