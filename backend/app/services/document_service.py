"""Document generation orchestration — Phase 04 chunk B.

Pipeline (in order):
  1. Validate employee + template.
  2. Determine output directory (personnel vault vs. global output).
  3. Allocate reference number via RefAllocator persisted through refs_repo.
  4. Apply manager override.
  5. Resolve submitter (Leave Undertaking only).
  6. Merge caller-supplied fields into the data dict.
  7. Strip signature paths for hand-sign slots.
  8. Fill template via DocxEngine.
  9. Stamp ref number.
  10. Convert to PDF via process-pool executor.
  11. Persist Document row.
  12. For leave forms — insert Leave row, link Document.leave_id.
  13. For violation form — insert Violation row, link Document.violation_id.
  14. Commit and return GenerationResult.
"""

from __future__ import annotations

import contextlib
import functools
import json
import logging
import re
import shutil
import uuid
from collections.abc import Callable, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime
from pathlib import Path
from typing import TYPE_CHECKING, Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.errors import AppError, NotFoundError, ValidationFailedError
from app.config import get_settings
from app.core import form_policy, leave_lifecycle
from app.core import signature as signature_core
from app.core.book_text import build_search_text, html_to_text
from app.core.classifications import classified_ref, get_classification
from app.core.constants import STAMP_STYLE_HEADER, TEMPLATE_FILES
from app.core.docx_engine import DocxEngine, aztec_corner_for
from app.core.pdf_merge import merge_attachments_into_pdf
from app.core.vault_manager import Vault
from app.db.models import (
    AuditLog,
    Book,
    BookApprovalStep,
    BookCategory,
    BookVersion,
    Document,
    Employee,
    Leave,
    Manager,
    Submitter,
    User,
    Violation,
)
from app.db.repos.classified_refs_repo import allocate_classified_serial
from app.db.repos.refs_repo import allocate_ref_with_retry
from app.services._pdf_executor import convert_docx_to_pdf

if TYPE_CHECKING:
    # Type-only: app.api.v1.documents imports this module at runtime, so a
    # real import here would be circular. The specs are plain pydantic value
    # objects — only their attributes are read.
    from app.api.v1.documents import GenerateAttachmentSpec

log = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Category map — mirrors v3 _stamp_and_record (gssg_manager.pyw line 7778)
# ---------------------------------------------------------------------------

_FORM_CATEGORY: dict[str, str] = {
    "Acknowledgment Form": "GS",
    "Salary Transfer Request": "HR",
    "Salary Deduction Form": "HR",
    "Violation Form": "NAT",
    "Warning Form": "NAT",
    "Employee Clearance Form": "HR",
    "Material Request Form": "SC",
    "Leave Application Form": "HR",
    "Passport Release Form": "HR",
    "Duty Resumption Form": "HR",
    "General Book": "GS",
    "HR Request Form": "HR",
    "Resignation Declaration": "HR",
    "Resignation Letter": "HR",
    "Leave Undertaking": "HR",
    "Leave Permit Form": "HR",
    "Administrative Leave Form": "HR",
    "Passport Release List": "HR",
}

# Short filename prefix per form — mirrors v3's fn = f"LeaveApp_..." pattern
_FORM_SHORT_NAME: dict[str, str] = {
    "Leave Application Form": "LeaveApp",
    "Leave Undertaking": "LeaveUndertaking",
    "Passport Release Form": "PassportRelease",
    "Duty Resumption Form": "DutyResumption",
    "Employee Clearance Form": "Clearance",
    "Salary Deduction Form": "SalaryDeduction",
    "Salary Transfer Request": "SalaryTransfer",
    "Violation Form": "Violation",
    "Warning Form": "Warning",
    "HR Request Form": "HRRequest",
    "Resignation Letter": "ResignationLetter",
    "Resignation Declaration": "ResignationDecl",
    "Acknowledgment Form": "Acknowledgment",
    "Material Request Form": "MRF",
    "Leave Permit Form": "LeavePermit",
    "Administrative Leave Form": "AdminLeave",
    "General Book": "GeneralBook",
    "Passport Release List": "PassportReleaseList",
}

# Forms that create a Leave row in the DB
_LEAVE_FORM_IDS: frozenset[str] = frozenset(
    {
        "Leave Application Form",
        "Duty Resumption Form",
        "Passport Release Form",
        "Leave Permit Form",
        "Administrative Leave Form",
    }
)

# Forms that log into the shared Violation records (Warning mirrors Violation)
_VIOLATION_FORM_IDS: frozenset[str] = frozenset({"Violation Form", "Warning Form"})

# Forms that require a submitter
_SUBMITTER_REQUIRED_IDS: frozenset[str] = frozenset({"Leave Undertaking"})

# Forms where a chosen submitter signs the employee cell in the applicant's
# place (their signature replaces ``employee_sig_path`` on the primary fill).
# Leave-related forms only — kept explicit so adding a submitter picker to an
# unrelated form doesn't silently swap its employee signature.
_SUBMITTER_SIGN_FORMS: frozenset[str] = frozenset(
    {"Leave Application Form", "Duty Resumption Form"}
)

# Forms where the picked submitter ALWAYS signs the employee cell — no
# employee-signature opt-in checkbox exists in their schema, so the submitter's
# signature auto-embeds (mirrors the manager auto-embed on ``auto``-path forms).
# The Employee Clearance Form is submitted on the leaving employee's behalf and
# carries only manager + submitter pickers (no signature field), so the
# submitter's signature is the only one available for the employee slot.
_SUBMITTER_AUTO_SIGN_FORMS: frozenset[str] = frozenset({"Employee Clearance Form"})


def _submitter_signs_employee_cell(
    template_id: str,
    submitter_id: int | None,
    embed_signature: dict[str, bool],
) -> bool:
    """Whether a picked submitter's signature replaces the employee cell.

    Auto-sign forms (``_SUBMITTER_AUTO_SIGN_FORMS``) embed whenever a submitter
    is picked — they carry no employee-signature checkbox. Regular
    submitter-sign forms (``_SUBMITTER_SIGN_FORMS``) still require the
    ``embed_signature.employee`` opt-in. Everything else never swaps.
    """
    if submitter_id is None:
        return False
    if template_id in _SUBMITTER_AUTO_SIGN_FORMS:
        return True
    return template_id in _SUBMITTER_SIGN_FORMS and bool(embed_signature.get("employee"))


_TEMPLATES_DIR = Path(__file__).resolve().parents[2] / "templates"
_FIELDS_JSON = _TEMPLATES_DIR / "_fields.json"

# ---------------------------------------------------------------------------
# Companion-doc rules
# Maps primary template_id → callable(data) → companion template_id | None
# ---------------------------------------------------------------------------

_COMPANION_RULES: dict[str, Callable[[dict[str, Any]], str | None]] = {
    "Resignation Letter": lambda _data: "Resignation Declaration",
    "Leave Application Form": (
        lambda data: (
            "Leave Undertaking" if str(data.get("leave_type", "")).startswith("Annual") else None
        )
    ),
}


@dataclass
class GenerationDocumentResult:
    """Describes a single generated document (primary or companion)."""

    document_id: int
    template_id: str
    role: str  # "primary" | "companion"
    ref_number: str
    docx_path: Path
    pdf_path: Path | None


@dataclass
class GenerationResult:
    submission_id: str
    ref_number: str
    leave_id: int | None
    violation_id: int | None
    documents: list[GenerationDocumentResult] = field(default_factory=list)
    book_id: int | None = None

    @property
    def document_id(self) -> int:
        """Primary document id (backward-compat helper)."""
        for d in self.documents:
            if d.role == "primary":
                return d.document_id
        return self.documents[0].document_id

    @property
    def docx_path(self) -> Path:
        for d in self.documents:
            if d.role == "primary":
                return d.docx_path
        return self.documents[0].docx_path

    @property
    def pdf_path(self) -> Path | None:
        for d in self.documents:
            if d.role == "primary":
                return d.pdf_path
        return self.documents[0].pdf_path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def companion_pdf_paths(db: Session, primary: Document) -> list[Path]:
    """Absolute PDF paths of the companions filed under ``primary``'s submission.

    Annual-leave / resignation forms auto-generate a companion (Leave Undertaking,
    Resignation Declaration) as a separate Document sharing the primary's
    ``submission_id``. Its pages are appended onto the primary's served PDF so the
    record shows one merged document, not a second paper. Returns ``[]`` when
    ``primary`` is itself a companion, has no companions, or a companion lacks a
    PDF on disk.
    """
    if primary.role == "companion":
        return []
    rows = (
        db.execute(
            select(Document)
            .where(Document.submission_id == primary.submission_id)
            .where(Document.role == "companion")
            .order_by(Document.id)
        )
        .scalars()
        .all()
    )
    data_dir = get_settings().data_dir
    out: list[Path] = []
    for doc in rows:
        if not doc.pdf_path:
            continue
        p = data_dir / doc.pdf_path
        if p.is_file():
            out.append(p)
    return out


@functools.cache
def load_fields_meta() -> dict[str, Any]:
    """Return parsed _fields.json (category, fields, …) keyed by template_id."""
    with _FIELDS_JSON.open(encoding="utf-8") as fh:
        return json.load(fh)  # type: ignore[no-any-return]


# Field types whose values are HugeRTE/TinyMCE HTML, not plain text.
_RICH_FIELD_TYPES: frozenset[str] = frozenset({"arabic_rich", "arabic_rich_full"})

# Content-independent anchor for the General Book body. The `{{ body }}` token
# renders this sentinel (instead of the flattened body text) so the
# post-process can locate the anchor paragraph by substring regardless of the
# body's content, clear it, and render the FULL body HTML via `html_to_docx`.
# Wrapped in invisible separators (U+2063) so it never shows if a render path
# ever fails to clear it.
GENERAL_BOOK_BODY_SENTINEL = "⁣GSSG_BODY_ANCHOR⁣"


def _html_to_text(html: str) -> str:
    """Flatten editor HTML to plain text, preserving block/line breaks.

    The Jinja DOCX render substitutes ``{{ body }}`` / ``{{ reason }}`` with
    the raw string, so HugeRTE HTML would otherwise appear literally (``<p>``,
    ``<span>`` …) in the document. We strip the markup to text and map block
    boundaries (``<br>``, ``</p>``, ``</div>``, ``</li>``) to newlines so
    multi-paragraph content stays readable. (Rich formatting — bold, colour,
    RTL runs — is intentionally not preserved here; see arabic_rtl.html_to_docx
    for the full fragment renderer.)
    """
    if not html or "<" not in html:
        return html or ""
    # Block-closing / break tags → newline before tags are stripped.
    text = re.sub(r"(?i)<\s*br\s*/?\s*>", "\n", html)
    text = re.sub(r"(?i)</\s*(p|div|li|tr|h[1-6]|blockquote)\s*>", "\n", text)
    text = re.sub(r"<[^>]+>", "", text)
    # Decode the handful of entities HugeRTE emits.
    text = (
        text.replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", '"')
        .replace("&#39;", "'")
    )
    # Collapse the runs of blank lines the block-boundary mapping can create.
    text = re.sub(r"\n[ \t]*\n[ \t]*\n+", "\n\n", text)
    return text.strip()


def _flatten_rich_fields(template_id: str, fields: dict[str, Any]) -> dict[str, Any]:
    """Return a copy of `fields` with any ``arabic_rich``/``arabic_rich_full``
    values flattened from HTML to plain text (see ``_html_to_text``)."""
    meta = load_fields_meta().get(template_id, {})
    rich_keys = {f["key"] for f in meta.get("fields", []) if f.get("type") in _RICH_FIELD_TYPES}
    if not rich_keys:
        return fields
    out = dict(fields)
    for key in rich_keys:
        val = out.get(key)
        if isinstance(val, str):
            # General Book routes its WHOLE body through html_to_docx (narrative
            # formatting + inline runs + real Word tables, in order). Thread the
            # raw HTML as body_html and set the {{ body }} token to a
            # content-independent sentinel so _pp_general_book can locate the
            # anchor paragraph and render the body there. Other templates /
            # other rich keys keep flattening to plain text.
            if template_id == "General Book" and key == "body":
                out["body_html"] = val
                out[key] = GENERAL_BOOK_BODY_SENTINEL
            else:
                out[key] = _html_to_text(val)
    return out


def _parse_date_str(val: Any) -> date:
    """Parse a date value (date, datetime, or string) into a date object."""
    if isinstance(val, date) and not isinstance(val, datetime):
        return val
    if isinstance(val, datetime):
        return val.date()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(str(val), fmt).date()
        except (ValueError, TypeError):
            pass
    return datetime.now().date()


def _build_docx_filename(template_id: str, name_en: str, ts: datetime) -> str:
    """Build a filename matching v3's pattern: {ShortName}_{name_short}_{timestamp}.docx"""
    short = _FORM_SHORT_NAME.get(template_id, template_id.replace(" ", ""))
    name_short = name_en.replace(" ", "_")[:20] or "General"
    timestamp = ts.strftime("%Y%m%d_%H%M")
    return f"{short}_{name_short}_{timestamp}.docx"


def _output_dir_for_admin(template_id: str) -> Path:
    """Global output directory for admin/General Book forms."""
    settings = get_settings()
    out = settings.data_dir / "output" / template_id.replace(" ", "_")
    out.mkdir(parents=True, exist_ok=True)
    return out


def _unlink_document_files(doc: Document, data_dir: Path) -> None:
    """Best-effort removal of a document's rendered files (rows are deleted by caller)."""
    _data_dir_resolved = data_dir.resolve()
    for rel in (doc.docx_path, doc.pdf_path):
        if not rel:
            continue
        p = Path(rel)
        if not p.is_absolute():
            p = data_dir / rel
        # Containment check: refuse to unlink paths that resolve outside data_dir
        try:
            resolved = p.resolve()
        except OSError:
            continue
        if _data_dir_resolved not in resolved.parents and resolved != _data_dir_resolved:
            log.warning("Refusing to unlink path outside data_dir: %s", p)
            continue
        with contextlib.suppress(OSError):
            p.unlink(missing_ok=True)


def _purge_superseded_drafts(
    db: Session, *, employee_id: str | None, template_id: str, keep_doc_id: int
) -> None:
    """Delete prior preview-DRAFT documents (rows + files) for the same form.

    Only un-committed previews are removed: ``ref_number == 'DRAFT'`` AND not
    referenced by any book_version. Scoped to the same (employee_id, template_id)
    so unrelated drafts are untouched.
    """
    referenced = select(BookVersion.document_id).where(BookVersion.document_id.is_not(None))
    stmt = select(Document).where(
        Document.ref_number == "DRAFT",
        Document.template_id == template_id,
        Document.id != keep_doc_id,
        Document.id.not_in(referenced),
    )
    stmt = stmt.where(
        Document.employee_id.is_(None)
        if employee_id is None
        else Document.employee_id == employee_id
    )
    data_dir = get_settings().data_dir
    for doc in db.execute(stmt).scalars().all():
        _unlink_document_files(doc, data_dir)
        db.delete(doc)


def _find_duplicate_leave(db: Session, leave_row: Leave) -> Leave | None:
    """Return an existing non-deleted Leave with the same natural key
    (employee, type, exact start/end) as ``leave_row``, or ``None``.

    No time window: a leave re-generated any time later must reuse the existing
    row rather than spawn a duplicate. The retired WF-03 guard only looked back
    2 minutes, so real ~5-minute-apart retries slipped through (audit 2026-07-02).
    ``leave_row`` is the freshly built, not-yet-persisted row from
    ``_make_leave_row`` (its ``id`` is still ``None``), so we match purely on fields.
    """
    return (
        db.execute(
            select(Leave)
            .where(
                Leave.employee_id == leave_row.employee_id,
                Leave.leave_type == leave_row.leave_type,
                Leave.start_date == leave_row.start_date,
                Leave.end_date == leave_row.end_date,
                Leave.deleted_at.is_(None),
            )
            .order_by(Leave.id.desc())
        )
        .scalars()
        .first()
    )


def _make_leave_row(
    employee_id: str,
    template_id: str,
    fields: dict[str, Any],
    docx_path: Path,
    ts: datetime,
) -> Leave:
    """Build a Leave ORM object from the generation context. Mirrors v3's
    _record_leave_to_history (gssg_manager.pyw line 7830)."""
    today = ts.strftime("%d/%m/%Y")

    if template_id == "Leave Application Form":
        leave_type = fields.get("leave_type", "Annual Leave")
        start = fields.get("start_date", today)
        end = fields.get("end_date", start)
        try:
            days = int(fields.get("total_days", 1) or 1)
        except (ValueError, TypeError):
            days = 1
        status = leave_lifecycle.birth_status(leave_type)

    elif template_id == "Passport Release Form":
        leave_type = "Passport Release"
        start = fields.get("request_date", today)
        end = fields.get("return_date", start) or start
        days = 0
        status = "Approved"

    elif template_id == "Duty Resumption Form":
        leave_type = "Duty Resumption"
        start = fields.get("first_date_leave", today)
        end = fields.get("resumption_date", today)
        days = 0
        status = "Approved"

    elif template_id == "Leave Permit Form":
        leave_type = "Leave Permit"
        start = fields.get("date", today)
        end = start
        days = 0
        status = "Approved"

    elif template_id == "Administrative Leave Form":
        leave_type = "Administrative Leave"
        start = fields.get("start_date", today) or today
        end = fields.get("end_date", start) or start
        try:
            days = int(fields.get("duration", 1) or 1)
        except (ValueError, TypeError):
            days = 1
        status = "Approved"

    else:
        leave_type = template_id
        start = today
        end = today
        days = 0
        status = "Approved"

    return Leave(
        employee_id=employee_id,
        leave_type=leave_type,
        start_date=_parse_date_str(start),
        end_date=_parse_date_str(end),
        days=days,
        status=status,
        doc_path=str(docx_path),
    )


def _make_violation_row(
    employee_id: str,
    fields: dict[str, Any],
    docx_path: Path,
    ts: datetime,
) -> Violation:
    """Build a Violation ORM object from the generation context."""
    vio_date_raw = fields.get("date") or ts.strftime("%Y-%m-%d")

    # Violation Form carries a ``violations`` list (dicts {"row": N, "name": ...},
    # strings, or a plain string); the Warning Form instead carries a pre-joined
    # ``violation_type`` string.
    vio_raw = fields.get("violations")
    if isinstance(vio_raw, list):
        parts: list[str] = []
        for v in vio_raw:
            name = v.get("name") or str(v.get("row", "")) if isinstance(v, dict) else str(v)
            if name:
                parts.append(name)
        vio_type = ", ".join(parts) or "Violation"
    elif isinstance(vio_raw, dict):
        vio_type = ", ".join(k for k, v in vio_raw.items() if v) or "Violation"
    elif vio_raw:
        vio_type = str(vio_raw)
    else:
        vio_type = str(fields.get("violation_type", "") or "") or "Violation"

    return Violation(
        employee_id=employee_id,
        violation_type=vio_type[:64],
        date=_parse_date_str(vio_date_raw),
        description=str(fields.get("explanation", "") or ""),
        status="Open",
        doc_path=str(docx_path),
    )


# ---------------------------------------------------------------------------
# Manager resolution (Phase 14 — identity-aware signer fallback)
# ---------------------------------------------------------------------------


def resolve_manager(
    db: Session,
    *,
    explicit_manager_id: int | None,
) -> Manager | None:
    """Pick the Manager row to sign a document.

    Order:
      1. Explicit ``explicit_manager_id`` from the request.
      2. Manager matching the EmailAccount.linked_employee_id (by Manager.employee_id
         if that column exists, else by case-insensitive Manager.name_en ==
         Employee.name_en).
      3. Settings.default_manager_id (legacy behaviour).
    """
    from sqlalchemy import func, select

    from app.db.models import EmailAccount
    from app.services import settings_service

    if explicit_manager_id is not None:
        return db.get(Manager, explicit_manager_id)

    account = db.execute(select(EmailAccount).where(EmailAccount.id == 1)).scalar_one_or_none()
    if account is not None and account.linked_employee_id:
        # Try Manager.employee_id match first (if that column exists on Manager).
        manager_col_emp = getattr(Manager, "employee_id", None)
        if manager_col_emp is not None:
            row = db.execute(
                select(Manager).where(manager_col_emp == account.linked_employee_id)
            ).scalar_one_or_none()
            if row is not None:
                return row
        # Fallback: match by name.
        emp = db.get(Employee, account.linked_employee_id)
        if emp is not None and emp.name_en:
            row = db.execute(
                select(Manager).where(func.lower(Manager.name_en) == emp.name_en.lower())
            ).scalar_one_or_none()
            if row is not None:
                return row

    default_id = settings_service.get_settings(db).default_manager_id
    if default_id is not None:
        return db.get(Manager, default_id)
    return None


def _build_template_data(
    db: Session,
    *,
    template_id: str,
    employee: Employee | None,
    employee_id: str | None,
    fields: dict[str, Any],
    manager_id: int | None,
    submitter_id: int | None,
    embed_signature: dict[str, bool] | None,
    current_user: User | None,
) -> dict[str, Any]:
    """Assemble the docxtpl ``data`` dict (employee fields, manager, submitter,
    embed-flag handling). Assembles template data; reads app settings (signature
    appearance) via the DB session. Extracted from generate_document so the
    signing path reuses identical token assembly."""
    embed_signature = embed_signature or {}
    embed_mgr = bool(embed_signature.get("manager", False))
    embed_emp = bool(embed_signature.get("employee", False))

    from app.services import settings_service

    data: dict[str, Any] = {}

    _appearance = settings_service.get_settings(db)
    data["_sig_size_mm"] = _appearance.signature_size_mm
    data["_sig_boldness"] = _appearance.signature_boldness

    # Populate employee fields that templates expect.
    # Key names must match the Jinja tokens in the DOCX templates ({{ name }},
    # {{ employee_id }}, {{ join_date }}, …).  Keep legacy aliases alongside
    # so callers that pass raw FIXTURE_DATA keys still work.
    today_str = datetime.now().strftime("%d/%m/%Y")
    if employee is not None:
        data["name"] = employee.name_en or ""
        data["employee_name"] = employee.name_en or ""  # legacy alias
        data["employee_name_ar"] = employee.name_ar or ""
        data["employee_id"] = employee.id
        data["g_number"] = employee.id  # legacy alias
        data["department"] = employee.department or ""
        data["position"] = employee.position or ""
        data["designation"] = employee.position or ""  # alias used by some templates
        data["position_ar"] = employee.position_ar or ""
        data["nationality"] = employee.nationality or ""
        data["passport_no"] = employee.passport_no or ""
        data["uae_id_no"] = employee.uae_id_no or ""
        data["phone"] = employee.contact or ""
        # Employee Clearance dates — default issue_date to today, derive
        # termination_date from Employee.end_date. Both stay overridable
        # by the caller-supplied field merge below.
        data.setdefault("issue_date", data.get("today") or today_str)
        data["termination_date"] = (
            employee.end_date.strftime("%d/%m/%Y") if employee.end_date else ""
        )
        # join_date: templates use {{ join_date }} (dd/mm/yyyy format)
        if employee.doj is not None:
            data["join_date"] = employee.doj.strftime("%d/%m/%Y")
            data["joining_date"] = data["join_date"]  # alias
        else:
            data["join_date"] = ""
            data["joining_date"] = ""

    # Merge caller-supplied fields (override employee defaults where both exist).
    # Rich-text fields (General Book body, Resignation Letter reason) arrive as
    # HugeRTE HTML — flatten to plain text so the Jinja {{ token }} render
    # doesn't emit literal <p>/<span> markup into the DOCX.
    data.update(_flatten_rich_fields(template_id, fields))

    # Explicit manager_id is validated; absence falls through to identity-aware
    # resolver (linked employee → default_manager_id). resolve_manager may
    # still return None (e.g. unconfigured), in which case the hand-sign /
    # template-default path applies.
    if manager_id is not None and db.get(Manager, manager_id) is None:
        raise NotFoundError(
            "MANAGER_NOT_FOUND",
            f"Manager {manager_id} does not exist",
            id=manager_id,
        )

    manager = resolve_manager(db, explicit_manager_id=manager_id)
    if manager is not None:
        manager_record = {
            "name_en": manager.name_en,
            "name_ar": manager.name_ar,
            "title": manager.title,
            "sig_path": manager.sig_path,
        }
        from app.core import manager_override

        manager_override.apply(
            data,
            manager_record,
            embed=embed_mgr,
            # These forms render the manager as an Arabic signature block, so the
            # Arabic name reads correctly beside the Arabic designation.
            prefer_arabic=(
                template_id in ("General Book", "Leave Permit Form", "Administrative Leave Form")
            ),
        )
    else:
        # No manager picked — never inject a manager sig path the caller didn't
        # ask for. Belt-and-braces; manager_override only writes sig1_path
        # when both a manager_record and embed=True are present.
        data.pop("sig1_path", None)

    # ------------------------------------------------------------------
    # 4b. Submitter G-number for the document footer — ONLY the General Book
    # footer consumes `{{ submitter_g }}`. Scoped to that template so other
    # forms don't silently emit the caller's G-number. Resolves to the
    # authenticated caller's `employee_id` (G-number); empty string when the
    # user is unlinked or no auth context was threaded through (the template
    # hides the line via a Jinja {% if %} guard).
    # ------------------------------------------------------------------
    if template_id == "General Book":
        data["submitter_g"] = (current_user.employee_id or "") if current_user is not None else ""

    # ------------------------------------------------------------------
    # 4c. Administrative Leave Form — auto-count this employee's admin leaves
    # taken in the current calendar month (the 301-005 "الإجازات الإدارية خلال
    # شهر" cell, token {{ admin_leaves_this_month }}). DB-dependent, so resolved
    # here (the docx adapter is pure / has no session — same split as
    # General Book's submitter_g / recipient_name). Mirrors v3's
    # _count_admin_leaves_this_month (gssg_manager.pyw): Leave rows for this
    # employee whose leave_type starts with "Administrative" and whose
    # start_date falls in the current month. A caller-supplied value wins.
    # ------------------------------------------------------------------
    if (
        template_id == "Administrative Leave Form"
        and employee is not None
        and not str(data.get("admin_leaves_this_month", "") or "").strip()
    ):
        now = datetime.now()
        month_start = date(now.year, now.month, 1)
        month_end = (
            date(now.year + 1, 1, 1) if now.month == 12 else date(now.year, now.month + 1, 1)
        )
        count = (
            db.query(Leave)
            .filter(
                Leave.employee_id == employee.id,
                Leave.leave_type.like("Administrative%"),
                Leave.start_date >= month_start,
                Leave.start_date < month_end,
                Leave.deleted_at.is_(None),
            )
            .count()
        )
        data["admin_leaves_this_month"] = str(count)

    # ------------------------------------------------------------------
    # 5. Resolve submitter
    # ------------------------------------------------------------------
    if template_id in _SUBMITTER_REQUIRED_IDS and submitter_id is None:
        raise AppError(
            "SUBMITTER_REQUIRED",
            f"Template {template_id!r} requires a submitter",
            details={"template_id": template_id},
        )

    if submitter_id is not None:
        sub_row: Submitter | None = db.get(Submitter, submitter_id)
        if sub_row is None:
            raise NotFoundError(
                "SUBMITTER_NOT_FOUND",
                f"Submitter {submitter_id} does not exist",
                id=submitter_id,
            )
        data["submitter_name"] = sub_row.name
        # Look up the employee linked to the submitter for the G-number
        if sub_row.employee_id:
            data["submitter_id"] = sub_row.employee_id
        if sub_row.stored_sig_path:
            data["submitter_sig_path"] = sub_row.stored_sig_path

    # ------------------------------------------------------------------
    # 6. (Fields already merged in step 4 above)
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # 7. Employee-signature embed. Opt-in (``embed_signature.employee``):
    # off → strip any signature keys; on → a caller-supplied (drawn/uploaded)
    # data-URL wins, else fall back to the employee's saved vault
    # ``signature.png`` (the v3 behaviour this feature restores).
    # ------------------------------------------------------------------
    if not embed_emp:
        data.pop("sig2_path", None)
        data.pop("employee_sig_path", None)
    elif employee is not None and not data.get("sig2_path") and not data.get("employee_sig_path"):
        saved_sig = signature_core.vault_path(Vault(get_settings().vault_dir), employee.id)
        if saved_sig.is_file():
            data["employee_sig_path"] = str(saved_sig)

    return data


def _submitter_sign_path(db: Session, submitter_id: int) -> str | None:
    """Resolve a chosen submitter's signature for the employee cell.

    Prefers the saved vault signature of the employee the submitter is linked
    to; falls back to the submitter's own uploaded signature (``stored_sig_path``)
    when there is no linked employee or that employee has no saved signature.
    Returns ``None`` when the submitter has neither — the cell then prints blank.

    Used by the leave-related forms in ``_SUBMITTER_SIGN_FORMS``: a picked
    submitter signs the employee cell in the applicant's place. The Leave
    Application Form's companion Leave Undertaking keeps the applicant's own
    signature (it re-uses the untouched ``data``).
    """
    sub_row = db.get(Submitter, submitter_id)
    if sub_row is None:
        return None
    if sub_row.employee_id:
        saved = signature_core.vault_path(Vault(get_settings().vault_dir), sub_row.employee_id)
        if saved.is_file():
            return str(saved)
    if sub_row.stored_sig_path and Path(sub_row.stored_sig_path).is_file():
        return sub_row.stored_sig_path
    return None


# ---------------------------------------------------------------------------
# Attachments (spec 2026-06-11 §6) — resolve / order / persist+merge support
# ---------------------------------------------------------------------------


def _resolve_attachment_sources(
    db: Session, specs: Sequence[GenerateAttachmentSpec]
) -> list[tuple[GenerateAttachmentSpec, Path]]:
    """Resolve every attachment spec to an on-disk file, failing fast (422).

    ``staged`` → the parked upload (token); ``record_document`` → the
    referenced book's current generated PDF; ``record_attachment`` → one of
    the referenced book's film-strip scans. All reads are containment-checked
    server-side, so "from Records" needs no client download.
    """
    from app.services import book_service, staging_service

    data_dir = get_settings().data_dir
    resolved: list[tuple[GenerateAttachmentSpec, Path]] = []
    for spec in specs:
        path: Path | None
        if spec.source == "staged":
            path = staging_service.resolve(spec.staged_token) if spec.staged_token else None
            if path is None:
                raise ValidationFailedError(
                    "STAGED_ATTACHMENT_MISSING",
                    f"Staged attachment {spec.staged_token!r} is missing or expired",
                    staged_token=spec.staged_token,
                    slot_key=spec.slot_key,
                )
        else:
            book = db.get(Book, spec.book_id) if spec.book_id is not None else None
            if book is None or book.deleted_at is not None:
                raise ValidationFailedError(
                    "ATTACHMENT_BOOK_NOT_FOUND",
                    f"Referenced book {spec.book_id!r} does not exist",
                    book_id=spec.book_id,
                    slot_key=spec.slot_key,
                )
            if spec.source == "record_document":
                version = book.versions[-1] if book.versions else None
                doc = (
                    db.get(Document, version.document_id)
                    if version is not None and version.document_id is not None
                    else None
                )
                rel = doc.pdf_path if doc is not None else None
                path = (data_dir / rel) if rel else None
                if path is None or not path.is_file():
                    raise ValidationFailedError(
                        "ATTACHMENT_PDF_MISSING",
                        f"Book {book.ref_number} has no generated PDF to attach",
                        book_id=spec.book_id,
                        slot_key=spec.slot_key,
                    )
            else:  # record_attachment
                paths = list(book.attachment_paths or [])
                idx = spec.attachment_index
                rel = paths[idx] if idx is not None and 0 <= idx < len(paths) else None
                path = book_service.resolve_attachment_path(rel) if rel else None
                if path is None:
                    raise ValidationFailedError(
                        "ATTACHMENT_NOT_FOUND",
                        f"Book {book.ref_number} has no attachment at index {idx!r}",
                        book_id=spec.book_id,
                        attachment_index=idx,
                        slot_key=spec.slot_key,
                    )
        resolved.append((spec, path))
    return resolved


def _ordered_attachment_specs(
    resolved: Sequence[tuple[GenerateAttachmentSpec, Path]],
    slots: Sequence[form_policy.AttachmentSlot],
) -> list[tuple[GenerateAttachmentSpec, Path]]:
    """Merge order: declared slot order first, then extras in request order."""
    rank = {s.key: i for i, s in enumerate(slots)}
    keyed = sorted(
        (item for item in resolved if item[0].slot_key),
        key=lambda item: rank.get(item[0].slot_key or "", len(rank)),
    )
    extras = [item for item in resolved if not item[0].slot_key]
    return [*keyed, *extras]


# ---------------------------------------------------------------------------
# Main pipeline
# ---------------------------------------------------------------------------


def generate_document(
    db: Session,
    *,
    employee_id: str | None,
    template_id: str,
    fields: dict[str, Any],
    manager_id: int | None = None,
    submitter_id: int | None = None,
    embed_signature: dict[str, bool] | None = None,
    commit: bool = True,
    current_user: User | None = None,
    revise_of_book_id: int | None = None,
    attachments: Sequence[GenerateAttachmentSpec] | None = None,
    return_for_leave_id: int | None = None,
    classification_code: str | None = None,
) -> GenerationResult:
    """Orchestrate the v4 doc generation pipeline.

    ``employee_id`` is optional for admin-category forms (e.g. General Book) —
    those carry no employee data and can be generated unattached. Every other
    template still requires a bound employee.

    ``commit`` is the draft/save toggle (added 2026-05-28):
      * ``True``  — full pipeline: allocate ref → render → stamp → write Document
        + Book row. This is the legacy default.
      * ``False`` — *preview*: render the DOCX without a ref stamp, **do not**
        allocate a ref number, and **do not** create a Book row. A Document row
        is still written so the existing ``GET /documents/{id}/download`` URL
        keeps working unchanged for the in-app PDF canvas; it carries the
        sentinel ``ref_number="DRAFT"`` and is the absence of a Book row that
        identifies it as un-committed.

    ``current_user`` is the authenticated caller (added 2026-05-28). When set,
    their ``employee_id`` (G-number) is injected as ``data["submitter_g"]`` for
    the template footer; falls back to ``""`` if absent or unlinked. The
    template (General Book) hides the line gracefully via a Jinja ``{% if %}``
    guard.

    Round 2 — Fix E: ``embed_signature`` replaces the old ``hand_sign`` kwarg
    with inverted semantics. ``embed_signature[entity]=True`` opts INTO
    embedding the signature image; the default behaviour is no embed.

    Forms rework (spec 2026-06-11 §3/§4): the backend is authoritative for the
    MANAGER embed slot — forced on for ``auto``-path forms, forced off for
    ``in_app``/``scan``/``chain``, ignoring the client value (the employee
    flag stays caller-controlled). Committed generations then land in the
    truthful per-path state: auto → ``approved`` (when a manager signature
    actually embedded), scan → ``awaiting_scan``, in_app → auto-submitted
    ``pending`` when a default manager exists.

    ``attachments`` (spec §6): per-slot / free-form sources merged into the
    combined primary PDF on a committed save. Required slots
    (``form_policy.attachment_slots_of``) block the commit when absent;
    sources are resolved before ref allocation (fail fast), persisted under
    ``book_attachments/{book_id}/``, recorded on
    ``Book.merged_attachment_paths`` and appended to the primary PDF in slot
    order then request order. A revise with ``attachments=None`` re-merges
    the book's existing set; a provided list replaces it.

    ``return_for_leave_id`` (return-form filing): when set for a Duty Resumption
    generation, the standalone "Duty Resumption" register row is NOT created;
    the produced Document is linked to the existing leave instead
    (``Document.leave_id = return_for_leave_id``). leave_service.file_return
    then completes that leave.
    """
    embed_signature = dict(embed_signature or {})

    # Warning Form sends ``violation_type`` as a list of strings; join it once
    # with the Arabic comma so the DOCX token and the Violation record match.
    vio_type = fields.get("violation_type")
    if isinstance(vio_type, list):
        fields = {**fields, "violation_type": "، ".join(str(v) for v in vio_type)}

    # Paths of files to unlink AFTER a successful commit (B1: defer unlink past commit).
    superseded_files: list[str] = []

    # ------------------------------------------------------------------
    # 1. Validate inputs
    # ------------------------------------------------------------------
    if template_id not in TEMPLATE_FILES:
        raise AppError(
            "TEMPLATE_UNKNOWN",
            f"Unknown template {template_id!r}",
            details={"template_id": template_id},
        )

    # Per-form signing path (spec §3). Server-enforced manager embedding:
    # the client value for the "manager" slot is overridden by policy.
    signing_path = form_policy.signing_path_of(template_id)
    embed_signature["manager"] = signing_path == "auto"

    fields_meta = load_fields_meta()
    form_meta = fields_meta.get(template_id, {})
    is_personnel = form_meta.get("category", "personnel") == "personnel"

    employee: Employee | None = None
    if employee_id is not None:
        employee = db.get(Employee, employee_id)
        if employee is None:
            raise NotFoundError(
                "EMPLOYEE_NOT_FOUND",
                f"Employee {employee_id!r} does not exist",
                id=employee_id,
            )
    elif is_personnel:
        # Personnel forms still require an employee; admin forms may skip it.
        raise AppError(
            "EMPLOYEE_REQUIRED",
            f"Template {template_id!r} requires an employee",
            details={"template_id": template_id},
        )

    # ------------------------------------------------------------------
    # 1b. Revise mode: regenerate a new version for an existing book. Reuse its
    # ref (no allocation, no new Book row) and append a fresh version.
    # ------------------------------------------------------------------
    revise_book: Book | None = None
    if revise_of_book_id is not None:
        if not commit:
            raise ValidationFailedError(
                "REVISE_REQUIRES_COMMIT", "Revise mode cannot run as a preview"
            )
        revise_book = db.get(Book, revise_of_book_id)
        if revise_book is None or revise_book.deleted_at is not None:
            raise NotFoundError(
                "BOOK_NOT_FOUND",
                f"Book {revise_of_book_id} does not exist",
                id=revise_of_book_id,
            )
        if revise_book.approval_state not in (
            "returned",
            "rejected",
            "none",
            "awaiting_scan",
        ):
            raise ValidationFailedError(
                "BOOK_NOT_REVISABLE",
                "Only a draft, returned, rejected, or awaiting-scan book can be revised",
                state=revise_book.approval_state,
            )

    # ------------------------------------------------------------------
    # 1c. Attachments (spec §6) — validate slots + resolve sources BEFORE
    # ref allocation so a bad payload fails fast with nothing to roll back.
    # ------------------------------------------------------------------
    slots = form_policy.attachment_slots_of(template_id)
    attachment_specs = list(attachments or [])
    slot_keys = {s.key for s in slots}
    for spec in attachment_specs:
        if spec.slot_key and spec.slot_key not in slot_keys:
            raise ValidationFailedError(
                "UNKNOWN_ATTACHMENT_SLOT",
                f"Template {template_id!r} has no attachment slot {spec.slot_key!r}",
                slot_key=spec.slot_key,
                template_id=template_id,
            )
    # Revise with attachments=None reuses the book's stored merged set —
    # required slots were satisfied when the book was first committed.
    reuse_merged: list[dict[str, str | None]] = []
    if revise_book is not None and attachments is None:
        reuse_merged = list(revise_book.merged_attachment_paths or [])
    elif commit:
        missing = [
            s.key
            for s in slots
            if s.required and not any(x.slot_key == s.key for x in attachment_specs)
        ]
        if missing:
            raise ValidationFailedError(
                "REQUIRED_ATTACHMENT_MISSING", ", ".join(missing), slots=missing
            )
    resolved_attachments: list[tuple[GenerateAttachmentSpec, Path]] = []
    if commit and attachment_specs:
        resolved_attachments = _resolve_attachment_sources(db, attachment_specs)

    # ------------------------------------------------------------------
    # 2. Determine output directory
    # ------------------------------------------------------------------
    if is_personnel and employee is not None:
        vault = Vault(get_settings().vault_dir)
        out_dir = vault.form_output_dir(employee.id, template_id)
        if out_dir is None:
            # Fallback for personnel forms without a subfolder mapping
            out_dir = _output_dir_for_admin(template_id)
    else:
        out_dir = _output_dir_for_admin(template_id)

    # ------------------------------------------------------------------
    # 3. Allocate reference number — committed saves only.
    # Preview (commit=False) uses the literal sentinel "DRAFT"; the monotonic
    # counter is untouched, so concurrent previews don't burn ref numbers.
    # ------------------------------------------------------------------
    cat_code = _FORM_CATEGORY.get(template_id, "HR")
    # General Book refs come exclusively from the classified register
    # (1/{tab}/GSSG/{serial}) — the legacy GS-#### counter is retired for this
    # form regardless of authoring surface (rich editor OR Word). Validate the
    # classification up-front so a bad code fails before any file is written.
    _classification = None
    if template_id == "General Book":
        if classification_code is not None:
            _classification = get_classification(classification_code)
            if _classification is None:
                raise ValidationFailedError(
                    "UNKNOWN_CLASSIFICATION",
                    f"Classification code {classification_code!r} is not in the registry",
                )
        elif commit and revise_book is None:
            raise ValidationFailedError(
                "CLASSIFICATION_REQUIRED",
                "General Book requires a classification (التبويب) — every book "
                "takes its ref from the classified register",
            )
    if commit and revise_book is not None:
        # Revise reuses the existing book's ref — no allocation.
        raw_ref = revise_book.ref_number
    elif commit and _classification is not None:
        # Shared classified serial — atomic with the Book/Document insert via
        # the function's terminal db.commit().
        serial = allocate_classified_serial(db)
        raw_ref = classified_ref(_classification.tab, serial)
    elif commit:
        # Serialised + bounded-retry ref allocation (BEGIN IMMEDIATE inside the
        # helper) — mirrors create_book. Atomic with the Book/Document insert
        # via the function's terminal db.commit().
        raw_ref = allocate_ref_with_retry(db, cat_code)
    else:
        raw_ref = "DRAFT"

    # ------------------------------------------------------------------
    # 4-7. Assemble the docxtpl data dict (employee fields, manager override,
    # submitter, embed-flag handling). Extracted to _build_template_data so the
    # signing path can reuse identical token assembly.
    # ------------------------------------------------------------------
    data = _build_template_data(
        db,
        template_id=template_id,
        employee=employee,
        employee_id=employee_id,
        fields=fields,
        manager_id=manager_id,
        submitter_id=submitter_id,
        embed_signature=embed_signature,
        current_user=current_user,
    )

    # General Book: the classified ref renders as the Arabic body line
    # (الرقم: …) — commit-only, so previews stay serial-free. Replaces the
    # English header stamp for this form.
    if commit and template_id == "General Book":
        data["ref"] = raw_ref

    # Truthful embed flag: ``sig1_path`` survives _build_template_data only
    # when the policy forced the embed on AND a manager with an on-disk
    # signature actually resolved — so this records what the rendered DOCX
    # really carries (an auto form without a resolvable manager stays False).
    embed_mgr = bool(data.get("sig1_path"))

    # ------------------------------------------------------------------
    # 8. Build output path and fill PRIMARY template
    # ------------------------------------------------------------------
    ts = datetime.now()
    submission_id = str(uuid.uuid4())
    engine = DocxEngine(_TEMPLATES_DIR)
    settings = get_settings()

    primary_name = (employee.name_en if employee is not None else "") or ""
    filename = _build_docx_filename(template_id, primary_name, ts)
    docx_path = Vault.collision_safe_name(out_dir, filename)

    # Pre-resolve General Book recipient_id → recipient_name here (where the db
    # session is available). _adapt_general_book has a fallback for callers
    # that go straight to DocxEngine.fill, but doing it here is the canonical
    # path.
    if (
        template_id == "General Book"
        and data.get("recipient_id") is not None
        and not data.get("recipient_name")
    ):
        from app.services import recipient_service

        try:
            resolved = recipient_service.resolve_name(db, int(data["recipient_id"]))
        except (TypeError, ValueError):
            resolved = None
        if resolved:
            data["recipient_name"] = resolved

    # Submitter-sign forms: when a submitter is picked, their signature replaces
    # the applicant's in the employee-signature cell. Leave forms gate on the
    # embed checkbox; the Clearance Form (no such checkbox) auto-embeds. See
    # _submitter_signs_employee_cell. The Leave Application Form's companion
    # Leave Undertaking re-uses the shared `data` untouched below, so it keeps
    # the applicant's own signature.
    primary_data = data
    if _submitter_signs_employee_cell(template_id, submitter_id, embed_signature):
        assert submitter_id is not None  # _submitter_signs_employee_cell requires it
        primary_data = {
            **data,
            "employee_sig_path": _submitter_sign_path(db, submitter_id),
        }

    engine.fill(template_id, primary_data, docx_path)

    # ------------------------------------------------------------------
    # 8b. Round 2 — Fix D: sync General Book footer2.xml ← footer3.xml so
    # the submitter G-number + letterhead appear on page 2+ as well as
    # page 1. Operates on the saved file (zipfile can't edit in place).
    # ------------------------------------------------------------------
    if template_id == "General Book":
        from app.core.docx_engine import _postprocess_general_book_footer

        _postprocess_general_book_footer(docx_path)

    # ------------------------------------------------------------------
    # 9. Stamp ref number (primary) — committed saves only.
    # Previews skip the stamp so the operator never sees the placeholder
    # "DRAFT" string in the header (it would just be visual noise).
    # ------------------------------------------------------------------
    if commit:
        if template_id != "General Book":
            DocxEngine.stamp_ref_number(docx_path, raw_ref, STAMP_STYLE_HEADER)
        DocxEngine.stamp_aztec_code(docx_path, raw_ref, corner=aztec_corner_for(template_id))

    # ------------------------------------------------------------------
    # 10. Convert primary DOCX to PDF
    # ------------------------------------------------------------------
    pdf_path: Path | None = None
    try:
        pdf_path = convert_docx_to_pdf(docx_path)
    except Exception:
        # Hard failure (COM crash, pool timeout). Log at error so it isn't lost
        # — the job still completes with pdf_path=None and the UI surfaces a
        # "PDF unavailable — download DOCX" state deliberately.
        log.error("PDF conversion crashed for %s", docx_path, exc_info=True)
    if pdf_path is None:
        # Graceful None (e.g. no Word/LibreOffice on the host) is otherwise
        # silent; log it so a host-config issue is diagnosable from the logs.
        log.warning("PDF unavailable for %s — conversion returned no file", docx_path)
        # No silent attachment loss (spec §6 failure mode): a merge was
        # pending (fresh specs or a revise reuse) but there is no PDF to merge
        # into. Abort the generation — the transaction rolls back and staged
        # files stay on disk for retry / the 24h TTL purge.
        if commit and (resolved_attachments or reuse_merged):
            raise ValidationFailedError(
                "GENERATION_PDF_FAILED",
                "PDF conversion failed — the attachments cannot be merged",
                template_id=template_id,
            )

    # ------------------------------------------------------------------
    # 11. Persist primary Document row
    # ------------------------------------------------------------------
    def _rel(p: Path | None) -> str | None:
        if p is None:
            return None
        try:
            return str(p.relative_to(settings.data_dir))
        except ValueError:
            return str(p)

    doc_row = Document(
        employee_id=employee_id,
        template_id=template_id,
        ref_number=raw_ref,
        docx_path=_rel(docx_path) or str(docx_path),
        pdf_path=_rel(pdf_path),
        submission_id=submission_id,
        role="primary",
    )
    db.add(doc_row)
    db.flush()  # get doc_row.id without committing
    _purge_superseded_drafts(
        db, employee_id=employee_id, template_id=template_id, keep_doc_id=doc_row.id
    )

    # ------------------------------------------------------------------
    # 11b. Create Book row so the generated document appears in Records.
    #
    # Committed saves only — preview/draft generations skip the Book row
    # entirely (that's how Records knows not to surface them).
    #
    # Every committed form allocates a ref number from the book-category
    # ref allocator (_FORM_CATEGORY → e.g. "HR-0042").  That same ref
    # should be visible in the Books / Records page so operators can
    # track and approve the document.  We insert the Book row directly
    # (bypassing book_service.create_book, which would allocate a second
    # independent ref) using the ref already allocated in step 3.
    #
    # Guard: if the book_categories row for cat_code doesn't exist (e.g.
    # a bare test DB that never ran migrations), skip silently rather than
    # rolling back the entire generation.
    # ------------------------------------------------------------------
    _logged_book: Book | None = None
    # The version this generation produced/updated — target of the per-path
    # state block below (spec §4).
    _state_version: BookVersion | None = None
    if commit:
        if revise_book is not None:
            _logged_book = revise_book
            latest = revise_book.versions[-1] if revise_book.versions else None
            if revise_book.approval_state == "none" and latest is not None:
                # Draft edit — regenerate in place: replace the current version's
                # document/fields, keep version_no, stay a draft.
                old_doc = db.get(Document, latest.document_id) if latest.document_id else None
                # Capture paths BEFORE db.delete so we can unlink post-commit
                # (B1: file deletion is irreversible; must not run before the
                # transaction is durably committed).
                if old_doc is not None:
                    superseded_files.extend(p for p in (old_doc.docx_path, old_doc.pdf_path) if p)
                    db.delete(old_doc)
                latest.document_id = doc_row.id
                latest.fields = dict(fields)
                latest.template_id = template_id
                latest.trigger = "draft-edit"
                latest.manager_sig_embedded = embed_mgr
                latest.created_at = ts.replace(tzinfo=None)
                revise_book.doc_path = _rel(docx_path) or str(docx_path)
                db.flush()
                _state_version = latest
            else:
                # Revise after return/reject/awaiting-scan — append a new
                # version (existing behavior).
                next_no = (
                    db.execute(
                        select(func.max(BookVersion.version_no)).where(
                            BookVersion.book_id == revise_book.id
                        )
                    ).scalar_one_or_none()
                    or 0
                ) + 1
                revision_row = BookVersion(
                    book_id=revise_book.id,
                    version_no=next_no,
                    document_id=doc_row.id,
                    template_id=template_id,
                    fields=dict(fields),
                    trigger="revision",
                    status="none",
                    manager_sig_embedded=embed_mgr,
                    created_by_user_id=current_user.id if current_user is not None else None,
                    created_at=ts.replace(tzinfo=None),
                )
                db.add(revision_row)
                revise_book.approval_state = "none"
                revise_book.submitted_by_user_id = None
                revise_book.doc_path = _rel(docx_path) or str(docx_path)
                db.flush()
                _state_version = revision_row
        elif db.get(BookCategory, cat_code) is not None:
            # Snapshot/subject must hold a NAME (never the G-number/employee_id):
            # English name preferred, Arabic fallback, else empty string.
            _emp_name = (
                (employee.name_en or employee.name_ar) if employee is not None else ""
            ) or ""
            # Prefer the operator-entered subject token (General Book has a
            # free-text موضوع/Subject field); fall back to the form-type label.
            _entered_subject = fields.get("subject")
            _subject = (
                _entered_subject.strip()
                if isinstance(_entered_subject, str) and _entered_subject.strip()
                else (f"{template_id} — {_emp_name}" if _emp_name else template_id)
            )
            _body_raw = fields.get("body")
            _body_text = html_to_text(_body_raw) if isinstance(_body_raw, str) else ""
            book_row = Book(
                category_id=cat_code,
                ref_number=raw_ref,
                classification_code=_classification.code if _classification else None,
                subject=_subject,
                direction="outgoing",
                stamp_style=STAMP_STYLE_HEADER,
                employee_id=employee_id,
                employee_name_snapshot=_emp_name,
                doc_path=_rel(docx_path) or str(docx_path),
                created_at=ts.replace(tzinfo=None),
                deleted_at=None,
                search_text=build_search_text(subject=_subject, ref=raw_ref, body=_body_text),
            )
            db.add(book_row)
            db.flush()
            _logged_book = book_row
            initial_row = BookVersion(
                book_id=book_row.id,
                version_no=1,
                document_id=doc_row.id,
                template_id=template_id,
                fields=dict(fields),
                trigger="initial",
                status="none",
                manager_sig_embedded=embed_mgr,
                created_by_user_id=current_user.id if current_user is not None else None,
                created_at=ts.replace(tzinfo=None),
            )
            db.add(initial_row)
            db.flush()
            _state_version = initial_row
        else:
            # Committed save but no book_categories row for cat_code: the doc
            # file is produced yet no Book is created, so it never appears in
            # Records. This is a misconfiguration (unseeded category), not a
            # normal path — log it loudly so the silent drop is diagnosable.
            log.warning(
                "Generated document %s committed but book_categories row for "
                "cat_code=%r is missing — no Book created, doc will NOT appear "
                "in Records.",
                doc_row.id,
                cat_code,
            )

    # ------------------------------------------------------------------
    # 11b-2. Per-path generation states (spec §4) — runs for new books AND
    # both revise scenarios (so a returned Material Request auto-resubmits,
    # a revised Violation goes back to awaiting_scan, an auto form
    # re-approves). ``chain`` books keep the existing none → submit flow,
    # and so does an ``in_app`` book when no default manager is set (the
    # Submit dialog takes over, preselecting the default).
    # ------------------------------------------------------------------
    if commit and _logged_book is not None and _state_version is not None:
        _doc_mgr = resolve_manager(db, explicit_manager_id=manager_id)
        _logged_book.doc_manager_id = _doc_mgr.id if _doc_mgr is not None else None
        if signing_path == "auto" and embed_mgr:
            _logged_book.approval_state = "approved"
            _state_version.status = "approved"
            # WF-02 (by-design auto path): the manager's signature is embedded
            # at generation with no per-document sign action. Leave a trail of
            # consent-by-policy — attribute the embed to the generating user AND
            # the signing manager so an auto-signed record is auditable.
            _auto_mgr = _doc_mgr
            db.add(
                AuditLog(
                    actor=(current_user.employee_id if current_user is not None else None),
                    action="auto_sign_embed",
                    entity_type="book",
                    entity_id=str(_logged_book.id),
                    payload=json.dumps(
                        {
                            "template_id": template_id,
                            "ref_number": raw_ref,
                            "signing_path": "auto",
                            "generated_by_user_id": (
                                current_user.id if current_user is not None else None
                            ),
                            "signing_manager_id": (_auto_mgr.id if _auto_mgr is not None else None),
                            "signing_manager_name": (
                                (_auto_mgr.name_en or _auto_mgr.name_ar)
                                if _auto_mgr is not None
                                else None
                            ),
                        }
                    ),
                )
            )
        elif signing_path == "scan":
            _logged_book.approval_state = "awaiting_scan"
            _state_version.status = "awaiting_scan"
        elif signing_path == "in_app":
            assignee_id: int | None = None
            if _doc_mgr is not None and _doc_mgr.user_id is not None:
                linked = db.get(User, _doc_mgr.user_id)
                if linked is not None and linked.status == "active":
                    assignee_id = linked.id
            if assignee_id is None:
                default_mgr = db.execute(
                    select(User).where(User.is_default_manager.is_(True), User.status == "active")
                ).scalar_one_or_none()
                assignee_id = default_mgr.id if default_mgr is not None else None
            if assignee_id is not None:
                _state_version.approval_steps.append(
                    BookApprovalStep(
                        book_id=_logged_book.id,
                        version_id=_state_version.id,
                        step_order=0,
                        stage_label="Signature",  # keep — test_generation_paths asserts it
                        assignee_user_id=assignee_id,
                        kind="approver",
                        state="pending",
                    )
                )
                _logged_book.approval_state = "pending"
                _state_version.status = "pending"
                _logged_book.submitted_by_user_id = (
                    current_user.id if current_user is not None else None
                )
        db.flush()

    # ------------------------------------------------------------------
    # 11b-3. Attachments (spec §6) — persist the resolved sources under
    # book_attachments/{book_id}/, record them on the book, and merge them
    # into the combined primary PDF (slot order, then free-form extras).
    # The merged file IS Document.pdf_path, so download / film-strip / email
    # all carry the combined PDF with zero further changes. Consumed staged
    # files are unlinked only after the commit (alongside the B1 loop).
    # ------------------------------------------------------------------
    if commit and _logged_book is not None and pdf_path is not None:
        merge_sources: list[Path] = []
        if resolved_attachments:
            att_dir = settings.data_dir / "book_attachments" / str(_logged_book.id)
            att_dir.mkdir(parents=True, exist_ok=True)
            persisted: list[dict[str, str | None]] = []
            for spec, src in _ordered_attachment_specs(resolved_attachments, slots):
                dest = Vault.collision_safe_name(att_dir, f"{spec.slot_key or 'extra'}_{src.name}")
                shutil.copyfile(src, dest)
                persisted.append(
                    {
                        "path": dest.relative_to(settings.data_dir).as_posix(),
                        "slot_key": spec.slot_key,
                    }
                )
                merge_sources.append(dest)
                if spec.source == "staged":
                    # Consumed — unlink post-commit (B1 pattern below).
                    superseded_files.append(str(src))
            # A provided list replaces the stored set (old files stay on disk
            # — earlier versions may reference them; cheap and safe).
            _logged_book.merged_attachment_paths = persisted
        elif attachments is not None and revise_book is not None:
            # Explicit empty list on revise clears the stored set.
            _logged_book.merged_attachment_paths = []
        elif reuse_merged:
            # Revise with attachments=None: re-merge the existing set into
            # the freshly generated PDF; the column is left untouched.
            from app.services import book_service

            for item in reuse_merged:
                rel_path = item.get("path")
                src_path = book_service.resolve_attachment_path(rel_path) if rel_path else None
                if src_path is None:
                    log.warning(
                        "merged attachment %s missing for book %s — skipped on re-merge",
                        rel_path,
                        _logged_book.id,
                    )
                    continue
                merge_sources.append(src_path)
        if merge_sources:
            merge_attachments_into_pdf(pdf_path, merge_sources)
        db.flush()

    # ------------------------------------------------------------------
    # 11b. Phase 3 — auto-file this generation in the shared Correspondence Log.
    # Defensive: a logging failure must NEVER roll back or break generation.
    # Idempotent on (source_kind, book.id) so a revise re-fire updates in place.
    # ------------------------------------------------------------------
    if commit and _logged_book is not None:
        try:
            from app.services import correspondence_service

            correspondence_service.log_event(
                db,
                trigger="document_generated",
                source_kind="generated_doc",
                source_book_id=_logged_book.id,
                subject=(_logged_book.subject or template_id)[:255],
                employee_id=employee_id,
                submitter=(current_user.employee_id if current_user else None),
                entry_date=ts.date(),
                condition_fields={"category": cat_code, "template_id": template_id},
                direction="outgoing",
            )
        except Exception:
            log.warning(
                "correspondence auto-log failed for book %s",
                _logged_book.id,
                exc_info=True,
            )

    # ------------------------------------------------------------------
    # 12. Leave forms — insert Leave row (primary only)
    # ------------------------------------------------------------------
    leave_id: int | None = None
    if return_for_leave_id is not None:
        # Return-form filing: attach to the existing leave; no new register row.
        doc_row.leave_id = return_for_leave_id
        leave_id = return_for_leave_id
    elif template_id in _LEAVE_FORM_IDS and employee_id is not None:
        leave_row = _make_leave_row(employee_id, template_id, fields, docx_path, ts)
        # Idempotency guard (WF-03): a client retry / double-submit / runaway
        # loop must not spam exact-duplicate Leave rows (the documented
        # 2026-03-26 incident inserted 300 identical sick rows). Reuse any
        # non-deleted row with the same natural key instead of inserting again.
        existing_leave = _find_duplicate_leave(db, leave_row)
        if existing_leave is not None:
            log.info(
                "leave-row dedup: reusing leave %d for employee %s (%s %s→%s)",
                existing_leave.id,
                employee_id,
                leave_row.leave_type,
                leave_row.start_date,
                leave_row.end_date,
            )
            doc_row.leave_id = existing_leave.id
            leave_id = existing_leave.id
        else:
            db.add(leave_row)
            db.flush()
            doc_row.leave_id = leave_row.id
            leave_id = leave_row.id

    # ------------------------------------------------------------------
    # 13. Violation form — insert Violation row
    # ------------------------------------------------------------------
    violation_id: int | None = None
    if template_id in _VIOLATION_FORM_IDS and employee_id is not None:
        vio_row = _make_violation_row(employee_id, fields, docx_path, ts)
        db.add(vio_row)
        db.flush()
        doc_row.violation_id = vio_row.id
        violation_id = vio_row.id

    # Build primary result item
    doc_results: list[GenerationDocumentResult] = [
        GenerationDocumentResult(
            document_id=doc_row.id,
            template_id=template_id,
            role="primary",
            ref_number=raw_ref,
            docx_path=docx_path,
            pdf_path=pdf_path,
        )
    ]

    # ------------------------------------------------------------------
    # 14. Companion documents (same ref, same submission_id)
    # ------------------------------------------------------------------
    companion_rule = _COMPANION_RULES.get(template_id)
    if companion_rule is not None:
        companion_template_id = companion_rule(data)
        if companion_template_id is not None:
            # NOTE: companions reuse the primary's `data`, so a submitter is only
            # present if one was picked on the primary form. The Leave Undertaking
            # companion (which lists a submitter when generated standalone) is
            # rendered WITHOUT enforcing _SUBMITTER_REQUIRED_IDS here — its
            # adapter (_adapt_leave_undertaking) degrades gracefully, leaving the
            # submitter block blank rather than failing the whole leave packet.
            comp_filename = _build_docx_filename(companion_template_id, primary_name, ts)
            comp_docx_path = Vault.collision_safe_name(out_dir, comp_filename)
            engine.fill(companion_template_id, data, comp_docx_path)
            if commit:
                DocxEngine.stamp_ref_number(comp_docx_path, raw_ref, STAMP_STYLE_HEADER)
                DocxEngine.stamp_aztec_code(
                    comp_docx_path,
                    raw_ref,
                    corner=aztec_corner_for(companion_template_id),
                )

            comp_pdf_path: Path | None = None
            try:
                comp_pdf_path = convert_docx_to_pdf(comp_docx_path)
            except Exception:
                log.warning("PDF conversion failed for companion %s", comp_docx_path, exc_info=True)

            comp_row = Document(
                employee_id=employee_id,
                template_id=companion_template_id,
                ref_number=raw_ref,
                docx_path=_rel(comp_docx_path) or str(comp_docx_path),
                pdf_path=_rel(comp_pdf_path),
                submission_id=submission_id,
                role="companion",
                # Companion docs never get their own leave/violation row
                leave_id=None,
                violation_id=None,
            )
            db.add(comp_row)
            db.flush()

            doc_results.append(
                GenerationDocumentResult(
                    document_id=comp_row.id,
                    template_id=companion_template_id,
                    role="companion",
                    ref_number=raw_ref,
                    docx_path=comp_docx_path,
                    pdf_path=comp_pdf_path,
                )
            )

    # ------------------------------------------------------------------
    # 15. Commit
    # ------------------------------------------------------------------
    db.commit()
    db.refresh(doc_row)

    # B1: unlink superseded in-place-edit files NOW — transaction is durable.
    # If commit raised above, we never reach this point, so old files are safe.
    if superseded_files:
        _post_data_dir = get_settings().data_dir
        _post_data_dir_resolved = _post_data_dir.resolve()
        for _sup_rel in superseded_files:
            _sup_p = Path(_sup_rel)
            if not _sup_p.is_absolute():
                _sup_p = _post_data_dir / _sup_p
            try:
                _sup_resolved: Path = _sup_p.resolve()
            except OSError:
                continue
            if (
                _post_data_dir_resolved not in _sup_resolved.parents
                and _sup_resolved != _post_data_dir_resolved
            ):
                log.warning("Refusing to unlink path outside data_dir (post-commit): %s", _sup_p)
                continue
            with contextlib.suppress(OSError):
                _sup_p.unlink(missing_ok=True)

    return GenerationResult(
        submission_id=submission_id,
        ref_number=raw_ref,
        leave_id=leave_id,
        violation_id=violation_id,
        documents=doc_results,
        book_id=_logged_book.id if _logged_book is not None else None,
    )


def purge_orphan_draft_documents(db: Session) -> int:
    """Delete every preview-DRAFT document (rows + files) not referenced by a
    book_version. Idempotent maintenance routine. Returns the number removed."""
    referenced = select(BookVersion.document_id).where(BookVersion.document_id.is_not(None))
    rows = list(
        db.execute(
            select(Document).where(
                Document.ref_number == "DRAFT",
                Document.id.not_in(referenced),
            )
        )
        .scalars()
        .all()
    )
    data_dir = get_settings().data_dir
    for doc in rows:
        _unlink_document_files(doc, data_dir)
        db.delete(doc)
    db.commit()
    return len(rows)


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


def _merge_book_attachments(db: Session, book: Book, pdf_path: Path) -> None:
    """Re-merge the book's combined-PDF attachments into *pdf_path* (spec §6):
    the generated PDF carried them, so any signed artifact must too."""
    merged_items = list(book.merged_attachment_paths or [])
    if not merged_items:
        return
    from app.services import book_service

    merge_sources: list[Path] = []
    for item in merged_items:
        rel_path = item.get("path")
        src_path = book_service.resolve_attachment_path(rel_path) if rel_path else None
        if src_path is None:
            log.warning(
                "merged attachment %s missing for book %s — skipped in signed artifact",
                rel_path,
                book.id,
            )
            continue
        merge_sources.append(src_path)
    if merge_sources:
        merge_attachments_into_pdf(pdf_path, merge_sources)


def _sign_authored_docx(
    db: Session,
    *,
    version: BookVersion,
    source: Path,
    signer_signature_path: str,
    signer_names: Sequence[str] = (),
) -> str:
    """Signed artifact for a Word-authored book: copy docx → stamp signature →
    convert. The paper already carries ref/date/footer/Aztec from its own
    render — nothing is re-generated (re-rendering from the empty ``fields``
    blob is what blanked signed Word books, 2026-07-19)."""
    from app.core import docx_engine
    from app.core.constants import DEFAULT_MANAGER_NAME
    from app.services import settings_service

    book = version.book
    out_dir = _output_dir_for_admin("General Book")
    ts = datetime.now()
    docx_name = _build_docx_filename("General Book", book.ref_number.replace("/", "-"), ts)
    docx_path = Vault.collision_safe_name(out_dir, docx_name.replace(".docx", "_signed.docx"))
    shutil.copy2(source, docx_path)

    # Anchor candidates: the signer (a delegated approver may have typed their
    # own closing in Word), the linked manager, then the default manager.
    names: list[str] = list(signer_names)
    if book.doc_manager_id is not None:
        mgr = db.get(Manager, book.doc_manager_id)
        if mgr is not None:
            names += [n for n in (mgr.name_ar, mgr.name_en) if n]
    names.append(DEFAULT_MANAGER_NAME)

    _appearance = settings_service.get_settings(db)
    placed = docx_engine.stamp_signature_above_name(
        docx_path,
        signer_signature_path,
        names,
        size_mm=_appearance.signature_size_mm,
        boldness=_appearance.signature_boldness,
    )
    if not placed:
        # A "signed" paper with no visible signature is the exact defect class
        # this path exists to fix — fail LOUDLY, like the rich path does when
        # its render fails, and don't leave the half-made copy behind.
        with contextlib.suppress(OSError):
            docx_path.unlink(missing_ok=True)
        log.error(
            "signature stamp failed for book %s (%s) — sig=%s",
            book.id,
            docx_path.name,
            signer_signature_path,
        )
        raise AppError(
            "SIGNATURE_STAMP_FAILED",
            "تعذر إدراج التوقيع في الكتاب — تحقق من ملف التوقيع ثم أعد المحاولة",
            http_status=409,
        )

    pdf_path: Path | None = None
    try:
        pdf_path = convert_docx_to_pdf(docx_path)
    except Exception:
        log.error("Signed PDF conversion crashed for %s", docx_path, exc_info=True)
    if pdf_path is None:
        log.warning("Signed PDF unavailable for %s — returning signed DOCX", docx_path)
    if pdf_path is not None:
        _merge_book_attachments(db, book, pdf_path)

    settings = get_settings()

    def _rel(p: Path) -> str:
        # Output dirs can live OUTSIDE data_dir (AppData/Desktop roots) —
        # same fallback as the re-render path below.
        try:
            return p.relative_to(settings.data_dir).as_posix()
        except ValueError:
            return str(p)

    return _rel(pdf_path) if pdf_path is not None else _rel(docx_path)


def render_signed_pdf(
    db: Session,
    *,
    version: BookVersion,
    signer_signature_path: str,
    signer_names: Sequence[str] = (),
) -> str:
    """Re-render ``version``'s document with the signer's signature embedded in
    the manager slot (``sig1_path``); return the signed PDF path relative to
    data_dir.

    Reuses the version's stored ``template_id`` + ``fields`` + the book's
    employee. Does NOT allocate a ref, Book, or new version — this is a derived
    artifact. PDF conversion can fail / return None (no Word on the host), in
    which case the signed DOCX path is returned as a fallback, mirroring
    ``generate_document``.

    Word-authored versions (``fields == {}``) carry their truth in the DOCX,
    not in re-renderable fields — those are signed in place via
    ``_sign_authored_docx``; ``signer_names`` feeds its anchor search. A
    fields-less version whose docx is GONE fails loudly: falling through to
    the template re-render would reproduce the blank signed paper.
    """
    book = version.book
    if not version.fields:
        authored = _authored_docx_of(db, version)
        if authored is None:
            raise AppError(
                "SOURCE_DOCX_MISSING",
                "ملف الكتاب الأصلي غير موجود على القرص — لا يمكن التوقيع",
                http_status=409,
            )
        return _sign_authored_docx(
            db,
            version=version,
            source=authored,
            signer_signature_path=signer_signature_path,
            signer_names=signer_names,
        )
    template_id = version.template_id or ""
    if template_id not in TEMPLATE_FILES:
        raise AppError(
            "TEMPLATE_UNKNOWN",
            f"Unknown template {template_id!r}",
            details={"template_id": template_id},
        )
    employee = db.get(Employee, book.employee_id) if book.employee_id else None
    fields = dict(version.fields or {})

    data = _build_template_data(
        db,
        template_id=template_id,
        employee=employee,
        employee_id=book.employee_id,
        fields=fields,
        # The manager chosen at generation is recorded on book.doc_manager_id,
        # NOT in version.fields — re-render with it so the signed copy keeps the
        # same verifier name/title (else the {{ manager_name }} cell renders
        # blank; SC-0425 regression).
        manager_id=book.doc_manager_id,
        submitter_id=None,
        embed_signature=None,
        current_user=None,
    )
    # Inject the approver's signature into the manager signature slot.
    data["sig1_path"] = signer_signature_path

    # Resolve General Book recipient_id → recipient_name on the REQUEST session
    # (mirrors the generate path) so the adapter never opens a second session.
    if (
        template_id == "General Book"
        and data.get("recipient_id") is not None
        and not data.get("recipient_name")
    ):
        from app.services import recipient_service

        try:
            resolved = recipient_service.resolve_name(db, int(data["recipient_id"]))
        except (TypeError, ValueError):
            resolved = None
        if resolved:
            data["recipient_name"] = resolved

    out_dir = _output_dir_for_admin(template_id)
    ts = datetime.now()
    docx_name = _build_docx_filename(
        template_id, (employee.name_en if employee is not None else "signed") or "signed", ts
    )
    docx_path = Vault.collision_safe_name(out_dir, docx_name.replace(".docx", "_signed.docx"))
    engine = DocxEngine(_TEMPLATES_DIR)
    if template_id == "General Book":
        data["ref"] = book.ref_number
    engine.fill(template_id, data, docx_path)

    # Mirror generate_document: sync the General Book page-2+ footer so the
    # signed artifact matches the original's multi-page footer.
    if template_id == "General Book":
        from app.core.docx_engine import _postprocess_general_book_footer

        _postprocess_general_book_footer(docx_path)

    if template_id != "General Book":
        DocxEngine.stamp_ref_number(docx_path, book.ref_number, STAMP_STYLE_HEADER)
    DocxEngine.stamp_aztec_code(docx_path, book.ref_number, corner=aztec_corner_for(template_id))

    pdf_path: Path | None = None
    try:
        pdf_path = convert_docx_to_pdf(docx_path)
    except Exception:
        log.error("Signed PDF conversion crashed for %s", docx_path, exc_info=True)
    if pdf_path is None:
        log.warning("Signed PDF unavailable for %s — conversion returned no file", docx_path)

    # Re-merge the book's combined-PDF attachments (spec §6): the generated
    # PDF carried them, so the signed artifact must too.
    if pdf_path is not None:
        _merge_book_attachments(db, book, pdf_path)

    settings = get_settings()

    def _rel(p: Path) -> str:
        try:
            return p.relative_to(settings.data_dir).as_posix()
        except ValueError:
            return str(p)

    return _rel(pdf_path) if pdf_path is not None else _rel(docx_path)


def download_filename_for(row: Document, ext: str, *, db: Session | None = None) -> str:
    """Filename for a document download, per export-naming rules (spec 2026-07-01)."""
    from app.core.export_naming import book_download_filename, export_filename

    if row.template_id == "General Book" and db is not None:
        book = (
            db.execute(
                select(Book)
                .join(BookVersion, BookVersion.book_id == Book.id)
                .where(BookVersion.document_id == row.id)
            )
            .scalars()
            .first()
        )
        if book is not None:
            return book_download_filename(
                ref=book.ref_number,
                subject=book.subject or "",
                when=book.created_at,
                ext=ext,
            )

    meta = load_fields_meta().get(row.template_id) or {}
    arabic_name = meta.get("name_ar", "")
    is_sick = row.leave is not None and row.leave.leave_type == "Sick Leave"
    return export_filename(
        employee_id=row.employee_id,
        ref_number=row.ref_number,
        template_id=row.template_id,
        arabic_name=arabic_name,
        is_sick_leave=is_sick,
        ext=ext,
    )
