import pytest
from PIL import Image

from app.config import Settings
from app.core import form_policy
from app.core.docx_engine import _FORM_REGISTRY
from app.db.models import Book, BookCategory, Employee, Manager
from app.services import book_service, document_service
from app.services.template_service import load_fields_meta
from tests.conftest import make_user


def test_all_forms_cap_signature_width() -> None:
    for spec in _FORM_REGISTRY.values():
        adapter = spec["adapter"]
        assert adapter({})["_sig_size_mm"] <= 32
        assert adapter({"_sig_size_mm": 45})["_sig_size_mm"] <= 32


@pytest.mark.parametrize(
    "name",
    (
        "Leave Permit Form",
        "Administrative Leave Form",
        "Leave Application Form",
        "Duty Resumption Form",
        "Inmate Conduct Violations",
        "Manpower Requisition Form",
        "Employee Performance Appraisal Form",
        "Leave Encashment Form",
        "Loan Request Form",
        "Promotion and Salary Increment Request Form",
        "Salary Advance Request Form",
        "Breach of Discipline Form",
        "Allowance Request Form",
        "Employee Overtime Form",
        "Passport Release Form",
        "Employee Clearance Form",
        "HR Request Form",
    ),
)
def test_chain_forms_keep_manager_picker_without_embed_checkbox(name: str) -> None:
    fields = load_fields_meta()[name]["fields"]
    assert any(field["type"] == "manager_picker" for field in fields)
    assert all(field["key"] != "hand_sign_manager" for field in fields)
    assert form_policy.signing_path_of(name) == "chain"


@pytest.mark.parametrize(
    "template_id",
    (
        "Leave Permit Form",
        "Administrative Leave Form",
        "Passport Release Form",
        "Employee Clearance Form",
    ),
)
def test_chain_generation_ignores_manager_embed_request(
    db_session, tmp_path, monkeypatch, template_id: str
) -> None:
    settings = Settings(data_dir=tmp_path / "data")
    monkeypatch.setattr(document_service, "get_settings", lambda: settings)
    monkeypatch.setattr(document_service, "convert_docx_to_pdf", lambda _path: None)
    db_session.add_all(
        [
            BookCategory(id="HR", prefix="HR"),
            BookCategory(id="GS", prefix="GS"),
            Employee(id="G-4301", name_en="Chain Employee", name_ar="موظف"),
        ]
    )
    submitter = make_user(db_session, email="chain-operator@test.ae")
    signer = make_user(db_session, role="manager", email="chain-manager@test.ae")
    manager = Manager(name_en="Chain Manager", name_ar="المدير", user_id=signer.id)
    db_session.add(manager)
    db_session.commit()
    sig_dir = settings.data_dir / "signatures" / "managers"
    sig_dir.mkdir(parents=True, exist_ok=True)
    sig_path = sig_dir / f"manager_{manager.id}.png"
    Image.new("RGBA", (80, 40), (0, 0, 0, 255)).save(sig_path)
    manager.sig_path = str(sig_path)
    db_session.commit()

    result = document_service.generate_document(
        db_session,
        employee_id="G-4301",
        template_id=template_id,
        fields={},
        manager_id=manager.id,
        embed_signature={"manager": True},
        current_user=submitter,
    )

    book = db_session.get_one(Book, result.book_id)
    version = max(book.versions, key=lambda item: item.version_no)
    assert version.manager_sig_embedded is False
    assert book.approval_state == "none"
    assert form_policy.signing_path_of(template_id) == "chain"
    if template_id == "Leave Permit Form":
        submitted = book_service.submit_for_approval(
            db_session,
            book.id,
            urgency="Normal",
            approver_user_id=None,
            reviewer_user_ids=[],
            submitted_by_user_id=submitter.id,
        )
        assert submitted.approval_state == "pending"
        assert version.approval_steps[0].assignee_user_id == signer.id
