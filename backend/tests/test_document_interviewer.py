from types import SimpleNamespace

import pytest

from app.api.errors import NotFoundError
from app.db.models import Submitter
from app.services import document_service, settings_service


@pytest.mark.parametrize(
    "template_id",
    ["Employee Exit Form", "Employee Exit Form – Project or Contract"],  # noqa: RUF001
)
def test_exit_interviewer_is_independent_and_signature_is_opt_in(
    db_session, monkeypatch, tmp_path, template_id
):
    signature = tmp_path / "interviewer.png"
    signature.write_bytes(b"signature")
    employee_signer = Submitter(name="Employee signer", stored_sig_path=str(signature))
    interviewer = Submitter(name="Interviewer", stored_sig_path=str(signature))
    db_session.add_all([employee_signer, interviewer])
    db_session.flush()
    monkeypatch.setattr(
        settings_service,
        "get_settings",
        lambda _db: SimpleNamespace(signature_size_mm=20, signature_boldness=1),
    )
    monkeypatch.setattr(document_service, "resolve_manager", lambda *_args, **_kwargs: None)

    def build(embed_interviewer):
        return document_service._build_template_data(
            db_session,
            template_id=template_id,
            employee=None,
            employee_id=None,
            fields={"interviewer_id": str(interviewer.id)},
            manager_id=None,
            submitter_id=employee_signer.id,
            embed_signature={"interviewer": embed_interviewer},
            current_user=None,
        )

    unsigned = build(False)
    assert unsigned["submitter_name"] == "Employee signer"
    assert unsigned["submitter_sig_path"] == str(signature)
    assert unsigned["interviewer_name"] == "Interviewer"
    assert "interviewer_sig_path" not in unsigned

    signed = build(True)
    assert signed["submitter_name"] == "Employee signer"
    assert signed["submitter_sig_path"] == str(signature)
    assert signed["interviewer_name"] == "Interviewer"
    assert signed["interviewer_sig_path"] == str(signature)

    with pytest.raises(NotFoundError):
        document_service._build_template_data(
            db_session,
            template_id=template_id,
            employee=None,
            employee_id=None,
            fields={"interviewer_id": "999999"},
            manager_id=None,
            submitter_id=employee_signer.id,
            embed_signature={"interviewer": True},
            current_user=None,
        )
