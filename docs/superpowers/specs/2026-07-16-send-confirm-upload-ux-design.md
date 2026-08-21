# Send-to-Group: upload control + send confirmation — design

**Date:** 2026-07-16
**Mockup (approved):** `docs/upload-ux-polish-mockup.html` (v2)
**Scope:** frontend-only changes to the Send-to-Group page (`frontend/src/pages/announcements/`).
No backend, schema, or API changes — no `/sync-api-types` needed.

## Problem

1. The "Upload a file" attachment option renders a bare native `<input type="file">`
   (`SendToGroupPage.tsx:613-620`) — it reads as plain text, the click target is
   tiny, and users press Send believing they attached a file.
2. Nothing prevents that mistaken send: with a message typed, Send is enabled
   even when "Upload a file" (or "Attach a record") is selected with nothing
   attached. The user hit this in production.

## Design (per approved mockup v2)

### 1. Upload dropzone (replaces the bare input)

New component `FileDropzone.tsx` in `pages/announcements/`:

- **Empty state:** a dashed-border zone, fully clickable, with a 📎 icon,
  "Click to choose a file — or drag & drop it here", and a hint line
  ("PDF, image, or document · sent to every selected recipient"). Clicking it
  opens the hidden file input. Drag-over highlights the zone; dropping a file
  assigns `e.dataTransfer.files` to the hidden input and fires the change
  handler.
- **Selected state:** the zone is replaced by a file card — file-type icon,
  name (`dir="ltr"`), size (formatted KB/MB), "✓ Ready to send", and
  **Replace** (reopens the picker) / **Remove** (clears the input) buttons.
- The hidden `<input type="file">` keeps the existing `fileRef` contract so
  `sendMut`'s FormData path (`fileRef.current.files[0]`) is unchanged. Page
  gains a `fileSize` state next to the existing `fileName`.
- Dropping a file anywhere on the zone auto-selects the "Upload a file" radio
  (`setAttachMode('upload')`) — the zone is only rendered in upload mode, so
  this matters for a possible future page-level drop target; v1 keeps the drop
  target inside the zone only (YAGNI).
- RTL-safe (logical CSS), `dir="auto"` not needed (no free text), bilingual
  strings under `sendToGroup.uploadZone.*`.

### 2. Send confirmation dialog (every send)

New component `SendConfirmDialog.tsx` in `pages/announcements/`:

- `handleSubmit` no longer calls `sendMut.mutate()` directly: it opens the
  dialog (`confirmOpen` state). Nothing sends until confirmed. Escape /
  overlay-click / "Continue editing" close without sending.
- Dialog content (top to bottom):
  - Title **"Ready to send?"** + subtitle "This is exactly what recipients
    will receive."
  - **Warning row** (amber), only when attachment intent is unfulfilled:
    `unfulfilled = (attachMode==='upload' && !hasFile) || (attachMode==='book' && !bookId)`
    with mode-specific copy ("You selected 'Upload a file' but no file is
    attached." / record variant).
  - **Recipient pills:** groups count and direct-employees count (each pill
    hidden when its count is 0).
  - **Phone preview:** reuse the existing `PhonePreview` component
    (`MessagePreview.tsx`) with the page's already-computed props —
    `previewChatName`, message text, `activeMentionNames`,
    `previewAttachment`. What the composer previews is exactly what the
    dialog confirms.
  - **Primary button:** "Send" — or, when unfulfilled, **"Send anyway —
    without the file/record"** in warning styling. Disabled while
    `sendMut.isPending`.
  - **Secondary button:** "Continue editing".
  - Footnote: "Nothing is sent until you confirm."
- One dialog does both jobs (no chained popups) — approved in mockup review.
- Dialog shell follows the app's existing Radix dialog primitives (same ones
  `ConfirmDialog` / `ReturnFormDialog` use), sized to fit the phone preview
  (~440px), content scrollable on small screens.
- On confirm: close the dialog, then `sendMut.mutate()` (the existing result
  panel/toast behavior is unchanged).

### i18n

New keys in BOTH `en.json` and `ar.json` (namespace `sendToGroup.uploadZone.*`
and `sendToGroup.confirmSend.*` — NOT `sendToGroup.confirm`, which already
exists as a string key). Strings as in the approved mockup (EN and AR),
including: zone main/hint, ready, replace, remove, dialog title/subtitle,
warning (upload + record variants), send / sendAnyway (file + record
variants) / continueEditing, footnote, and recipient-pill labels (reuse
existing count patterns; Arabic plural handling mirrors the
`sendToGroup.direct.*` conventions).

### Out of scope

- No change to `canSubmit` enablement (guard is the soft dialog, not a
  disable).
- No page-wide drag-and-drop target.
- No file-type/size validation beyond what the backend already enforces.
- Extended (WA-Web) view keeps its own inline preview; the dialog appears the
  same way in both views.

### Testing

- `FileDropzone.test.tsx`: renders empty zone; simulated file selection swaps
  to the card with the file name; Remove restores the zone; drop assigns
  files and fires onChange.
- `SendConfirmDialog.test.tsx`: shows message text; warning + "Send anyway"
  when unfulfilled; clean "Send" when fulfilled; confirm fires callback;
  "Continue editing" closes without firing.
- `SendToGroupPage.test.tsx` additions: clicking Send opens the dialog
  instead of posting; confirming posts (existing FormData assertions reused);
  cancelling does not post.
- Run the `i18n-rtl-reviewer` after locale/UI work (project rule).
