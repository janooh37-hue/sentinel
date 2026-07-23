"""Create a no-classification, no-ref Report on the General Book paper,
signed at creation by a picked employee. Reuses the render core only —
NOT document_service.generate_document (see the design spec)."""

from __future__ import annotations

import uuid
from datetime import datetime
from pathlib import Path

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.errors import AppError
from app.config import get_settings
from app.core import manager_override
from app.core.book_text import build_search_text
from app.core.docx_engine import DocxEngine, _postprocess_general_book_footer
from app.db.models import (
    Book,
    BookVersion,
    Document,
    Employee,
    GeneralBookRecipient,
    Submitter,
    User,
)
from app.services._pdf_executor import convert_docx_to_pdf
from app.services.document_service import (
    GENERAL_BOOK_BODY_SENTINEL,
    _output_dir_for_admin,
)

_TEMPLATE_ID = "Report"
_GS_CATEGORY = "GS"  # same category the General Book uses → shows in that list


def _resolve_signer(db: Session, employee_id: str) -> tuple[str, str, str | None]:
    """(name, designation, signature_path|None) for the picked employee."""
    emp = db.get(Employee, employee_id)
    if emp is None:
        raise AppError("EMPLOYEE_NOT_FOUND", f"Employee {employee_id} not found", http_status=404)
    name = (emp.name_ar or emp.name_en or "").strip()
    title = (emp.position_ar or emp.position or "").strip()
    sub = (
        db.execute(select(Submitter).where(Submitter.employee_id == employee_id)).scalars().first()
    )
    sig: str | None = sub.stored_sig_path if sub is not None else None
    if sig is not None:
        p = Path(sig)
        if not p.is_absolute():
            p = get_settings().data_dir / p
        sig = str(p) if p.is_file() else None
    return name, title, sig


def _resolve_recipient(db: Session, recipient_id: int | None) -> str:
    if recipient_id is None:
        return ""
    row = db.get(GeneralBookRecipient, recipient_id)
    return row.name if row is not None else ""


def create_report(
    db: Session,
    *,
    operator: User,
    signer_employee_id: str,
    recipient_id: int | None,
    subject: str,
    date: str | None,
    body_html: str,
    sign: bool = True,
) -> Book:
    name, title, sig_path = _resolve_signer(db, signer_employee_id)

    # Naive LOCAL timestamp — every other book path (document_service) stamps
    # created_at with datetime.now() (local), so the Report must too or it sorts
    # 4h behind its siblings in the shared Records list (buries itself off-screen
    # under a created_at-DESC sort). Do NOT use UTC here (2026-07-23 QA fix).
    now = datetime.now()

    # 1) Book row with a unique internal filing id (invisible on paper).
    book = Book(
        category_id=_GS_CATEGORY,
        ref_number=f"__pending_{uuid.uuid4().hex}__",
        subject=subject,
        direction="outgoing",
        classification_code=None,
        employee_id=None,
        submitted_by_user_id=operator.id,
        approval_state="approved",
        created_at=now,
    )
    db.add(book)
    db.flush()  # assigns book.id
    book.ref_number = f"REPORT-{book.id}"
    db.flush()

    # 2) Build the render data — mirrors word_book_service MINUS ref.
    data: dict[str, object] = {
        "date": date or datetime.now().strftime("%d-%m-%Y"),
        "subject": subject,
        "body": GENERAL_BOOK_BODY_SENTINEL,
        "body_html": body_html,
        "recipient_name": _resolve_recipient(db, recipient_id),
        "cc": "",
        "submitter_g": operator.employee_id or "",  # footer = signed-in account
    }
    manager_override.apply(
        data,
        {"name_ar": name, "name_en": name, "title": title, "sig_path": sig_path},
        embed=bool(sign and sig_path),
        prefer_arabic=True,
    )

    # 3) Render onto the report paper + footer sync. No ref / Aztec stamp.
    settings = get_settings()
    out_dir = _output_dir_for_admin(_TEMPLATE_ID)
    docx_path = out_dir / f"Report_{book.ref_number}_{now:%Y%m%d%H%M%S}.docx"
    DocxEngine(settings.templates_dir).fill(_TEMPLATE_ID, data, docx_path)
    _postprocess_general_book_footer(docx_path)
    pdf_path = convert_docx_to_pdf(docx_path)  # lenient: may return None

    # 4) Document + signed BookVersion.
    doc = Document(
        template_id=_TEMPLATE_ID,
        ref_number=book.ref_number,
        docx_path=str(docx_path),
        pdf_path=str(pdf_path) if pdf_path else None,
        submission_id=str(uuid.uuid4()),
        role="primary",
        created_at=now,  # local, like Book/BookVersion — dashboard sorts docs by this
    )
    db.add(doc)
    db.flush()

    version_no = (
        db.query(func.max(BookVersion.version_no)).filter(BookVersion.book_id == book.id).scalar()
        or 0
    ) + 1
    embedded = bool(sign and sig_path)
    version = BookVersion(
        book_id=book.id,
        version_no=version_no,
        trigger="initial",
        status="approved",
        template_id=_TEMPLATE_ID,
        fields={"signer_employee_id": signer_employee_id, "signed": embedded},
        created_by_user_id=operator.id,
        created_at=now,
        document_id=doc.id,
        signed_pdf_path=str(pdf_path) if (embedded and pdf_path) else None,
        signed_by_user_id=operator.id if embedded else None,
        signed_at=now if embedded else None,
        manager_sig_embedded=embedded,
    )
    db.add(version)

    # 5) FTS corpus + commit.
    book.search_text = build_search_text(subject=subject, ref=book.ref_number, body="")
    db.commit()
    db.refresh(book)
    return book
