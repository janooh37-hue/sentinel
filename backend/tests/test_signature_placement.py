"""Behavior tests for signature_placement_service — the public contract of
approval-signature-placement plan §§5, 7. The Word-COM measurement/movement
primitives themselves are proven separately and empirically against real
Word in ``test_artifact_word_windows.py::test_signature_placement_word_smoke``
(the isolated, opt-in Word gate); this file exercises everything ABOVE that
boundary — identity/history bookkeeping, authorization, and the
compare-and-set publish transaction — with the Word layer mocked, so it runs
in every ordinary test invocation without Microsoft Word installed.
"""

from __future__ import annotations

from pathlib import Path

import pymupdf
import pytest
from sqlalchemy.orm import Session

from app.api.errors import AppError, ConflictError, NotFoundError
from app.config import Settings
from app.core.signature_layout import SignatureGeometry, SignatureLayout, SignaturePageInfo
from app.db.models import (
    Book,
    BookCategory,
    BookVersion,
    Document,
    SignatureArtifactRevision,
    User,
)
from app.services import _pdf_executor
from app.services import signature_placement_service as sps


def _pdf(path: Path, labels: list[str]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = pymupdf.open()
    try:
        for label in labels:
            page = doc.new_page(width=300, height=400)
            page.insert_text((40, 80), label)
        doc.save(path)
    finally:
        doc.close()
    return path


def _record(
    db: Session, tmp_path: Path, *, manager_sig_embedded: bool = False
) -> tuple[Book, BookVersion, Document]:
    if db.get(BookCategory, "HR") is None:
        db.add(BookCategory(id="HR", prefix="HR"))
    db.flush()
    generated = _pdf(tmp_path / "generated.pdf", ["FORM"])
    docx_path = tmp_path / "source.docx"
    docx_path.write_bytes(b"docx-placeholder")
    document = Document(
        template_id="General Book",
        ref_number="HR-1",
        docx_path=docx_path.relative_to(tmp_path).as_posix(),
        pdf_path=generated.relative_to(tmp_path).as_posix(),
        submission_id="submission-1",
        role="primary",
    )
    db.add(document)
    db.flush()
    book = Book(category_id="HR", ref_number="HR-1", approval_state="approved")
    db.add(book)
    db.flush()
    version = BookVersion(
        book_id=book.id,
        version_no=1,
        document_id=document.id,
        template_id="General Book",
        fields={},
        status="approved",
        manager_sig_embedded=manager_sig_embedded,
    )
    db.add(version)
    db.commit()
    return book, version, document


def _fake_layout(*, page: int, x: float, y: float, sha: str, signature_id: str) -> SignatureLayout:
    return SignatureLayout(
        source_sha256=sha,
        pages=(
            SignaturePageInfo(page=page, width_pt=612.0, height_pt=792.0, anchor_paragraph_index=0),
        ),
        drawings={
            signature_id: SignatureGeometry(page=page, x=x, y=y, width_pt=90.0, height_pt=40.0)
        },
    )


# ---------------------------------------------------------------------------
# can_correct — authorization
# ---------------------------------------------------------------------------


def test_can_correct_original_signer_succeeds() -> None:
    version = BookVersion(signature_revision=3)
    active = SignatureArtifactRevision(revision=3, signer_user_id=7)
    assert sps.can_correct(
        version=version, active_revision=active, actor_user_id=7, actor_is_admin=False
    )


def test_can_correct_different_approver_fails() -> None:
    version = BookVersion(signature_revision=3)
    active = SignatureArtifactRevision(revision=3, signer_user_id=7)
    assert not sps.can_correct(
        version=version, active_revision=active, actor_user_id=8, actor_is_admin=False
    )


def test_can_correct_admin_always_succeeds_even_without_active_revision() -> None:
    version = BookVersion(signature_revision=0)
    assert sps.can_correct(
        version=version, active_revision=None, actor_user_id=1, actor_is_admin=True
    )


def test_can_correct_auto_embedded_no_signer_is_admin_only() -> None:
    version = BookVersion(signature_revision=1)
    active = SignatureArtifactRevision(revision=1, signer_user_id=None)
    assert not sps.can_correct(
        version=version, active_revision=active, actor_user_id=1, actor_is_admin=False
    )
    assert sps.can_correct(
        version=version, active_revision=active, actor_user_id=1, actor_is_admin=True
    )


def test_can_correct_stale_revision_fails_even_for_original_signer() -> None:
    version = BookVersion(signature_revision=4)  # a later correction already landed
    active = SignatureArtifactRevision(revision=3, signer_user_id=7)
    assert not sps.can_correct(
        version=version, active_revision=active, actor_user_id=7, actor_is_admin=False
    )


# ---------------------------------------------------------------------------
# capture_initial_revision / invalidate_revision
# ---------------------------------------------------------------------------


def test_capture_initial_revision_noop_without_manager_drawing(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    settings = Settings(data_dir=tmp_path, templates_dir=tmp_path)
    monkeypatch.setattr(sps, "get_settings", lambda: settings)
    version = BookVersion(id=1, book_id=1, version_no=1, signature_revision=0)
    unmarked = tmp_path / "unmarked.docx"
    from docx import Document as DocxFile

    DocxFile().save(str(unmarked))

    row = sps.capture_initial_revision(
        db_session,
        version=version,
        source_kind=sps.SOURCE_KIND_APPROVAL,
        signer_user_id=5,
        docx_path=unmarked,
        primary_pdf_path=None,
        published_pdf_path=None,
    )
    assert row is None
    assert version.signature_revision == 0


def test_capture_initial_revision_captures_and_sets_revision(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    settings = Settings(data_dir=tmp_path, templates_dir=tmp_path)
    monkeypatch.setattr(sps, "get_settings", lambda: settings)
    version = BookVersion(id=1, book_id=1, version_no=1, signature_revision=0)

    from docx import Document as DocxFile

    from app.core.docx_engine import stamp_signature_above_name

    letter = tmp_path / "letter.docx"
    doc = DocxFile()
    doc.add_paragraph("Body")
    doc.add_paragraph("Ali Manager")
    doc.save(str(letter))
    sig = tmp_path / "sig.png"
    from PIL import Image

    Image.new("RGBA", (60, 30), (0, 0, 0, 255)).save(sig)
    assert stamp_signature_above_name(letter, str(sig), ["Ali Manager"], size_mm=32.0, boldness=1)

    row = sps.capture_initial_revision(
        db_session,
        version=version,
        source_kind=sps.SOURCE_KIND_APPROVAL,
        signer_user_id=5,
        docx_path=letter,
        primary_pdf_path=None,
        published_pdf_path=None,
    )
    assert row is not None
    assert row.revision == 1
    assert row.action == sps.ACTION_INITIAL
    assert row.signer_user_id == 5
    assert version.signature_revision == 1
    retained = settings.data_dir / row.docx_path
    assert retained.is_file()
    assert retained != letter  # a COPY, source untouched
    assert letter.is_file()

    # Idempotent: a second call after signature_revision advanced is a no-op.
    again = sps.capture_initial_revision(
        db_session,
        version=version,
        source_kind=sps.SOURCE_KIND_APPROVAL,
        signer_user_id=5,
        docx_path=letter,
        primary_pdf_path=None,
        published_pdf_path=None,
    )
    assert again is None


def test_invalidate_revision_resets_to_zero_keeps_history_row(
    db_session: Session,
) -> None:
    version = BookVersion(id=1, book_id=1, version_no=1, signature_revision=2)
    sps.invalidate_revision(db_session, version=version)
    assert version.signature_revision == 0


def test_measurement_cache_key_and_forced_refresh(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    first = tmp_path / "first.docx"
    duplicate = tmp_path / "duplicate.docx"
    first.write_bytes(b"same-docx")
    duplicate.write_bytes(b"same-docx")
    version = ["16.0"]
    conversions = 0

    def _fake_measure(
        docx_path: Path, *, converter: object, source_sha256: str | None = None
    ) -> SignatureLayout:
        del docx_path, converter
        nonlocal conversions
        conversions += 1
        assert source_sha256 is not None
        return _fake_layout(page=1, x=0.2, y=0.3, sha=source_sha256, signature_id="sig")

    monkeypatch.setattr("app.services._pdf_executor.word_pdf.word_version", lambda: version[0])
    monkeypatch.setattr(
        "app.services._pdf_executor.word_pdf.convert",
        lambda _path: pytest.fail("unexpected conversion"),
    )
    monkeypatch.setattr("app.core.signature_layout.measure_signature_layout", _fake_measure)
    _pdf_executor._measurement_cache.clear()
    try:
        assert _pdf_executor._measure_in_subprocess(str(first)).source_sha256
        assert _pdf_executor._measure_in_subprocess(str(duplicate)).source_sha256
        assert conversions == 1

        _pdf_executor._measure_in_subprocess(str(first), force=True)
        assert conversions == 2

        version[0] = "16.1"
        _pdf_executor._measure_in_subprocess(str(first))
        assert conversions == 3

        monkeypatch.setattr("app.core.signature_layout.SIGNATURE_LAYOUT_SCHEMA_VERSION", 2)
        _pdf_executor._measure_in_subprocess(str(first))
        assert conversions == 4

        duplicate.write_bytes(b"different-docx")
        _pdf_executor._measure_in_subprocess(str(duplicate))
        assert conversions == 5
    finally:
        _pdf_executor._measurement_cache.clear()


# ---------------------------------------------------------------------------
# move_signature — authorization, CAS, and the publish transaction
# ---------------------------------------------------------------------------


def _active_row(
    db: Session, version: BookVersion, tmp_path: Path, *, signer_user_id: int | None
) -> SignatureArtifactRevision:
    tracked_docx = tmp_path / "tracked.docx"
    tracked_docx.write_bytes(b"tracked-docx-bytes")
    tracked_pdf = _pdf(tmp_path / "tracked.pdf", ["TRACKED"])
    row = SignatureArtifactRevision(
        version_id=version.id,
        revision=1,
        source_kind=sps.SOURCE_KIND_APPROVAL,
        signer_user_id=signer_user_id,
        docx_path=tracked_docx.relative_to(tmp_path).as_posix(),
        primary_pdf_path=tracked_pdf.relative_to(tmp_path).as_posix(),
        published_pdf_path=None,
        previous_published_pdf_path=None,
        docx_sha256=sps._sha256_file(tracked_docx),
        manifest=[],
        action=sps.ACTION_INITIAL,
        signature_id=None,
        before_geometry=None,
        after_geometry=None,
        actor_user_id=signer_user_id,
    )
    db.add(row)
    version.signature_revision = 1
    db.commit()
    return row


def test_move_signature_wrong_actor_is_forbidden(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    settings = Settings(data_dir=tmp_path, templates_dir=tmp_path)
    monkeypatch.setattr(sps, "get_settings", lambda: settings)
    _book, version, document = _record(db_session, tmp_path)
    active = _active_row(db_session, version, tmp_path, signer_user_id=7)
    signer = User(id=7, email="signer@x.ae", password_hash="x", role="manager", status="active")
    other = User(id=8, email="other@x.ae", password_hash="x", role="operator", status="active")
    db_session.add_all([signer, other])
    db_session.commit()

    with pytest.raises(AppError) as error:
        sps.move_signature(
            db_session,
            document.id,
            user=other,
            signature_id="whatever",
            signature_revision=1,
            package_revision=0,
            source_sha256=active.docx_sha256,
            page=1,
            x=0.1,
            y=0.1,
        )
    assert error.value.http_status == 403
    db_session.refresh(version)
    assert version.signature_revision == 1  # untouched


def test_move_signature_admin_without_active_revision_is_not_found(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """`can_correct` authorizes an administrator unconditionally, even with
    no active revision — that predicate answers "would this actor be
    allowed", not "does a target exist". `move_signature` must still refuse
    cleanly (404, not an internal assertion crash) when there is nothing to
    correct yet."""
    settings = Settings(data_dir=tmp_path, templates_dir=tmp_path)
    monkeypatch.setattr(sps, "get_settings", lambda: settings)
    _book, _version, document = _record(db_session, tmp_path)
    admin = User(id=1, email="admin@x.ae", password_hash="x", role="admin", status="active")
    db_session.add(admin)
    db_session.commit()

    with pytest.raises(NotFoundError) as error:
        sps.move_signature(
            db_session,
            document.id,
            user=admin,
            signature_id="whatever",
            signature_revision=0,
            package_revision=0,
            source_sha256="0" * 64,
            page=1,
            x=0.1,
            y=0.1,
        )
    assert error.value.code == "SIGNATURE_SOURCE_UNAVAILABLE"


def test_move_signature_stale_revision_conflicts_before_any_word_work(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    settings = Settings(data_dir=tmp_path, templates_dir=tmp_path)
    monkeypatch.setattr(sps, "get_settings", lambda: settings)
    _book, version, document = _record(db_session, tmp_path)
    active = _active_row(db_session, version, tmp_path, signer_user_id=7)
    signer = User(id=7, email="signer2@x.ae", password_hash="x", role="manager", status="active")
    db_session.add(signer)
    db_session.commit()

    called = False

    def _should_not_run(*_args: object, **_kwargs: object) -> None:
        nonlocal called
        called = True
        raise AssertionError("measure_signature_position must not run on a stale revision")

    monkeypatch.setattr(_pdf_executor, "measure_signature_position", _should_not_run)

    with pytest.raises(ConflictError):
        sps.move_signature(
            db_session,
            document.id,
            user=signer,
            signature_id="whatever",
            signature_revision=99,  # stale
            package_revision=0,
            source_sha256=active.docx_sha256,
            page=1,
            x=0.1,
            y=0.1,
        )
    assert called is False


def test_move_signature_success_appends_revision_and_publishes(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    settings = Settings(data_dir=tmp_path, templates_dir=tmp_path)
    monkeypatch.setattr(sps, "get_settings", lambda: settings)
    monkeypatch.setattr("app.services.included_papers_service.get_settings", lambda: settings)
    book, version, document = _record(db_session, tmp_path)
    active = _active_row(db_session, version, tmp_path, signer_user_id=7)
    signer = User(id=7, email="signer3@x.ae", password_hash="x", role="manager", status="active")
    db_session.add(signer)
    db_session.commit()

    signature_id = "sig-under-test"
    before_layout = _fake_layout(
        page=1, x=0.2, y=0.2, sha=active.docx_sha256, signature_id=signature_id
    )
    moved_pdf = _pdf(tmp_path / "moved-output.pdf", ["MOVED-FORM"])

    def _fake_measure(docx_path: Path) -> SignatureLayout:
        return before_layout

    def _fake_move(
        source: Path,
        destination: Path,
        *,
        signature_id: str,
        page: int,
        x: float,
        y: float,
        layout: SignatureLayout,
        before_pdf: Path,
        width_pt: float | None = None,
    ) -> tuple[SignatureLayout, Path]:
        assert width_pt is None  # no width requested → size untouched
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"moved-docx-bytes")
        after_layout = _fake_layout(page=page, x=x, y=y, sha="after-sha", signature_id=signature_id)
        return after_layout, moved_pdf

    monkeypatch.setattr(_pdf_executor, "measure_signature_position", _fake_measure)
    monkeypatch.setattr(_pdf_executor, "move_signature_position", _fake_move)

    description = sps.move_signature(
        db_session,
        document.id,
        user=signer,
        signature_id=signature_id,
        signature_revision=1,
        package_revision=0,
        source_sha256=active.docx_sha256,
        page=1,
        x=0.35,
        y=0.4,
    )

    db_session.refresh(version)
    db_session.refresh(book)
    assert version.signature_revision == 2
    assert book.included_papers_revision == 1
    assert description.signature_revision == 2
    assert description.package_revision == 1

    rows = (
        db_session.query(SignatureArtifactRevision)
        .filter(SignatureArtifactRevision.version_id == version.id)
        .order_by(SignatureArtifactRevision.revision)
        .all()
    )
    assert [r.revision for r in rows] == [1, 2]
    new_row = rows[1]
    assert new_row.action == sps.ACTION_MOVE
    assert new_row.signature_id == signature_id
    assert new_row.signer_user_id == 7  # carried from the original signer, not the correcting admin
    assert new_row.before_geometry == {
        "page": 1,
        "x": 0.2,
        "y": 0.2,
        "width_pt": 90.0,
        "height_pt": 40.0,
    }
    assert new_row.after_geometry == {
        "page": 1,
        "x": 0.35,
        "y": 0.4,
        "width_pt": 90.0,
        "height_pt": 40.0,
    }
    assert (settings.data_dir / new_row.docx_path).is_file()
    assert new_row.published_pdf_path is not None

    from app.db.models import AuditLog

    audit = db_session.query(AuditLog).filter(AuditLog.action == "signature.position_changed").one()
    assert audit.entity_id == str(document.id)


def test_move_signature_layout_unsupported_page_rejected(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    settings = Settings(data_dir=tmp_path, templates_dir=tmp_path)
    monkeypatch.setattr(sps, "get_settings", lambda: settings)
    _book, version, document = _record(db_session, tmp_path)
    active = _active_row(db_session, version, tmp_path, signer_user_id=7)
    signer = User(id=7, email="signer4@x.ae", password_hash="x", role="manager", status="active")
    db_session.add(signer)
    db_session.commit()

    signature_id = "sig-unsupported"
    layout = _fake_layout(page=1, x=0.2, y=0.2, sha=active.docx_sha256, signature_id=signature_id)

    def _raise_unsupported(*_args: object, **_kwargs: object) -> None:
        from app.core.signature_layout import SignatureLayoutUnsupportedError

        raise SignatureLayoutUnsupportedError("no safe anchor on page 9")

    monkeypatch.setattr(_pdf_executor, "measure_signature_position", lambda _p: layout)
    monkeypatch.setattr(_pdf_executor, "move_signature_position", _raise_unsupported)

    from app.core.signature_layout import SignatureLayoutUnsupportedError

    with pytest.raises(SignatureLayoutUnsupportedError):
        sps.move_signature(
            db_session,
            document.id,
            user=signer,
            signature_id=signature_id,
            signature_revision=1,
            package_revision=0,
            source_sha256=active.docx_sha256,
            page=9,
            x=0.1,
            y=0.1,
        )
    db_session.refresh(version)
    assert version.signature_revision == 1  # untouched — failure cleaned up, nothing committed
    retained_root = settings.data_dir / "signature_artifacts" / str(version.id)
    # No revision-2 directory left behind.
    assert not any(
        p.name.startswith("2-") for p in (retained_root.iterdir() if retained_root.is_dir() else [])
    )


def test_move_signature_with_width_resizes_and_records_sizes(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    settings = Settings(data_dir=tmp_path, templates_dir=tmp_path)
    monkeypatch.setattr(sps, "get_settings", lambda: settings)
    monkeypatch.setattr("app.services.included_papers_service.get_settings", lambda: settings)
    _book, version, document = _record(db_session, tmp_path)
    active = _active_row(db_session, version, tmp_path, signer_user_id=7)
    signer = User(id=7, email="signer5@x.ae", password_hash="x", role="manager", status="active")
    db_session.add(signer)
    db_session.commit()

    signature_id = "sig-resized"
    before_layout = _fake_layout(
        page=1, x=0.2, y=0.2, sha=active.docx_sha256, signature_id=signature_id
    )
    moved_pdf = _pdf(tmp_path / "resized-output.pdf", ["RESIZED-FORM"])
    requested_widths: list[float | None] = []

    def _fake_move(
        source: Path,
        destination: Path,
        *,
        signature_id: str,
        page: int,
        x: float,
        y: float,
        layout: SignatureLayout,
        before_pdf: Path,
        width_pt: float | None = None,
    ) -> tuple[SignatureLayout, Path]:
        requested_widths.append(width_pt)
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"resized-docx-bytes")
        assert width_pt is not None
        after_layout = SignatureLayout(
            source_sha256="after-sha",
            pages=layout.pages,
            drawings={
                signature_id: SignatureGeometry(
                    page=page, x=x, y=y, width_pt=width_pt, height_pt=width_pt * 40.0 / 90.0
                )
            },
        )
        return after_layout, moved_pdf

    monkeypatch.setattr(_pdf_executor, "measure_signature_position", lambda _p: before_layout)
    monkeypatch.setattr(_pdf_executor, "move_signature_position", _fake_move)

    sps.move_signature(
        db_session,
        document.id,
        user=signer,
        signature_id=signature_id,
        signature_revision=1,
        package_revision=0,
        source_sha256=active.docx_sha256,
        page=1,
        x=0.3,
        y=0.3,
        width_pt=135.0,
    )

    assert requested_widths == [135.0]
    new_row = (
        db_session.query(SignatureArtifactRevision)
        .filter(SignatureArtifactRevision.version_id == version.id)
        .filter(SignatureArtifactRevision.revision == 2)
        .one()
    )
    assert new_row.before_geometry is not None and new_row.after_geometry is not None
    assert new_row.before_geometry["width_pt"] == 90.0
    assert new_row.after_geometry["width_pt"] == 135.0
    assert new_row.after_geometry["height_pt"] == pytest.approx(60.0)

    import json

    from app.db.models import AuditLog

    audit = db_session.query(AuditLog).filter(AuditLog.action == "signature.position_changed").one()
    payload = json.loads(audit.payload or "{}")
    assert payload["before_width_pt"] == 90.0
    assert payload["after_width_pt"] == 135.0


# ---------------------------------------------------------------------------
# _find_probe — measurement must not mistake the transparent spacer for a probe
# ---------------------------------------------------------------------------


def test_find_probe_skips_overlapping_transparent_spacer(tmp_path: Path) -> None:
    """A nudged signature overlaps the transparent spacer its first move left
    at the original rect. The spacer comes first in the page and the probe
    shows through its center, but the probe's OWN rect must be reported."""
    from app.core.signature_layout import (
        _distinct_rgb,
        _find_probe,
        _probe_png_bytes,
        _transparent_png_bytes,
    )

    rgb = _distinct_rgb(3)
    spacer_rect = pymupdf.Rect(90, 420, 180, 456)  # the original position
    probe_rect = pymupdf.Rect(120, 420, 210, 456)  # nudged right, covering its center
    pdf_path = tmp_path / "measure.pdf"
    doc = pymupdf.open()
    try:
        page = doc.new_page(width=595, height=842)
        page.insert_image(spacer_rect, stream=_transparent_png_bytes())
        page.insert_image(probe_rect, stream=_probe_png_bytes(rgb))
        doc.save(pdf_path)
    finally:
        doc.close()

    measured = pymupdf.open(pdf_path)
    try:
        located = _find_probe(measured, rgb)
    finally:
        measured.close()

    assert located is not None
    page_index, bbox = located
    assert page_index == 0
    assert bbox == pytest.approx(tuple(probe_rect))


# ---------------------------------------------------------------------------
# write_signature_position / validate_move — resizing (no Word needed: the
# DOCX rewrite and the remeasurement check are pure functions of their inputs)
# ---------------------------------------------------------------------------

_SIG_ID = "0123456789abcdef0123456789abcdef"


def _inline_signed_docx(path: Path, tmp_path: Path) -> Path:
    """A DOCX with one INLINE marked manager signature, 90 x 45 pt (2:1 image)."""
    from docx import Document as DocxFile
    from docx.oxml.ns import qn
    from docx.shared import Pt
    from PIL import Image

    from app.core.signature_layout import marker_descr, marker_name

    png = tmp_path / "sig-2to1.png"
    Image.new("RGBA", (60, 30), (0, 0, 200, 255)).save(png)
    doc = DocxFile()
    doc.add_paragraph("Body")
    run = doc.add_paragraph().add_run()
    run.add_picture(str(png), width=Pt(90))
    docpr = run._element.find(f".//{qn('wp:docPr')}")
    docpr.set("name", marker_name(_SIG_ID))
    docpr.set("descr", marker_descr("manager", _SIG_ID))
    doc.save(str(path))
    return path


def _a4_layout() -> SignatureLayout:
    return SignatureLayout(
        source_sha256="src",
        pages=(
            SignaturePageInfo(page=1, width_pt=595.0, height_pt=842.0, anchor_paragraph_index=0),
        ),
        drawings={_SIG_ID: SignatureGeometry(page=1, x=0.1, y=0.1, width_pt=90.0, height_pt=45.0)},
    )


def _target_sizes(docx_path: Path) -> tuple[tuple[int, int], tuple[int, int]]:
    """``((wp:extent cx, cy), (pic a:ext cx, cy))`` of the marked signature."""
    from docx import Document as DocxFile
    from docx.oxml.ns import qn

    from app.core.signature_layout import marker_name

    doc = DocxFile(str(docx_path))
    docpr = next(
        d for d in doc.element.body.iter(qn("wp:docPr")) if d.get("name") == marker_name(_SIG_ID)
    )
    container = docpr.getparent()
    extent = container.find(qn("wp:extent"))
    pic_ext = container.find(f".//{qn('pic:spPr')}/{qn('a:xfrm')}/{qn('a:ext')}")
    return (
        (int(extent.get("cx")), int(extent.get("cy"))),
        (int(pic_ext.get("cx")), int(pic_ext.get("cy"))),
    )


def _inline_extents(docx_path: Path) -> list[tuple[int, int]]:
    from docx import Document as DocxFile
    from docx.oxml.ns import qn

    doc = DocxFile(str(docx_path))
    return [
        (int(inline.find(qn("wp:extent")).get("cx")), int(inline.find(qn("wp:extent")).get("cy")))
        for inline in doc.element.body.iter(qn("wp:inline"))
    ]


def test_resize_writes_new_extent_and_picture_size_with_locked_aspect(tmp_path: Path) -> None:
    from app.core.signature_layout import EMU_PER_POINT, write_signature_position

    source = _inline_signed_docx(tmp_path / "source.docx", tmp_path)
    destination = tmp_path / "out" / "moved.docx"
    write_signature_position(
        source,
        destination,
        signature_id=_SIG_ID,
        page=1,
        x=0.2,
        y=0.3,
        layout=_a4_layout(),
        width_pt=120.0,
    )

    expected = (120 * EMU_PER_POINT, 60 * EMU_PER_POINT)
    extent, pic_ext = _target_sizes(destination)
    assert extent == expected
    assert pic_ext == expected
    # The previously-inline signature leaves its spacer at the ORIGINAL size,
    # so the paragraph's line allocation does not change with the resize.
    assert _inline_extents(destination) == [(90 * EMU_PER_POINT, 45 * EMU_PER_POINT)]
    # The source is never modified.
    assert _target_sizes(source)[0] == (90 * EMU_PER_POINT, 45 * EMU_PER_POINT)


def test_move_without_width_keeps_signature_size(tmp_path: Path) -> None:
    from app.core.signature_layout import EMU_PER_POINT, write_signature_position

    source = _inline_signed_docx(tmp_path / "source.docx", tmp_path)
    destination = tmp_path / "moved.docx"
    write_signature_position(
        source, destination, signature_id=_SIG_ID, page=1, x=0.2, y=0.3, layout=_a4_layout()
    )

    original = (90 * EMU_PER_POINT, 45 * EMU_PER_POINT)
    assert _target_sizes(destination) == (original, original)


def test_resize_of_an_already_floating_signature_keeps_aspect(tmp_path: Path) -> None:
    from app.core.signature_layout import EMU_PER_POINT, write_signature_position

    source = _inline_signed_docx(tmp_path / "source.docx", tmp_path)
    first = tmp_path / "first.docx"
    write_signature_position(
        source, first, signature_id=_SIG_ID, page=1, x=0.2, y=0.3, layout=_a4_layout()
    )
    second = tmp_path / "second.docx"
    write_signature_position(
        first,
        second,
        signature_id=_SIG_ID,
        page=1,
        x=0.2,
        y=0.3,
        layout=_a4_layout(),
        width_pt=45.0,
    )

    expected = (45 * EMU_PER_POINT, round(22.5 * EMU_PER_POINT))
    assert _target_sizes(second) == (expected, expected)
    # Only the one spacer from the first move; a floating move adds none.
    assert len(_inline_extents(second)) == 1


@pytest.mark.parametrize(
    ("x", "width_pt"),
    [
        (0.2, 28.0),  # just under 10 mm (28.35 pt)
        (0.8, 120.0),  # 0.8 * 595 + 120 overflows the page's right edge
        (0.2, float("nan")),
    ],
)
def test_resize_rejects_too_small_or_overflowing_width(
    tmp_path: Path, x: float, width_pt: float
) -> None:
    from app.core.signature_layout import SignaturePositionInvalidError, write_signature_position

    source = _inline_signed_docx(tmp_path / "source.docx", tmp_path)
    destination = tmp_path / "moved.docx"
    with pytest.raises(SignaturePositionInvalidError):
        write_signature_position(
            source,
            destination,
            signature_id=_SIG_ID,
            page=1,
            x=x,
            y=0.3,
            layout=_a4_layout(),
            width_pt=width_pt,
        )
    assert not destination.exists()


def test_resize_accepts_exactly_ten_millimetres(tmp_path: Path) -> None:
    from app.core.signature_layout import (
        MIN_SIGNATURE_WIDTH_PT,
        inspect_signature_drawings,
        write_signature_position,
    )

    source = _inline_signed_docx(tmp_path / "source.docx", tmp_path)
    destination = tmp_path / "moved.docx"
    write_signature_position(
        source,
        destination,
        signature_id=_SIG_ID,
        page=1,
        x=0.2,
        y=0.3,
        layout=_a4_layout(),
        width_pt=MIN_SIGNATURE_WIDTH_PT,
    )
    assert inspect_signature_drawings(destination)[0].width_emu == round(
        MIN_SIGNATURE_WIDTH_PT * 12700
    )


def _validate_resize(tmp_path: Path, *, rendered: tuple[float, float]) -> None:
    from app.core.signature_layout import validate_move, write_signature_position

    before_docx = _inline_signed_docx(tmp_path / "before.docx", tmp_path)
    after_docx = tmp_path / "after.docx"
    write_signature_position(
        before_docx,
        after_docx,
        signature_id=_SIG_ID,
        page=1,
        x=0.2,
        y=0.3,
        layout=_a4_layout(),
        width_pt=120.0,
    )
    layout_after = SignatureLayout(
        source_sha256="after",
        pages=_a4_layout().pages,
        drawings={
            _SIG_ID: SignatureGeometry(
                page=1, x=0.2, y=0.3, width_pt=rendered[0], height_pt=rendered[1]
            )
        },
    )
    validate_move(
        before_docx=before_docx,
        after_docx=after_docx,
        before_pdf=_pdf(tmp_path / "before.pdf", ["FORM"]),
        after_pdf=_pdf(tmp_path / "after.pdf", ["FORM"]),
        signature_id=_SIG_ID,
        requested_page=1,
        requested_x=0.2,
        requested_y=0.3,
        layout_after=layout_after,
        requested_width_pt=120.0,
    )


def test_validate_move_accepts_resize_rendered_at_requested_size(tmp_path: Path) -> None:
    _validate_resize(tmp_path, rendered=(120.4, 59.6))


@pytest.mark.parametrize("rendered", [(90.0, 45.0), (120.0, 75.0)])
def test_validate_move_rejects_resize_rendered_at_wrong_size(
    tmp_path: Path, rendered: tuple[float, float]
) -> None:
    from app.core.signature_layout import SignatureLayoutChangedError

    with pytest.raises(SignatureLayoutChangedError, match="size"):
        _validate_resize(tmp_path, rendered=rendered)


# ---------------------------------------------------------------------------
# reassign_signature — admin-only employee picker (SignaturePlacementPage)
# ---------------------------------------------------------------------------


def test_reassign_signature_non_admin_is_forbidden(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    settings = Settings(data_dir=tmp_path, templates_dir=tmp_path)
    monkeypatch.setattr(sps, "get_settings", lambda: settings)
    _book, version, document = _record(db_session, tmp_path)
    _active_row(db_session, version, tmp_path, signer_user_id=7)
    non_admin = User(id=7, email="signer5@x.ae", password_hash="x", role="manager", status="active")
    db_session.add(non_admin)
    db_session.commit()

    with pytest.raises(AppError):
        sps.reassign_signature(
            db_session,
            document.id,
            user=non_admin,
            signature_id="sig-x",
            signature_revision=1,
            package_revision=0,
            source_sha256="whatever",
            employee_id="G1042",
        )
    db_session.refresh(version)
    assert version.signature_revision == 1  # untouched


def test_reassign_signature_success_swaps_image_and_appends_revision(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    from app.db.models import Employee

    settings = Settings(data_dir=tmp_path, templates_dir=tmp_path)
    monkeypatch.setattr(sps, "get_settings", lambda: settings)
    monkeypatch.setattr("app.services.included_papers_service.get_settings", lambda: settings)
    book, version, document = _record(db_session, tmp_path)
    active = _active_row(db_session, version, tmp_path, signer_user_id=7)
    admin = User(id=9, email="admin1@x.ae", password_hash="x", role="admin", status="active")
    other_employee = Employee(id="G1042", name_en="Muhannad", name_ar="مهند", position="Head")
    db_session.add_all([admin, other_employee])
    db_session.commit()

    sig_file = tmp_path / "vault" / "G1042.png"
    sig_file.parent.mkdir(parents=True, exist_ok=True)
    sig_file.write_bytes(b"other-employee-signature-bytes")
    monkeypatch.setattr(
        "app.core.signature.employee_signature_str", lambda _vault, _emp_id: str(sig_file)
    )

    signature_id = "sig-under-test"
    layout = _fake_layout(page=1, x=0.2, y=0.2, sha=active.docx_sha256, signature_id=signature_id)
    reassigned_pdf = _pdf(tmp_path / "reassigned-output.pdf", ["REASSIGNED-FORM"])

    def _fake_reassign(
        source: Path,
        destination: Path,
        *,
        signature_id: str,
        image_bytes: bytes,
        layout: SignatureLayout,
        before_pdf: Path,
    ) -> tuple[SignatureLayout, Path]:
        assert image_bytes == b"other-employee-signature-bytes"
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"reassigned-docx-bytes")
        return layout, reassigned_pdf

    monkeypatch.setattr(_pdf_executor, "measure_signature_position", lambda _p: layout)
    monkeypatch.setattr(_pdf_executor, "reassign_signature_image", _fake_reassign)

    description = sps.reassign_signature(
        db_session,
        document.id,
        user=admin,
        signature_id=signature_id,
        signature_revision=1,
        package_revision=0,
        source_sha256=active.docx_sha256,
        employee_id="G1042",
    )

    db_session.refresh(version)
    db_session.refresh(book)
    assert version.signature_revision == 2
    assert book.included_papers_revision == 1
    assert description.signature_revision == 2

    rows = (
        db_session.query(SignatureArtifactRevision)
        .filter(SignatureArtifactRevision.version_id == version.id)
        .order_by(SignatureArtifactRevision.revision)
        .all()
    )
    new_row = rows[-1]
    assert new_row.action == sps.ACTION_REASSIGN
    assert new_row.signer_user_id is None  # G1042 has no linked User row in this test
    assert (settings.data_dir / new_row.docx_path).is_file()

    from app.db.models import AuditLog

    audit = db_session.query(AuditLog).filter(AuditLog.action == "signature.reassigned").one()
    assert audit.entity_id == str(document.id)


def test_reassign_signature_unknown_employee_not_found(
    db_session: Session, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    settings = Settings(data_dir=tmp_path, templates_dir=tmp_path)
    monkeypatch.setattr(sps, "get_settings", lambda: settings)
    _book, version, document = _record(db_session, tmp_path)
    _active_row(db_session, version, tmp_path, signer_user_id=7)
    admin = User(id=9, email="admin2@x.ae", password_hash="x", role="admin", status="active")
    db_session.add(admin)
    db_session.commit()

    with pytest.raises(NotFoundError):
        sps.reassign_signature(
            db_session,
            document.id,
            user=admin,
            signature_id="sig-x",
            signature_revision=1,
            package_revision=0,
            source_sha256="whatever",
            employee_id="NO-SUCH-EMPLOYEE",
        )
