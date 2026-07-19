# General Book Word-Version Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Word-authored General Book flow correct end-to-end: signing keeps the Word-written body, the approval signature is the person's one signature (G-number linked), template save/rename/load live on the General Book side, a live preview persists across Word saves, and the Records/Services UI stops lying about Word books.

**Architecture:** All fixes reuse existing pipelines: post-render docx surgery (`fill_image_behind_text_in_paragraph`, `stamp_aztec_code` precedent) for signing an already-authored docx; `convert_docx_to_pdf` for the live preview; `book_template_service` grows one `rename` op; the frontend reuses `DocPdfCanvas`, `WordHandoffDialog`, `ConfirmDialog`, and the `['word-templates']` query. No new dependencies, no schema migrations (the only DB-adjacent fix is a read-time clamp in settings).

**Tech Stack:** FastAPI + SQLAlchemy + python-docx/docxtpl (backend), React 19 + React Query + Radix (frontend), pytest + vitest.

## Grounding evidence (from code reading + live Playwright audit, 2026-07-19)

Sandboxed instance (scratch DB, port 8766), full user flow driven with Playwright:

1. **Signing wipes the Word body (CRITICAL).** `book_service.sign_book` → `document_service.render_signed_pdf` (document_service.py:1761) re-renders the **base template** via `engine.fill(template_id, data, ...)` from `version.fields` — and Word books commit `fields={}` (word_book_service.py:316). Proven: original finished PDF contained the template boilerplate + Word-typed body; the signed PDF was a bare letterhead (no subject, no recipient, no body).
2. **Buttons go dead after "Create & open in Word" (CRITICAL UX).** `ApplicationPage.tsx:365` runs `window.location.href = res.word_url` right after create (and `BookWordActions.tsx:58`, `WordHandoffDialog.tsx:235` do the same on re-open). Chrome raises its **tab-modal external-protocol dialog**; while it is up (it persists even across in-tab navigation), every real click in the tab is silently swallowed — Finish/Close/Discard appear broken with zero feedback. Verified: capture-phase listeners on `document` recorded **no** pointer events from trusted clicks, while JS `.click()` worked and the POST succeeded.
3. **Approval signature is a second, separate signature.** `sign_book` requires `User.signature_path` (models.py:979). The person's actual signature keyed by G number lives in `Submitter.stored_sig_path` (models.py:592, `Submitter.employee_id` → `Employee.id`). Users linked to an employee with a stored signature still get `NO_SIGNATURE`.
4. **Library template hides the Signing Manager.** `TemplateForm.tsx:395-399` (`TEMPLATE_BAKED_TYPES` includes `manager_picker`) — templated Word books get `doc_manager_id=NULL`, so submit has no default approver and the signed paper falls back to `DEFAULT_MANAGER_NAME`.
5. **Records misidentifies Word General Books.** `formKind.ts:36-54` parses `Book.subject` as `"<form> — <employee>"`: a real subject containing `—`/`-`/`:` is chopped (showed only "تجربة") and the form label falls back to "Other records" 📄.
6. **No preview during/after Word editing.** `WordHandoffDialog` shows a PDF only after Finish, only inside the transient dialog. While editing there is no visual, and the "No save from Word yet" hint simply vanishes on first save (no positive "saved ✓" state). Finish has no spinner during the multi-second PDF conversion.
7. **Template ops scattered + incomplete.** Load picker: Services form (`TemplateForm.tsx:473-492`). Save-as-template: Records (`BookWordActions.tsx:176-211`). Rename: **does not exist** (`book_template_service.py` has list/save/resolve only).
8. **BookRecordPage always passes `isMobile`,** so on a desktop PC the full-record page disables "Edit in Word" with the wrong caption ("needs a PC with Word installed"). `useIsMobile` hook exists (`lib/useIsMobile.ts`).
9. **Fresh-install seed bug (bonus, small).** Seeded `settings.font_scale=15` fails `AppSettingsRead` (`ge=16`) → `GET /settings` 500s and `sign` 500s on a brand-new install.

**Reuse inventory (do NOT reinvent):** `fill_image_behind_text_in_paragraph` (core/_docx_helpers.py:127), `_place_manager_sig_above_name` pattern (core/docx_engine.py:419), `convert_docx_to_pdf` (services/_pdf_executor), `_postprocess_general_book_footer`, `stamp_aztec_code`, `DocPdfCanvas`, `WordHandoffDialog` finished view, `ConfirmDialog`, `book_template_service.safe_template_name`, `BookVersionRead.has_fields` (schemas/book.py:107 — `False` ⇔ Word-authored version), `useIsMobile`, `derive_subject`.

## Global Constraints

- Bilingual parity: every new UI string gets keys in BOTH `frontend/src/locales/en.json` and `ar.json`; Arabic is first-class. Logical CSS only (`ms-`/`me-`, `text-start`), `dir`/`<bdi>` for mixed runs.
- All Python via `venv\Scripts\python.exe`; mypy is strict; pytest runs with `filterwarnings=error`. Frontend: eslint + `tsc -b --noEmit` must stay clean.
- After backend route/schema changes, resync types (`/sync-api-types`: dump openapi → `pnpm gen:api` → typecheck) before frontend tasks; commit `api.types.ts` (and `openapi.json` if tracked — it is gitignored in this checkout).
- Do not touch `backend/templates/*.docx` (live-service churn); revert any incidental churn before committing.
- Test on a branch (`feature/word-book-fixes`), merge to `main` when green (this checkout is live production; fixes must land on origin/main to survive `mng update`).
- No new dependencies.

## File Structure (created/modified)

| File | Responsibility |
|---|---|
| `backend/app/core/docx_engine.py` | + `stamp_signature_above_name(docx_path, sig_path, names, size_mm, boldness)` — post-render sig float on a saved docx |
| `backend/app/services/document_service.py` | `render_signed_pdf` word-branch: copy authored docx + stamp sig instead of re-render |
| `backend/app/services/book_service.py` | `sign_book` signature fallback (User → Submitter by G number) |
| `backend/app/services/word_book_service.py` | + `render_session_preview` (working-docx → cached preview PDF) |
| `backend/app/services/book_template_service.py` | + `rename_template(old, new)` |
| `backend/app/services/settings_service.py` | clamp `font_scale` ≥ 16 on read |
| `backend/app/api/v1/books.py` | + `GET /{book_id}/word-sessions/preview`, + `PATCH /word-templates/{name}` |
| `frontend/src/pages/application/ApplicationPage.tsx` | drop auto `location.href` on create |
| `frontend/src/pages/books/WordHandoffDialog.tsx` | Open-in-Word anchor, saved-✓ state, Finish spinner, live preview pane, Save-as-template in finished view |
| `frontend/src/components/books/BookWordActions.tsx` | drop auto `location.href` on reopen; remove Save-as-template UI; real `isMobile` |
| `frontend/src/components/application/WordTemplateManager.tsx` | NEW — list + rename dialog next to the picker |
| `frontend/src/components/application/TemplateForm.tsx` | manage button; keep manager picker visible with template |
| `frontend/src/pages/books/formKind.ts` | classified books → General Book identity, full subject |
| `frontend/src/pages/books/RecordPane.tsx` + `frontend/src/pages/books/BookRecordPage.tsx` | word-book action gating |
| `frontend/src/locales/{en,ar}.json` | new keys |

Backend tests: `backend/tests/test_word_book_sign.py` (new), `backend/tests/test_book_templates_rename.py` (new), `backend/tests/test_word_book_preview.py` (new), plus edits where named. Frontend tests colocated `.test.tsx`.

---

### Task 1: `stamp_signature_above_name` — sig float on an already-rendered docx

**Files:**
- Modify: `backend/app/core/docx_engine.py` (add public function near `_place_manager_sig_above_name`, ~line 442)
- Test: `backend/tests/test_stamp_signature.py` (new)

**Interfaces:**
- Produces: `stamp_signature_above_name(docx_path: Path, sig_path: str, names: Sequence[str], *, size_mm: float, boldness: int) -> bool` — opens the docx, finds the last body paragraph whose tatweel/whitespace-normalized text contains any normalized `names` entry, floats the signature on the paragraph above it (falling back to the last non-empty paragraph), saves in place. Returns `False` (no-op) when no anchor/sig.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_stamp_signature.py
"""stamp_signature_above_name — anchor the approval signature in an authored docx."""

from pathlib import Path

from docx import Document

from app.core.docx_engine import stamp_signature_above_name


def _make_letter(tmp_path: Path, closing_name: str) -> Path:
    doc = Document()
    doc.add_paragraph("نص الكتاب التجريبي")
    doc.add_paragraph("")  # signature gap
    doc.add_paragraph(closing_name)
    doc.add_paragraph("مدير مشروع")
    p = tmp_path / "letter.docx"
    doc.save(str(p))
    return p


def _make_sig(tmp_path: Path) -> Path:
    from PIL import Image

    sig = tmp_path / "sig.png"
    Image.new("RGBA", (60, 30), (0, 0, 200, 255)).save(sig)
    return sig


def test_stamps_on_exact_name(tmp_path: Path) -> None:
    docx = _make_letter(tmp_path, "سعيد راشد اليحيائي")
    ok = stamp_signature_above_name(
        docx, str(_make_sig(tmp_path)), ["سعيد راشد اليحيائي"], size_mm=32.0, boldness=2
    )
    assert ok
    # The float is an anchored drawing in the paragraph above the name.
    assert b"<wp:anchor" in _document_xml(docx)


def test_stamps_despite_tatweel_stretching(tmp_path: Path) -> None:
    # Templates stretch names with tatweel: سعيــــد راشــــد
    docx = _make_letter(tmp_path, "سعيــــــــــد راشــــــــــد اليحيائــــــــــي")
    ok = stamp_signature_above_name(
        docx, str(_make_sig(tmp_path)), ["سعيد راشد اليحيائي"], size_mm=32.0, boldness=2
    )
    assert ok
    assert b"<wp:anchor" in _document_xml(docx)


def test_falls_back_to_last_paragraph_when_name_missing(tmp_path: Path) -> None:
    docx = _make_letter(tmp_path, "اسم آخر تماماً")
    ok = stamp_signature_above_name(
        docx, str(_make_sig(tmp_path)), ["سعيد راشد اليحيائي"], size_mm=32.0, boldness=2
    )
    assert ok  # fallback anchor, still stamped
    assert b"<wp:anchor" in _document_xml(docx)


def test_noop_without_signature_file(tmp_path: Path) -> None:
    docx = _make_letter(tmp_path, "سعيد راشد اليحيائي")
    ok = stamp_signature_above_name(
        docx, str(tmp_path / "missing.png"), ["سعيد راشد اليحيائي"], size_mm=32.0, boldness=2
    )
    assert not ok


def _document_xml(docx: Path) -> bytes:
    import zipfile

    with zipfile.ZipFile(docx) as z:
        return z.read("word/document.xml")
```

- [ ] **Step 2: Run to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_stamp_signature.py -v`
Expected: FAIL — `ImportError: cannot import name 'stamp_signature_above_name'`

- [ ] **Step 3: Implement**

In `backend/app/core/docx_engine.py`, after `_place_manager_sig_above_name` (~line 442):

```python
_TATWEEL_WS = re.compile(r"[\sـ]+")  # whitespace + Arabic tatweel


def _norm_name(s: str) -> str:
    return _TATWEEL_WS.sub("", s or "")


def stamp_signature_above_name(
    docx_path: Path | str,
    sig_path: str,
    names: Sequence[str],
    *,
    size_mm: float = DEFAULT_SIG_SIZE_MM,
    boldness: int = DEFAULT_SIG_BOLDNESS,
) -> bool:
    """Float *sig_path* above the closing-name line of an ALREADY-RENDERED docx.

    Word-authored books have no Jinja tokens left, so the anchor is textual:
    the LAST body paragraph whose normalized text (whitespace + tatweel
    stripped — hand-made templates stretch names with tatweel) contains any of
    *names*. Falls back to the last non-empty paragraph (the closing block
    convention). No-op → False when the signature file or any anchor is
    missing.
    """
    if not sig_path or not Path(sig_path).is_file():
        return False
    doc = DocxDocument(str(docx_path))
    paras = list(doc.paragraphs)
    wanted = [_norm_name(n) for n in names if n and _norm_name(n)]
    idx = None
    for i in range(len(paras) - 1, -1, -1):
        text = _norm_name(paras[i].text)
        if text and any(w in text for w in wanted):
            idx = i
            break
    if idx is None:
        idx = next((i for i in range(len(paras) - 1, -1, -1) if paras[i].text.strip()), None)
        if idx is None:
            return False
    anchor = paras[idx - 1] if idx > 0 else paras[idx]
    placed = fill_image_behind_text_in_paragraph(
        anchor, sig_path, width_inches=size_mm / 25.4, dilate_radius_px=boldness
    )
    if placed:
        doc.save(str(docx_path))
    return placed
```

Notes for the implementer: `re`, `Sequence`, `DEFAULT_SIG_SIZE_MM`, `DEFAULT_SIG_BOLDNESS`, and `fill_image_behind_text_in_paragraph` are already imported/defined in this module (check the import block; add `from collections.abc import Sequence` if absent). `DocxDocument` is whatever alias this module already uses for `docx.Document` — reuse the module's existing import, do not add a duplicate.

- [ ] **Step 4: Run tests to verify pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_stamp_signature.py -v`
Expected: 4 PASS

- [ ] **Step 5: Lint + typecheck + commit**

```bash
venv\Scripts\ruff.exe check backend/app/core/docx_engine.py backend/tests/test_stamp_signature.py && venv\Scripts\mypy.exe
git add backend/app/core/docx_engine.py backend/tests/test_stamp_signature.py
git commit -m "feat(word-books): stamp_signature_above_name — sig float on authored docx (tatweel-safe anchor)"
```

---

### Task 2: `render_signed_pdf` — sign the authored docx instead of re-rendering

**Files:**
- Modify: `backend/app/services/document_service.py:1761-1786` (top of `render_signed_pdf`)
- Test: `backend/tests/test_word_book_sign.py` (new)

**Interfaces:**
- Consumes: `stamp_signature_above_name` (Task 1).
- Produces: unchanged signature `render_signed_pdf(db, *, version, signer_signature_path) -> str` — but for word-authored versions (`not version.fields` AND the linked Document's docx exists) the signed artifact derives from the authored docx.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_word_book_sign.py
"""Signing a Word-authored General Book must keep the authored body."""

from pathlib import Path

import pytest
from docx import Document as DocxDocument

from app.core.book_text import docx_to_text
from app.db.models import Book, BookVersion, Document
from app.services import document_service

BODY_LINE = "نرجو الموافقة على أعمال الصيانة العاجلة"


@pytest.fixture
def word_book(db_session, tmp_path):
    """A finished word-authored book: Document docx on disk, version.fields == {}."""
    docx_path = tmp_path / "1-11-GSSG-9.docx"
    d = DocxDocument()
    d.add_paragraph(BODY_LINE)
    d.add_paragraph("")
    d.add_paragraph("سعيد راشد اليحيائي")
    d.save(str(docx_path))

    book = Book(category_id="GS", ref_number="1/11/GSSG/9", subject="اختبار التوقيع")
    db_session.add(book)
    db_session.flush()
    doc = Document(
        template_id="General Book",
        ref_number=book.ref_number,
        docx_path=str(docx_path),
        submission_id="t-sign",
        role="primary",
    )
    db_session.add(doc)
    db_session.flush()
    version = BookVersion(
        book_id=book.id,
        version_no=1,
        trigger="initial",
        status="none",
        template_id="General Book",
        fields={},
        document_id=doc.id,
    )
    db_session.add(version)
    db_session.commit()
    return version


def _sig(tmp_path) -> str:
    from PIL import Image

    p = tmp_path / "sig.png"
    Image.new("RGBA", (60, 30), (0, 0, 200, 255)).save(p)
    return str(p)


def test_signed_artifact_keeps_word_body(db_session, tmp_path, word_book, monkeypatch):
    # PDF conversion is environment-dependent — force the docx fallback path.
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda p: None)
    rel = document_service.render_signed_pdf(
        db_session, version=word_book, signer_signature_path=_sig(tmp_path)
    )
    from app.config import get_settings

    signed = get_settings().data_dir / rel
    assert signed.suffix == ".docx"  # conversion stubbed out
    text = docx_to_text(signed)
    assert BODY_LINE in text  # the authored body SURVIVED signing
    # and the signature image landed (anchored drawing present)
    import zipfile

    with zipfile.ZipFile(signed) as z:
        assert b"<wp:anchor" in z.read("word/document.xml")


def test_rich_versions_still_rerender(db_session, tmp_path, word_book, monkeypatch):
    """A version WITH fields keeps the existing template re-render path."""
    word_book.fields = {"subject": "موضوع", "body": "نص"}
    db_session.commit()
    calls: list[str] = []
    monkeypatch.setattr(
        document_service.DocxEngine,
        "fill",
        lambda self, tid, data, out: calls.append(tid) or DocxDocument().save(str(out)),
    )
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda p: None)
    document_service.render_signed_pdf(
        db_session, version=word_book, signer_signature_path=_sig(tmp_path)
    )
    assert calls == ["General Book"]
```

Adapt fixture names to this repo's `backend/tests/conftest.py` (`db_session` exists; check exact name before writing). If `_postprocess_general_book_footer` or aztec stamping in the rich path breaks the monkeypatched minimal docx, monkeypatch those too — the test's point is *which* path ran, not the artifact's cosmetics.

- [ ] **Step 2: Run to verify it fails**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_word_book_sign.py -v`
Expected: `test_signed_artifact_keeps_word_body` FAILS (body missing from re-rendered artifact) — this is the bug reproduced.

- [ ] **Step 3: Implement the word-branch**

At the top of `render_signed_pdf` (document_service.py:1776, right after the docstring):

```python
    book = version.book
    # ── Word-authored versions (fields == {}) carry their truth in the DOCX,
    # not in re-renderable fields. Re-rendering the template would blank the
    # paper (the 2026-07-19 signed-book regression). Copy the authored docx
    # and float the signature above the closing name instead.
    authored = _authored_docx_of(db, version)
    if not version.fields and authored is not None:
        return _sign_authored_docx(
            db, version=version, source=authored, signer_signature_path=signer_signature_path
        )
```

(The existing `book = version.book` line moves up; keep the rest of the function unchanged.)

New private helpers, placed directly above `render_signed_pdf`:

```python
def _authored_docx_of(db: Session, version: BookVersion) -> Path | None:
    """The version's committed docx on disk, or None."""
    if version.document_id is None:
        return None
    doc = db.get(Document, version.document_id)
    if doc is None or not doc.docx_path:
        return None
    p = Path(doc.docx_path)
    if not p.is_absolute():
        p = get_settings().data_dir / p
    return p if p.exists() else None


def _sign_authored_docx(
    db: Session,
    *,
    version: BookVersion,
    source: Path,
    signer_signature_path: str,
) -> str:
    """Signed artifact for a Word-authored book: copy docx → stamp signature →
    convert. The paper already carries ref/date/footer/Aztec from its own
    render — nothing is re-generated."""
    from app.core.docx_engine import (
        DEFAULT_MANAGER_NAME,
        stamp_signature_above_name,
    )
    from app.services import settings_service

    book = version.book
    out_dir = _output_dir_for_admin("General Book")
    ts = datetime.now()
    docx_name = _build_docx_filename(
        "General Book", book.ref_number.replace("/", "-"), ts
    )
    docx_path = Vault.collision_safe_name(out_dir, docx_name.replace(".docx", "_signed.docx"))
    shutil.copy2(source, docx_path)

    # Anchor candidates: the linked manager's names, then the default manager.
    names: list[str] = []
    if book.doc_manager_id is not None:
        mgr = db.get(Manager, book.doc_manager_id)
        if mgr is not None:
            names += [n for n in (mgr.name_ar, mgr.name_en) if n]
    names.append(DEFAULT_MANAGER_NAME)

    _appearance = settings_service.get_settings(db)
    stamp_signature_above_name(
        docx_path,
        signer_signature_path,
        names,
        size_mm=_appearance.signature_size_mm,
        boldness=_appearance.signature_boldness,
    )

    pdf_path: Path | None = None
    try:
        pdf_path = convert_docx_to_pdf(docx_path)
    except Exception:
        log.error("Signed PDF conversion crashed for %s", docx_path, exc_info=True)
    if pdf_path is None:
        log.warning("Signed PDF unavailable for %s — returning signed DOCX", docx_path)

    # The generated PDF carried the book's combined-PDF attachments — the
    # signed artifact must too (same rule as the rich path, document_service.py
    # 1852-1871). Factor that block into `_merge_book_attachments(db, book,
    # pdf_path)` and call it from BOTH paths (DRY — do the extraction as part
    # of this task, the rich path keeps identical behavior).
    if pdf_path is not None:
        _merge_book_attachments(db, book, pdf_path)

    settings = get_settings()

    def _rel(p: Path) -> str:
        # Output dirs can live OUTSIDE data_dir (AppData/Desktop output roots) —
        # mirror render_signed_pdf's fallback (document_service.py:1875-1879).
        try:
            return p.relative_to(settings.data_dir).as_posix()
        except ValueError:
            return str(p)

    return _rel(pdf_path) if pdf_path is not None else _rel(docx_path)
```

Implementer notes (verified 2026-07-19): `shutil`, `Vault`, `datetime`, `log`, `get_settings`, `convert_docx_to_pdf` are already imported at document_service.py:22-64. `settings_service` is imported LOCALLY inside functions in this module (see :583, :633) — keep that convention. `DEFAULT_MANAGER_NAME` is NOT imported here — local import from docx_engine as shown. Check `Manager` is in the models import list at :48-61 (add if missing). `_merge_book_attachments` = extract document_service.py:1852-1871 verbatim into a helper and replace the inline block in `render_signed_pdf` with the call — behavior identical, one test in the existing suite already covers the rich-path merge.

Detection edge (accepted): ANY legacy version with empty `fields` + an on-disk docx routes through the authored path — that is strictly safer than re-rendering from empty fields, so no extra guard.

- [ ] **Step 4: Run tests**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_word_book_sign.py backend/tests/test_stamp_signature.py -v`
Expected: all PASS. Then the full suite: `venv\Scripts\python.exe -m pytest` — no regressions (existing sign tests cover the rich path).

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/document_service.py backend/tests/test_word_book_sign.py
git commit -m "fix(word-books): signing preserves the authored docx — no more blank signed papers"
```

---

### Task 3: `sign_book` — one signature per person (User → Submitter fallback)

**Files:**
- Modify: `backend/app/services/book_service.py:599-606`
- Test: `backend/tests/test_word_book_sign.py` (extend)

**Interfaces:**
- Produces: `_resolve_signer_signature(db, signer: User) -> Path | None` in book_service — used by `sign_book`; resolution order: `User.signature_path`, else `Submitter.stored_sig_path` where `Submitter.employee_id == signer.employee_id`.

- [ ] **Step 1: Write the failing test** (append to `backend/tests/test_word_book_sign.py`)

```python
def test_sign_falls_back_to_submitter_signature(db_session, tmp_path):
    from app.db.models import Employee, Submitter, User
    from app.services.book_service import _resolve_signer_signature

    sig = tmp_path / "emp-sig.png"
    from PIL import Image

    Image.new("RGBA", (40, 20), (0, 0, 0, 255)).save(sig)

    db_session.add(Employee(id="G7001", name_en="Signer Emp"))
    db_session.flush()
    user = User(
        email="signer@test.ae", password_hash="x", role="manager", status="active",
        employee_id="G7001", signature_path=None,
    )
    db_session.add(user)
    db_session.add(Submitter(employee_id="G7001", name="Signer Emp", stored_sig_path=str(sig)))
    db_session.commit()

    resolved = _resolve_signer_signature(db_session, user)
    assert resolved is not None and resolved.name == "emp-sig.png"


def test_sign_prefers_own_signature(db_session, tmp_path):
    from app.db.models import User
    from app.services.book_service import _resolve_signer_signature

    own = tmp_path / "own.png"
    from PIL import Image

    Image.new("RGBA", (40, 20), (0, 0, 0, 255)).save(own)
    user = User(
        email="own@test.ae", password_hash="x", role="manager", status="active",
        signature_path=str(own),
    )
    db_session.add(user)
    db_session.commit()
    resolved = _resolve_signer_signature(db_session, user)
    assert resolved is not None and resolved.name == "own.png"
```

- [ ] **Step 2: Run to verify failure**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_word_book_sign.py -k signature -v`
Expected: FAIL — `_resolve_signer_signature` not defined.

- [ ] **Step 3: Implement**

In `book_service.py`, above `sign_book`:

```python
def _resolve_signer_signature(db: Session, signer: User) -> Path | None:
    """The signer's ONE signature: their uploaded approval signature, else the
    stored signature of their linked employee (G number) from the Submitter
    registry — people should not need a second signature just for approvals."""
    candidates: list[str] = []
    if signer.signature_path:
        candidates.append(signer.signature_path)
    if signer.employee_id:
        sub = db.execute(
            select(Submitter).where(Submitter.employee_id == signer.employee_id)
        ).scalar_one_or_none()
        if sub is not None and sub.stored_sig_path:
            candidates.append(sub.stored_sig_path)
    for raw in candidates:
        p = Path(raw)
        if not p.is_absolute():
            p = get_settings().data_dir / p
        if p.is_file():
            return p
    return None
```

Then in `sign_book` replace lines 599-606:

```python
    signer = db.get(User, user_id)
    if signer is None:
        raise ValidationFailedError("NO_SIGNATURE", "You have no signature on file")
    abs_sig = _resolve_signer_signature(db, signer)
    if abs_sig is None:
        raise ValidationFailedError(
            "NO_SIGNATURE",
            "No signature on file — upload one in Settings, or store the employee "
            "signature (G number) in the Submitters registry.",
        )
```

(`Submitter` import: add to the existing `app.db.models` import list; `select` and `get_settings` are already imported.) Also grep `SubmitForApprovalDialog` + backend for any "no signature on file" pre-warning keyed to `signature_path` only, and align its condition or copy (search: `signature` in `frontend/src/components/books/SubmitForApprovalDialog.tsx` and `/auth/me` capability payloads). If such a warning exists, it may keep the stricter check but must not block submission (it doesn't today — candidates are lenient by design, book_service.py:885-889).

- [ ] **Step 4: Run tests**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_word_book_sign.py -v` → PASS; then full `venv\Scripts\python.exe -m pytest`.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/book_service.py backend/tests/test_word_book_sign.py
git commit -m "feat(books): approval uses the person's one signature — Submitter G-number fallback"
```

---

### Task 4: Live preview of the active Word session (backend)

**Files:**
- Modify: `backend/app/services/word_book_service.py` (new function at the end)
- Modify: `backend/app/api/v1/books.py` (new route after `finish_word_session`, ~line 171)
- Test: `backend/tests/test_word_book_preview.py` (new)

**Interfaces:**
- Produces: `word_book_service.render_session_preview(db, *, book_id: int) -> Path` — PDF of the CURRENT working docx, cached beside it as `preview.pdf`, regenerated only when the working file is newer. Raises `AppError` `NO_ACTIVE_SESSION` / `NO_SAVES_YET` / `PREVIEW_UNAVAILABLE` (409).
- Produces: `GET /api/v1/books/{book_id}/word-sessions/preview` → `FileResponse(media_type="application/pdf")`, gated `books.manage`.

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_word_book_preview.py
"""Live preview of an active Word session's working docx."""

from datetime import UTC, datetime
from pathlib import Path

import pytest
from docx import Document as DocxDocument

from app.api.errors import AppError
from app.db.models import Book, BookEditSession
from app.services import word_book_service


@pytest.fixture
def active_session(db_session, tmp_path):
    book = Book(category_id="GS", ref_number="1/11/GSSG/7", subject="معاينة")
    db_session.add(book)
    db_session.flush()
    working = tmp_path / "editing" / f"book-{book.id}" / "1-11-GSSG-7.docx"
    working.parent.mkdir(parents=True)
    d = DocxDocument()
    d.add_paragraph("معاينة حية")
    d.save(str(working))
    sess = BookEditSession(
        book_id=book.id, user_id=1, token="tok-preview", working_path=str(working),
        state="active", last_put_at=datetime.now(UTC).replace(tzinfo=None),
    )
    db_session.add(sess)
    db_session.commit()
    return book, working


def test_preview_renders_and_caches(db_session, active_session, monkeypatch):
    book, working = active_session
    calls: list[Path] = []

    def fake_convert(src: Path) -> Path:
        calls.append(src)
        out = src.with_suffix(".pdf")
        out.write_bytes(b"%PDF-1.4 fake")
        return out

    monkeypatch.setattr(word_book_service, "convert_docx_to_pdf", fake_convert)
    p1 = word_book_service.render_session_preview(db_session, book_id=book.id)
    assert p1.name == "preview-src.pdf" and p1.read_bytes().startswith(b"%PDF")
    # Second call with unchanged working file: served from cache, no re-convert.
    p2 = word_book_service.render_session_preview(db_session, book_id=book.id)
    assert p2 == p1 and len(calls) == 1


def test_preview_requires_a_save(db_session, active_session):
    book, _ = active_session
    sess = db_session.query(BookEditSession).filter_by(book_id=book.id).one()
    sess.last_put_at = None
    db_session.commit()
    with pytest.raises(AppError) as ei:
        word_book_service.render_session_preview(db_session, book_id=book.id)
    assert ei.value.code == "NO_SAVES_YET"
```

(Adjust `AppError.code` attribute name to whatever `app.api.errors.AppError` actually exposes — read the class first.)

- [ ] **Step 2: Run to verify failure** — `venv\Scripts\python.exe -m pytest backend/tests/test_word_book_preview.py -v` → `AttributeError`/`ImportError`.

- [ ] **Step 3: Implement service + route**

`word_book_service.py` (end of file):

```python
def render_session_preview(db: Session, *, book_id: int) -> Path:
    """PDF preview of the ACTIVE session's working docx.

    Cached beside the working file as ``preview.pdf`` and regenerated only when
    the working docx is newer — Word COM conversion costs seconds, and the
    dialog polls every 5s. Conversion runs on a COPY so Word's WebDAV PUTs
    never collide with the converter's open handle.
    """
    session = db.query(BookEditSession).filter_by(book_id=book_id, state="active").one_or_none()
    if session is None:
        raise AppError(
            "NO_ACTIVE_SESSION", "No active editing session for this book", http_status=409
        )
    if session.last_put_at is None:
        raise AppError("NO_SAVES_YET", "Nothing saved from Word yet", http_status=409)
    working = Path(session.working_path)
    if not working.exists():
        raise AppError("PREVIEW_UNAVAILABLE", "Working file is missing", http_status=409)

    # Cache = the conversion output itself (preview-src.pdf). No os.replace
    # juggling: on Windows, replacing a file that another request is still
    # streaming raises PermissionError. Serve the output path directly and
    # cache-check by mtime.
    preview_pdf = working.parent / "preview-src.pdf"
    if preview_pdf.exists() and preview_pdf.stat().st_mtime >= working.stat().st_mtime:
        return preview_pdf

    src_copy = working.parent / "preview-src.docx"
    shutil.copy2(working, src_copy)
    pdf = convert_docx_to_pdf(src_copy)
    src_copy.unlink(missing_ok=True)
    if pdf is None:
        raise AppError(
            "PREVIEW_UNAVAILABLE", "PDF conversion is not available", http_status=409
        )
    return pdf  # == preview_pdf (conversion writes beside the source docx)
```

(`shutil`, `AppError`, `convert_docx_to_pdf` already imported in word_book_service.)

Cleanup: in `finish_word_session` (after the `shutil.move`) and `discard_word_session` (after the working-file unlink), best-effort remove the leftover preview files so the editing dir doesn't accumulate orphans:

```python
    for leftover in ("preview-src.pdf", "preview-src.docx"):
        with contextlib.suppress(OSError):
            (src.parent / leftover).unlink(missing_ok=True)
```

(`contextlib` already imported in word_book_service; in `finish_word_session` the variable holding the old working path is `src`.)

`books.py` route (after the finish route). CRITICAL: `DocPdfCanvas` fetches with `?encoding=base64` (text/plain body — the IDM/stream-handler bypass), so the endpoint MUST support it exactly like the documents download endpoint (documents.py:382, 445-450, using `maybe_base64` from `app.api._responses`):

```python
@router.get("/{book_id}/word-sessions/preview")
def word_session_preview(
    book_id: int,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(require_capability("books.manage"))],
    encoding: Annotated[str | None, Query(pattern="^base64$")] = None,
) -> Response:
    """PDF preview of the active Word session's working docx (regenerates on change)."""
    pdf = word_book_service.render_session_preview(db, book_id=book_id)
    if (b64 := maybe_base64(pdf.read_bytes(), encoding)) is not None:
        return b64
    return FileResponse(
        str(pdf),
        media_type="application/pdf",
        headers={"Cache-Control": "no-store"},
    )
```

(Imports: mirror documents.py — `from app.api._responses import maybe_base64`; `Query`, `Response`, `FileResponse` — check what books.py already imports and add the missing ones. Also add a route test asserting `?encoding=base64` returns text/plain base64 whose decode starts with `%PDF`.)

DAV note (verified): `dav.py:81` always serves `sess.working_path` regardless of the URL filename — the preview files are NOT reachable through the WebDAV token. No change needed.

- [ ] **Step 4: Run tests** — preview tests + full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/word_book_service.py backend/app/api/v1/books.py backend/tests/test_word_book_preview.py
git commit -m "feat(word-books): live session preview endpoint — cached working-docx PDF"
```

---

### Task 5: Template rename (backend)

**Files:**
- Modify: `backend/app/services/book_template_service.py` (new function after `save_book_as_template`)
- Modify: `backend/app/api/v1/books.py` (new route after `list_word_templates`, ~line 127)
- Modify: `backend/app/schemas/book.py` (or wherever `WordTemplateRead`/`SaveAsTemplateRequest` live — grep first): add `RenameTemplateRequest`
- Test: `backend/tests/test_book_templates_rename.py` (new)

**Interfaces:**
- Produces: `book_template_service.rename_template(old: str, new: str) -> TemplateInfo`; `PATCH /api/v1/books/word-templates/{name}` body `{"new_name": str}` → `WordTemplateRead`, gated `books.manage`. Errors: `TEMPLATE_NOT_FOUND` 404, `TEMPLATE_EXISTS` 409, `TEMPLATE_BAD_NAME` 422 (reuse `safe_template_name`).

- [ ] **Step 1: Write the failing test**

```python
# backend/tests/test_book_templates_rename.py
"""Rename ops on the shared General Book template library."""

import pytest

from app.api.errors import AppError
from app.services import book_template_service


@pytest.fixture
def library(tmp_path, monkeypatch):
    monkeypatch.setattr(book_template_service, "templates_dir", lambda: tmp_path)
    (tmp_path / "الصيانة.docx").write_bytes(b"PK-fake")
    (tmp_path / "التكليف.docx").write_bytes(b"PK-fake")
    return tmp_path


def test_rename_moves_the_file(library):
    info = book_template_service.rename_template("الصيانة.docx", "صيانة المباني")
    assert info.name == "صيانة المباني.docx"
    assert (library / "صيانة المباني.docx").exists()
    assert not (library / "الصيانة.docx").exists()


def test_rename_collision_is_409(library):
    with pytest.raises(AppError) as ei:
        book_template_service.rename_template("الصيانة.docx", "التكليف")
    assert ei.value.http_status == 409


def test_rename_missing_is_404(library):
    with pytest.raises(AppError) as ei:
        book_template_service.rename_template("غير موجود.docx", "جديد")
    assert ei.value.http_status == 404


def test_rename_bad_name_is_422(library):
    with pytest.raises(AppError) as ei:
        book_template_service.rename_template("الصيانة.docx", "../evil")
    assert ei.value.http_status == 422
```

(Verify `AppError` exposes `http_status`; if the attribute differs, read `app/api/errors.py` and match.)

- [ ] **Step 2: Run to verify failure** — `rename_template` missing.

- [ ] **Step 3: Implement**

```python
def rename_template(old: str, new: str) -> TemplateInfo:
    """Rename a library template. Same hard name sanitation as save; atomic
    collision check via exclusive create semantics (NTFS case-folds)."""
    src = templates_dir() / safe_template_name(old)
    if not src.is_file():
        raise AppError("TEMPLATE_NOT_FOUND", "القالب غير موجود", http_status=404)
    dest = templates_dir() / safe_template_name(new)
    if dest == src:
        return TemplateInfo(
            name=src.name,
            modified_at=datetime.fromtimestamp(src.stat().st_mtime, tz=UTC).replace(tzinfo=None),
        )
    try:
        fd = os.open(dest, os.O_CREAT | os.O_EXCL | os.O_WRONLY | getattr(os, "O_BINARY", 0))
    except FileExistsError:
        raise AppError("TEMPLATE_EXISTS", "يوجد قالب بهذا الاسم", http_status=409) from None
    os.close(fd)
    os.replace(src, dest)
    return TemplateInfo(
        name=dest.name,
        modified_at=datetime.fromtimestamp(dest.stat().st_mtime, tz=UTC).replace(tzinfo=None),
    )
```

Route + schema:

```python
class RenameTemplateRequest(BaseModel):
    new_name: str
```

```python
@router.patch("/word-templates/{name}", response_model=WordTemplateRead)
def rename_word_template(
    name: str,
    payload: RenameTemplateRequest,
    _user: Annotated[User, Depends(require_capability("books.manage"))],
) -> WordTemplateRead:
    """Rename a template in the shared General Book library."""
    info = book_template_service.rename_template(name, payload.new_name)
    return WordTemplateRead(name=info.name, modified_at=info.modified_at)
```

Route-ordering caveat: FastAPI matches in registration order — `/word-templates/{name}` must be registered near the other static `word-templates` route and BEFORE any conflicting `/{book_id}`-style catch-all (check how `GET /word-templates` at books.py:118 avoids the `/{book_id}` clash today and place the PATCH beside it).

- [ ] **Step 4: Run tests** — rename tests + full suite PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/book_template_service.py backend/app/api/v1/books.py backend/app/schemas/book.py backend/tests/test_book_templates_rename.py
git commit -m "feat(book-templates): rename endpoint for the shared library"
```

---

### Task 6: Fresh-install `font_scale` seed clamp

**Files:**
- Modify: `backend/app/services/settings_service.py:~200` (before `AppSettingsRead.model_validate(raw)`)
- Test: `backend/tests/test_settings_service.py` (extend; create if absent)

- [ ] **Step 1: Failing test**

```python
def test_font_scale_below_floor_is_clamped(db_session):
    """Migration 0007 seeded settings.font_scale=15; AppSettingsRead requires >=16.
    A fresh install must not 500 on GET /settings."""
    from app.db.models import AppSetting  # check actual model name in models.py
    from app.services import settings_service

    row = db_session.query(AppSetting).filter_by(key="settings.font_scale").one_or_none()
    if row is None:
        db_session.add(AppSetting(key="settings.font_scale", value="15"))
    else:
        row.value = "15"
    db_session.commit()
    out = settings_service.get_settings(db_session)
    assert out.font_scale >= 16
```

(Read `settings_service.get_settings` + the settings model first; adapt key/model names to reality — the audit showed the stored key is `settings.font_scale`.)

- [ ] **Step 2: Run to verify failure** — pydantic `ValidationError`.

- [ ] **Step 3: Implement** — in `get_settings`, before validation, clamp the raw value:

```python
    # Pre-0015 installs seeded font_scale=15; the schema floor is 16. Clamp on
    # read so a fresh DB never 500s (2026-07-19 fresh-install audit).
    try:
        if int(raw.get("font_scale", 16)) < 16:
            raw["font_scale"] = 16
    except (TypeError, ValueError):
        raw["font_scale"] = 16
```

(Adapt to how `raw` is keyed at settings_service.py:202 — read the 20 lines above it first.)

- [ ] **Step 4: Run** the test + full suite → PASS.
- [ ] **Step 5: Commit** — `git commit -m "fix(settings): clamp font_scale to schema floor — fresh installs 500'd on GET /settings"`

---

### Task 7: Resync API types

- [ ] **Step 1:** Run the `/sync-api-types` skill flow: `venv\Scripts\python.exe -X utf8 scripts/dump_openapi.py` then `pnpm -C frontend run gen:api` then `pnpm -C frontend exec tsc -b --noEmit`.
- [ ] **Step 2:** Add typed client methods in `frontend/src/lib/api.ts` beside `listWordTemplates`/`saveBookAsTemplate` (mirror their style exactly):

```ts
/** Rename a template in the shared General Book library. */
renameWordTemplate: (name: string, newName: string) =>
  request<WordTemplateRead>(`/books/word-templates/${encodeURIComponent(name)}`, {
    method: 'PATCH',
    body: JSON.stringify({ new_name: newName }),
  }),

/** URL of the live PDF preview for an active Word session (ts busts the browser cache). */
wordSessionPreviewUrl: (bookId: number, ts: string) =>
  `${API_BASE}/books/${bookId}/word-sessions/preview?ts=${encodeURIComponent(ts)}`,
```

(Copy the module's real request helper/`API_BASE` idioms — read neighbors first; the exported type name for `WordTemplateRead` comes from the regenerated `api.types.ts`.)

- [ ] **Step 3:** `pnpm -C frontend exec tsc -b --noEmit` → clean. Commit `api.types.ts` + `api.ts`:

```bash
git add frontend/src/lib/api.types.ts frontend/src/lib/api.ts
git commit -m "chore(api): types resync + client methods for template rename and session preview"
```

---

### Task 8: Kill the click-swallowing auto `ms-word:` navigation + honest button states

**Files:**
- Modify: `frontend/src/pages/application/ApplicationPage.tsx:365`
- Modify: `frontend/src/pages/books/WordHandoffDialog.tsx` (steps copy, Open-in-Word anchor, Finish spinner, saved-✓ line)
- Modify: `frontend/src/components/books/BookWordActions.tsx:54-62`
- Modify: `frontend/src/locales/en.json` + `ar.json`
- Test: `frontend/src/pages/books/WordHandoffDialog.test.tsx` (extend)

**Interfaces:**
- Consumes: `session.word_url` (unchanged).
- Produces: the ONLY `ms-word:` trigger is an explicit user-clicked `<a href>`; no `window.location.href` writes remain for `word_url` (`LedgerAttachments` one is unrelated — leave it).

- [ ] **Step 1: Failing tests** (extend `WordHandoffDialog.test.tsx`, follow its existing render/mocks):

```tsx
it('renders Open in Word as a real anchor with the ms-word url', () => {
  renderDialog() // existing helper in this test file
  const link = screen.getByRole('link', { name: /open in word|افتح/i })
  expect(link).toHaveAttribute('href', expect.stringMatching(/^ms-word:/))
})

it('shows a positive saved state once a Word save exists', async () => {
  renderDialogWithSave() // book query returns edit_session.last_put_at
  expect(await screen.findByText(/saved from word|تم الحفظ/i)).toBeInTheDocument()
})

it('finish shows a busy spinner while pending', async () => {
  renderDialogWithSave()
  fireEvent.click(screen.getByRole('button', { name: /finish/i }))
  expect(screen.getByRole('button', { name: /finish/i })).toBeDisabled()
})
```

- [ ] **Step 2: Run** `pnpm -C frontend exec vitest run src/pages/books/WordHandoffDialog.test.tsx` → new tests FAIL.

- [ ] **Step 3: Implement**

1. `ApplicationPage.tsx:365`: delete `window.location.href = res.word_url` (the dialog now owns the launch; keep the rest of `onSuccess`).
2. `WordHandoffDialog.tsx` footer: replace the "Open in Word again" `<Button onClick={location.href=…}>` with an anchor styled as the PRIMARY action (Word blue), placed FIRST:

```tsx
<a
  href={session.word_url}
  className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg px-4 text-[0.86em] font-semibold text-white"
  style={{ backgroundColor: '#185abd' }}
>
  {t('books.word.openInWord')}
</a>
```

and under the actions a one-line hint: `<p className="mt-2 text-[0.72em] text-muted-foreground">{t('books.word.protocolHint')}</p>`.
3. Step copy (do NOT quote the browser's dialog text — Chrome localizes it by BROWSER language, not app language): `books.word.step1` EN "Press «Open in Word», then allow the browser's confirmation" / AR "اضغط «افتح في Word» ثم وافق على تأكيد المتصفح". Keep steps 2-3.
4. Saved state: replace the vanish-only hint block (`{!hasSave && …noSavesYet}`) with:

```tsx
{hasSave ? (
  <p className="mb-4 text-center text-[0.78em] text-emerald-600 dark:text-emerald-400">
    {t('books.word.lastSavedAt', {
      time: new Date(bookQuery.data!.edit_session!.last_put_at!).toLocaleTimeString(
        isAr ? 'ar-AE' : 'en-GB', { hour: '2-digit', minute: '2-digit' },
      ),
    })}
  </p>
) : (
  <p className="mb-4 text-center text-[0.78em] text-amber-600 dark:text-amber-400">
    {t('books.word.noSavesYet')}
  </p>
)}
```

5. Finish spinner: inside the Finish `<Button>`, `{finishMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}` (import `Loader2` from lucide-react as sibling files do) and disable during pending (already does).
6. `BookWordActions.tsx` reopen `onSuccess`: delete the `window.location.href = session.word_url` line — `setReopenSession(session)` opens `WordHandoffDialog`, which now carries the launch anchor.

New keys (both locales — `books.word.openInWord` already exists in both, verified): `books.word.protocolHint` EN "If Word didn't open, your browser is asking for permission — approve it once and choose to always allow." / AR "إذا لم يُفتح Word فالمتصفح يطلب الإذن — وافق مرة واحدة واختر السماح دائماً.", `books.word.lastSavedAt` EN "Saved from Word ✓ {{time}}" / AR "تم الحفظ من Word ✓ {{time}}" (keep the ✓ adjacent to the word it follows; the `{{time}}` interpolation style matches existing keys like `books.word.editingBy`).

- [ ] **Step 4: Run** dialog tests + `pnpm -C frontend test` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "fix(word-books): ms-word launch is a user-gesture anchor — Chrome's protocol prompt no longer eats every click"`

---

### Task 9: Live preview pane in the handoff dialog (persists across saves)

**Files:**
- Modify: `frontend/src/pages/books/WordHandoffDialog.tsx`
- Test: `frontend/src/pages/books/WordHandoffDialog.test.tsx` (extend)

**Interfaces:**
- Consumes: `api.wordSessionPreviewUrl(bookId, ts)` (Task 7), `DocPdfCanvas` (`pdfUrl` prop, lazy — already imported in this file).

- [ ] **Step 1: Failing test**

```tsx
it('shows the live preview canvas once a Word save exists', async () => {
  renderDialogWithSave()
  expect(await screen.findByTestId('word-live-preview')).toBeInTheDocument()
})
```

- [ ] **Step 2: Run** → FAIL (testid absent).

- [ ] **Step 3: Implement**

In the ACTIVE-session view (below the steps/saved-state, above the footer), when `hasSave`:

```tsx
{hasSave && (
  <div data-testid="word-live-preview" className="mb-4 max-h-[40vh] min-h-[260px] overflow-auto rounded-lg border border-hairline">
    <Suspense fallback={<p className="p-3 text-[0.8em] text-muted-foreground">…</p>}>
      <DocPdfCanvas
        key={bookQuery.data!.edit_session!.last_put_at!}
        pdfUrl={api.wordSessionPreviewUrl(session.book_id, bookQuery.data!.edit_session!.last_put_at!)}
      />
    </Suspense>
  </div>
)}
```

The `key` + `ts` on the URL re-mounts the canvas whenever `last_put_at` changes — the 5s poll already provides the change signal; the backend cache (Task 4) makes repeat fetches cheap. Widen the active-session dialog to `max-w-3xl` (same as the finished view) so the A4 page is legible. Verified behaviors to rely on: `DocPdfCanvas` (`pages/application/DocPdfCanvas.tsx:38-68`) takes `pdfUrl`/`docxUrl?`, fetches the URL itself WITH `encoding=base64` appended (via `toBase64Url` — check `lib/pdf.ts` appends with `&` when the URL already has `?ts=`), and has its own loading spinner + 'missing'/'render' error states. The preview conversion runs synchronously inside the GET (serialized by the single-worker PDF executor), so the canvas's loading state naturally covers the seconds-long conversion — no extra "converting…" indicator, no retry system. If the executor is down the 409 lands in the canvas's 'missing' error state — acceptable.

- [ ] **Step 4: Run** tests → PASS. Also `pnpm -C frontend exec tsc -b --noEmit`.
- [ ] **Step 5: Commit** — `git commit -m "feat(word-books): live paper preview in the handoff dialog — updates on every Word save"`

---

### Task 10: Template ops on the General Book side (manage dialog + save moves into the flow)

**Files:**
- Create: `frontend/src/components/application/WordTemplateManager.tsx`
- Modify: `frontend/src/components/application/TemplateForm.tsx:472-492` (gear button beside picker)
- Modify: `frontend/src/pages/books/WordHandoffDialog.tsx` (Save-as-template in the finished view)
- Modify: `frontend/src/components/books/BookWordActions.tsx` (REMOVE Save-as-template button/dialog/mutation)
- Modify: `frontend/src/locales/{en,ar}.json`
- Test: `frontend/src/components/application/WordTemplateManager.test.tsx` (new), `frontend/src/components/books/BookWordActions.test.tsx` (update — save-as-template expectations removed)

**Interfaces:**
- Consumes: `api.listWordTemplates`, `api.renameWordTemplate` (Task 7), `api.saveBookAsTemplate` (existing), query key `['word-templates']`.

- [ ] **Step 1: Failing tests**

```tsx
// WordTemplateManager.test.tsx — follow the repo's vitest+RTL setup (copy a sibling test's boilerplate)
it('lists templates and renames one', async () => {
  mockApi.listWordTemplates.mockResolvedValue([{ name: 'الصيانة.docx', modified_at: '2026-07-19T10:00:00' }])
  mockApi.renameWordTemplate.mockResolvedValue({ name: 'صيانة المباني.docx', modified_at: '2026-07-19T10:05:00' })
  renderManager({ open: true })
  expect(await screen.findByText('الصيانة')).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: /rename|إعادة تسمية/i }))
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'صيانة المباني' } })
  fireEvent.click(screen.getByRole('button', { name: /save|حفظ/i }))
  await waitFor(() => expect(mockApi.renameWordTemplate).toHaveBeenCalledWith('الصيانة.docx', 'صيانة المباني'))
})
```

And in `WordHandoffDialog.test.tsx`:

```tsx
it('finished view offers Save as template', async () => {
  renderFinishedDialog() // finished state helper
  expect(screen.getByRole('button', { name: /save as template|حفظ كقالب/i })).toBeInTheDocument()
})
```

- [ ] **Step 2: Run** → FAIL (component missing / button absent).

- [ ] **Step 3: Implement**

`WordTemplateManager.tsx` — a `DialogRoot` listing `['word-templates']` rows (`name` minus `.docx` — strip the suffix EVERYWHERE in UI including the rename input, it's an Arabic-name + Latin-suffix bidi mess otherwise; the server re-appends via `safe_template_name`), localized modified date, each with a pencil button flipping the row to an inline `<input dir="auto">` + save/cancel; `renameMutation` calls `api.renameWordTemplate(oldName, newNameTrimmed)`, on success invalidates `['word-templates']` + toast; on error `toast.error(apiErrorMessage(err))`. RTL: rows are `flex` with logical margins only; the dialog inherits app `dir`.

`TemplateForm.tsx` — beside the picker label add the same gear-button pattern used for "Manage recipients" (`⚙`, `aria-label={t('books.word.manageTemplates')}`) opening the manager; render `<WordTemplateManager open={…} onOpenChange={…} />` next to the select.

`WordHandoffDialog.tsx` finished view footer — before Close, a ghost button `{t('books.word.saveAsTemplate')}` opening a small name dialog (input pre-seeded with `finishedBook.subject ?? ''`, `dir="auto"`), mutation `api.saveBookAsTemplate(finishedBook.id, name.trim())`, success → toast `books.word.savedAsTemplate` + invalidate `['word-templates']`. Copy the dialog JSX from `BookWordActions.tsx:176-211` before deleting it there — same i18n keys, so no new keys needed for this part.

`BookWordActions.tsx` — remove `saveTplOpen`/`tplName` state, `saveTemplateMutation`, the Save-as-template button (lines 106-113) and its dialog (176-211). Template ops now live on the General Book side only (form picker + manager; save in the Word-flow finished view). Reopen→finish still reaches Save-as-template for old books — accepted ceiling: that path creates a new (identical) version just to save a template. `ponytail:` note this in the component; if operators hit it often, the upgrade path is a book-picker inside WordTemplateManager. Reuse the existing keys `books.word.saveAsTemplateName` / `saveAsTemplateHint` / `savedAsTemplate` in the moved dialog — no new keys for this part.

New keys: `books.word.manageTemplates` EN "Manage templates" / AR "إدارة القوالب"; `books.word.renameTemplate` EN "Rename" / AR "إعادة تسمية"; reuse `common.save`/`common.cancel` if present (grep first).

- [ ] **Step 4: Run** all three test files + full `pnpm -C frontend test` → PASS (fix the BookWordActions tests that asserted the removed button).
- [ ] **Step 5: Commit** — `git commit -m "feat(book-templates): manage/rename on the General Book side; save-as-template moves into the Word flow"`

---

### Task 11: Keep the Signing Manager with a library template

**Files:**
- Modify: `frontend/src/components/application/TemplateForm.tsx:395-399` + helper text near the manager field
- Modify: `frontend/src/locales/{en,ar}.json`
- Test: `frontend/src/components/application/TemplateForm.test.tsx` (extend if exists, else create minimal)

- [ ] **Step 1: Failing test**

```tsx
it('keeps the signing manager picker when a template is selected (word mode)', () => {
  renderGeneralBookForm({ bodyMode: 'word', templateName: 'الصيانة.docx' })
  expect(screen.getByLabelText(/signing manager|المدير الموقع/i)).toBeInTheDocument()
  expect(screen.queryByLabelText(/to \(recipient\)/i)).not.toBeInTheDocument() // recipient stays hidden
})
```

- [ ] **Step 2: Run** → FAIL (manager hidden).

- [ ] **Step 3: Implement** — `TEMPLATE_BAKED_TYPES`: remove `'manager_picker'` (recipient/CC stay baked):

```tsx
const TEMPLATE_BAKED_TYPES = new Set(['recipient_picker', 'recipient_multi_picker'])
```

Under the manager field, when `wordMode && templateName`, render `<p className="text-[0.72em] text-muted-foreground">{t('books.word.managerWithTemplate')}</p>` — EN "Used for approval and the signature placement — the template's printed closing stays as-is." / AR "يُستخدم للاعتماد وموضع التوقيع — والخاتمة المطبوعة في القالب تبقى كما هي." (Find where the manager field renders its existing hint at TemplateForm/field-renderer level and attach beside it; if per-field hints aren't structured, render the note in the template-picker block instead — smallest diff wins.)

- [ ] **Step 4: Run** tests + tsc → PASS.
- [ ] **Step 5: Commit** — `git commit -m "fix(word-books): library template keeps the signing-manager picker — approvals get a default approver again"`

---

### Task 12: Records identity + action cleanup for Word books

**Files:**
- Modify: `frontend/src/pages/books/formKind.ts`
- Modify: `frontend/src/pages/books/RecordPane.tsx:116-117,207-209`
- Modify: `frontend/src/pages/books/BookRecordPage.tsx` (find `formKindOf`/`subjectEmployeePart` + `BookWordActions isMobile` usages)
- Modify: `frontend/src/pages/books/BooksPage.tsx` + `frontend/src/pages/books/BooksFilterBar.tsx` (remaining `formKindOf` call sites — grep `formKindOf|subjectEmployeePart` and update ALL)
- Modify: `frontend/src/locales/{en,ar}.json`
- Test: `frontend/src/pages/books/formKind.test.ts` (extend/create)

- [ ] **Step 1: Failing tests**

```ts
import { formKindOf, subjectEmployeePart } from './formKind'

it('classified books are General Book, never chopped', () => {
  const kind = formKindOf('طلب صيانة أجهزة التكييف — تجربة', { classified: true })
  expect(kind.labelKey).toBe('books.formKind.generalBook')
})

it('classified subject is shown whole', () => {
  expect(subjectEmployeePart('طلب صيانة — تجربة', { classified: true })).toBe('طلب صيانة — تجربة')
})

it('generated-form subjects still split', () => {
  expect(subjectEmployeePart('Leave Application Form — Saif Rashed')).toBe('Saif Rashed')
})
```

- [ ] **Step 2: Run** → FAIL (no options param).

- [ ] **Step 3: Implement**

`formKind.ts`:

```ts
export interface FormKindOpts {
  /** Classified General Books (classification_code set) carry a REAL subject —
   * never parse it as "<form> — <employee>". */
  classified?: boolean
}

export const GENERAL_BOOK_KIND: FormKind = {
  id: 'general_book',
  glyph: '📓',
  labelKey: 'books.formKind.generalBook',
  prefixes: [],
}

export function formKindOf(subject: string | null | undefined, opts?: FormKindOpts): FormKind {
  if (opts?.classified) return GENERAL_BOOK_KIND
  // …existing body unchanged…
}

export function subjectEmployeePart(subject: string | null | undefined, opts?: FormKindOpts): string {
  if (opts?.classified) return (subject ?? '').trim()
  // …existing body unchanged…
}
```

`FormKind` shape verified (formKind.ts:11-18: `id`/`glyph`/`labelKey`/`prefixes`; labelKey namespace is `books.formKind.*`). Call sites to update with `{ classified: !!row.classification_code }` (verified by grep): `RecordPane.tsx:116-117`, `RecordsList.tsx:83-84`, `BooksPage.tsx:276` (bucket counts) and `BooksPage.tsx:318,327` (rail filtering). **Also register the new kind in the rail's bucket list** — `BooksPage.tsx:288` hardcodes `const ordered: FormKind[] = [...FORM_KINDS, OTHER_KIND]`; insert `GENERAL_BOOK_KIND` before `OTHER_KIND` or classified books match no rail bucket and vanish from filtered views. `recordsBasket.ts:49` also calls `subjectEmployeePart` (email-basket employee name) — leave it WITHOUT opts: its behavior for classified books is a pre-existing quirk out of scope. Keys: `books.formKind.generalBook` EN "General Book" / AR "كتاب عام" (matches the short-noun style of `books.formKind.*` in ar.json:882-891).

RecordPane/BookRecordPage cleanup in the same task:
1. `RecordPane.tsx:207-209` — hide the rich "Continue Draft" for word-authored books:

```tsx
const latestVersion = book.versions?.[book.versions.length - 1]
const isWordBook = latestVersion != null && !latestVersion.has_fields
…
{state === 'none' && !isWordBook && (
  <PaneBtn primary onClick={() => onContinueDraft(book.id)}>{t('books.pane.continueDraft')}</PaneBtn>
)}
```

(If `RecordPane`'s `book` object lacks `versions` in the list payload, check what `BookRead` the pane receives — the audit showed `book.versions` populated on the detail fetch; if the pane's list rows lack versions, gate on `book.classification_code != null && book.signing_path == null` as the word-book proxy and leave a `ponytail:` comment naming the ceiling.)
2. `BookRecordPage.tsx` — `BookWordActions isMobile` must be the real device check: `const isMobile = useIsMobile()` (import from `@/lib/useIsMobile`) instead of a hardcoded `true`/page identity, so desktop users get a working "Edit in Word" on the full record page.
3. Word-mode duplicate hint: in `TemplateForm.tsx` the note `books.word.bodyInWord` renders twice (the `note` beside classification AND the footer paragraph). Keep the footer only — delete the note block beside classification.
4. Verify with a vitest render (RecordPane or formKind tests suffice — pane-level snapshot tests are overkill here).

- [ ] **Step 4: Run** `pnpm -C frontend test` + `tsc -b --noEmit` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "fix(records): word General Books get their real identity — full subject, General Book label, honest actions"`

---

### Task 13: Full gates + bilingual sweep

- [ ] **Step 1:** `venv\Scripts\python.exe -m pytest` (expect ~618 + new, all green) · `venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .` · `venv\Scripts\mypy.exe`
- [ ] **Step 2:** `pnpm -C frontend test` · `pnpm -C frontend run lint` · `pnpm -C frontend exec tsc -b --noEmit`
- [ ] **Step 3:** en/ar key-parity check for every key added in Tasks 8-12 (grep each new key in BOTH locale files).
- [ ] **Step 4:** `git status` — confirm no `backend/templates/*.docx` churn is staged; revert if present.
- [ ] **Step 5:** Commit any stragglers; the branch is now review-ready.

---

## Process after the plan (per user instruction)

1. **3-agent plan challenge** — DONE 2026-07-19 (executed as three inline adversarial passes when the subagent session limit blocked dispatch; lenses: backend correctness, UX/product, i18n/RTL+security). Findings folded into the tasks above: attachment re-merge + `_rel` fallback + local imports (Task 2), preview cache without `os.replace` + editing-dir cleanup + `encoding=base64` support (Task 4), browser-neutral dialog copy (Task 8), `max-w-3xl` + no extra converting-indicator (Task 9), `.docx` stripped in template UI (Task 10), `books.formKind.*` namespace + rail bucket registration at BooksPage.tsx:288 (Task 12). Verified non-issues: DAV can't leak preview files (dav.py:81), PDF conversions are globally serialized (_pdf_executor max_workers=1), `db_session`/`AppError.code`/`http_status` match the planned tests.
2. **Build** with subagent-driven TDD per task above, on branch `feature/word-book-fixes`.
3. **3-agent review loop** (after build): `i18n-rtl-reviewer` + two general code reviewers (one adversarial on the signing/preview backend, one on the frontend flows). Fix → re-review → repeat until no MUST-FIX findings.
4. Merge to `main`, push to `origin/main` (live checkout rule). Deploy is the user's call (`mng deploy`).

## Verification checklist (manual, after deploy or in sandbox)

- Create Word book (with + without library template) → Open in Word via the button → save → live preview appears and updates → Finish (spinner) → finished PDF.
- Save as template from the finished dialog; rename it via the picker's gear; create a new book from the renamed template.
- Submit for approval (manager preselected even with a template) → Sign → signed PDF **contains the authored body** with the signature above the closing name.
- Sign as a user with no `User.signature_path` but a Submitter G-number signature → succeeds.
- Records: book shows "كتاب عام/General Book" + full subject; no rich "Continue editing" on Word books; desktop full-record page offers Edit in Word.
- Arabic locale end-to-end: no English leaks in the new strings.
