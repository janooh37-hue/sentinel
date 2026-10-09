"""2026-09-21 HR intake: the 19 new opt-in forms render end-to-end and start
denied by default for non-admins (see permissions.OPT_IN_SERVICE_IDS)."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path

import fitz
import pytest
from sqlalchemy.orm import Session

from app.api.errors import ValidationFailedError
from app.config import Settings, get_settings
from app.core.permissions import SERVICE_CAP_PREFIX, SERVICE_RECORDS_CAP_PREFIX
from app.db.models import BookCategory, Document, Employee, User
from app.services import document_service, perm_service


def _pdf_texts(path: Path) -> list[str]:
    with fitz.open(path) as doc:
        return [page.get_text().strip() for page in doc]


@pytest.fixture()
def generation_env(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> Iterator[tuple[Session, Settings, User]]:
    data_dir = tmp_path / "data"
    monkeypatch.setenv("GSSG_DATA_DIR", str(data_dir))
    get_settings.cache_clear()
    settings = Settings(data_dir=data_dir)
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", _write_pdf)
    db_session.add_all(
        [
            BookCategory(id="HR", prefix="HR"),
            Employee(id="G-2001", name_en="Test Employee", name_ar="موظف اختبار"),
        ]
    )
    user = User(
        email="creator2@example.ae",
        password_hash="x",
        role="operator",
        status="active",
        display_name="Record creator",
    )
    db_session.add(user)
    db_session.commit()
    yield db_session, settings, user
    get_settings.cache_clear()


def _write_pdf(docx_path: Path) -> Path:
    out = docx_path.with_suffix(".pdf")
    doc = fitz.open()
    page = doc.new_page()
    page.insert_text((72, 72), "RENDERED")
    doc.save(out)
    doc.close()
    return out


def test_generate_new_scalar_opt_in_form_end_to_end(
    generation_env: tuple[Session, Settings, User],
) -> None:
    """Loan Request Form (2026-09-21 addition, plain scalar fields) renders
    through the real generate_document -> DocxEngine -> Word-PDF pipeline."""
    db, settings, creator = generation_env

    result = document_service.generate_document(
        db,
        employee_id="G-2001",
        template_id="Loan Request Form",
        fields={
            "loan_amount": "5000",
            "loan_duration": "12 months",
            "loan_purpose": "Home renovation",
        },
        commit=True,
        current_user=creator,
    )

    document = db.get(Document, result.documents[0].document_id)
    assert document is not None
    assert document.base_pdf_path is not None
    assert _pdf_texts(settings.data_dir / document.base_pdf_path) == ["RENDERED"]


def test_generate_new_grid_opt_in_form_end_to_end(
    generation_env: tuple[Session, Settings, User],
) -> None:
    """Expense Claim Form (2026-09-21 addition, configurable items_table grid)
    renders with multiple item() rows populated."""
    db, settings, creator = generation_env

    result = document_service.generate_document(
        db,
        employee_id="G-2001",
        template_id="Expense Claim Form",
        fields={
            "total_amount": "250",
            "claim_remarks": "Taxi + meals",
            "items": [
                {"particulars": "Taxi", "amount": "100"},
                {"particulars": "Meals", "amount": "150"},
            ],
        },
        commit=True,
        current_user=creator,
    )

    document = db.get(Document, result.documents[0].document_id)
    assert document is not None
    assert document.base_pdf_path is not None
    assert _pdf_texts(settings.data_dir / document.base_pdf_path) == ["RENDERED"]

def test_expense_claim_rejects_rows_that_cannot_print(
    generation_env: tuple[Session, Settings, User],
) -> None:
    db, _, creator = generation_env
    with pytest.raises(ValidationFailedError) as exc:
        document_service.generate_document(
            db,
            employee_id="G-2001",
            template_id="Expense Claim Form",
            fields={"items": [{"particulars": str(i)} for i in range(3)]},
            current_user=creator,
        )
    assert exc.value.code == "TOO_MANY_ITEMS"


def test_opt_in_service_denied_by_default_then_grantable(db_session: Session) -> None:
    """A 2026-09-21 addition starts denied for a non-admin; an explicit grant
    (the only path to access before the templates are reviewed) restores it."""
    user = User(
        email="operator3@example.ae",
        password_hash="x",
        role="operator",
        status="active",
        display_name="Operator",
    )
    db_session.add(user)
    db_session.commit()

    create_cap = f"{SERVICE_CAP_PREFIX}Loan Request Form"
    records_cap = f"{SERVICE_RECORDS_CAP_PREFIX}Loan Request Form"

    assert not perm_service.has_capability(db_session, user, create_cap)
    assert not perm_service.has_capability(db_session, user, records_cap)

    # A pre-existing, non-opt-in service stays auto-granted.
    legacy_cap = f"{SERVICE_CAP_PREFIX}Leave Application Form"
    assert perm_service.has_capability(db_session, user, legacy_cap)

    perm_service.set_user_override(db_session, user.id, create_cap, "grant")
    perm_service.set_user_override(db_session, user.id, records_cap, "grant")

    assert perm_service.has_capability(db_session, user, create_cap)
    assert perm_service.has_capability(db_session, user, records_cap)

    # Clearing the override returns the opt-in service to denied (not the
    # legacy default-granted behaviour).
    perm_service.set_user_override(db_session, user.id, create_cap, None)
    assert not perm_service.has_capability(db_session, user, create_cap)


def test_admin_has_opt_in_service_without_any_grant(db_session: Session) -> None:
    """Admin's lockout-protection bypass must not depend on the opt-in
    rollout — it always sees every recognized dynamic capability."""
    admin = User(
        email="admin3@example.ae",
        password_hash="x",
        role="admin",
        status="active",
        display_name="Admin",
    )
    db_session.add(admin)
    db_session.commit()

    create_cap = f"{SERVICE_CAP_PREFIX}Loan Request Form"
    assert perm_service.has_capability(db_session, admin, create_cap)
    assert create_cap in perm_service.effective_caps(db_session, admin)
