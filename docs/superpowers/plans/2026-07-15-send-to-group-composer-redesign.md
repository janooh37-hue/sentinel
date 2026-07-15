# Send-to-Group Composer Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `/announcements/send` as a full-width 3-column composer (recipients rail · composer with Normal/Extended views · live iPhone preview) and make employee @mentions real WhatsApp mentions that notify the person.

**Architecture:** Frontend-heavy redesign of `SendToGroupPage.tsx` with two new sibling components (`MessagePreview.tsx` render surfaces, extended `EmployeeMentionField`), driven by pure helpers in `mention.ts`. Backend gains a `mentions` pass-through: route Form field → `announce_service` → `openwa_client` WAHA payload (`mentions: ["<digits>@c.us"]` on sendText/sendFile), plus `contact` exposed on `EmployeeListItem` so the frontend knows each employee's number. Animations are CSS-only (grid-template-columns/height/opacity transitions) honoring `prefers-reduced-motion`.

**Tech Stack:** React 19 + TS + Tailwind 4 + React Query + vitest/RTL (frontend); FastAPI + httpx + pytest with `httpx.MockTransport` (backend); WAHA gateway (NOWEB engine).

**Spec:** `docs/superpowers/specs/2026-07-15-send-to-group-composer-redesign-design.md` — read it first.

## Global Constraints

- This checkout is live production. Work in a worktree branch (`feat/send-to-group-composer-redesign`); never touch `main` directly; merge only when all gates pass.
- Backend gates: `venv\Scripts\python.exe -m pytest`, `venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .`, `venv\Scripts\mypy.exe` (strict). pytest runs with `filterwarnings=error`.
- Frontend gates: `pnpm -C frontend test`, `pnpm -C frontend run lint`, `pnpm -C frontend exec tsc -b --noEmit`.
- After ANY backend schema/route change: resync generated types per `.claude/skills/sync-api-types/SKILL.md` (dump openapi → `pnpm gen:api` → typecheck). `openapi.json` is gitignored in this repo — commit `api.types.ts` only.
- Bilingual: every new UI string gets keys in BOTH `frontend/src/locales/en.json` and `ar.json`. Logical CSS only (`ms-`/`me-`, `text-start`, `inset-inline-*`) — never `ml-`/`left-`. `dir="auto"` on all user-content surfaces.
- All WhatsApp-look colors go through CSS custom properties added in Task 5 (`--wa-*` tokens in `index.css`), not scattered hex.
- Existing behavior preserved: capability gating, gateway banner states, attach modes, result panel, unlink/rescan (see spec "Unchanged" section).
- Preview bubble in the phone frame: `max-width: 94%` of chat surface, `width: fit-content` — long broadcasts fill the phone width (explicit spec requirement).

---

### Task 1: WAHA client — mentions support + number normalizer

**Files:**
- Modify: `backend/app/services/openwa_client.py` (send_to_chat ~line 91, send_file ~line 155; add helper near `_chat_id` ~line 65)
- Test: `backend/tests/test_openwa_client.py` (append)

**Interfaces:**
- Consumes: nothing new.
- Produces (Task 2 relies on these exact signatures):
  - `send_to_chat(chat_id: str, text: str, mentions: list[str] | None = None) -> SendResult`
  - `send_file(chat_id: str, *, data: bytes, filename: str, caption: str, mimetype: str = "application/pdf", mentions: list[str] | None = None) -> SendResult`
  - `mention_chat_ids(raws: list[str]) -> list[str]` — normalizes raw phone strings to `"<digits>@c.us"`, dedupes, drops empties.

- [ ] **Step 1: Write the failing tests** (append to `backend/tests/test_openwa_client.py`, following the existing `httpx.MockTransport` pattern in that file — a `handler(req) -> httpx.Response` assigned to `openwa_client._transport` via monkeypatch, exactly like the tests at the top of the file):

```python
def test_send_to_chat_includes_mentions(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured.update(json.loads(req.content))
        return httpx.Response(201, json={"id": "true_123@g.us_ABC"})

    _patch_transport(monkeypatch, handler)  # use/extend this file's existing transport-patch helper
    res = openwa_client.send_to_chat(
        "123@g.us", "Hi @971509059931", mentions=["971509059931@c.us"]
    )
    assert res.ok
    assert captured["mentions"] == ["971509059931@c.us"]


def test_send_to_chat_omits_mentions_key_when_none(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured.update(json.loads(req.content))
        return httpx.Response(201, json={"id": "x"})

    _patch_transport(monkeypatch, handler)
    openwa_client.send_to_chat("123@g.us", "plain")
    assert "mentions" not in captured


def test_send_file_includes_mentions(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    def handler(req: httpx.Request) -> httpx.Response:
        captured.update(json.loads(req.content))
        return httpx.Response(201, json={"id": "x"})

    _patch_transport(monkeypatch, handler)
    openwa_client.send_file(
        "123@g.us", data=b"pdf", filename="a.pdf", caption="hi",
        mentions=["971509059931@c.us"],
    )
    assert captured["mentions"] == ["971509059931@c.us"]


@pytest.mark.parametrize(
    ("raws", "expected"),
    [
        (["+971 50 905 9931"], ["971509059931@c.us"]),
        (["00971509059931"], ["971509059931@c.us"]),
        (["0509059931"], ["971509059931@c.us"]),  # org-local leading 0 -> 971
        (["971509059931", "971509059931"], ["971509059931@c.us"]),  # dedupe
        (["", "  ", "abc"], []),  # nothing usable
    ],
)
def test_mention_chat_ids(raws: list[str], expected: list[str]) -> None:
    assert openwa_client.mention_chat_ids(raws) == expected
```

If the existing file patches the transport differently (module-level `_transport` assignment), mirror that exact mechanism instead of inventing `_patch_transport`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client.py -k mention -v`
Expected: FAIL — `TypeError: send_to_chat() got an unexpected keyword argument 'mentions'` / `AttributeError: mention_chat_ids`

- [ ] **Step 3: Implement.** In `openwa_client.py`:

Add near `_chat_id`:

```python
def mention_chat_ids(raws: list[str]) -> list[str]:
    """Normalize raw phone strings to WhatsApp mention ids (``<digits>@c.us``).

    Strips non-digits, drops an international ``00`` prefix, and maps an
    org-local leading ``0`` (e.g. ``05x…``) to the UAE country code. Empty
    and duplicate entries are dropped; order is preserved.
    """
    out: list[str] = []
    for raw in raws:
        digits = "".join(ch for ch in raw if ch.isdigit())
        if digits.startswith("00"):
            digits = digits[2:]
        elif digits.startswith("0") and len(digits) >= 9:
            digits = "971" + digits[1:]
        if not digits:
            continue
        cid = f"{digits}@c.us"
        if cid not in out:
            out.append(cid)
    return out
```

Change `send_to_chat` (payload dict must be typed `dict[str, object]` for mypy-strict once it holds a list):

```python
def send_to_chat(chat_id: str, text: str, mentions: list[str] | None = None) -> SendResult:
    """Send free-form text to any WhatsApp chat id (person @c.us or group @g.us)."""
    cfg = get_settings()
    url = f"{_base()}/api/sendText"
    payload: dict[str, object] = {"session": cfg.openwa_session, "chatId": chat_id, "text": text}
    if mentions:
        payload["mentions"] = mentions
    ...  # rest of the function body unchanged
```

Change `send_file` the same way — add `mentions: list[str] | None = None` keyword-only param and after building `payload` add:

```python
    if mentions:
        payload["mentions"] = mentions
```

(`send_file`'s payload literal already infers `dict[str, object]`-compatible; if mypy complains, annotate it `dict[str, object]` too.)

- [ ] **Step 4: Run tests + gates**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_openwa_client.py -v` → all PASS
Run: `venv\Scripts\ruff.exe check backend/app/services/openwa_client.py backend/tests/test_openwa_client.py && venv\Scripts\mypy.exe` → clean

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/openwa_client.py backend/tests/test_openwa_client.py
git commit -m "feat(openwa): mentions support on sendText/sendFile + phone->chat-id normalizer"
```

---

### Task 2: Announce route + service accept mentions

**Files:**
- Modify: `backend/app/services/announce_service.py` (`send_announcement`, ~line 182)
- Modify: `backend/app/api/v1/announcements.py` (`send_announcement` route, ~line 75)
- Test: `backend/tests/test_announcements_api.py`, `backend/tests/test_announcements_gateway.py` (append)

**Interfaces:**
- Consumes (Task 1): `openwa_client.mention_chat_ids`, `send_to_chat(..., mentions=)`, `send_file(..., mentions=)`.
- Produces (frontend Task 7 relies on this): `POST /announcements/send` accepts repeated Form field `mentions` (raw phone strings, e.g. `971509059931`); message text is expected to already contain `@<digits>` tokens for those numbers (frontend's job).

- [ ] **Step 1: Write failing service test** (append to `backend/tests/test_announcements_gateway.py`, reusing its db fixture + openwa mock style):

```python
def test_send_announcement_passes_normalized_mentions(
    db: Session, monkeypatch: pytest.MonkeyPatch
) -> None:
    calls: list[dict[str, object]] = []

    def fake_send_to_chat(
        chat_id: str, text: str, mentions: list[str] | None = None
    ) -> openwa_client.SendResult:
        calls.append({"chat_id": chat_id, "text": text, "mentions": mentions})
        return openwa_client.SendResult(ok=True, message_id="m1")

    monkeypatch.setattr(announce_service.openwa_client, "send_to_chat", fake_send_to_chat)
    _enable_openwa(monkeypatch)  # reuse this file's existing settings-enable helper/fixture

    announce_service.send_announcement(
        db,
        groups=[("g1@g.us", "Duty Officers")],
        text="Hi @971509059931",
        attachment=None,
        book_id=None,
        sent_by=None,
        mentions=["+971 50 905 9931"],
    )
    assert calls[0]["mentions"] == ["971509059931@c.us"]
```

- [ ] **Step 2: Write failing API test** (append to `backend/tests/test_announcements_api.py`, following its monkeypatched-service pattern): post multipart with two `mentions` fields and assert the mocked `announce_service.send_announcement` received `mentions=["971509059931", "0501234567"]`.

```python
def test_send_route_forwards_mentions(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    seen: dict[str, object] = {}

    def fake_send(db: object, **kw: object) -> announce_service.AnnouncementResult:
        seen.update(kw)
        return announce_service.AnnouncementResult(announcement_id=1, sent=1, failed=0, results=[])

    monkeypatch.setattr(announce_service, "send_announcement", fake_send)
    monkeypatch.setattr(
        announce_service, "groups_available",
        lambda db: [openwa_client.Group(id="g1@g.us", name="G One")],
    )
    resp = client.post(
        "/api/v1/announcements/send",
        data={"group_ids": ["g1@g.us"], "text": "hi @971509059931",
              "mentions": ["971509059931", "0501234567"]},
    )
    assert resp.status_code == 200
    assert seen["mentions"] == ["971509059931", "0501234567"]
```

Adapt fixture names (`client`, auth override, URL prefix) to what that file actually uses — read it first.

- [ ] **Step 3: Run both to verify they fail** — `venv\Scripts\python.exe -m pytest backend/tests/test_announcements_gateway.py backend/tests/test_announcements_api.py -k mention -v` → FAIL (unexpected kwarg).

- [ ] **Step 4: Implement.**

`announce_service.send_announcement`: add keyword param + normalize once, thread through both send paths:

```python
def send_announcement(
    db: Session,
    *,
    groups: list[tuple[str, str]],
    text: str,
    attachment: Attachment | None,
    book_id: int | None,
    sent_by: int | None,
    mentions: list[str] | None = None,
) -> AnnouncementResult:
```

After the `openwa_enabled` guard:

```python
    mention_ids = openwa_client.mention_chat_ids(mentions or [])
```

In the fan-out loop:

```python
            if attachment is not None:
                send_result = openwa_client.send_file(
                    group_id,
                    data=attachment.data,
                    filename=attachment.filename,
                    caption=text,
                    mentions=mention_ids or None,
                )
            else:
                send_result = openwa_client.send_to_chat(
                    group_id, text, mentions=mention_ids or None
                )
```

Also document the new param in the function docstring (mentions: raw phone strings; normalized here; gateway degrades to literal text if unsupported).

Route (`announcements.py`): add Form param and pass through:

```python
    mentions: Annotated[list[str] | None, Form()] = None,
```

```python
    result = announce_service.send_announcement(
        db,
        groups=groups,
        text=text,
        attachment=attachment,
        book_id=(book_id if file is None else None),
        sent_by=user.id,
        mentions=mentions or [],
    )
```

- [ ] **Step 5: Run backend gates** — `venv\Scripts\python.exe -m pytest backend/tests/test_announcements_gateway.py backend/tests/test_announcements_api.py -v`, then full `venv\Scripts\python.exe -m pytest`, `venv\Scripts\ruff.exe check .`, `venv\Scripts\mypy.exe` → all clean.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/announce_service.py backend/app/api/v1/announcements.py backend/tests/test_announcements_gateway.py backend/tests/test_announcements_api.py
git commit -m "feat(announcements): accept mentions on /send and pass through to WAHA"
```

---

### Task 3: Expose `contact` on EmployeeListItem + resync generated types

**Files:**
- Modify: `backend/app/schemas/employee.py:154-167` (`EmployeeListItem`)
- Test: the existing employees API test file (`backend/tests/test_employees_api.py` or nearest equivalent — locate with `Grep "EmployeeListItem\|/employees" backend/tests`)
- Modify (generated): `frontend/src/lib/api.types.ts` via sync skill

**Interfaces:**
- Produces: `EmployeeListItem.contact: str | None` on `GET /employees` items (frontend Tasks 6–7 read `emp.contact`).

- [ ] **Step 1: Failing test** — in the employees API test file, create an employee row with `contact="+971509059931"` (mirror that file's existing employee-factory usage) and assert the list response item includes `"contact": "+971509059931"`.

```python
def test_employee_list_includes_contact(client: TestClient, db: Session) -> None:
    _mk_employee(db, id="G-1", contact="+971509059931")  # use this file's factory
    items = client.get("/api/v1/employees").json()["items"]
    assert items[0]["contact"] == "+971509059931"
```

- [ ] **Step 2: Run to verify FAIL** (`KeyError: 'contact'`).

- [ ] **Step 3: Implement** — one line in `EmployeeListItem` (ORMBase is `from_attributes`, so `model_validate` picks it up from `Employee.contact` automatically):

```python
    # Raw contact number as stored on the employee (used for WhatsApp mentions).
    contact: str | None = None
```

- [ ] **Step 4: Run test + full backend gates** → PASS/clean.

- [ ] **Step 5: Resync frontend types** — follow `.claude/skills/sync-api-types/SKILL.md` exactly (dump `backend/openapi.json` from the app, `pnpm -C frontend run gen:api`, `pnpm -C frontend exec tsc -b --noEmit`). `openapi.json` is gitignored — do NOT commit it.

- [ ] **Step 6: Commit**

```bash
git add backend/app/schemas/employee.py backend/tests/<employees test file> frontend/src/lib/api.types.ts
git commit -m "feat(employees): expose contact on list items (mention numbers) + type resync"
```

---

### Task 4: `mention.ts` pure helpers — MentionTarget, applyMentions, splitMentionParts

**Files:**
- Modify: `frontend/src/pages/announcements/mention.ts`
- Test: Create `frontend/src/pages/announcements/mention.test.ts`

**Interfaces:**
- Consumes: nothing (pure).
- Produces (Tasks 5–7 rely on these exact exports):

```ts
export interface MentionTarget { name: string; number: string }
export function mentionDigits(raw: string): string
export function applyMentions(text: string, mentions: MentionTarget[]): { text: string; numbers: string[] }
export function splitMentionParts(text: string, names: string[]): Array<{ kind: 'text' | 'mention'; value: string }>
```

Normalization rules MUST mirror backend `mention_chat_ids` (strip non-digits, `00` prefix dropped, single leading `0` → `971`).

- [ ] **Step 1: Write failing tests** (`mention.test.ts`):

```ts
import { describe, expect, it } from 'vitest'
import { applyMentions, mentionDigits, splitMentionParts } from './mention'

describe('mentionDigits', () => {
  it('normalizes like the backend', () => {
    expect(mentionDigits('+971 50 905 9931')).toBe('971509059931')
    expect(mentionDigits('00971509059931')).toBe('971509059931')
    expect(mentionDigits('0509059931')).toBe('971509059931')
    expect(mentionDigits('abc')).toBe('')
  })
})

describe('applyMentions', () => {
  it('replaces @Name tokens with @digits and collects numbers', () => {
    const r = applyMentions('Hi @Omar Al-Rashid, see roster', [
      { name: 'Omar Al-Rashid', number: '+971509059931' },
    ])
    expect(r.text).toBe('Hi @971509059931, see roster')
    expect(r.numbers).toEqual(['971509059931'])
  })
  it('skips mentions the operator edited away', () => {
    const r = applyMentions('no tags here', [{ name: 'Omar', number: '0501234567' }])
    expect(r.text).toBe('no tags here')
    expect(r.numbers).toEqual([])
  })
  it('handles prefix-overlapping names (longest first)', () => {
    const r = applyMentions('@Omar Ali and @Omar', [
      { name: 'Omar', number: '0500000001' },
      { name: 'Omar Ali', number: '0500000002' },
    ])
    expect(r.text).toBe('@971500000002 and @971500000001')
  })
  it('drops mentions without a usable number', () => {
    const r = applyMentions('@Ghost hi', [{ name: 'Ghost', number: 'n/a' }])
    expect(r.text).toBe('@Ghost hi')
    expect(r.numbers).toEqual([])
  })
})

describe('splitMentionParts', () => {
  it('splits text into text/mention parts', () => {
    expect(splitMentionParts('Hi @Omar!', ['Omar'])).toEqual([
      { kind: 'text', value: 'Hi ' },
      { kind: 'mention', value: '@Omar' },
      { kind: 'text', value: '!' },
    ])
  })
  it('returns single text part when no names match', () => {
    expect(splitMentionParts('plain', ['Omar'])).toEqual([{ kind: 'text', value: 'plain' }])
  })
})
```

- [ ] **Step 2: Run to verify FAIL** — `pnpm -C frontend exec vitest run src/pages/announcements/mention.test.ts` → missing exports.

- [ ] **Step 3: Implement** (append to `mention.ts`; keep `buildMention` untouched):

```ts
export interface MentionTarget {
  name: string
  number: string
}

/** Mirror of backend openwa_client.mention_chat_ids digit rules. */
export function mentionDigits(raw: string): string {
  let d = raw.replace(/\D/g, '')
  if (d.startsWith('00')) d = d.slice(2)
  else if (d.startsWith('0') && d.length >= 9) d = '971' + d.slice(1)
  return d
}

/**
 * Rewrite "@Name" tokens to "@<digits>" (what WhatsApp needs for a real
 * mention) and collect the numbers to send alongside. Mentions whose token
 * no longer appears (operator edited it out) or whose number is unusable
 * are silently skipped — the literal text still delivers.
 */
export function applyMentions(
  text: string,
  mentions: MentionTarget[],
): { text: string; numbers: string[] } {
  let out = text
  const numbers: string[] = []
  const ordered = [...mentions].sort((a, b) => b.name.length - a.name.length)
  for (const m of ordered) {
    const token = `@${m.name}`
    if (!out.includes(token)) continue
    const digits = mentionDigits(m.number)
    if (!digits) continue
    out = out.split(token).join(`@${digits}`)
    if (!numbers.includes(digits)) numbers.push(digits)
  }
  return { text: out, numbers }
}

/** Split message text into parts so previews can paint "@Name" in WA blue. */
export function splitMentionParts(
  text: string,
  names: string[],
): Array<{ kind: 'text' | 'mention'; value: string }> {
  const tokens = names.map((n) => `@${n}`).sort((a, b) => b.length - a.length)
  const parts: Array<{ kind: 'text' | 'mention'; value: string }> = []
  let rest = text
  while (rest.length > 0) {
    let hitIdx = -1
    let hitToken = ''
    for (const tok of tokens) {
      const i = rest.indexOf(tok)
      if (i !== -1 && (hitIdx === -1 || i < hitIdx)) {
        hitIdx = i
        hitToken = tok
      }
    }
    if (hitIdx === -1) {
      parts.push({ kind: 'text', value: rest })
      break
    }
    if (hitIdx > 0) parts.push({ kind: 'text', value: rest.slice(0, hitIdx) })
    parts.push({ kind: 'mention', value: hitToken })
    rest = rest.slice(hitIdx + hitToken.length)
  }
  return parts
}
```

- [ ] **Step 4: Run tests** → PASS. Run `pnpm -C frontend run lint` + `pnpm -C frontend exec tsc -b --noEmit` → clean.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/announcements/mention.ts frontend/src/pages/announcements/mention.test.ts
git commit -m "feat(announcements): mention helpers — digits normalizer, applyMentions, splitMentionParts"
```

---

### Task 5: WA look tokens + MessagePreview surfaces (PhonePreview / WebChatWindow)

**Files:**
- Modify: `frontend/src/index.css` (add `--wa-*` tokens beside the existing `:root` / `html.dark` token blocks)
- Create: `frontend/src/pages/announcements/MessagePreview.tsx`
- Test: `frontend/src/pages/announcements/MessagePreview.test.tsx`

**Interfaces:**
- Consumes (Task 4): `splitMentionParts`.
- Produces (Task 7 relies on these):

```tsx
export interface PreviewAttachment { title: string; subtitle?: string }
export interface PreviewProps {
  groupName: string | null            // first selected group; null -> muted placeholder
  text: string
  mentionNames: string[]              // names to highlight as @Name
  attachment: PreviewAttachment | null
}
export function PhonePreview(props: PreviewProps): React.JSX.Element   // iPhone-14 framed (Normal view)
export function WebChatWindow(props: PreviewProps): React.JSX.Element  // WA Web window body (Extended view)
```

- [ ] **Step 1: Add tokens to `index.css`** — inside the existing `:root` custom-property block:

```css
  /* WhatsApp preview surfaces (Send-to-Group composer) */
  --wa-chat: #e5ddd5;
  --wa-bubble: #d9fdd3;
  --wa-bubble-ink: #111b21;
  --wa-header: #008069;
  --wa-web-bar: #f0f2f5;
  --wa-web-ink: #111b21;
  --wa-mention: #027eb5;
  --wa-meta: #667781;
```

and inside `html.dark`:

```css
  --wa-chat: #0b141a;
  --wa-bubble: #005c4b;
  --wa-bubble-ink: #e9edef;
  --wa-header: #1f2c33;
  --wa-web-bar: #202c33;
  --wa-web-ink: #e9edef;
  --wa-mention: #53bdeb;
  --wa-meta: #8696a0;
```

- [ ] **Step 2: Write failing component tests** (`MessagePreview.test.tsx`; i18n mocked identity like `SendToGroupPage.test.tsx` does):

```tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { PhonePreview, WebChatWindow } from './MessagePreview'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'en' } }),
}))

const base = { groupName: 'Duty Officers', text: '', mentionNames: [], attachment: null }

describe('PhonePreview', () => {
  it('shows group name and live text', () => {
    render(<PhonePreview {...base} text="Hello team" />)
    expect(screen.getByText('Duty Officers')).toBeInTheDocument()
    expect(screen.getByText('Hello team')).toBeInTheDocument()
  })
  it('highlights mention tokens', () => {
    render(<PhonePreview {...base} text="Hi @Omar!" mentionNames={['Omar']} />)
    const tag = screen.getByText('@Omar')
    expect(tag.className).toContain('wa-mention')
  })
  it('renders attachment chip only when provided', () => {
    const { rerender } = render(<PhonePreview {...base} />)
    expect(screen.queryByTestId('preview-attachment')).not.toBeInTheDocument()
    rerender(<PhonePreview {...base} attachment={{ title: 'GSSG-2026-0417.pdf' }} />)
    expect(screen.getByTestId('preview-attachment')).toBeInTheDocument()
  })
  it('bubble fills the phone width (spec: 94%)', () => {
    render(<PhonePreview {...base} text="x" />)
    expect(screen.getByTestId('preview-bubble').className).toContain('max-w-[94%]')
  })
})

describe('WebChatWindow', () => {
  it('renders the same message content', () => {
    render(<WebChatWindow {...base} text="Hello web" />)
    expect(screen.getByText('Hello web')).toBeInTheDocument()
  })
})
```

- [ ] **Step 3: Run to verify FAIL** — `pnpm -C frontend exec vitest run src/pages/announcements/MessagePreview.test.tsx`.

- [ ] **Step 4: Implement `MessagePreview.tsx`.** One shared `<Bubble>` used by both surfaces; all colors via the `--wa-*` vars with Tailwind arbitrary values; logical CSS only. Skeleton (complete this structure — it is the full component, no extra features):

```tsx
/**
 * MessagePreview — live WhatsApp render of the outgoing broadcast.
 * PhonePreview: iPhone-14-proportioned framed phone (Normal view side column).
 * WebChatWindow: WhatsApp Web-style desktop chat surface (Extended view).
 * Colors come from the --wa-* tokens in index.css (light+dark).
 */
import { useTranslation } from 'react-i18next'
import { splitMentionParts } from './mention'

export interface PreviewAttachment { title: string; subtitle?: string }
export interface PreviewProps {
  groupName: string | null
  text: string
  mentionNames: string[]
  attachment: PreviewAttachment | null
}

function Bubble({ text, mentionNames, attachment }: Omit<PreviewProps, 'groupName'>): React.JSX.Element {
  const { t } = useTranslation()
  const parts = splitMentionParts(text, mentionNames)
  return (
    <div
      data-testid="preview-bubble"
      className="ms-auto w-fit max-w-[94%] rounded-lg rounded-ee-sm bg-[var(--wa-bubble)] px-2.5 py-1.5 text-[0.85em] text-[var(--wa-bubble-ink)] shadow-sm"
    >
      {attachment && (
        <div
          data-testid="preview-attachment"
          className="mb-1.5 flex items-center gap-2.5 rounded-md bg-black/5 p-2 dark:bg-white/10"
        >
          <span className="grid h-9 w-7 shrink-0 place-items-center rounded bg-surface text-[0.6em] font-extrabold text-accent">PDF</span>
          <span className="min-w-0">
            <span dir="auto" className="block truncate text-[0.9em] font-semibold">{attachment.title}</span>
            {attachment.subtitle && (
              <span dir="auto" className="block truncate text-[0.8em] text-[var(--wa-meta)]">{attachment.subtitle}</span>
            )}
          </span>
        </div>
      )}
      <span dir="auto" className="whitespace-pre-wrap break-words">
        {text.trim().length === 0 ? (
          <span className="opacity-50">{t('sendToGroup.preview.empty')}</span>
        ) : (
          parts.map((p, i) =>
            p.kind === 'mention' ? (
              <span key={i} className="wa-mention font-semibold text-[var(--wa-mention)]">{p.value}</span>
            ) : (
              <span key={i}>{p.value}</span>
            ),
          )
        )}
      </span>
      <span className="ms-2 inline-flex translate-y-0.5 items-center gap-0.5 text-[0.72em] text-[var(--wa-meta)]" aria-hidden>
        {new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ✓✓
      </span>
    </div>
  )
}

function ChatHeader({ groupName, desktop }: { groupName: string | null; desktop?: boolean }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className={
      desktop
        ? 'flex items-center gap-2.5 bg-[var(--wa-web-bar)] px-3.5 py-2.5 text-[var(--wa-web-ink)]'
        : 'flex items-center gap-2.5 bg-[var(--wa-header)] px-3.5 py-2.5 pt-7 text-white'
    }>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-gradient-to-br from-[#25d366] to-[#128c4b] text-[0.75em] font-bold text-white" aria-hidden>
        {(groupName ?? '?').slice(0, 2).toUpperCase()}
      </span>
      <span dir="auto" className="truncate text-[0.85em] font-semibold">
        {groupName ?? t('sendToGroup.preview.noGroup')}
      </span>
    </div>
  )
}

function ChatBody(props: PreviewProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-hidden bg-[var(--wa-chat)] p-3">
      <span className="mx-auto rounded-md bg-surface/80 px-2.5 py-0.5 text-[0.68em] font-semibold text-muted-foreground shadow-sm">
        {t('sendToGroup.preview.today')}
      </span>
      <Bubble text={props.text} mentionNames={props.mentionNames} attachment={props.attachment} />
    </div>
  )
}

export function PhonePreview(props: PreviewProps): React.JSX.Element {
  // iPhone 14 screen proportions: 390x844 CSS pt (19.5:9), bezel + notch.
  return (
    <div className="relative mx-auto w-full max-w-[280px] rounded-[34px] bg-[#0b141a] p-2.5 shadow-xl">
      <span className="absolute start-1/2 top-2.5 z-10 h-5 w-[34%] -translate-x-1/2 rtl:translate-x-1/2 rounded-b-xl bg-[#0b141a]" aria-hidden />
      <div className="flex aspect-[390/844] flex-col overflow-hidden rounded-[24px]">
        <ChatHeader groupName={props.groupName} />
        <ChatBody {...props} />
      </div>
    </div>
  )
}

export function WebChatWindow(props: PreviewProps): React.JSX.Element {
  // WhatsApp Web / desktop-style: gray header, wide surface. Height comes from parent.
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-t-xl border border-b-0 border-border">
      <ChatHeader groupName={props.groupName} desktop />
      <div className="[&>div>[data-testid=preview-bubble]]:max-w-[62%] flex min-h-0 flex-1 flex-col">
        <ChatBody {...props} />
      </div>
    </div>
  )
}
```

Note the WebChatWindow bubble cap (62%) is applied via an arbitrary-variant selector; if that selector proves brittle, pass a `bubbleMax?: string` prop into `Bubble` instead — either is acceptable, keep the test asserting the phone bubble contains `max-w-[94%]`.

- [ ] **Step 5: Run tests + lint + tsc** → PASS/clean.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/index.css frontend/src/pages/announcements/MessagePreview.tsx frontend/src/pages/announcements/MessagePreview.test.tsx
git commit -m "feat(announcements): live WhatsApp preview surfaces (phone + web) with WA tokens"
```

---

### Task 6: EmployeeMentionField — @Mention / Plain-name modes

**Files:**
- Modify: `frontend/src/pages/announcements/EmployeeMentionField.tsx`
- Test: `frontend/src/pages/announcements/EmployeeMentionField.test.tsx` (extend)

**Interfaces:**
- Consumes (Task 3): `emp.contact` on `EmployeeListItem`; (Task 4) `MentionTarget`, `buildMention`.
- Produces (Task 7 relies on this exact prop change):

```tsx
onInsert: (text: string, mention?: MentionTarget) => void
```

Behavior: mode switch `tag` (default) | `plain`.
- `tag` + employee has `contact`: `onInsert('@' + localizedName + ' ', { name: localizedName, number: emp.contact })`.
- `tag` + no `contact`: result button disabled, row shows `sendToGroup.mention.noNumber` badge.
- `plain`: `onInsert(buildMention(emp, lang, includeDesignation))` — existing behavior; designation checkbox only visible in `plain` mode.

- [ ] **Step 1: Extend tests** (follow the file's existing render/mock pattern; `api.listEmployees` mocked). New cases:

```tsx
it('tag mode inserts @Name and passes the mention target', async () => {
  mockEmployees([{ id: 'G-1', name_en: 'Omar Al-Rashid', name_ar: null, contact: '+971509059931' }])
  const onInsert = vi.fn()
  render(<EmployeeMentionField onInsert={onInsert} />)
  await userEvent.type(screen.getByPlaceholderText('sendToGroup.mention.searchPlaceholder'), 'om')
  await userEvent.click(await screen.findByRole('button', { name: /Omar Al-Rashid/ }))
  expect(onInsert).toHaveBeenCalledWith('@Omar Al-Rashid ', {
    name: 'Omar Al-Rashid',
    number: '+971509059931',
  })
})

it('tag mode disables employees without a number', async () => {
  mockEmployees([{ id: 'G-2', name_en: 'Ghost', name_ar: null, contact: null }])
  render(<EmployeeMentionField onInsert={vi.fn()} />)
  await userEvent.type(screen.getByPlaceholderText('sendToGroup.mention.searchPlaceholder'), 'gh')
  expect(await screen.findByRole('button', { name: /Ghost/ })).toBeDisabled()
  expect(screen.getByText('sendToGroup.mention.noNumber')).toBeInTheDocument()
})

it('plain mode inserts buildMention text with no target', async () => {
  mockEmployees([{ id: 'G-1', name_en: 'Omar', name_ar: null, contact: '+971509059931', position: null, position_ar: null }])
  const onInsert = vi.fn()
  render(<EmployeeMentionField onInsert={onInsert} />)
  await userEvent.click(screen.getByRole('button', { name: 'sendToGroup.mention.modePlain' }))
  await userEvent.type(screen.getByPlaceholderText('sendToGroup.mention.searchPlaceholder'), 'om')
  await userEvent.click(await screen.findByRole('button', { name: /Omar \(G-1\)?|Omar/ }))
  expect(onInsert).toHaveBeenCalledWith('Omar (G-1)', undefined)
})
```

(`mockEmployees` = whatever helper/mock shape the existing test file uses for `api.listEmployees` — extend it to carry `contact`.)

- [ ] **Step 2: Run to verify FAIL.**

- [ ] **Step 3: Implement.** Key changes inside the component:

```tsx
import type { MentionTarget } from './mention'

type MentionMode = 'tag' | 'plain'

export function EmployeeMentionField({
  onInsert,
}: {
  onInsert: (text: string, mention?: MentionTarget) => void
}): React.JSX.Element {
  const [mode, setMode] = useState<MentionMode>('tag')
  // ...existing q/includeDesignation/query state stays...
```

Mode switch UI above the search input (two buttons, pill segmented, `aria-pressed`):

```tsx
      <div className="mb-1.5 flex items-center gap-2">
        <span className="text-[0.82em] text-muted-foreground">{t('sendToGroup.mention.label')}</span>
        <div className="ms-auto inline-flex rounded-full border border-border bg-surface p-0.5">
          {(['tag', 'plain'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => setMode(m)}
              className={`rounded-full px-2.5 py-1 text-[0.78em] font-semibold transition-colors ${
                mode === m ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t(m === 'tag' ? 'sendToGroup.mention.modeTag' : 'sendToGroup.mention.modePlain')}
            </button>
          ))}
        </div>
      </div>
```

Result-row click handler:

```tsx
                onClick={() => {
                  const name = (ar ? emp.name_ar : emp.name_en) || emp.name_en || emp.name_ar || emp.id
                  if (mode === 'tag') {
                    onInsert(`@${name} `, { name, number: emp.contact ?? '' })
                  } else {
                    onInsert(buildMention(emp, i18n.language, includeDesignation), undefined)
                  }
                  setQ('')
                }}
                disabled={mode === 'tag' && !emp.contact}
```

Plus: `noNumber` badge (`{mode === 'tag' && !emp.contact && <span className="ms-1 text-[0.75em] text-muted-foreground">{t('sendToGroup.mention.noNumber')}</span>}`), designation checkbox wrapped in `{mode === 'plain' && (...)}`, and a one-line mode hint under the switch: `t('sendToGroup.mention.modeHint')` (explains that @Mention notifies the employee via his linked number). Note: don't pass `number: ''` targets up — guard: only call with a mention object when `emp.contact` is truthy (the disabled state already prevents it; keep the guard anyway).

- [ ] **Step 4: Run tests + lint + tsc** → PASS/clean. (SendToGroupPage still compiles because passing a 1-arg callback to a 2-arg prop is type-compatible in TS.)

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/announcements/EmployeeMentionField.tsx frontend/src/pages/announcements/EmployeeMentionField.test.tsx
git commit -m "feat(announcements): mention field modes — real @mention vs plain name"
```

---

### Task 7: SendToGroupPage — full-width layout, Normal/Extended views, mention wiring

**Files:**
- Modify: `frontend/src/pages/announcements/SendToGroupPage.tsx` (major rework)
- Test: `frontend/src/pages/announcements/SendToGroupPage.test.tsx` (extend; existing tests must keep passing — adapt selectors only where the DOM legitimately changed)

**Interfaces:**
- Consumes: `PhonePreview`, `WebChatWindow`, `PreviewAttachment` (Task 5); `MentionTarget`, `applyMentions` (Task 4); `onInsert(text, mention?)` (Task 6); `mentions` Form field (Task 2).
- Produces: final page; no downstream consumers.

**Layout contract (from the approved mockup `docs/send-to-group-composer-final.html`):**

- Page wrapper: `mx-auto max-w-[1360px] px-4 py-6` (drop `max-w-2xl`).
- Header row (title + connected pill + admin buttons) and the blocked banner stay full-width above the grid — logic untouched.
- Grid: `grid items-start gap-4 transition-[grid-template-columns] duration-500 motion-reduce:transition-none [grid-template-columns:minmax(280px,340px)_1fr_320px]`; in extended mode swap to `[grid-template-columns:minmax(280px,340px)_1fr_0px]`. Below `lg:` breakpoint stack to one column (`max-lg:[grid-template-columns:1fr]` for both) with the phone column last; in extended mode on mobile hide the side column entirely.
- Column 1: Recipients card — search input (client-side filter, case-insensitive on group name), select-all row (checkbox: checked = every *filtered* group selected; toggle selects/deselects the filtered set), group rows (existing checkbox+label style upgraded with a 2-letter green avatar). Below it the reach meter card: navy gradient (`bg-gradient-to-br from-primary to-primary-hover text-primary-foreground`), big count = `selectedIds.size`, label `t('sendToGroup.reach.groups', { count })`. No member counts (API has none) — groups only.
- Column 2: Composer card — header row `t('sendToGroup.message')` + view switch (`viewNormal`/`viewExtended`, segmented pills, `aria-pressed`); the collapsible preview zone (`h-0 opacity-0 overflow-hidden` normal → `h-[min(54vh,480px)] opacity-100` extended, `transition-[height,opacity] duration-500 motion-reduce:transition-none`) containing `<WebChatWindow …/>`; then the textarea. In extended mode the textarea is wrapped by a WA-Web composer bar: container `flex items-center gap-2.5 rounded-b-xl border border-t-0 border-border bg-[var(--wa-web-bar)] px-3 py-2` with decorative 😊/📎/🎤 spans (aria-hidden, hidden in normal mode) and the textarea shrinking (`h-[52px] rounded-lg` vs normal `h-[200px] rounded-md`, `transition-[height] duration-500 motion-reduce:transition-none`). Then EmployeeMentionField, Attachment section, send row — all existing logic preserved.
- Column 3: `<PhonePreview …/>` under a small `t('sendToGroup.preview.live')` pill + `t('sendToGroup.preview.firstGroup')` hint; column gets `opacity-0 translate-x-4 rtl:-translate-x-4 pointer-events-none` in extended mode (`transition-all duration-400`), `overflow-hidden min-w-0` always.

**State/wiring:**

```tsx
const [view, setView] = useState<'normal' | 'extended'>('normal')
const [groupQuery, setGroupQuery] = useState('')
const [mentions, setMentions] = useState<MentionTarget[]>([])

const insertMention = useCallback((text: string, mention?: MentionTarget): void => {
  // existing caret-insertion body stays; then:
  if (mention) {
    setMentions((prev) =>
      prev.some((m) => m.name === mention.name) ? prev : [...prev, mention],
    )
  }
}, [])

const activeMentionNames = mentions
  .filter((m) => message.includes(`@${m.name}`))
  .map((m) => m.name)

const previewAttachment: PreviewAttachment | null =
  attachMode === 'book' && pickedBook
    ? { title: pickedBook.ref, subtitle: pickedBook.subject }
    : attachMode === 'upload' && hasFile
      ? { title: fileRef.current?.files?.[0]?.name ?? 'file' }
      : null

const firstGroupName =
  (groups ?? []).find((g) => selectedIds.has(g.id))?.name ?? null
```

Submit (inside `mutationFn`, replacing the plain `text` append):

```tsx
const applied = applyMentions(message.trim(), mentions)
if (applied.text) form.append('text', applied.text)
for (const n of applied.numbers) form.append('mentions', n)
```

- [ ] **Step 1: Write the new failing tests first** (extend `SendToGroupPage.test.tsx`; mock `EmployeeMentionField` stub upgraded so tests can trigger `onInsert('@Omar ', {name:'Omar', number:'+971509059931'})` via a test button):

```tsx
it('filters groups by search', async () => { /* type in search, assert non-matching group row gone */ })

it('select all toggles every filtered group', async () => { /* click selectAll, assert all checkboxes checked */ })

it('shows reach meter count for selected groups', async () => { /* select 2, assert reach.groups text rendered */ })

it('switches to extended view and back', async () => {
  // click viewExtended: WebChatWindow test-id visible, side PhonePreview column gets pointer-events-none class
  // textarea still holds its value after toggling both ways
})

it('sends transformed text and mention numbers', async () => {
  // insert mention via stub, type message containing @Omar, select group, submit;
  const form = vi.mocked(api.sendAnnouncement).mock.calls[0][0] as FormData
  expect(form.get('text')).toBe('Hi @971509059931')
  expect(form.getAll('mentions')).toEqual(['971509059931'])
})

it('drops mentions the operator edited out', async () => {
  // insert mention, then clear textarea and type text without the token; submit
  // expect form.getAll('mentions') to be []
})
```

Write them with the file's existing helpers (`renderPage()`, mocked api module). Mock `MessagePreview` exports with light stubs carrying test-ids (`phone-preview`, `web-chat-window`) to keep page tests DOM-cheap.

- [ ] **Step 2: Run to verify the new tests FAIL** — `pnpm -C frontend exec vitest run src/pages/announcements/SendToGroupPage.test.tsx`.

- [ ] **Step 3: Implement the rework** per the layout contract + state/wiring blocks above. Keep every existing i18n key in use for unchanged copy; new keys are listed in Task 8 (use them now — tests mock `t` as identity so key names are what tests assert).

- [ ] **Step 4: Run the FULL frontend suite** — `pnpm -C frontend test` (old + new tests green), `pnpm -C frontend run lint`, `pnpm -C frontend exec tsc -b --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/announcements/SendToGroupPage.tsx frontend/src/pages/announcements/SendToGroupPage.test.tsx
git commit -m "feat(announcements): full-width composer — recipients rail, Normal/Extended views, live preview, real mentions"
```

---

### Task 8: i18n keys (EN + AR) + final gates

**Files:**
- Modify: `frontend/src/locales/en.json` (inside the existing `sendToGroup` object, ~line 2705)
- Modify: `frontend/src/locales/ar.json` (matching section, ~line 2888)

**Interfaces:** consumed by Tasks 5–7 key names — must match exactly.

- [ ] **Step 1: Add EN keys** (merge into `sendToGroup`):

```json
"recipients": "Recipients",
"groupsAvailable": "{{count}} groups available",
"searchGroups": "Search groups…",
"selectAll": "Select all groups",
"reach": { "groups": "{{count}} groups selected" },
"viewNormal": "Normal",
"viewExtended": "Extended view",
"preview": {
  "live": "Live preview — how it arrives",
  "firstGroup": "Shown for the first selected group. Sends identically to all selected groups.",
  "noGroup": "Pick a group to preview",
  "today": "Today",
  "empty": "Your message appears here as you type…"
},
"mention": {
  "modeTag": "@ Mention — notifies them",
  "modePlain": "Plain name",
  "modeHint": "A mention tags the employee in WhatsApp using their linked number, so they get a personal notification.",
  "noNumber": "No linked number"
}
```

(`mention` already exists — add the four new keys inside it, keep `label`, `searchPlaceholder`, `includeDesignation`, `noResults`.)

- [ ] **Step 2: Add AR keys** (same structure; formal register matching existing tone):

```json
"recipients": "المستلمون",
"groupsAvailable": "{{count}} مجموعة متاحة",
"searchGroups": "ابحث في المجموعات…",
"selectAll": "تحديد كل المجموعات",
"reach": { "groups": "{{count}} مجموعة محددة" },
"viewNormal": "عادي",
"viewExtended": "عرض موسّع",
"preview": {
  "live": "معاينة حية — كما ستصل",
  "firstGroup": "تُعرض للمجموعة الأولى المحددة، وتُرسل بالصيغة نفسها إلى كل المجموعات المحددة.",
  "noGroup": "اختر مجموعة للمعاينة",
  "today": "اليوم",
  "empty": "تظهر رسالتك هنا أثناء الكتابة…"
},
"mention": {
  "modeTag": "@ إشارة — يصله تنبيه",
  "modePlain": "اسم فقط",
  "modeHint": "تُشير الإشارة إلى الموظف في واتساب عبر رقمه المرتبط، فيصله تنبيه شخصي.",
  "noNumber": "لا يوجد رقم مرتبط"
}
```

- [ ] **Step 3: Key-parity check** — verify every key added to `en.json` exists in `ar.json` and vice versa (quick script or careful diff of the `sendToGroup` blocks).

- [ ] **Step 4: Run ALL gates** — backend: `venv\Scripts\python.exe -m pytest`, `venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .`, `venv\Scripts\mypy.exe`. Frontend: `pnpm -C frontend test`, `pnpm -C frontend run lint`, `pnpm -C frontend exec tsc -b --noEmit`. All green.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(announcements): EN/AR strings for composer redesign + mention modes"
```

---

### Final verification (orchestrator, after all tasks)

- [ ] Run the `i18n-rtl-reviewer` agent over the branch diff (bilingual surfaces changed — mandatory per CLAUDE.md).
- [ ] Run the full gate matrix once more on the merged worktree state.
- [ ] `git status` — confirm no `backend/templates/*.docx` churn and no `openapi.json` staged.
- [ ] Merge to `main` per superpowers:finishing-a-development-branch; deploy is left to the operator (`mng deploy`).
