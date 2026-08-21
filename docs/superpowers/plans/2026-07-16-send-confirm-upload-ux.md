# Send-to-Group upload control + send confirmation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the bare native file input on the Send-to-Group page with a dropzone + file card, and put a "Ready to send?" confirmation dialog (with the phone preview and a missing-attachment warning) in front of every send.

**Architecture:** Two new self-contained components in `frontend/src/pages/announcements/` — `FileDropzone` (owns the upload visuals around the page's existing `fileRef` input) and `SendConfirmDialog` (Radix dialog embedding the existing `PhonePreview`). `SendToGroupPage.handleSubmit` opens the dialog instead of mutating; confirm fires the unchanged `sendMut`. No backend/API changes.

**Tech Stack:** React 19 + TypeScript, Radix dialog primitives (same as `ReturnFormDialog`/`AmendLeaveDialog`), i18next, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-07-16-send-confirm-upload-ux-design.md` (mockup-locked copy — use the strings exactly as written here).

## Global Constraints

- Frontend-only; do NOT touch backend files or regenerate api types.
- Work on a feature branch in a worktree; merge to `main` when done (live-production checkout rule).
- Bilingual rule: every new string in BOTH `frontend/src/locales/en.json` and `ar.json`; logical CSS only (`ms-`/`me-`, `text-start`); RTL-safe.
- i18n namespaces: `sendToGroup.uploadZone.*` and `sendToGroup.confirmSend.*` — NOT `sendToGroup.confirm`, which already exists as a string key (`SendToGroupPage.tsx:636`).
- The FormData contract is unchanged: `sendMut` keeps reading `fileRef.current.files[0]`; `canSubmit` enablement logic is unchanged (the guard is the dialog, not a disable).
- Gates: `pnpm -C frontend exec tsc -b --noEmit` clean; `pnpm -C frontend run lint` no NEW errors (baseline: 8 problems / 3 errors on main); vitest all green.
- jsdom cannot construct `DataTransfer`/`FileList` for drop events — test the drop path's drag-highlight and preventDefault only; the file-assignment-on-drop line is browser-only (documented below).

---

### Task 1: FileDropzone component + page wiring

**Files:**
- Create: `frontend/src/pages/announcements/FileDropzone.tsx`
- Create: `frontend/src/pages/announcements/FileDropzone.test.tsx`
- Modify: `frontend/src/pages/announcements/SendToGroupPage.tsx` (upload branch ~lines 613-622; `handleFileChange` ~line 220; state block ~line 82)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`

**Interfaces:**
- Consumes: the page's existing `fileRef: useRef<HTMLInputElement>(null)`, `hasFile`, `fileName` state and `handleFileChange` callback.
- Produces (Task 2 does not depend on this, but the page keeps): `FileDropzone({ fileRef, hasFile, fileName, fileSize, onFileChange, onClear })` — renders the hidden input itself; page gains `fileSize: number | null` state.

- [ ] **Step 1: Locale keys.** Add to `en.json` under the `sendToGroup` object:

```json
"uploadZone": {
  "main": "Click to choose a file — or drag & drop it here",
  "hint": "PDF, image, or document · sent to every selected recipient",
  "ready": "Ready to send",
  "replace": "Replace",
  "remove": "Remove"
}
```

and to `ar.json` (same key path):

```json
"uploadZone": {
  "main": "انقر لاختيار ملف — أو اسحبه وأفلته هنا",
  "hint": "PDF أو صورة أو مستند · يُرسل إلى كل مستلم مختار",
  "ready": "جاهز للإرسال",
  "replace": "استبدال",
  "remove": "إزالة"
}
```

- [ ] **Step 2: Write the failing test** — create `FileDropzone.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { useRef, useState } from 'react'
import { describe, expect, it } from 'vitest'

import { FileDropzone } from './FileDropzone'

function Harness(): React.JSX.Element {
  const fileRef = useRef<HTMLInputElement>(null)
  const [hasFile, setHasFile] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [fileSize, setFileSize] = useState<number | null>(null)
  return (
    <FileDropzone
      fileRef={fileRef}
      hasFile={hasFile}
      fileName={fileName}
      fileSize={fileSize}
      onFileChange={() => {
        const f = fileRef.current?.files?.[0] ?? null
        setHasFile(f !== null)
        setFileName(f?.name ?? null)
        setFileSize(f?.size ?? null)
      }}
      onClear={() => {
        if (fileRef.current) fileRef.current.value = ''
        setHasFile(false)
        setFileName(null)
        setFileSize(null)
      }}
    />
  )
}

describe('FileDropzone', () => {
  it('swaps zone → file card on selection, and back on remove', () => {
    render(<Harness />)
    // empty state: the zone text is visible
    expect(screen.getByText(/sendToGroup.uploadZone.main|choose a file/i)).toBeInTheDocument()
    const input = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['%PDF'], 'roster.pdf', { type: 'application/pdf' })
    fireEvent.change(input, { target: { files: [file] } })
    // selected state: card with the file name; zone gone
    expect(screen.getByText('roster.pdf')).toBeInTheDocument()
    expect(screen.queryByText(/choose a file/i)).not.toBeInTheDocument()
    // remove restores the zone
    fireEvent.click(screen.getByRole('button', { name: /remove|إزالة/i }))
    expect(screen.getByText(/choose a file/i)).toBeInTheDocument()
  })

  it('highlights on dragover and clears on dragleave', () => {
    render(<Harness />)
    const zone = screen.getByText(/choose a file/i).closest('div') as HTMLElement
    fireEvent.dragOver(zone)
    expect(zone.className).toMatch(/border-primary/)
    fireEvent.dragLeave(zone)
    expect(zone.className).not.toMatch(/border-primary/)
  })
})
```

Adapt the text queries to how the repo's tests handle i18n (if tests render raw keys, query `sendToGroup.uploadZone.main`; check how `SendToGroupPage.test.tsx` asserts translated vs raw strings and match it).

- [ ] **Step 3: Run to verify failure** — `pnpm -C frontend exec vitest run src/pages/announcements/FileDropzone.test.tsx` → FAIL (module missing).

- [ ] **Step 4: Implement `FileDropzone.tsx`:**

```tsx
/**
 * FileDropzone — the Send-to-Group upload control (spec 2026-07-16).
 * Replaces the bare native file input: a clickable dashed dropzone that
 * swaps to a file card (name, size, Replace/Remove) once a file is chosen.
 * Owns the hidden <input type="file"> around the page's existing fileRef so
 * the FormData send path is unchanged. Drag & drop assigns the dropped
 * FileList to the input (browser-only; jsdom can't construct FileList).
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, Paperclip } from 'lucide-react'

function fmtSize(bytes: number): string {
  return bytes >= 1_048_576
    ? `${(bytes / 1_048_576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function FileDropzone({
  fileRef,
  hasFile,
  fileName,
  fileSize,
  onFileChange,
  onClear,
}: {
  fileRef: React.RefObject<HTMLInputElement | null>
  hasFile: boolean
  fileName: string | null
  fileSize: number | null
  onFileChange: () => void
  onClear: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [drag, setDrag] = useState(false)

  return (
    <div className="mt-3">
      <input
        ref={fileRef}
        type="file"
        onChange={onFileChange}
        className="hidden"
        aria-hidden
        tabIndex={-1}
      />

      {!hasFile ? (
        <div
          role="button"
          tabIndex={0}
          aria-label={t('sendToGroup.uploadZone.main')}
          onClick={() => fileRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              fileRef.current?.click()
            }
          }}
          onDragOver={(e) => {
            e.preventDefault()
            setDrag(true)
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDrag(false)
            if (e.dataTransfer.files.length > 0 && fileRef.current) {
              fileRef.current.files = e.dataTransfer.files
              onFileChange()
            }
          }}
          className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors ${
            drag
              ? 'border-primary bg-primary/5'
              : 'border-border bg-surface-tinted hover:border-primary hover:bg-primary/5'
          }`}
        >
          <Paperclip className="mx-auto mb-1.5 h-6 w-6 text-muted-foreground" aria-hidden />
          <p className="text-[0.88em] font-semibold text-foreground">
            {t('sendToGroup.uploadZone.main')}
          </p>
          <p className="mt-0.5 text-[0.78em] text-muted-foreground">
            {t('sendToGroup.uploadZone.hint')}
          </p>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-xl border border-border bg-surface px-3 py-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10">
            <FileText className="h-4.5 w-4.5 text-primary" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[0.85em] font-semibold text-foreground" dir="ltr">
              {fileName}
            </p>
            <p className="text-[0.78em] text-muted-foreground">
              <span className="font-semibold text-green-600 dark:text-green-400">
                ✓ {t('sendToGroup.uploadZone.ready')}
              </span>
              {fileSize !== null && <> · {fmtSize(fileSize)}</>}
            </p>
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="rounded-md border border-border px-3 py-1.5 text-[0.8em] font-medium text-foreground hover:bg-surface-tinted"
          >
            {t('sendToGroup.uploadZone.replace')}
          </button>
          <button
            type="button"
            onClick={onClear}
            className="rounded-md border border-accent/40 px-3 py-1.5 text-[0.8em] font-medium text-accent hover:bg-accent/10"
          >
            {t('sendToGroup.uploadZone.remove')}
          </button>
        </div>
      )}
    </div>
  )
}
```

(If `h-4.5 w-4.5` is not a valid Tailwind class in this project, use `h-4 w-4`. Check the icon set — `Paperclip`/`FileText` are lucide-react icons already used elsewhere in the app.)

- [ ] **Step 5: Wire into the page** — in `SendToGroupPage.tsx`:

State (next to `fileName`, ~line 82):

```tsx
  const [fileSize, setFileSize] = useState<number | null>(null)
```

Extend `handleFileChange` (~line 220) to also set the size:

```tsx
  const handleFileChange = useCallback(() => {
    const f = fileRef.current?.files?.[0] ?? null
    setHasFile(f !== null)
    setFileName(f?.name ?? null)
    setFileSize(f?.size ?? null)
  }, [])
```

Add a clear handler next to it:

```tsx
  const handleFileClear = useCallback(() => {
    if (fileRef.current) fileRef.current.value = ''
    setHasFile(false)
    setFileName(null)
    setFileSize(null)
  }, [])
```

Replace the upload branch (~lines 613-622, the `{attachMode === 'upload' && (...)}` block containing the bare `<input ref={fileRef} type="file" ...>`):

```tsx
              {attachMode === 'upload' && (
                <FileDropzone
                  fileRef={fileRef}
                  hasFile={hasFile}
                  fileName={fileName}
                  fileSize={fileSize}
                  onFileChange={handleFileChange}
                  onClear={handleFileClear}
                />
              )}
```

Import: `import { FileDropzone } from './FileDropzone'`.

- [ ] **Step 6: Run tests** — `pnpm -C frontend exec vitest run src/pages/announcements` → all pass (the page suite must not regress; the file input moved inside FileDropzone but keeps the same ref contract).

- [ ] **Step 7: Gates** — `pnpm -C frontend exec tsc -b --noEmit` clean; `pnpm -C frontend run lint` no NEW errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/pages/announcements/FileDropzone.tsx frontend/src/pages/announcements/FileDropzone.test.tsx frontend/src/pages/announcements/SendToGroupPage.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(announcements): dropzone upload control replaces bare file input"
```

---

### Task 2: SendConfirmDialog + page wiring

**Files:**
- Create: `frontend/src/pages/announcements/SendConfirmDialog.tsx`
- Create: `frontend/src/pages/announcements/SendConfirmDialog.test.tsx`
- Modify: `frontend/src/pages/announcements/SendToGroupPage.tsx` (`handleSubmit` ~line 226; dialog mount near `RecordAnnouncePicker`)
- Modify: `frontend/src/pages/announcements/SendToGroupPage.test.tsx` (existing send-flow tests gain a confirm step)
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json`

**Interfaces:**
- Consumes: `PhonePreview` + `PreviewAttachment` from `./MessagePreview` (props: `groupName: string | null, text: string, mentionNames: string[], attachment: PreviewAttachment | null`); the page's existing derived values `previewChatName`, `activeMentionNames`, `previewAttachment`, `message`, `selectedIds`, `directEmps`, `sendMut`.
- Produces:

```tsx
export type UnfulfilledAttachment = 'upload' | 'book' | null
export function SendConfirmDialog(props: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
  sending: boolean
  text: string
  chatName: string | null
  mentionNames: string[]
  attachment: PreviewAttachment | null
  unfulfilled: UnfulfilledAttachment
  groupCount: number
  directCount: number
}): React.JSX.Element
```

- [ ] **Step 1: Locale keys.** Add to `en.json` under `sendToGroup`:

```json
"confirmSend": {
  "title": "Ready to send?",
  "subtitle": "This is exactly what recipients will receive.",
  "warnUpload": "You selected “Upload a file” but no file is attached.",
  "warnBook": "You selected “Attach a record” but no record is picked.",
  "send": "Send",
  "sendAnywayFile": "Send anyway — without the file",
  "sendAnywayBook": "Send anyway — without the record",
  "continueEditing": "Continue editing",
  "note": "Nothing is sent until you confirm.",
  "groupsPill_one": "{{count}} group",
  "groupsPill_other": "{{count}} groups",
  "directPill_one": "{{count}} direct",
  "directPill_other": "{{count}} direct"
}
```

And to `ar.json`:

```json
"confirmSend": {
  "title": "جاهز للإرسال؟",
  "subtitle": "هذا بالضبط ما سيستلمه المستلمون.",
  "warnUpload": "اخترت «رفع ملف» لكن لا يوجد ملف مرفق.",
  "warnBook": "اخترت «إرفاق سجل» لكن لم يُختر سجل.",
  "send": "إرسال",
  "sendAnywayFile": "إرسال على أي حال — بدون الملف",
  "sendAnywayBook": "إرسال على أي حال — بدون السجل",
  "continueEditing": "متابعة التحرير",
  "note": "لن يُرسل شيء حتى تؤكد.",
  "groupsPill": "{{count}} من المجموعات",
  "directPill": "{{count}} مباشر"
}
```

(Arabic uses the count-neutral partitive for groups — same convention as `sendToGroup.direct.hintMixed`; check how `ar.json` handled `hintPrivate_*` plural suffixes and mirror the mechanism: if AR plural suffixes are the convention for count pills, use them; EN keeps `_one`/`_other`.)

- [ ] **Step 2: Write the failing dialog test** — create `SendConfirmDialog.test.tsx`:

```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SendConfirmDialog } from './SendConfirmDialog'

function renderIt(over: Partial<Parameters<typeof SendConfirmDialog>[0]> = {}) {
  const onConfirm = vi.fn()
  const onOpenChange = vi.fn()
  render(
    <SendConfirmDialog
      open
      onOpenChange={onOpenChange}
      onConfirm={onConfirm}
      sending={false}
      text="Roster is out"
      chatName="Supervisors"
      mentionNames={[]}
      attachment={null}
      unfulfilled={null}
      groupCount={2}
      directCount={1}
      {...over}
    />,
  )
  return { onConfirm, onOpenChange }
}

describe('SendConfirmDialog', () => {
  it('previews the message and confirms', () => {
    const { onConfirm } = renderIt()
    expect(screen.getByText('Roster is out')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /^send$|sendToGroup.confirmSend.send$/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('shows the upload warning and "send anyway" when unfulfilled', () => {
    const { onConfirm } = renderIt({ unfulfilled: 'upload' })
    expect(screen.getByText(/no file is attached|warnUpload/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /send anyway|sendAnywayFile/i }))
    expect(onConfirm).toHaveBeenCalledTimes(1)
  })

  it('continue editing closes without confirming', () => {
    const { onConfirm, onOpenChange } = renderIt()
    fireEvent.click(screen.getByRole('button', { name: /continue editing|continueEditing/i }))
    expect(onConfirm).not.toHaveBeenCalled()
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
```

(Adapt text queries to the repo's i18n-in-tests convention, same as Task 1. If the Radix dialog needs a portal container or `open` context in tests, mirror how `AmendLeaveDialog.test.tsx` renders its dialog.)

- [ ] **Step 3: Run to verify failure** — `pnpm -C frontend exec vitest run src/pages/announcements/SendConfirmDialog.test.tsx` → FAIL (module missing).

- [ ] **Step 4: Implement `SendConfirmDialog.tsx`.** Read `frontend/src/pages/leaves/ReturnFormDialog.tsx` first and reuse its Radix `Dialog` shell (same primitives/classes — do not invent a new dialog system). Content per this contract:

```tsx
/**
 * SendConfirmDialog — every Send on the Send-to-Group page passes through
 * this confirmation (spec 2026-07-16): "Ready to send?" with the message
 * rendered in the real PhonePreview, recipient pills, and — when an
 * attachment mode was chosen but nothing attached — an amber warning with
 * the primary button becoming "Send anyway". One dialog, both jobs.
 */
import { useTranslation } from 'react-i18next'
import { AlertTriangle } from 'lucide-react'

import { PhonePreview, type PreviewAttachment } from './MessagePreview'
// + the same Dialog primitives ReturnFormDialog imports

export type UnfulfilledAttachment = 'upload' | 'book' | null

export function SendConfirmDialog({
  open, onOpenChange, onConfirm, sending, text, chatName, mentionNames,
  attachment, unfulfilled, groupCount, directCount,
}: { /* … exact props from the Interfaces block … */ }): React.JSX.Element {
  const { t } = useTranslation()
  const sendLabel =
    unfulfilled === 'upload' ? t('sendToGroup.confirmSend.sendAnywayFile')
    : unfulfilled === 'book' ? t('sendToGroup.confirmSend.sendAnywayBook')
    : t('sendToGroup.confirmSend.send')
  // Body layout (top→bottom):
  // 1. centered title t('sendToGroup.confirmSend.title') + subtitle
  // 2. warning row when unfulfilled !== null:
  //    <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-amber-300
  //         bg-amber-50 px-3 py-2.5 text-[0.85em] font-medium text-amber-800
  //         dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
  //      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
  //      {t(unfulfilled === 'upload' ? 'sendToGroup.confirmSend.warnUpload' : 'sendToGroup.confirmSend.warnBook')}
  //    </div>
  // 3. recipient pills row (each hidden when its count is 0):
  //    groupCount > 0 → t('sendToGroup.confirmSend.groupsPill', { count: groupCount })
  //    directCount > 0 → t('sendToGroup.confirmSend.directPill', { count: directCount })
  //    styled: inline-flex rounded-full bg-surface-tinted px-2.5 py-1 text-[0.78em] text-muted-foreground
  // 4. <PhonePreview groupName={chatName} text={text} mentionNames={mentionNames} attachment={attachment} />
  // 5. stacked full-width buttons:
  //    primary: onClick={onConfirm} disabled={sending}; warning styling
  //      (bg-amber-600 hover:bg-amber-700 text-white) when unfulfilled, else the
  //      standard primary (bg-primary text-primary-foreground); label = sendLabel
  //    secondary: onClick={() => onOpenChange(false)} — t('sendToGroup.confirmSend.continueEditing')
  // 6. footnote: t('sendToGroup.confirmSend.note') — centered, text-[0.72em] text-muted-foreground
}
```

The comment block defines every element, class set, and key; the dialog shell (overlay, content, close-on-escape/outside) comes from ReturnFormDialog's primitives. `onConfirm` must NOT call `onOpenChange` itself — the page closes the dialog in its own handler.

- [ ] **Step 5: Wire into the page** — `SendToGroupPage.tsx`:

State + derived (near the other state):

```tsx
  const [confirmOpen, setConfirmOpen] = useState(false)
  const unfulfilled: UnfulfilledAttachment =
    attachMode === 'upload' && !hasFile
      ? 'upload'
      : attachMode === 'book' && !bookId.trim()
        ? 'book'
        : null
```

Change `handleSubmit` (~line 226) to open the dialog instead of mutating:

```tsx
  function handleSubmit(e: React.FormEvent): void {
    e.preventDefault()
    if (!canSubmit) return
    setConfirmOpen(true)
  }
```

Mount the dialog next to `RecordAnnouncePicker`:

```tsx
      <SendConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        sending={sendMut.isPending}
        onConfirm={() => {
          setConfirmOpen(false)
          sendMut.mutate()
        }}
        text={message.trim()}
        chatName={previewChatName}
        mentionNames={activeMentionNames}
        attachment={previewAttachment}
        unfulfilled={unfulfilled}
        groupCount={selectedIds.size}
        directCount={directEmps.length}
      />
```

Import: `import { SendConfirmDialog, type UnfulfilledAttachment } from './SendConfirmDialog'`.

- [ ] **Step 6: Update the page tests.** `SendToGroupPage.test.tsx` has send-flow tests that click Send and assert `api.sendAnnouncement` was called (including the two direct-send tests added 2026-07-15). They now need a confirm step: after clicking Send, click the dialog's confirm button, then keep the existing assertions. Also ADD:

```tsx
it('send opens the confirmation instead of posting; continue editing aborts', async () => {
  // arrange exactly like the existing send test (connected gateway, group selected, message typed)
  // act: click Send
  // assert: api.sendAnnouncement NOT called; the dialog title is visible
  // act: click Continue editing
  // assert: api.sendAnnouncement still NOT called; dialog closed
})
```

Implement it fully with the file's existing helpers (they mock `useGatewayStatus`, `api.listGroups`, `api.sendAnnouncement`).

- [ ] **Step 7: Run tests** — `pnpm -C frontend exec vitest run src/pages/announcements` → all pass.

- [ ] **Step 8: Gates** — `pnpm -C frontend exec tsc -b --noEmit` clean; `pnpm -C frontend run lint` no NEW errors.

- [ ] **Step 9: Commit**

```bash
git add frontend/src/pages/announcements frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(announcements): Ready-to-send confirmation dialog with phone preview + missing-attachment warning"
```

---

### Task 3: Gates, i18n review, finish

**Files:** none new — verification and merge only.

- [ ] **Step 1:** Full frontend suite: `pnpm -C frontend test && pnpm -C frontend exec tsc -b --noEmit && pnpm -C frontend run lint` → green / no new errors.
- [ ] **Step 2:** Quick backend sanity (nothing should have changed): `git status --short -- backend/` → empty.
- [ ] **Step 3:** Dispatch the `i18n-rtl-reviewer` agent on the diff (FileDropzone, SendConfirmDialog, SendToGroupPage, both locale files). Fix real findings, re-run gates.
- [ ] **Step 4:** Check `git status` for `backend/templates/*.docx` churn — revert any.
- [ ] **Step 5:** Use superpowers:finishing-a-development-branch (merge to `main`; push is the user's deploy decision).
