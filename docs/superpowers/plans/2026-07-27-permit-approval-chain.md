# Permit Approval Chain (no auto-sign) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permit 1/5 letters stop embedding the manager signature at generation; they ride the existing book approval chain (submit → manager approves → signature stamped at sign time), with an operator-facing "Send for approval" switch (default OFF) on create, a manual send button + state badge on the permit detail, and auto-resubmit on regeneration when already in the loop.

**Architecture:** Backend removes `force_manager_embed` from the permit book pipeline and adds a small submit helper in `permit_service` that calls the existing `book_service.submit_for_approval` (approver resolves from `Book.doc_manager_id → Manager.user_id`). `PermitCreate` gains `send_for_approval` (default False); `regenerate_permit_book` gains a `submit` kwarg and a prior-state capture that auto-resubmits when the book was `pending`/`approved`. A new `POST /permits/{id}/submit-approval` endpoint backs the manual button. `PermitRead` exposes the linked book's `approval_state`. Frontend: a generic `ToggleRow` switch in the create form, badge + send button in the detail dialog.

**Tech Stack:** FastAPI + SQLAlchemy + Pydantic (backend), pytest; React 19 + React Query + i18next (frontend), vitest.

**Spec:** `docs/superpowers/specs/2026-07-27-permit-approval-chain-design.md`

## Global Constraints

- Work on branch `feature/permit-approval-chain` off `main` (this checkout is live production; never develop directly on main). Prefer a worktree under `.claude/worktrees/` per superpowers:using-git-worktrees.
- All Python via `venv\Scripts\python.exe`; frontend via `pnpm -C frontend`.
- Gates are strict: `mypy` is strict, pytest runs with `filterwarnings=error`, eslint + `tsc -b --noEmit` must stay clean.
- Book approval states are exactly: `none | pending | approved | rejected | returned` (see `book_service._recompute_approval_state`). Use these strings verbatim.
- `book_service.submit_for_approval` signature (do not change it):
  `submit_for_approval(db, book_id, *, priority: str, approver_user_id: int | None, reviewer_user_ids: Sequence[int], submitted_by_user_id: int) -> Book` — priority literal values are `"Normal" | "High"`; permits always pass `"Normal"`, `approver_user_id=None`, `reviewer_user_ids=[]`.
- Arabic copy (user-facing, use verbatim — see Task 6/7): switch label «إرسال للاعتماد», badge states «مسودة / بانتظار الاعتماد / معتمد / مرفوض / مُعاد», toast «أُرسل للاعتماد».
- `backend/templates/*.docx` churn: if `git status` shows modified templates you did not edit, revert them before committing.

---

### Task 1: Remove the auto-sign (no more `force_manager_embed`)

**Files:**
- Modify: `backend/app/services/permit_service.py` (`regenerate_permit_book`, ~line 292-336)
- Modify: `backend/app/services/document_service.py` (drop the `force_manager_embed` param, def ~line 939, use ~line 1021)
- Rewrite: `backend/tests/test_permit_manager_signature.py`

**Interfaces:**
- Consumes: existing `document_service.generate_document`.
- Produces: `generate_document` WITHOUT the `force_manager_embed` kwarg (later tasks and any caller must not pass it); permit letters render with `manager_sig_embedded=False`.

- [ ] **Step 1: Flip the signature test to assert NO embed**

Replace the module docstring and the final test of `backend/tests/test_permit_manager_signature.py` (keep `_minimal_png`, `_seed_gs`, `gen_env`, `_make_manager_with_sig`, `_payload` exactly as they are):

```python
"""Permit letters must NOT embed the manager signature at generation.

The signature is applied by the book approval chain at sign time
(book_service.sign_book). Even with a manager selected AND a signature file on
disk, the generated version stays unsigned so it can be submitted for approval.
"""
```

and replace `test_permit_book_embeds_manager_signature` with:

```python
def test_permit_book_stays_unsigned(gen_env: tuple[Session, Any]) -> None:
    """manager_sig_embedded must be False on the permit's book version even when
    the permit has manager_id pointing to a manager with a signature on disk —
    signing now happens via the approval chain, not at generation."""
    from app.db.models import Book

    db, settings = gen_env
    mgr = _make_manager_with_sig(db, settings)

    permit = permit_service.create_permit(db, _payload(manager_id=mgr.id))
    assert permit.book_id is not None, "book must still be generated"

    book = db.get_one(Book, permit.book_id)
    assert book.versions, "book must have at least one version"
    latest = max(book.versions, key=lambda v: v.version_no)
    assert latest.manager_sig_embedded is False, (
        "the permit letter must stay unsigned at generation; the approval chain "
        "embeds the signature at sign time"
    )
```

- [ ] **Step 2: Run it to verify it FAILS (auto-sign still on)**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_permit_manager_signature.py -v`
Expected: FAIL — `manager_sig_embedded` is `True`.

- [ ] **Step 3: Remove `force_manager_embed` end to end**

In `backend/app/services/permit_service.py` `regenerate_permit_book`, delete the line:

```python
        force_manager_embed=permit.manager_id is not None,
```

and update the function docstring — replace the sentence fragment `manager signature, PDF` with `Arabic letterhead, PDF` and append to the docstring body:

```
    The letter is generated UNSIGNED — the manager signature is applied by the
    book approval chain at sign time (book_service.sign_book).
```

In `backend/app/services/document_service.py`:
- delete the parameter `force_manager_embed: bool = False,` from `generate_document`'s signature (~line 939);
- change (~line 1021)

```python
    if not optional_manager_signature:
        embed_signature["manager"] = signing_path == "auto" or force_manager_embed
```

to

```python
    if not optional_manager_signature:
        embed_signature["manager"] = signing_path == "auto"
```

- if `generate_document`'s docstring mentions `force_manager_embed`, delete that paragraph.

- [ ] **Step 4: Verify nothing references it and tests pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_permit_manager_signature.py backend/tests/test_permit_book_generation.py -v` — Expected: PASS.
Then grep: `force_manager_embed` must have ZERO hits under `backend/` (excluding `backend/app/static/`).

- [ ] **Step 5: Lint + typecheck + commit**

Run: `venv\Scripts\ruff.exe check backend` and `venv\Scripts\mypy.exe` — both clean.

```bash
git add backend/app/services/permit_service.py backend/app/services/document_service.py backend/tests/test_permit_manager_signature.py
git commit -m "feat(permits): stop auto-embedding the manager signature in permit letters

The 1/5 letter now renders unsigned; the signature will be applied by the
book approval chain at sign time. Removes the force_manager_embed escape
hatch from generate_document (permits were its only caller)."
```

---

### Task 2: `send_for_approval` flag — auto-submit on create

**Files:**
- Modify: `backend/app/schemas/permit.py` (`PermitCreate`, ~line 130)
- Modify: `backend/app/services/permit_service.py` (new `_submit_book` helper; `regenerate_permit_book` gains `submit` kwarg; `create_permit` threads the flag)
- Create: `backend/tests/test_permit_approval_flow.py`

**Interfaces:**
- Consumes: `book_service.submit_for_approval` (signature in Global Constraints); `ValidationFailedError` from `app.api.errors` (attrs: `.code`, `.message`).
- Produces: `permit_service._submit_book(db, permit, *, actor) -> None` (best-effort, audits `permit.book_submitted` / `permit.book_submit_failed`); `regenerate_permit_book(db, permit, *, actor=None, submit: bool = False)`; `PermitCreate.send_for_approval: bool = False`. Tasks 3–4 build on these exact names.

- [ ] **Step 1: Write the failing tests**

Create `backend/tests/test_permit_approval_flow.py`:

```python
"""Permit letters ride the book approval chain (spec 2026-07-27).

Create-time behavior: send_for_approval=False (default) leaves the letter a
draft; True submits it to the permit's manager. A manager without a linked
login account must NOT fail the permit mutation — the book stays draft and an
audit row records why.
"""

from __future__ import annotations

from datetime import date
from typing import Any

import pytest
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import AuditLog, Book, BookCategory, Manager, User
from app.schemas.permit import PermitCreate
from app.services import document_service, permit_service


def _seed_gs(db: Session) -> None:
    if db.get(BookCategory, "GS") is None:
        db.add(BookCategory(id="GS", prefix="GS"))
        db.commit()


@pytest.fixture()
def gen_env(db_session: Session, tmp_path: Any, monkeypatch: pytest.MonkeyPatch) -> Session:
    """Point document_service at a tmp data dir and stub the PDF chain."""
    from app.config import Settings

    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda p: None)
    _seed_gs(db_session)
    return db_session


def _actor(db: Session) -> User:
    u = User(email="op@x.ae", password_hash="x", role="admin", status="active")
    db.add(u)
    db.commit()
    db.refresh(u)
    return u


def _linked_manager(db: Session) -> tuple[Manager, User]:
    u = User(email="mgr@x.ae", password_hash="x", role="admin", status="active")
    db.add(u)
    db.commit()
    db.refresh(u)
    m = Manager(name_en="Boss", user_id=u.id)
    db.add(m)
    db.commit()
    db.refresh(m)
    return m, u


def _payload(**kw: Any) -> PermitCreate:
    base: dict[str, Any] = dict(
        company="ACME",
        zones=["green"],
        start_date=date(2026, 7, 1),
        end_date=date(2026, 8, 1),
        people=[{"name": "Ali", "uae_id": "784-1", "nationality": "مصر"}],
        vehicles=[],
    )
    base.update(kw)
    return PermitCreate(**base)


def _latest_version(db: Session, book_id: int):  # noqa: ANN202 - test helper
    book = db.get_one(Book, book_id)
    return book, max(book.versions, key=lambda v: v.version_no)


def _audit_actions(db: Session) -> list[str]:
    return list(db.scalars(select(AuditLog.action)))


def test_create_without_flag_stays_draft(gen_env: Session) -> None:
    db = gen_env
    _actor(db)
    mgr, _ = _linked_manager(db)
    permit = permit_service.create_permit(db, _payload(manager_id=mgr.id), actor="op@x.ae")
    book, latest = _latest_version(db, permit.book_id)
    assert book.approval_state == "none"
    assert latest.approval_steps == []
    assert "permit.book_submitted" not in _audit_actions(db)


def test_create_with_flag_submits_to_manager(gen_env: Session) -> None:
    db = gen_env
    _actor(db)
    mgr, mgr_user = _linked_manager(db)
    permit = permit_service.create_permit(
        db, _payload(manager_id=mgr.id, send_for_approval=True), actor="op@x.ae"
    )
    book, latest = _latest_version(db, permit.book_id)
    assert book.approval_state == "pending"
    steps = sorted(latest.approval_steps, key=lambda s: s.step_order)
    assert steps and steps[0].assignee_user_id == mgr_user.id
    assert steps[0].state == "pending"
    assert "permit.book_submitted" in _audit_actions(db)


def test_create_flag_with_unlinked_manager_leaves_draft(gen_env: Session) -> None:
    """APPROVER_REQUIRED must not blow up permit creation — draft + audit."""
    db = gen_env
    _actor(db)
    m = Manager(name_en="Names Only")  # no user_id
    db.add(m)
    db.commit()
    db.refresh(m)
    permit = permit_service.create_permit(
        db, _payload(manager_id=m.id, send_for_approval=True), actor="op@x.ae"
    )
    book, _ = _latest_version(db, permit.book_id)
    assert book.approval_state == "none"
    assert "permit.book_submit_failed" in _audit_actions(db)
```

- [ ] **Step 2: Run to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_permit_approval_flow.py -v`
Expected: FAIL — `PermitCreate` has no field `send_for_approval` (pydantic `ValidationError`) / attribute errors.

- [ ] **Step 3: Implement**

`backend/app/schemas/permit.py` — in `PermitCreate`, after `manager_id: int | None = None` add:

```python
    # When True, the generated 1/5 letter is submitted straight into the book
    # approval chain. Default False = leave it a draft for double-checking.
    send_for_approval: bool = False
```

`backend/app/services/permit_service.py` — add after `_letter_dicts` (before `regenerate_permit_book`):

```python
def _submit_book(db: Session, permit: Permit, *, actor: str | None) -> None:
    """Send the permit's letter into the book approval chain. Best-effort on the
    auto paths: a failure (e.g. the manager has no login account) leaves the
    book a draft and audits why — the permit mutation itself stands."""
    from app.services import book_service

    submitter = db.scalar(select(User).where(User.email == actor)) if actor else None
    if permit.book_id is None or submitter is None:
        reason = "NO_BOOK" if permit.book_id is None else "NO_SUBMITTER"
        _audit(db, "permit.book_submit_failed", permit.id, actor, {"error": reason})
        return
    try:
        book_service.submit_for_approval(
            db,
            permit.book_id,
            priority="Normal",
            approver_user_id=None,
            reviewer_user_ids=[],
            submitted_by_user_id=submitter.id,
        )
    except ValidationFailedError as exc:
        log.warning("permit %s: book submit failed: %s", permit.id, exc.message)
        _audit(db, "permit.book_submit_failed", permit.id, actor, {"error": exc.code})
        return
    _audit(db, "permit.book_submitted", permit.id, actor, {"book_id": permit.book_id})
```

`regenerate_permit_book` — change the signature to

```python
def regenerate_permit_book(
    db: Session, permit: Permit, *, actor: str | None = None, submit: bool = False
) -> None:
```

and append at the end of the function (after the `_audit(db, "permit.book_generated", ...)` line):

```python
    if submit:
        _submit_book(db, permit, actor=actor)
```

`create_permit` — change its `regenerate_permit_book(db, row, actor=actor)` call to:

```python
    regenerate_permit_book(db, row, actor=actor, submit=payload.send_for_approval)
```

- [ ] **Step 4: Run to verify they pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_permit_approval_flow.py backend/tests/test_permit_manager_signature.py backend/tests/test_permit_book_generation.py backend/tests/test_permits_service.py -v`
Expected: ALL PASS.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `venv\Scripts\ruff.exe check backend` and `venv\Scripts\mypy.exe` — clean.

```bash
git add backend/app/schemas/permit.py backend/app/services/permit_service.py backend/tests/test_permit_approval_flow.py
git commit -m "feat(permits): send_for_approval switch submits the new letter into the approval chain

Create accepts send_for_approval (default False = draft). Submission is
best-effort on the auto path: an unlinked manager audits
permit.book_submit_failed and leaves the letter a draft."
```

---

### Task 3: Regeneration auto-resubmits when already in the loop

**Files:**
- Modify: `backend/app/services/permit_service.py` (`regenerate_permit_book`)
- Test: `backend/tests/test_permit_approval_flow.py` (append)

**Interfaces:**
- Consumes: `_submit_book`, `regenerate_permit_book(submit=...)` from Task 2.
- Produces: regeneration rule — resubmit iff `submit=True` OR the book's `approval_state` was `pending`/`approved` before regeneration. `rejected`/`returned`/`none` are NOT auto-resubmitted (they land as a fresh draft via `generate_document`'s existing revise semantics).

**Revise-path reality (this shapes the code):** `generate_document(revise_of_book_id=...)` refuses `pending`/`approved` books (`BOOK_NOT_REVISABLE`); `none` books are re-rendered IN PLACE (same version_no); `returned`/`rejected`/`awaiting_scan` books get a fresh appended version and the book resets to `approval_state="none"`. So before regenerating, a `pending` book is *withdrawn* (steps cleared → draft, then edited in place) and an `approved` book is flipped to `returned` (so the signed version is preserved and a fresh version is appended). All approval queries go through the book's CURRENT version only, and `BookVersion.approval_steps` has delete-orphan cascade, so `clear()` deletes the stale step rows.

- [ ] **Step 1: Append the failing tests**

Append to `backend/tests/test_permit_approval_flow.py`:

```python
def _set_state(db: Session, book_id: int, state: str) -> None:
    db.get_one(Book, book_id).approval_state = state
    db.commit()


def test_regen_resubmits_when_pending(gen_env: Session) -> None:
    """A pending letter is withdrawn, re-rendered in place (draft-edit path,
    same single version), and resubmitted — no stale steps left behind."""
    from app.schemas.permit import PermitVehicleCreate

    db = gen_env
    _actor(db)
    mgr, mgr_user = _linked_manager(db)
    permit = permit_service.create_permit(
        db, _payload(manager_id=mgr.id, send_for_approval=True), actor="op@x.ae"
    )
    permit_service.add_vehicle(
        db, permit.id, PermitVehicleCreate(plate_no="A 1"), actor="op@x.ae"
    )
    book, latest = _latest_version(db, permit.book_id)
    assert len(book.versions) == 1  # in-place draft edit, no version churn
    assert book.approval_state == "pending"
    steps = sorted(latest.approval_steps, key=lambda s: s.step_order)
    assert len(steps) == 1  # fresh chain only — the withdrawn step is gone
    assert steps[0].assignee_user_id == mgr_user.id
    assert steps[0].state == "pending"


def test_regen_resubmits_when_approved(gen_env: Session) -> None:
    """An approved (signed) letter is never edited in place — a fresh version
    is appended (history kept) and immediately resubmitted."""
    from app.schemas.permit import PermitPersonCreate

    db = gen_env
    _actor(db)
    mgr, _ = _linked_manager(db)
    permit = permit_service.create_permit(
        db, _payload(manager_id=mgr.id, send_for_approval=True), actor="op@x.ae"
    )
    _set_state(db, permit.book_id, "approved")
    permit_service.add_person(
        db, permit.id, PermitPersonCreate(name="Omar", uae_id="784-2"), actor="op@x.ae"
    )
    book, latest = _latest_version(db, permit.book_id)
    assert len(book.versions) == 2  # prior (signed) version preserved
    assert book.approval_state == "pending"
    assert any(s.state == "pending" for s in latest.approval_steps)


def test_regen_after_rejection_lands_as_fresh_draft(gen_env: Session) -> None:
    """No auto-resubmit after a rejection: the edit produces a fresh draft
    version (generate_document's revise semantics reset the book to 'none');
    the operator reviews and explicitly resends via the button."""
    from app.schemas.permit import PermitPersonCreate

    db = gen_env
    _actor(db)
    mgr, _ = _linked_manager(db)
    permit = permit_service.create_permit(
        db, _payload(manager_id=mgr.id, send_for_approval=True), actor="op@x.ae"
    )
    _set_state(db, permit.book_id, "rejected")
    permit_service.add_person(
        db, permit.id, PermitPersonCreate(name="Omar", uae_id="784-2"), actor="op@x.ae"
    )
    book, latest = _latest_version(db, permit.book_id)
    assert book.approval_state == "none"  # fresh draft — NOT auto-resubmitted
    assert latest.approval_steps == []


def test_regen_never_sent_stays_draft(gen_env: Session) -> None:
    from app.schemas.permit import PermitVehicleCreate

    db = gen_env
    _actor(db)
    mgr, _ = _linked_manager(db)
    permit = permit_service.create_permit(db, _payload(manager_id=mgr.id), actor="op@x.ae")
    permit_service.add_vehicle(
        db, permit.id, PermitVehicleCreate(plate_no="A 1"), actor="op@x.ae"
    )
    book, _ = _latest_version(db, permit.book_id)
    assert book.approval_state == "none"
```

- [ ] **Step 2: Run to verify the resubmit tests fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_permit_approval_flow.py -v`
Expected: `test_regen_resubmits_when_pending` and `test_regen_resubmits_when_approved` FAIL — with the code as-is they crash with `BOOK_NOT_REVISABLE` from `generate_document` (a pending/approved book cannot be revised). `test_regen_after_rejection_lands_as_fresh_draft` and `test_regen_never_sent_stays_draft` already pass.

- [ ] **Step 3: Implement withdraw + prior-state rule**

In `regenerate_permit_book`, at the very top of the function body (before the imports of `permit_letter`/`document_service`), add:

```python
    # A letter already in the approval loop needs the manager's signature again
    # after any content change — void the stale submission BEFORE regenerating
    # (generate_document refuses to revise a pending/approved book), remember
    # the prior state, and resubmit the regenerated letter below.
    prior_state: str | None = None
    if permit.book_id is not None:
        prior = db.get(Book, permit.book_id)
        prior_state = prior.approval_state if prior is not None else None
        if prior is not None and prior_state == "pending":
            # Withdraw: drop the stale request outright so the letter falls
            # back to the draft-edit path (in-place re-render, same version).
            cur = prior.versions[-1] if prior.versions else None
            if cur is not None:
                cur.approval_steps.clear()
                cur.status = "none"
            prior.approval_state = "none"
            prior.submitted_by_user_id = None
            db.flush()
        elif prior is not None and prior_state == "approved":
            # A signed letter is never edited in place — mark it revisable so
            # generate_document appends a fresh version (the signed one stays
            # in history); the fresh version is resubmitted below.
            prior.approval_state = "returned"
            db.flush()
```

and change the Task 2 tail to:

```python
    if submit or prior_state in ("pending", "approved"):
        _submit_book(db, permit, actor=actor)
```

Also update the docstring line added in Task 1 to:

```
    The letter is generated UNSIGNED — the manager signature is applied by the
    book approval chain at sign time. A regeneration withdraws + auto-resubmits
    when the book was already pending/approved; rejected/returned/never-sent
    land as a fresh draft for the operator to resend manually.
```

- [ ] **Step 4: Run to verify all pass**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_permit_approval_flow.py -v` — Expected: PASS.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `venv\Scripts\ruff.exe check backend` and `venv\Scripts\mypy.exe` — clean.

```bash
git add backend/app/services/permit_service.py backend/tests/test_permit_approval_flow.py
git commit -m "feat(permits): roster changes re-send an in-loop letter for approval

Regeneration captures the book's approval_state beforehand: pending/approved
auto-resubmit the new version; rejected/returned wait for an explicit resend."
```

---

### Task 4: Manual submit endpoint + `approval_state` on PermitRead

**Files:**
- Modify: `backend/app/services/permit_service.py` (new `submit_permit_book`; extend `to_read`)
- Modify: `backend/app/schemas/permit.py` (`PermitRead`)
- Modify: `backend/app/api/v1/permits.py` (new route + docstring route list)
- Test: `backend/tests/test_permit_approval_flow.py` (append)

**Interfaces:**
- Consumes: `_submit_book`'s building blocks (Task 2); `get_permit`, `to_read`.
- Produces: `permit_service.submit_permit_book(db, permit_id, *, actor=None) -> Permit` (raises `ValidationFailedError` — never swallows); `PermitRead.approval_state: str | None`; `POST /permits/{permit_id}/submit-approval` → `PermitRead` (gate `permits.manage`). Tasks 5–7 rely on the route path and field name exactly.

- [ ] **Step 1: Append the failing tests**

Append to `backend/tests/test_permit_approval_flow.py`:

```python
def test_manual_submit_happy_path(gen_env: Session) -> None:
    db = gen_env
    _actor(db)
    mgr, _ = _linked_manager(db)
    permit = permit_service.create_permit(db, _payload(manager_id=mgr.id), actor="op@x.ae")
    row = permit_service.submit_permit_book(db, permit.id, actor="op@x.ae")
    book, _ = _latest_version(db, permit.book_id)
    assert book.approval_state == "pending"
    read = permit_service.to_read(row, db=db)
    assert read.approval_state == "pending"


def test_manual_submit_unlinked_manager_raises(gen_env: Session) -> None:
    from app.api.errors import ValidationFailedError

    db = gen_env
    _actor(db)
    m = Manager(name_en="Names Only")
    db.add(m)
    db.commit()
    db.refresh(m)
    permit = permit_service.create_permit(db, _payload(manager_id=m.id), actor="op@x.ae")
    with pytest.raises(ValidationFailedError):
        permit_service.submit_permit_book(db, permit.id, actor="op@x.ae")


def test_manual_submit_revoked_raises(gen_env: Session) -> None:
    from app.api.errors import ValidationFailedError

    db = gen_env
    _actor(db)
    mgr, _ = _linked_manager(db)
    permit = permit_service.create_permit(db, _payload(manager_id=mgr.id), actor="op@x.ae")
    permit_service.revoke_permit(db, permit.id, actor="op@x.ae")
    with pytest.raises(ValidationFailedError):
        permit_service.submit_permit_book(db, permit.id, actor="op@x.ae")


def test_to_read_exposes_draft_state(gen_env: Session) -> None:
    db = gen_env
    _actor(db)
    mgr, _ = _linked_manager(db)
    permit = permit_service.create_permit(db, _payload(manager_id=mgr.id), actor="op@x.ae")
    read = permit_service.to_read(permit, db=db)
    assert read.approval_state == "none"
```

- [ ] **Step 2: Run to verify they fail**

Run: `venv\Scripts\python.exe -m pytest backend/tests/test_permit_approval_flow.py -v`
Expected: the four new tests FAIL (`submit_permit_book` missing / `approval_state` missing).

- [ ] **Step 3: Implement**

`backend/app/schemas/permit.py` — in `PermitRead`, after `book_ref: str | None = None` add:

```python
    # The linked book's approval state, verbatim:
    # none | pending | approved | rejected | returned. None when no book.
    approval_state: str | None = None
```

`backend/app/services/permit_service.py` — in `to_read`, replace the book-fetch branch:

```python
    book_ref: str | None = None
    approval_state: str | None = None
    if db is not None and row.book_id is not None:
        b = db.get(Book, row.book_id)
        book_ref = b.ref_number if b is not None else None
        approval_state = b.approval_state if b is not None else None
```

and add `"approval_state": approval_state,` to the `model_copy(update={...})` dict (next to `"book_ref": book_ref,`).

Add after `regenerate_permit_book`:

```python
def submit_permit_book(db: Session, permit_id: int, *, actor: str | None = None) -> Permit:
    """Manual "Send for approval". Unlike the auto paths this does NOT swallow
    chain errors — the operator sees exactly why it can't be sent (e.g. the
    manager needs a login account in Settings → Managers)."""
    from app.services import book_service

    row = get_permit(db, permit_id)
    if row.status == "revoked":
        raise ValidationFailedError(
            "PERMIT_REVOKED", "A revoked permit cannot be sent for approval.", id=permit_id
        )
    if row.book_id is None:
        raise ValidationFailedError(
            "PERMIT_NO_BOOK", "This permit has no generated letter to submit.", id=permit_id
        )
    submitter = db.scalar(select(User).where(User.email == actor)) if actor else None
    if submitter is None:
        raise ValidationFailedError(
            "SUBMITTER_UNRESOLVED", "Could not resolve the submitting user account."
        )
    book_service.submit_for_approval(
        db,
        row.book_id,
        priority="Normal",
        approver_user_id=None,
        reviewer_user_ids=[],
        submitted_by_user_id=submitter.id,
    )
    _audit(db, "permit.book_submitted", permit_id, actor, {"book_id": row.book_id})
    return get_permit(db, permit_id)
```

`backend/app/api/v1/permits.py` — add after the `revoke_permit` route:

```python
@router.post("/{permit_id}/submit-approval", response_model=PermitRead)
def submit_permit_approval(
    permit_id: int,
    db: Annotated[Session, Depends(get_db)],
    user: Annotated[User, Depends(require_capability("permits.manage"))],
) -> PermitRead:
    """Send the permit's 1/5 letter into the book approval chain."""
    row = permit_service.submit_permit_book(db, permit_id, actor=user.email)
    return permit_service.to_read(row, db=db)
```

and add to the module docstring route list:

```
  POST   /permits/{id}/submit-approval  — send the 1/5 letter for approval
```

- [ ] **Step 4: Run the full backend suite**

Run: `venv\Scripts\python.exe -m pytest` — Expected: PASS (no regressions).

- [ ] **Step 5: Lint + typecheck + commit**

Run: `venv\Scripts\ruff.exe check backend` and `venv\Scripts\mypy.exe` — clean.

```bash
git add backend/app/schemas/permit.py backend/app/services/permit_service.py backend/app/api/v1/permits.py backend/tests/test_permit_approval_flow.py
git commit -m "feat(permits): manual submit-approval endpoint + approval_state on PermitRead"
```

---

### Task 5: Resync API types + `api.ts` helper

**Files:**
- Regenerate: `frontend/src/lib/api.types.ts` (via `scripts\dump_openapi.py` + `pnpm gen:api`)
- Modify: `frontend/src/lib/api.ts` (permits section, ~line 1084)

**Interfaces:**
- Consumes: Task 2's `send_for_approval` and Task 4's `approval_state` + route (they must be committed first).
- Produces: `api.submitPermitApproval(id: number): Promise<PermitRead>`; regenerated `PermitCreate`/`PermitRead` types. Tasks 6–7 import these.

- [ ] **Step 1: Regenerate the types**

```bash
venv\Scripts\python.exe -X utf8 scripts\dump_openapi.py
```
Expected: `Wrote ...backend\openapi.json (N paths)`.

```bash
pnpm -C frontend run gen:api
```

- [ ] **Step 2: Add the API helper**

In `frontend/src/lib/api.ts`, directly after `revokePermit`:

```ts
  /** POST /permits/{id}/submit-approval — send the 1/5 letter into the approval chain. */
  submitPermitApproval: (id: number) =>
    request<PermitRead>('POST', `/permits/${id}/submit-approval`),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm -C frontend exec tsc -b --noEmit` — Expected: clean (new fields are optional/additive).

- [ ] **Step 4: Commit**

`backend/openapi.json` is gitignored in this repo — commit only the frontend files:

```bash
git add frontend/src/lib/api.types.ts frontend/src/lib/api.ts
git commit -m "chore(api): resync types for permit approval fields + submit-approval helper"
```

---

### Task 6: Create-form "Send for approval" switch

**Files:**
- Create: `frontend/src/components/ui/toggle-row.tsx`
- Modify: `frontend/src/pages/permits/PermitFormDialog.tsx`
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (`permits.form`)
- Test: `frontend/src/pages/permits/PermitFormDialog.test.tsx`

**Interfaces:**
- Consumes: `api.createPermit` typed with `send_for_approval` (Task 5).
- Produces: `ToggleRow` component `{ checked, onChange, label, hint?, className? }` — Task 7 does not use it, but future notify work may.

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/pages/permits/PermitFormDialog.test.tsx` (inside the existing `describe`; `createPermit` is already in the api mock):

```tsx
  it('send-for-approval switch defaults OFF and is sent when toggled ON', async () => {
    const created = { id: 7, people: [], vehicles: [] }
    const createSpy = vi.spyOn(api, 'createPermit').mockResolvedValue(created as never)

    renderForm()

    // Fill the minimum valid form: company + one person (name + UAE ID)
    await userEvent.type(screen.getByLabelText(/company/i), 'ACME')
    await userEvent.type(screen.getByPlaceholderText('Full name'), 'Ali')
    await userEvent.type(screen.getByPlaceholderText('UAE ID'), '784-1')

    const toggle = screen.getByRole('switch', { name: /send for approval/i })
    expect(toggle).toHaveAttribute('aria-checked', 'false')

    await userEvent.click(screen.getByRole('button', { name: /issue permit/i }))
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ send_for_approval: false }),
      ),
    )

    createSpy.mockClear()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    await userEvent.click(screen.getByRole('button', { name: /issue permit/i }))
    await waitFor(() =>
      expect(createSpy).toHaveBeenCalledWith(
        expect.objectContaining({ send_for_approval: true }),
      ),
    )
  })
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm -C frontend exec vitest run src/pages/permits/PermitFormDialog.test.tsx`
Expected: FAIL — no element with role `switch`.

- [ ] **Step 3: Implement**

Create `frontend/src/components/ui/toggle-row.tsx` (generic sibling of the notify-branch `NotifyEmployeeToggle` — same accessible switch pattern, RTL-safe logical classes):

```tsx
/**
 * ToggleRow — a labelled on/off switch row (role="switch" button, not a
 * checkbox). RTL-safe via logical `ms-auto` and a mirrored thumb translate.
 * `hint` is an optional second line under the label.
 */
import { cn } from '@/lib/utils'

interface ToggleRowProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  hint?: string
  /** Extra classes for the outer row (e.g. spacing). */
  className?: string
}

export function ToggleRow({
  checked,
  onChange,
  label,
  hint,
  className,
}: ToggleRowProps): React.JSX.Element {
  return (
    <label
      className={cn(
        'flex items-center gap-3 rounded-md border border-hairline bg-muted/20 px-3 py-2.5',
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block text-[0.85em] font-medium text-foreground">{label}</span>
        {hint !== undefined && (
          <span className="mt-0.5 block text-[0.75em] text-muted-foreground">{hint}</span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative ms-auto inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
    </label>
  )
}
```

(If `border-hairline` is not a defined class in this codebase's Tailwind theme, use `border-border` instead — check with a grep for `hairline` in `frontend/src`.)

`frontend/src/pages/permits/PermitFormDialog.tsx`:
- import: `import { ToggleRow } from '@/components/ui/toggle-row'`
- state, next to `managerId`: `const [sendForApproval, setSendForApproval] = useState(false)`
- in the open-reset effect, after `setManagerId(...)`: `setSendForApproval(false)`
- in the create `body`, after `manager_id: managerId,`: `send_for_approval: sendForApproval,`
- render directly after the signing-manager `{!isEdit && (...)}` block:

```tsx
          {/* Send for approval — default OFF so the draft can be double-checked */}
          {!isEdit && (
            <ToggleRow
              checked={sendForApproval}
              onChange={setSendForApproval}
              label={t('permits.form.sendForApproval')}
              hint={t('permits.form.sendForApprovalHint')}
            />
          )}
```

Locales — `permits.form` in `frontend/src/locales/en.json`:

```json
    "sendForApproval": "Send for approval",
    "sendForApprovalHint": "Send the letter to the signing manager right after it is generated. Leave off to double-check the draft first."
```

`permits.form` in `frontend/src/locales/ar.json`:

```json
    "sendForApproval": "إرسال للاعتماد",
    "sendForApprovalHint": "يُرسل الكتاب إلى المدير المعتمِد فور إنشائه. اتركه مطفأً لمراجعة المسودة أولاً."
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm -C frontend exec vitest run src/pages/permits/PermitFormDialog.test.tsx` — Expected: PASS.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `pnpm -C frontend run lint` and `pnpm -C frontend exec tsc -b --noEmit` — clean.

```bash
git add frontend/src/components/ui/toggle-row.tsx frontend/src/pages/permits/PermitFormDialog.tsx frontend/src/pages/permits/PermitFormDialog.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(permits): send-for-approval switch on the new-permit form (default off)"
```

---

### Task 7: Detail dialog — approval badge + Send button

**Files:**
- Modify: `frontend/src/pages/permits/permitUtils.ts`
- Modify: `frontend/src/pages/permits/PermitDetailDialog.tsx`
- Modify: `frontend/src/locales/en.json`, `frontend/src/locales/ar.json` (new `permits.approval` block + `permits.detail.sendForApproval`)
- Test: `frontend/src/pages/permits/PermitDetailDialog.test.tsx`

**Interfaces:**
- Consumes: `api.submitPermitApproval` (Task 5); `PermitRead.approval_state`.
- Produces: `approvalTone(state: PermitApprovalState): Tone` in permitUtils.

- [ ] **Step 1: Write the failing tests**

Append to `frontend/src/pages/permits/PermitDetailDialog.test.tsx` (add `submitPermitApproval: vi.fn(),` to the api mock object next to `getBook`):

```tsx
  it('draft letter shows Draft badge and Send for approval; clicking submits', async () => {
    const submitSpy = vi
      .spyOn(api, 'submitPermitApproval')
      .mockResolvedValue({ ...basePermit, book_id: 7, approval_state: 'pending' } as never)

    renderDetail({ book_id: 7, book_ref: '1/5/GSSG/0042', approval_state: 'none' })
    await waitFor(() => expect(screen.getByText('Test Corp')).toBeInTheDocument())

    expect(screen.getByText('Draft')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /send for approval/i }))
    await waitFor(() => expect(submitSpy).toHaveBeenCalledWith(99))
  })

  it('pending letter shows the Pending badge and hides the send button', async () => {
    renderDetail({ book_id: 7, book_ref: '1/5/GSSG/0042', approval_state: 'pending' })
    await waitFor(() => expect(screen.getByText('Test Corp')).toBeInTheDocument())

    expect(screen.getByText('Pending approval')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /send for approval/i }),
    ).not.toBeInTheDocument()
  })

  it('rejected letter offers to re-send', async () => {
    renderDetail({ book_id: 7, book_ref: '1/5/GSSG/0042', approval_state: 'rejected' })
    await waitFor(() => expect(screen.getByText('Test Corp')).toBeInTheDocument())

    expect(screen.getByText('Rejected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /send for approval/i })).toBeInTheDocument()
  })

  it('revoked permit hides the send button even while draft', async () => {
    renderDetail({
      book_id: 7,
      book_ref: '1/5/GSSG/0042',
      approval_state: 'none',
      status: 'revoked',
      derived_status: 'revoked',
    })
    await waitFor(() => expect(screen.getByText('Test Corp')).toBeInTheDocument())
    expect(
      screen.queryByRole('button', { name: /send for approval/i }),
    ).not.toBeInTheDocument()
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm -C frontend exec vitest run src/pages/permits/PermitDetailDialog.test.tsx`
Expected: the four new tests FAIL (no badge text, no button).

- [ ] **Step 3: Implement**

`frontend/src/pages/permits/permitUtils.ts` — append:

```ts
/** The linked book's approval state as exposed on PermitRead. */
export type PermitApprovalState = 'none' | 'pending' | 'approved' | 'rejected' | 'returned'

export function approvalTone(state: PermitApprovalState): Tone {
  switch (state) {
    case 'none':
      return 'outline'
    case 'pending':
      return 'warning'
    case 'approved':
      return 'active'
    case 'rejected':
      return 'danger'
    case 'returned':
      return 'info'
  }
}
```

`frontend/src/pages/permits/PermitDetailDialog.tsx`:
- imports: add `Send` to the lucide import; extend the permitUtils import to `{ approvalTone, fmtDate, statusTone, type PermitApprovalState }`.
- next to the `isRevoked` derivation:

```tsx
  const approvalState = (permit?.approval_state ?? 'none') as PermitApprovalState
  const canSend =
    canManage && !isRevoked && Boolean(permit?.book_id) &&
    ['none', 'rejected', 'returned'].includes(approvalState)
```

- mutation, next to the others:

```tsx
  const submitApproval = useMutation({
    mutationFn: () => api.submitPermitApproval(permitId),
    onSuccess: () => {
      invalidate()
      toast.success(t('permits.approval.sentToast'))
    },
    onError: onErr,
  })
```

- badge, in the badges row after `<ZoneBadge zones={permit.zones} full />`:

```tsx
                {permit.book_id && (
                  <Badge tone={approvalTone(approvalState)}>
                    {t(`permits.approval.${approvalState}`)}
                  </Badge>
                )}
```

- button, in the footer actions inside the `{!isRevoked && (<>...` block, BEFORE the Edit button:

```tsx
                {canSend && (
                  <Button
                    type="button"
                    disabled={submitApproval.isPending}
                    onClick={() => submitApproval.mutate()}
                  >
                    <Send className="me-1.5 h-4 w-4" aria-hidden />
                    {t('permits.detail.sendForApproval')}
                  </Button>
                )}
```

Locales — add to `permits` in `frontend/src/locales/en.json` (sibling of `status`):

```json
  "approval": {
    "none": "Draft",
    "pending": "Pending approval",
    "approved": "Approved",
    "rejected": "Rejected",
    "returned": "Returned",
    "sentToast": "Sent for approval"
  }
```

and `"sendForApproval": "Send for approval"` inside `permits.detail`.

`frontend/src/locales/ar.json`:

```json
  "approval": {
    "none": "مسودة",
    "pending": "بانتظار الاعتماد",
    "approved": "معتمد",
    "rejected": "مرفوض",
    "returned": "مُعاد",
    "sentToast": "أُرسل للاعتماد"
  }
```

and `"sendForApproval": "إرسال للاعتماد"` inside `permits.detail`.

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm -C frontend exec vitest run src/pages/permits/PermitDetailDialog.test.tsx` — Expected: PASS.

- [ ] **Step 5: Lint + typecheck + commit**

Run: `pnpm -C frontend run lint` and `pnpm -C frontend exec tsc -b --noEmit` — clean.

```bash
git add frontend/src/pages/permits/permitUtils.ts frontend/src/pages/permits/PermitDetailDialog.tsx frontend/src/pages/permits/PermitDetailDialog.test.tsx frontend/src/locales/en.json frontend/src/locales/ar.json
git commit -m "feat(permits): approval-state badge + Send for approval on the permit detail"
```

---

### Task 8: i18n parity tests + full gates + reviewers

**Files:**
- Modify: `frontend/src/locales/permits.i18n.test.ts`

**Interfaces:**
- Consumes: all keys added in Tasks 6–7.

- [ ] **Step 1: Add the new keys to the parity test**

In `frontend/src/locales/permits.i18n.test.ts`, extend `KEYS` with:

```ts
  'permits.form.sendForApproval',
  'permits.form.sendForApprovalHint',
  'permits.detail.sendForApproval',
  'permits.approval.none',
  'permits.approval.pending',
  'permits.approval.approved',
  'permits.approval.rejected',
  'permits.approval.returned',
  'permits.approval.sentToast',
```

The existing loop already asserts each key exists in BOTH locales AND `ar !== en` (the Arabic-leak guard — this is the assertion that matters, per the `i18n-tests-must-assert-arabic` lesson).

- [ ] **Step 2: Run the full suites**

```bash
venv\Scripts\python.exe -m pytest
pnpm -C frontend test
venv\Scripts\ruff.exe check . && venv\Scripts\ruff.exe format --check .
venv\Scripts\mypy.exe
pnpm -C frontend run lint
pnpm -C frontend exec tsc -b --noEmit
```
Expected: all green (the DAV flake in the backend suite is pre-existing; re-run that file if it trips).

- [ ] **Step 3: Commit**

```bash
git add frontend/src/locales/permits.i18n.test.ts
git commit -m "test(permits): i18n parity coverage for the approval-chain strings"
```

- [ ] **Step 4: Dispatch the i18n/RTL reviewer**

Bilingual surfaces changed → run the `i18n-rtl-reviewer` agent over the Task 6–7 diff (locales + the two dialogs + toggle-row). Fix any findings, re-run the frontend suite, commit fixes. (`notification-template-reviewer` is NOT needed — no notify_format/sms_templates changes.)

- [ ] **Step 5: Merge decision**

Implementation done on `feature/permit-approval-chain` — use superpowers:finishing-a-development-branch (merge to `main` + push to `origin/main` per the live-checkout rule; deploy stays a user decision via `mng deploy`/`update`).
