"""The generation job announces a sick-leave overwrite of recorded absences.

When a generated sick/annual leave supersedes absence rows, the operator who
uploaded the certificate is told which days were overwritten. The dates travel
on the job-status payload because generation is asynchronous: POST /documents/
generate returns a job id, and the client polls /jobs/{id} for the result.
"""

from __future__ import annotations

from datetime import date

import pytest
from fastapi.testclient import TestClient

from app.api.deps import get_current_user
from app.db.models import User
from app.db.session import get_db
from app.main import create_app
from app.services import job_registry
from app.services.job_registry import JobDocumentItem


@pytest.fixture()
def client(api_db) -> TestClient:
    """An operator: ``documents.generate`` is an operator-level capability."""
    user = User(email="ops@x.ae", password_hash="x", role="operator", status="active")
    api_db.add(user)
    api_db.commit()
    app = create_app()
    app.dependency_overrides[get_db] = lambda: api_db
    app.dependency_overrides[get_current_user] = lambda: user
    return TestClient(app, raise_server_exceptions=True)


def _done_job(*, superseded: list[date]) -> str:
    job_id = job_registry.submit_job()
    job_registry.set_done(
        job_id,
        book_id=1,
        submission_id="sub-1",
        documents=[
            JobDocumentItem(
                document_id=1,
                template_id="Leave Application Form",
                role="primary",
                ref_number="HR/1",
                docx_url="/api/v1/documents/1/download?format=docx",
                pdf_url=None,
            )
        ],
        superseded_absence_dates=superseded,
    )
    return job_id


def test_job_status_carries_the_superseded_absence_dates(client):
    job_id = _done_job(superseded=[date(2026, 7, 9), date(2026, 7, 10)])

    body = client.get(f"/api/v1/jobs/{job_id}").json()

    assert body["status"] == "done"
    assert body["superseded_absence_dates"] == ["2026-07-09", "2026-07-10"]


def test_job_status_defaults_to_no_supersede(client):
    job_id = _done_job(superseded=[])

    body = client.get(f"/api/v1/jobs/{job_id}").json()

    assert body["superseded_absence_dates"] == []
