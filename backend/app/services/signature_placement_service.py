"""Signature placement service — paired-artifact retention and placement-
correction history (approval-signature-placement plan §§5, 7).

Owns ``SignatureArtifactRevision`` rows and the retained DOCX/PDF file pairs
under ``data/signature_artifacts/<version_id>/<revision>-<uuid>/``. Callers
never submit filesystem paths for retained artifacts — everything here is
resolved from the DB row.

Current scope: append-only ``initial`` revision capture, wired into
approval signing (``book_service.sign_book``) and manager-embedded
generation (``document_service.generate_document``). The Word-COM
measurement/movement engine, legacy-candidate identification, and the
``describe_editor`` / ``identify_signature`` / ``move_signature`` HTTP-facing
entrypoints are a separate, not-yet-implemented follow-on (plan §§6-9).
"""

from __future__ import annotations

import hashlib
import shutil
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast

from sqlalchemy import select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import set_committed_value

from app.api.errors import AppError, ConflictError, NotFoundError, ValidationFailedError
from app.config import get_settings
from app.core import signature_layout
from app.core.roles import ADMIN_ROLE
from app.core.signature_layout import inspect_signature_drawings
from app.db.models import AuditLog, Book, BookVersion, Document, SignatureArtifactRevision, User

# source_kind values (BookVersion signing pipeline that produced the artifact).
SOURCE_KIND_AUTO_MANAGER = "auto_manager"
SOURCE_KIND_APPROVAL = "approval"

# action values (append-only history row kind).
ACTION_INITIAL = "initial"
ACTION_IDENTIFY = "identify"
ACTION_MOVE = "move"


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _has_manager_drawing(docx_path: Path) -> bool:
    """True iff *docx_path* carries at least one marked manager/approver
    signature occurrence (the ``signature_layout`` identity scheme). Only
    actual manager/approver drawings activate the registry — a document with
    no such drawing (the checkbox was off, or the source predates the
    marking scheme) is never captured. A malformed/duplicate marker is
    treated as "no eligible drawing" here rather than raised: capture is a
    best-effort side effect of signing/generation and must never abort an
    otherwise-successful one over a marker integrity issue in an unrelated
    drawing.
    """
    try:
        drawings = inspect_signature_drawings(docx_path)
    except Exception:
        return False
    return any(drawing.role == "manager" for drawing in drawings)


def _retained_dir(version_id: int, revision: int) -> Path:
    settings = get_settings()
    return (
        settings.data_dir
        / "signature_artifacts"
        / str(version_id)
        / f"{revision}-{uuid.uuid4().hex[:10]}"
    )


def _rel(path: Path) -> str:
    settings = get_settings()
    try:
        return path.relative_to(settings.data_dir).as_posix()
    except ValueError:
        return str(path)


def capture_initial_revision(
    db: Session,
    *,
    version: BookVersion,
    source_kind: str,
    signer_user_id: int | None,
    docx_path: Path,
    primary_pdf_path: Path | None,
    published_pdf_path: Path | None,
) -> SignatureArtifactRevision | None:
    """Retain *docx_path* (+ PDF paths, when present) as revision 1 of
    *version*'s signature-placement history, IF it carries a marked
    manager/approver signature drawing.

    Returns ``None`` (no-op, no row created) when there is no eligible
    drawing — an unsigned document, or one whose manager checkbox was off,
    never activates the registry. Idempotent per version: only fires once,
    from ``signature_revision == 0``; a later correction cycle (after
    unfile/replace resets the counter to 0) starts its own fresh history via
    a subsequent call, never reusing revision 1.

    Copies (never moves) the source files — callers keep publishing their
    own artifacts exactly as before; this is purely an additional retained
    copy for later placement correction. Caller is responsible for adding
    ``version`` to the session and committing; this function only stages the
    new row and the retained files, mutating ``version.signature_revision``
    in place.
    """
    if version.signature_revision != 0:
        return None
    if not docx_path.is_file() or not _has_manager_drawing(docx_path):
        return None

    dest_dir = _retained_dir(version.id, 1)
    dest_dir.mkdir(parents=True, exist_ok=True)
    retained_docx = dest_dir / docx_path.name
    shutil.copy2(docx_path, retained_docx)

    retained_pdf: Path | None = None
    if primary_pdf_path is not None and primary_pdf_path.is_file():
        retained_pdf = dest_dir / primary_pdf_path.name
        shutil.copy2(primary_pdf_path, retained_pdf)

    row = SignatureArtifactRevision(
        version_id=version.id,
        revision=1,
        source_kind=source_kind,
        signer_user_id=signer_user_id,
        docx_path=_rel(retained_docx),
        primary_pdf_path=_rel(retained_pdf) if retained_pdf is not None else None,
        published_pdf_path=_rel(published_pdf_path) if published_pdf_path is not None else None,
        previous_published_pdf_path=None,
        docx_sha256=_sha256_file(retained_docx),
        manifest=[],
        action=ACTION_INITIAL,
        signature_id=None,
        before_geometry=None,
        after_geometry=None,
        actor_user_id=signer_user_id,
    )
    db.add(row)
    version.signature_revision = 1
    return row


def invalidate_revision(db: Session, *, version: BookVersion) -> None:
    """Reset *version*'s active-revision pointer after its signed artifact is
    unfiled (``book_service.unfile_signed_copy``) or replaced with a
    different file (``book_service.replace_signed_copy``).

    Append-only: existing ``SignatureArtifactRevision`` rows for this
    version are NEVER deleted or mutated by this call — they remain a
    permanent record of what was signed and, later, corrected. Only
    ``signature_revision`` resets to 0, so a subsequent digital re-sign of
    the SAME version (which does produce a fresh marked DOCX) starts a new
    revision 1 via ``capture_initial_revision`` rather than either reusing
    the now-stale retained files or refusing to ever track that version
    again. Neither ``unfile_signed_copy`` nor ``replace_signed_copy``
    themselves produce a marked DOCX (a human-uploaded scan/replacement PDF
    has no ``signature_layout`` markers), so neither calls
    ``capture_initial_revision`` — invalidation only.

    Caller is responsible for adding ``version`` to the session and
    committing.
    """
    version.signature_revision = 0


def can_correct(
    *,
    version: BookVersion,
    active_revision: SignatureArtifactRevision | None,
    actor_user_id: int,
    actor_is_admin: bool,
) -> bool:
    """Whether *actor_user_id* may correct the placement of *version*'s
    active tracked signature artifact.

    Only the recorded ORIGINAL signing account (``active_revision.
    signer_user_id`` — never the current pending approver, creator,
    ``Manager.user_id``, or a generic ``books.edit`` grant) or an
    administrator may correct. An automatically embedded manager signature
    with no recorded signing account (``signer_user_id is None``) is
    admin-only. Correcting requires an active tracked revision on the
    LATEST committed version — ``version.signature_revision`` must be
    nonzero and match ``active_revision.revision``.
    """
    if actor_is_admin:
        return True
    if active_revision is None:
        return False
    if version.signature_revision != active_revision.revision:
        return False
    if active_revision.signer_user_id is None:
        return False
    return active_revision.signer_user_id == actor_user_id


def _active_revision(db: Session, version: BookVersion) -> SignatureArtifactRevision | None:
    if version.signature_revision == 0:
        return None
    return db.execute(
        select(SignatureArtifactRevision).where(
            SignatureArtifactRevision.version_id == version.id,
            SignatureArtifactRevision.revision == version.signature_revision,
        )
    ).scalar_one_or_none()


def _resolve_version_book_document(
    db: Session, document_id: int
) -> tuple[BookVersion, Book, Document]:
    """The BookVersion/Book/Document triple for *document_id*'s owning
    record, or the standard 404s a route re-raises directly. Callers still
    owe their own `book_service.require_book_access` visibility check —
    this only resolves identity, matching the rest of this service's
    "no path/permission decisions of its own" boundary."""
    document = db.get(Document, document_id)
    if document is None:
        raise NotFoundError("DOCUMENT_NOT_FOUND", f"Document {document_id} does not exist")
    version = db.execute(
        select(BookVersion).where(BookVersion.document_id == document_id)
    ).scalar_one_or_none()
    if version is None:
        raise NotFoundError(
            "SIGNATURE_SOURCE_UNAVAILABLE", f"Document {document_id} has no owning record version"
        )
    book = db.get(Book, version.book_id)
    if book is None or book.deleted_at is not None:
        raise NotFoundError("BOOK_NOT_FOUND", f"Book {version.book_id} does not exist")
    return version, book, document


def _is_latest_version(book: Book, version: BookVersion) -> bool:
    latest = book.versions[-1] if book.versions else None
    return latest is not None and latest.id == version.id


def resolve_active_artifact(
    db: Session, document_id: int
) -> tuple[BookVersion, SignatureArtifactRevision]:
    """The ``(version, active_revision)`` pair for *document_id*'s currently
    tracked signature artifact. Raises `NotFoundError` when none exists.
    Caller owes its own record-access gate — this only resolves identity."""
    version, _book, _document = _resolve_version_book_document(db, document_id)
    active = _active_revision(db, version)
    if active is None:
        raise NotFoundError(
            "SIGNATURE_SOURCE_UNAVAILABLE", "No tracked signature artifact for this record"
        )
    return version, active


def resolve_legacy_docx(db: Session, document_id: int) -> Path:
    """The ONE verified legacy source DOCX for *document_id* — admin-only
    candidate discovery. Raises `NotFoundError` when unavailable."""
    _version, _book, document = _resolve_version_book_document(db, document_id)
    legacy_docx, _candidates = discover_legacy_candidates(document)
    if legacy_docx is None:
        raise NotFoundError(
            "SIGNATURE_SOURCE_UNAVAILABLE", "No verified legacy source is available"
        )
    return legacy_docx


def resolve_legacy_candidate(db: Session, document_id: int, candidate_id: str) -> LegacyCandidate:
    """The freshly re-verified legacy candidate matching *candidate_id* —
    never trusted from client/cached state (plan §7.3)."""
    _version, _book, document = _resolve_version_book_document(db, document_id)
    legacy_docx, found = discover_legacy_candidates(document)
    if legacy_docx is None:
        raise NotFoundError(
            "SIGNATURE_SOURCE_UNAVAILABLE", "No verified legacy source is available"
        )
    match = next((c for c in found if c.candidate_id == candidate_id), None)
    if match is None:
        raise NotFoundError("SIGNATURE_IDENTITY_INVALID", "That candidate no longer matches")
    return match


def list_history(db: Session, document_id: int) -> list[SignatureArtifactRevision]:
    """Every append-only revision row for *document_id*'s owning version,
    oldest first — the full placement-correction/identification trail."""
    version, _book, _document = _resolve_version_book_document(db, document_id)
    return list(
        db.execute(
            select(SignatureArtifactRevision)
            .where(SignatureArtifactRevision.version_id == version.id)
            .order_by(SignatureArtifactRevision.revision)
        ).scalars()
    )


def resolve_history_revision(
    db: Session, document_id: int, revision: int
) -> SignatureArtifactRevision:
    version, _book, _document = _resolve_version_book_document(db, document_id)
    row = db.execute(
        select(SignatureArtifactRevision).where(
            SignatureArtifactRevision.version_id == version.id,
            SignatureArtifactRevision.revision == revision,
        )
    ).scalar_one_or_none()
    if row is None:
        raise NotFoundError("SIGNATURE_SOURCE_UNAVAILABLE", f"No history revision {revision}")
    return row


@dataclass(frozen=True, slots=True)
class PageDescription:
    page: int
    width_pt: float
    height_pt: float


@dataclass(frozen=True, slots=True)
class SignatureDescription:
    id: str
    role: str
    page: int | None
    x: float | None
    y: float | None
    width_pt: float | None
    height_pt: float | None
    default_page: int | None
    default_x: float | None
    default_y: float | None


@dataclass(frozen=True, slots=True)
class LegacyCandidate:
    """An unmarked image drawing in the ONE verified legacy source DOCX,
    offered to an administrator for one-time identification (plan §7.2-3).
    ``candidate_id`` is a token bound to the source hash and drawing
    occurrence — recomputed and re-verified fresh on every
    `identify_signature` call, never trusted from client state alone."""

    candidate_id: str
    docpr_name: str
    width_emu: int
    height_emu: int


@dataclass(frozen=True, slots=True)
class EditorDescription:
    document_id: int
    version_id: int
    signature_revision: int
    package_revision: int
    source_sha256: str | None
    can_adjust: bool
    can_identify: bool
    unavailable_code: str | None
    measured: bool
    pages: tuple[PageDescription, ...]
    signatures: tuple[SignatureDescription, ...]
    candidates: tuple[LegacyCandidate, ...] | None
    legacy_docx_path: str | None  # relative; None unless legacy identification is live


def _normalize_text(value: str) -> str:
    return " ".join(value.split())


def discover_legacy_candidates(
    document: Document,
) -> tuple[Path | None, list[LegacyCandidate]]:
    """Establish the ONE verified legacy source DOCX for *document* and
    enumerate its unmarked (pre-identity-scheme) image drawings as
    admin-confirmable candidates (plan §7.2).

    Scope: a straightforward "own docx_path, or a same-directory
    ``*signed*.docx`` whose extracted main-document text matches the
    published PDF's first page" search — sufficient for the overwhelming
    majority of legacy records, where the signing DOCX sits beside its
    PDF. Returns ``(None, [])`` when no unique verified source can be
    established (missing docx, ambiguous match, or a source with no
    eligible image at all) — legacy identification is then simply
    unavailable for this record, never a guessed source.
    """
    from docx import Document as _Document
    from docx.oxml.ns import qn

    settings = get_settings()
    if not document.docx_path:
        return None, []
    own_docx = settings.data_dir / document.docx_path
    candidates_docx: list[Path] = []
    if own_docx.is_file():
        candidates_docx.append(own_docx)
    sibling_dir = own_docx.parent
    if sibling_dir.is_dir():
        for path in sorted(sibling_dir.glob("*.docx")):
            if path != own_docx and "signed" in path.stem.lower():
                candidates_docx.append(path)
    if not candidates_docx:
        return None, []

    expected_text = ""
    if document.pdf_path:
        pdf_abs = settings.data_dir / document.pdf_path
        if pdf_abs.is_file():
            import fitz

            with fitz.open(str(pdf_abs)) as pdf:
                if pdf.page_count > 0:
                    expected_text = _normalize_text(pdf[0].get_text())

    verified: Path | None = None
    if len(candidates_docx) == 1:
        verified = candidates_docx[0]
    elif expected_text:
        matches = []
        for candidate in candidates_docx:
            try:
                doc = _Document(str(candidate))
            except Exception:
                continue
            body_text = _normalize_text("\n".join(p.text for p in doc.paragraphs))
            if body_text and body_text in expected_text:
                matches.append(candidate)
        if len(matches) == 1:
            verified = matches[0]
    if verified is None:
        return None, []

    try:
        already_marked = {d.signature_id for d in inspect_signature_drawings(verified)}
    except signature_layout.SignatureIdentityError:
        already_marked = set()
    try:
        doc = _Document(str(verified))
    except Exception:
        return None, []
    source_sha = _sha256_file(verified)
    out: list[LegacyCandidate] = []
    for docpr in doc.element.body.iter(qn("wp:docPr")):
        name = docpr.get("name") or ""
        parsed = signature_layout.parse_marker_descr(docpr.get("descr"))
        if parsed is not None and parsed[1] in already_marked:
            continue  # already-identified occurrence, not a legacy candidate
        if name.startswith("GSSG_SIG_"):
            continue
        container = docpr.getparent()
        extent = container.find(qn("wp:extent")) if container is not None else None
        width_emu = int(extent.get("cx")) if extent is not None and extent.get("cx") else 0
        height_emu = int(extent.get("cy")) if extent is not None and extent.get("cy") else 0
        if width_emu <= 0 or height_emu <= 0:
            continue
        candidate_id = hashlib.sha256(
            f"{source_sha}:{name}:{width_emu}:{height_emu}".encode()
        ).hexdigest()
        out.append(
            LegacyCandidate(
                candidate_id=candidate_id,
                docpr_name=name,
                width_emu=width_emu,
                height_emu=height_emu,
            )
        )
    return verified, out


def describe_editor(
    db: Session, document_id: int, *, user: User, measure: bool = False
) -> EditorDescription:
    """Cheap capability/source-state description by default; ``measure=True``
    performs verification/layout after the workspace is actually opened
    (plan §7.4) — never launches Word merely to display an action button.
    """
    version, book, document = _resolve_version_book_document(db, document_id)
    is_admin = user.role == ADMIN_ROLE
    is_latest = _is_latest_version(book, version)
    active = _active_revision(db, version)
    can_adjust = is_latest and can_correct(
        version=version, active_revision=active, actor_user_id=user.id, actor_is_admin=is_admin
    )

    legacy_docx: Path | None = None
    candidates: tuple[LegacyCandidate, ...] | None = None
    can_identify = False
    if is_admin and is_latest and active is None:
        legacy_docx, found = discover_legacy_candidates(document)
        candidates = tuple(found)
        can_identify = legacy_docx is not None and len(found) > 0

    unavailable_code: str | None = None
    if not is_latest:
        unavailable_code = "SIGNATURE_LAYOUT_UNSUPPORTED"
    elif active is None and not can_identify:
        unavailable_code = "SIGNATURE_SOURCE_UNAVAILABLE"

    pages: tuple[PageDescription, ...] = ()
    signatures: tuple[SignatureDescription, ...] = ()
    measured = False
    source_sha256 = active.docx_sha256 if active is not None else None

    if measure and active is not None:
        from app.services import _pdf_executor

        settings = get_settings()
        tracked_docx = settings.data_dir / active.docx_path
        if not tracked_docx.is_file():
            unavailable_code = "SIGNATURE_SOURCE_UNAVAILABLE"
        else:
            layout = _pdf_executor.measure_signature_position(tracked_docx)
            measured = True
            pages = tuple(
                PageDescription(page=p.page, width_pt=p.width_pt, height_pt=p.height_pt)
                for p in layout.pages
            )
            # "Reset position" restores the ORIGINALLY measured location, not
            # today's template (plan §9.5) — that is revision 1's retained
            # DOCX, which a correction never mutates. When the active
            # revision already IS revision 1 (no correction has happened
            # yet), it is the same file already measured above; only a
            # later revision needs a second, separate Word-COM pass.
            if active.revision == 1:
                default_by_id = layout.drawings
            else:
                default_by_id = {}
                rev1 = db.execute(
                    select(SignatureArtifactRevision).where(
                        SignatureArtifactRevision.version_id == version.id,
                        SignatureArtifactRevision.revision == 1,
                    )
                ).scalar_one_or_none()
                if rev1 is not None:
                    rev1_docx = settings.data_dir / rev1.docx_path
                    if rev1_docx.is_file():
                        default_by_id = _pdf_executor.measure_signature_position(rev1_docx).drawings
            drawings_by_id = {d.signature_id: d for d in inspect_signature_drawings(tracked_docx)}
            signatures = tuple(
                SignatureDescription(
                    id=sig_id,
                    role=drawings_by_id[sig_id].role if sig_id in drawings_by_id else "manager",
                    page=geo.page,
                    x=geo.x,
                    y=geo.y,
                    width_pt=geo.width_pt,
                    height_pt=geo.height_pt,
                    default_page=default_by_id[sig_id].page if sig_id in default_by_id else None,
                    default_x=default_by_id[sig_id].x if sig_id in default_by_id else None,
                    default_y=default_by_id[sig_id].y if sig_id in default_by_id else None,
                )
                for sig_id, geo in layout.drawings.items()
            )

    return EditorDescription(
        document_id=document_id,
        version_id=version.id,
        signature_revision=version.signature_revision,
        package_revision=book.included_papers_revision,
        source_sha256=source_sha256,
        can_adjust=can_adjust,
        can_identify=can_identify,
        unavailable_code=unavailable_code,
        measured=measured,
        pages=pages,
        signatures=signatures,
        candidates=candidates,
        legacy_docx_path=_rel(legacy_docx) if legacy_docx is not None else None,
    )


def identify_signature(
    db: Session,
    document_id: int,
    *,
    user: User,
    candidate_id: str,
    signature_revision: int,
    package_revision: int,
    source_sha256: str,
) -> EditorDescription:
    """Administrator-only: confirm *candidate_id* (from a fresh
    `discover_legacy_candidates` re-scan) as the manager/approver image,
    marking it WITHOUT changing any rendered pixel or moving it (plan
    §7.2-3). Appends an `identify` revision as this version's fresh
    revision 1 — the stored signer remains unset (admin-only to correct
    thereafter, matching an auto-embedded signature with no recorded
    signer)."""
    if user.role != ADMIN_ROLE:
        raise AppError(
            "FORBIDDEN", "Only an administrator may identify a legacy signature", http_status=403
        )
    version, book, document = _resolve_version_book_document(db, document_id)
    if not _is_latest_version(book, version):
        raise ValidationFailedError(
            "SIGNATURE_LAYOUT_UNSUPPORTED", "Only the latest version can be corrected"
        )
    if version.signature_revision != 0:
        raise ConflictError(
            "SIGNATURE_REVISION_CONFLICT", "This record already has a tracked signature artifact"
        )
    if version.signature_revision != signature_revision or book.included_papers_revision != (
        package_revision
    ):
        raise ConflictError("SIGNATURE_REVISION_CONFLICT", "The record changed; reload and retry")

    legacy_docx, found = discover_legacy_candidates(document)
    if legacy_docx is None:
        raise ValidationFailedError(
            "SIGNATURE_SOURCE_UNAVAILABLE", "No verified legacy source is available to identify"
        )
    actual_sha = _sha256_file(legacy_docx)
    if actual_sha != source_sha256:
        raise ConflictError(
            "SIGNATURE_REVISION_CONFLICT", "The source document changed; reload and retry"
        )
    match = next((c for c in found if c.candidate_id == candidate_id), None)
    if match is None:
        raise ValidationFailedError(
            "SIGNATURE_IDENTITY_INVALID", "That candidate no longer matches this document"
        )

    from docx import Document as _Document
    from docx.oxml.ns import qn as _qn

    doc = _Document(str(legacy_docx))
    target_docpr = next(
        (
            d
            for d in doc.element.body.iter(_qn("wp:docPr"))
            if (d.get("name") or "") == match.docpr_name
        ),
        None,
    )
    if target_docpr is None:
        raise ValidationFailedError(
            "SIGNATURE_IDENTITY_INVALID", "That candidate drawing was not found"
        )
    new_id = signature_layout.new_signature_id()
    target_docpr.set("name", signature_layout.marker_name(new_id))
    target_docpr.set("descr", signature_layout.marker_descr("manager", new_id))

    dest_dir = _retained_dir(version.id, 1)
    dest_dir.mkdir(parents=True, exist_ok=True)
    retained_docx = dest_dir / legacy_docx.name
    doc.save(str(retained_docx))

    row = SignatureArtifactRevision(
        version_id=version.id,
        revision=1,
        source_kind=SOURCE_KIND_APPROVAL,
        signer_user_id=None,
        docx_path=_rel(retained_docx),
        primary_pdf_path=_rel(get_settings().data_dir / document.pdf_path)
        if document.pdf_path
        else None,
        published_pdf_path=_rel(get_settings().data_dir / document.pdf_path)
        if document.pdf_path
        else None,
        previous_published_pdf_path=None,
        docx_sha256=_sha256_file(retained_docx),
        manifest=[],
        action=ACTION_IDENTIFY,
        signature_id=new_id,
        before_geometry=None,
        after_geometry=None,
        actor_user_id=user.id,
    )
    db.add(row)
    version.signature_revision = 1
    db.add(
        AuditLog(
            actor=user.employee_id,
            action="signature.identified",
            entity_type="document",
            entity_id=str(document_id),
            payload=(
                f'{{"version_id": {version.id}, "signature_id": "{new_id}", '
                f'"actor_user_id": {user.id}}}'
            ),
        )
    )
    db.commit()
    return describe_editor(db, document_id, user=user)


def move_signature(
    db: Session,
    document_id: int,
    *,
    user: User,
    signature_id: str,
    signature_revision: int,
    package_revision: int,
    source_sha256: str,
    page: int,
    x: float,
    y: float,
) -> EditorDescription:
    """The authoritative placement-correction transaction (plan §7.5-7.8):
    measure/move/validate happens OUTSIDE the DB write lock (the isolated
    Word worker), then a compare-and-set on both
    ``BookVersion.signature_revision`` and ``Book.included_papers_revision``
    gates publication in one commit. Never advances either counter twice —
    the publish call below always passes its own already-performed CAS
    through as ``advance_revision=False`` / ``invalidate_revision=False``.
    """
    from app.services import _pdf_executor, included_papers_service

    version, book, document = _resolve_version_book_document(db, document_id)
    if not _is_latest_version(book, version):
        raise ValidationFailedError(
            "SIGNATURE_LAYOUT_UNSUPPORTED", "Only the latest version can be corrected"
        )
    active = _active_revision(db, version)
    is_admin = user.role == ADMIN_ROLE
    if not can_correct(
        version=version, active_revision=active, actor_user_id=user.id, actor_is_admin=is_admin
    ):
        raise AppError(
            "FORBIDDEN",
            "Only the original signer or an administrator may correct this signature",
            http_status=403,
        )
    if active is None:
        # `can_correct` authorizes an administrator unconditionally — an
        # admin's authority to correct does not manufacture a signature to
        # correct. The frontend never offers this route without a tracked
        # signature to select; a direct API call with none still gets a
        # clean 404 instead of an internal assertion failure.
        raise NotFoundError(
            "SIGNATURE_SOURCE_UNAVAILABLE", "No tracked signature artifact for this record"
        )
    if version.signature_revision != signature_revision:
        raise ConflictError("SIGNATURE_REVISION_CONFLICT", "The record changed; reload and retry")
    if book.included_papers_revision != package_revision:
        raise ConflictError("SIGNATURE_REVISION_CONFLICT", "The record changed; reload and retry")

    settings = get_settings()
    tracked_docx = settings.data_dir / active.docx_path
    if not tracked_docx.is_file():
        raise ValidationFailedError(
            "SIGNATURE_SOURCE_UNAVAILABLE", "The tracked signature source is unavailable"
        )
    actual_sha = _sha256_file(tracked_docx)
    if actual_sha != source_sha256:
        raise ConflictError(
            "SIGNATURE_REVISION_CONFLICT", "The document changed since the workspace was opened"
        )

    before_pdf = settings.data_dir / active.primary_pdf_path if active.primary_pdf_path else None
    if before_pdf is None or not before_pdf.is_file():
        before_pdf = _pdf_executor.convert_docx_to_pdf(tracked_docx)
    if before_pdf is None:
        raise signature_layout.SignatureRenderFailedError(
            f"No readable prior rendition for {tracked_docx}"
        )

    layout = _pdf_executor.measure_signature_position(tracked_docx)
    if signature_id not in layout.drawings:
        raise ValidationFailedError(
            "SIGNATURE_IDENTITY_INVALID", "That signature was not found in the tracked source"
        )
    before_geometry = layout.drawings[signature_id]

    next_revision = active.revision + 1
    dest_dir = _retained_dir(version.id, next_revision)
    dest_dir.mkdir(parents=True, exist_ok=True)
    destination_docx = dest_dir / tracked_docx.name
    try:
        after_layout, after_pdf = _pdf_executor.move_signature_position(
            tracked_docx,
            destination_docx,
            signature_id=signature_id,
            page=page,
            x=x,
            y=y,
            layout=layout,
            before_pdf=before_pdf,
        )
    except Exception:
        shutil.rmtree(dest_dir, ignore_errors=True)
        raise

    sig_update = cast(
        CursorResult[Any],
        db.execute(
            update(BookVersion)
            .where(
                BookVersion.id == version.id,
                BookVersion.signature_revision == signature_revision,
            )
            .values(signature_revision=next_revision)
            .execution_options(synchronize_session=False)
        ),
    )
    if sig_update.rowcount != 1:
        shutil.rmtree(dest_dir, ignore_errors=True)
        db.rollback()
        raise ConflictError("SIGNATURE_REVISION_CONFLICT", "Another correction was just published")
    pkg_update = cast(
        CursorResult[Any],
        db.execute(
            update(Book)
            .where(Book.id == book.id, Book.included_papers_revision == package_revision)
            .values(included_papers_revision=package_revision + 1)
            .execution_options(synchronize_session=False)
        ),
    )
    if pkg_update.rowcount != 1:
        shutil.rmtree(dest_dir, ignore_errors=True)
        db.rollback()
        raise ConflictError(
            "SIGNATURE_REVISION_CONFLICT", "Included papers changed; reload and retry"
        )
    set_committed_value(version, "signature_revision", next_revision)
    set_committed_value(book, "included_papers_revision", package_revision + 1)

    try:
        if active.source_kind == SOURCE_KIND_APPROVAL:
            published_rel = included_papers_service.publish_signed_package(
                db, book, version, after_pdf, physical_scan=False, advance_revision=False
            )
            published_abs: Path | None = settings.data_dir / published_rel
        else:
            result = included_papers_service.publish_generated_package(
                db, book, version, document, after_pdf, invalidate_revision=False
            )
            published_abs = (
                settings.data_dir / result.published_path if result.published_path else None
            )
    except Exception:
        db.rollback()
        shutil.rmtree(dest_dir, ignore_errors=True)
        raise

    retained_pdf = dest_dir / after_pdf.name
    if after_pdf.resolve() != retained_pdf.resolve():
        shutil.copy2(after_pdf, retained_pdf)
    after_geometry = after_layout.drawings.get(signature_id)
    row = SignatureArtifactRevision(
        version_id=version.id,
        revision=next_revision,
        source_kind=active.source_kind,
        signer_user_id=active.signer_user_id,
        docx_path=_rel(destination_docx),
        primary_pdf_path=_rel(retained_pdf),
        published_pdf_path=_rel(published_abs) if published_abs is not None else None,
        previous_published_pdf_path=active.published_pdf_path,
        docx_sha256=_sha256_file(destination_docx),
        manifest=[],
        action=ACTION_MOVE,
        signature_id=signature_id,
        before_geometry={
            "page": before_geometry.page,
            "x": before_geometry.x,
            "y": before_geometry.y,
        },
        after_geometry=(
            {"page": after_geometry.page, "x": after_geometry.x, "y": after_geometry.y}
            if after_geometry is not None
            else None
        ),
        actor_user_id=user.id,
    )
    db.add(row)
    db.add(
        AuditLog(
            actor=user.employee_id,
            action="signature.position_changed",
            entity_type="document",
            entity_id=str(document_id),
            payload=(
                f'{{"version_id": {version.id}, "signature_id": "{signature_id}", '
                f'"actor_user_id": {user.id}, "revision": {next_revision}, '
                f'"before_page": {before_geometry.page}, "after_page": {page}}}'
            ),
        )
    )
    db.commit()
    return describe_editor(db, document_id, user=user)
