"""Native PDF process confinement (P01 prerequisite, launch 9).

Contract under test (see ``mockups/plan`` and the launch-9 implementation contract): every
in-process PyMuPDF entrypoint reachable from the global lane — ``ocr.pdf_text_layer`` /
``ocr.pdf_to_images``, ``pdf_merge.build_pdf_package`` / ``merge_pdfs_to_bytes``,
``book_service._image_to_pdf_bytes``, ``included_papers_service.inspect_paper`` /
``describe_package`` / ``publish_signed_package`` and ``artifact_service._convert``'s page
validation — runs in a dedicated, spawned worker process instead of an API/lane thread, with
the public signatures, exceptions and renderer output unchanged.

Nothing here is a mock-only proof. A ``sitecustomize.py`` placed on the *children's*
``PYTHONPATH`` wraps ``fitz.open`` / ``Page.get_pixmap`` and logs ``kind pid ppid thread``; the
test process itself gets a trap on ``fitz.open``. So a test passes only when the native call
(1) ran in a real child process whose parent is this test process and (2) never ran in any API
or lane thread. The trap also proves the workers are spawned, not forked (a fork would inherit
the trap).

Tests that are pure behaviour-parity guards (no probe) are expected to pass both before and
after the change; every probe/runtime test is expected to fail before it.
"""

from __future__ import annotations

import asyncio
import importlib
import importlib.util
import inspect
import io
import multiprocessing
import os
import pickle
import re
import signal
import subprocess
import sys
import textwrap
import threading
import time
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from itertools import islice
from pathlib import Path
from typing import Any

import fitz
import pytest
from PIL import Image
from sqlalchemy.orm import Session

from app.api.errors import AppError, ValidationFailedError
from app.config import get_settings
from app.core import pdf_merge
from app.core.extraction import ocr
from app.db.models import Book, BookCategory, BookVersion, Document, User
from app.services import artifact_service, book_service

# Captured before any trap is installed: every helper below builds/inspects PDFs with the REAL
# function, so the parent-process trap only ever fires for application code.
_REAL_OPEN = fitz.open

BACKEND_DIR = Path(__file__).resolve().parents[1]
POSIX_ONLY = pytest.mark.skipif(
    sys.platform == "win32", reason="SIGSTOP / /proc / orphan checks are POSIX-only"
)


def _included_papers_service() -> Any:
    return importlib.import_module("app.services.included_papers_service")


# --------------------------------------------------------------------------------------------
# synthetic inputs
# --------------------------------------------------------------------------------------------


def _pdf_bytes(labels: list[str], *, size: tuple[float, float] = (300, 400)) -> bytes:
    doc = _REAL_OPEN()
    try:
        for label in labels:
            page = doc.new_page(width=size[0], height=size[1])
            page.insert_text((40, 80), label)
        return bytes(doc.tobytes())
    finally:
        doc.close()


def _pdf(path: Path, labels: list[str]) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(_pdf_bytes(labels))
    return path


def _png_bytes() -> bytes:
    buffer = io.BytesIO()
    Image.new("RGB", (40, 30), (74, 144, 226)).save(buffer, format="PNG")
    return buffer.getvalue()


def _texts(data: bytes) -> list[str]:
    with _REAL_OPEN("pdf", data) as doc:
        return [page.get_text().strip() for page in doc]


def _guard_pdf() -> bytes:
    """Letter page (rasterised) followed by a page that busts the cumulative pixel budget.

    Page 2 is individually legal (4800 pt = 13334 px at 200 dpi) but page 1 + page 2 exceeds
    ``_MAX_PIXELS``, so the generator must yield page 1 and then raise before rasterising page 2.
    """
    doc = _REAL_OPEN()
    try:
        doc.new_page(width=612, height=792)
        doc.new_page(width=4800, height=4800)
        return bytes(doc.tobytes())
    finally:
        doc.close()


# --------------------------------------------------------------------------------------------
# probe: independent evidence of where native code runs
# --------------------------------------------------------------------------------------------

_SITECUSTOMIZE = r"""
import os
import threading

_log = os.environ.get("GSSG_NATIVE_PROBE_LOG")
if _log:
    import fitz

    def _record(kind):
        with open(_log, "a", encoding="utf-8") as handle:
            handle.write(
                f"{kind} {os.getpid()} {os.getppid()} {threading.current_thread().name}\n"
            )

    _real_open = fitz.open

    def _open(*args, **kwargs):
        _record("open")
        return _real_open(*args, **kwargs)

    fitz.open = _open

    _real_pixmap = fitz.Page.get_pixmap

    def _pixmap(self, *args, **kwargs):
        _record("pixmap")
        return _real_pixmap(self, *args, **kwargs)

    fitz.Page.get_pixmap = _pixmap
"""


def _shutdown_workers() -> None:
    if importlib.util.find_spec("app.core.pdf_worker") is not None:
        importlib.import_module("app.core.pdf_worker").shutdown()


@pytest.fixture(scope="module")
def _probe_environment(tmp_path_factory: pytest.TempPathFactory) -> Iterator[Path]:
    probe_dir = tmp_path_factory.mktemp("native-probe")
    (probe_dir / "sitecustomize.py").write_text(_SITECUSTOMIZE, encoding="utf-8")
    log = probe_dir / "native-calls.log"
    log.write_text("", encoding="utf-8")
    with pytest.MonkeyPatch.context() as patch:
        existing = os.environ.get("PYTHONPATH")
        patch.setenv("PYTHONPATH", os.pathsep.join(filter(None, [str(probe_dir), existing])))
        patch.setenv("GSSG_NATIVE_PROBE_LOG", str(log))
        _shutdown_workers()  # any worker spawned earlier lacks the probe: respawn under it
        yield log
        _shutdown_workers()


@dataclass
class Probe:
    log: Path
    parent_calls: list[tuple[int, str]] = field(default_factory=list)

    def entries(self, kind: str) -> list[tuple[int, int, str]]:
        rows: list[tuple[int, int, str]] = []
        if not self.log.exists():
            return rows
        for line in self.log.read_text(encoding="utf-8").splitlines():
            parts = line.split(" ", 3)
            if len(parts) == 4 and parts[0] == kind:
                rows.append((int(parts[1]), int(parts[2]), parts[3]))
        return rows

    def count(self, kind: str) -> int:
        return len(self.entries(kind))


@pytest.fixture()
def probe(_probe_environment: Path, monkeypatch: pytest.MonkeyPatch) -> Probe:
    _probe_environment.write_text("", encoding="utf-8")
    state = Probe(_probe_environment)

    def trap(*_args: object, **_kwargs: object) -> None:
        state.parent_calls.append((os.getpid(), threading.current_thread().name))
        raise AssertionError("native fitz.open ran inside the API process")

    monkeypatch.setattr(fitz, "open", trap)
    return state


def assert_confined(probe: Probe, *, kind: str = "open", at_least: int = 1) -> set[int]:
    """Native work ran in real child process(es) of this process and nowhere else."""
    assert probe.parent_calls == [], (
        f"native fitz.open ran in the API process: {probe.parent_calls}"
    )
    entries = probe.entries(kind)
    assert len(entries) >= at_least, f"expected >= {at_least} child {kind} call(s), saw {entries}"
    pids = {pid for pid, _ppid, _thread in entries}
    assert os.getpid() not in pids
    assert {ppid for _pid, ppid, _thread in entries} == {os.getpid()}
    return pids


@pytest.fixture()
def data_dir(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Iterator[Path]:
    monkeypatch.setenv("GSSG_DATA_DIR", str(tmp_path))
    get_settings.cache_clear()
    yield tmp_path
    get_settings.cache_clear()


@pytest.fixture(scope="module")
def pdf_worker() -> Any:
    return importlib.import_module("app.core.pdf_worker")


@pytest.fixture()
def make_pool(pdf_worker: Any) -> Iterator[Callable[..., Any]]:
    pools: list[Any] = []

    def factory(**overrides: Any) -> Any:
        settings: dict[str, Any] = {
            "max_workers": 2,
            "lease_timeout": 10.0,
            "call_timeout": 30.0,
            "step_timeout": 30.0,
            "startup_timeout": 60.0,
        }
        settings.update(overrides)
        pool = pdf_worker.WorkerPool("test", **settings)
        pools.append(pool)
        return pool

    yield factory
    for pool in pools:
        pool.shutdown()


def _wait_until(predicate: Callable[[], bool], timeout: float = 15.0) -> bool:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.02)
    return predicate()


def _is_gone(pid: int) -> bool:
    """True once ``pid`` no longer exists (a zombie counts as gone: it ran no code)."""
    stat = Path(f"/proc/{pid}/stat")
    if stat.parent.parent.is_dir():  # Linux
        try:
            state = stat.read_text(encoding="utf-8").rsplit(")", 1)[1].split()[0]
        except (FileNotFoundError, ProcessLookupError):
            return True
        return state in {"Z", "X"}
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    except PermissionError:
        return False
    return False


# --------------------------------------------------------------------------------------------
# record fixture shared by the service-level entrypoints
# --------------------------------------------------------------------------------------------


def _record(db: Session, root: Path) -> tuple[Book, BookVersion, Document, Path]:
    creator = User(email="creator@example.ae", password_hash="x", role="operator", status="active")
    db.add_all([creator, BookCategory(id="HR", prefix="HR")])
    db.flush()
    generated = _pdf(root / "generated.pdf", ["FORM", "PAPER"])
    paper = _pdf(root / "paper.pdf", ["PAPER"])
    companion = _pdf(root / "companion.pdf", ["COMPANION"])
    document = Document(
        template_id="General Book",
        ref_number="HR-1",
        docx_path="source.docx",
        pdf_path=generated.relative_to(root).as_posix(),
        submission_id="submission-1",
        role="primary",
    )
    db.add(document)
    db.flush()
    db.add(
        Document(
            template_id="Leave Undertaking",
            ref_number="HR-1",
            docx_path="companion.docx",
            pdf_path=companion.relative_to(root).as_posix(),
            submission_id="submission-1",
            role="companion",
        )
    )
    book = Book(
        category_id="HR",
        ref_number="HR-1",
        approval_state="pending",
        merged_attachment_paths=[
            {"path": paper.relative_to(root).as_posix(), "slot_key": "medical_certificate"}
        ],
    )
    db.add(book)
    db.flush()
    version = BookVersion(
        book_id=book.id,
        version_no=1,
        document_id=document.id,
        template_id="General Book",
        fields={"subject": "Signed package"},
        status="pending",
        created_by_user_id=creator.id,
    )
    db.add(version)
    db.commit()
    return book, version, document, paper


# ============================================================================================
# A. the nine traced entrypoints execute in a real child process, never in an API thread
# ============================================================================================


def test_pdf_text_layer_runs_in_a_worker_child(probe: Probe) -> None:
    text = ocr.pdf_text_layer(_pdf_bytes(["GS-0042 text layer"]))

    assert "GS-0042" in text
    assert_confined(probe)


def test_pdf_to_images_renders_in_a_worker_child_with_identical_pixels(probe: Probe) -> None:
    data = _pdf_bytes(["P1", "P2", "P3"])

    images = list(ocr.pdf_to_images(data, dpi=72))

    assert [image.size for image in images] == [(300, 400)] * 3
    assert {image.mode for image in images} == {"RGB"}
    with _REAL_OPEN("pdf", data) as doc:
        expected = [page.get_pixmap(dpi=72, alpha=False).samples for page in doc]
    assert [image.tobytes() for image in images] == expected  # renderer output unchanged
    assert probe.count("pixmap") == 3
    assert_confined(probe)


def test_build_pdf_package_runs_in_a_worker_child(probe: Probe, tmp_path: Path) -> None:
    base = _pdf(tmp_path / "base.pdf", ["FORM-1", "FORM-2"])
    first = _pdf(tmp_path / "first.pdf", ["FIRST-1", "FIRST-2", "FIRST-3"])
    image = tmp_path / "last.png"
    image.write_bytes(_png_bytes())

    result = pdf_merge.build_pdf_package(
        base, [(first, "First paper.pdf"), (image, "Last image.png")]
    )

    assert isinstance(result, pdf_merge.PdfPackageResult)
    assert result.fixed_page_count == 2
    assert result.item_page_counts == (3, 1)
    assert result.total_page_count == 6
    assert _texts(result.pdf_bytes)[:5] == ["FORM-1", "FORM-2", "FIRST-1", "FIRST-2", "FIRST-3"]
    assert _texts(base.read_bytes()) == ["FORM-1", "FORM-2"]  # inputs untouched
    assert_confined(probe, at_least=3)


def test_merge_pdfs_to_bytes_runs_in_a_worker_child(probe: Probe, tmp_path: Path) -> None:
    base = _pdf(tmp_path / "base.pdf", ["BASE"])
    extra = _pdf(tmp_path / "extra.pdf", ["EXTRA-1", "EXTRA-2"])
    image = tmp_path / "scan.png"
    image.write_bytes(_png_bytes())

    merged = pdf_merge.merge_pdfs_to_bytes(base, [extra, tmp_path / "missing.pdf", image])

    assert _texts(merged)[:3] == ["BASE", "EXTRA-1", "EXTRA-2"]
    assert len(_texts(merged)) == 4  # missing source skipped, image became one page
    assert_confined(probe, at_least=3)


def test_image_to_pdf_bytes_runs_in_a_worker_child(probe: Probe) -> None:
    pdf = book_service._image_to_pdf_bytes(_png_bytes(), ".png")

    assert pdf.startswith(b"%PDF")
    assert len(_texts(pdf)) == 1
    assert_confined(probe)


def test_inspect_paper_runs_in_a_worker_child(probe: Probe, tmp_path: Path) -> None:
    service = _included_papers_service()
    two_pages = _pdf(tmp_path / "two.pdf", ["A", "B"])
    image = tmp_path / "scan.png"
    image.write_bytes(_png_bytes())

    assert service.inspect_paper(two_pages, display_name="Two.pdf") == ("application/pdf", 2)
    assert service.inspect_paper(image) == ("image/png", 1)
    assert_confined(probe, at_least=2)


def test_describe_package_runs_in_a_worker_child_without_the_session(
    probe: Probe, db_session: Session, data_dir: Path
) -> None:
    book, _version, _document, _paper = _record(db_session, data_dir)

    state = _included_papers_service().describe_package(db_session, book)

    assert state.total_page_count == 2
    assert state.fixed_page_count == 1
    assert [paper.page_count for paper in state.papers] == [1]
    assert_confined(probe, at_least=2)  # inspect_paper of the paper + page_count of the PDF


def test_publish_signed_package_runs_in_a_worker_child(
    probe: Probe, db_session: Session, data_dir: Path
) -> None:
    book, version, _document, _paper = _record(db_session, data_dir)
    signed_form = _pdf(data_dir / "signed-form.pdf", ["SIGNED-FORM"])

    published = _included_papers_service().publish_signed_package(
        db_session, book, version, signed_form, physical_scan=False
    )

    assert version.signed_pdf_path == published
    assert version.signed_base_pdf_path is not None
    assert _texts((data_dir / version.signed_base_pdf_path).read_bytes()) == [
        "SIGNED-FORM",
        "COMPANION",
    ]
    assert _texts((data_dir / published).read_bytes()) == ["SIGNED-FORM", "COMPANION", "PAPER"]
    assert_confined(probe, at_least=4)  # page check, inspect_paper, fixed base, package


def test_artifact_convert_page_validation_runs_in_a_worker_child(
    probe: Probe, tmp_path: Path
) -> None:
    target = tmp_path / "form.docx"
    target.write_bytes(b"docx")
    _pdf(tmp_path / "form.pdf", ["ONE"])

    outcome = artifact_service._convert(target, lambda docx: docx.with_suffix(".pdf"))

    assert outcome.status == "success"
    assert outcome.pdf_path == tmp_path / "form.pdf"
    assert_confined(probe)


# ============================================================================================
# B. composed public paths / lane / pool threads
# ============================================================================================


def test_scan_back_read_document_never_runs_native_in_the_api_thread(probe: Probe) -> None:
    from app.services.document_reader import read_document

    result = read_document(_pdf_bytes(["Reference GS-0042 in text layer"]))

    assert result.text_source == "pdf_text"
    assert "GS-0042" in result.text
    assert probe.count("pixmap") >= 2  # the 200 dpi QR pass and the 300 dpi code pass
    assert_confined(probe, at_least=3)  # two raster streams + the text layer


def test_stage_paper_validates_in_a_worker_child(probe: Probe, data_dir: Path) -> None:
    service = _included_papers_service()

    staged, media_type, pages = service.stage_paper(_pdf_bytes(["A", "B"]), "paper.pdf")

    assert (media_type, pages) == ("application/pdf", 2)
    assert staged.size > 0
    assert_confined(probe)


def test_lane_route_work_runs_native_only_in_children(probe: Probe, tmp_path: Path) -> None:
    from app.api._offload import run_exclusive

    base = _pdf(tmp_path / "base.pdf", ["BASE"])
    extra = _pdf(tmp_path / "extra.pdf", ["EXTRA"])
    data = _pdf_bytes(["LANE-TEXT"])

    async def scenario() -> tuple[pdf_merge.PdfPackageResult, bytes, str]:
        package = await run_exclusive(pdf_merge.build_pdf_package, base, [(extra, "Extra.pdf")])
        merged = await run_exclusive(pdf_merge.merge_pdfs_to_bytes, base, [extra])
        text = await run_exclusive(ocr.pdf_text_layer, data)
        return package, merged, text

    package, merged, text = asyncio.run(scenario())

    assert _texts(package.pdf_bytes) == ["BASE", "EXTRA"]
    assert _texts(merged) == ["BASE", "EXTRA"]
    assert "LANE-TEXT" in text
    assert_confined(probe, at_least=3)


def test_overlapping_pool_threads_get_their_own_results(probe: Probe, pdf_worker: Any) -> None:
    labels = [f"OVERLAP-{index}" for index in range(6)]
    payloads = {label: _pdf_bytes([label]) for label in labels}  # built before any thread starts
    barrier = threading.Barrier(len(labels))

    def read(label: str) -> tuple[str, str]:
        barrier.wait(timeout=60)
        return label, ocr.pdf_text_layer(payloads[label])

    with ThreadPoolExecutor(max_workers=len(labels)) as executor:
        results = list(executor.map(read, labels))

    for label, text in results:
        assert text.strip() == label  # no cross-talk between concurrent jobs
    pids = assert_confined(probe, at_least=len(labels))
    assert len(pids) <= 3  # the dedicated calls pool is bounded


def test_a_held_raster_stream_does_not_block_short_calls(probe: Probe) -> None:
    stream_source = ocr.pdf_to_images(_pdf_bytes(["S1", "S2", "S3"]), dpi=72)
    first = next(stream_source)  # worker leased and held between pages
    try:
        text = ocr.pdf_text_layer(_pdf_bytes(["SHORT-CALL"]))
        second = next(stream_source)
    finally:
        stream_source.close()

    assert "SHORT-CALL" in text
    assert first.size == second.size == (300, 400)
    assert_confined(probe, at_least=2)


def test_confinement_ignores_gssg_inline_pdf(probe: Probe, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("GSSG_INLINE_PDF", "1")

    text = ocr.pdf_text_layer(_pdf_bytes(["INLINE-ENV"]))

    assert "INLINE-ENV" in text
    assert_confined(probe)


# ============================================================================================
# C. error / output parity (guards: green before AND after; only the pickling test is RED at base)
# ============================================================================================


_NOT_READABLE = re.escape("The uploaded PDF is not readable.")
_DPI_MESSAGE = re.escape("PDF raster DPI must be positive.")


def test_corrupt_pdf_text_layer_and_raster_error_parity() -> None:
    assert ocr.pdf_text_layer(b"%PDF-1.7 not really a pdf") == ""
    assert ocr.pdf_text_layer(b"not a pdf") == ""
    with pytest.raises(ocr.InvalidImageError, match=_NOT_READABLE):
        list(ocr.pdf_to_images(b"%PDF-1.7 not really a pdf"))
    with pytest.raises(ocr.InvalidImageError, match=_NOT_READABLE):
        list(ocr.pdf_to_images(b""))


def test_nonpositive_dpi_is_rejected_lazily_like_the_original_generator() -> None:
    generator = ocr.pdf_to_images(_pdf_bytes(["X"]), dpi=0)  # creating it must not raise
    with pytest.raises(ocr.InvalidImageError, match=_DPI_MESSAGE):
        next(generator)
    assert inspect.isgeneratorfunction(ocr.pdf_to_images)


def test_cumulative_raster_budget_error_surfaces_after_the_first_page() -> None:
    generator = ocr.pdf_to_images(_guard_pdf(), dpi=200)
    try:
        first = next(generator)
        assert first.mode == "RGB"
        assert first.size[0] > 1000
        with pytest.raises(ocr.InvalidImageError, match="too large to rasterize safely"):
            next(generator)
    finally:
        generator.close()


def test_build_pdf_package_error_parity(tmp_path: Path) -> None:
    base = _pdf(tmp_path / "base.pdf", ["FORM"])
    corrupt = tmp_path / "bad.pdf"
    corrupt.write_bytes(b"not a pdf")
    missing_base = tmp_path / "gone-base.pdf"

    with pytest.raises(FileNotFoundError) as base_error:
        pdf_merge.build_pdf_package(missing_base, [])
    assert str(base_error.value) == str(missing_base)

    with pytest.raises(FileNotFoundError, match=r"Missing paper\.pdf"):
        pdf_merge.build_pdf_package(base, [(tmp_path / "gone.pdf", "Missing paper.pdf")])

    with pytest.raises(pdf_merge.PdfPackageSourceError) as source_error:
        pdf_merge.build_pdf_package(base, [(corrupt, "Unreadable certificate.pdf")])
    assert source_error.value.filename == "Unreadable certificate.pdf"
    assert str(source_error.value) == "Could not read Unreadable certificate.pdf"
    assert isinstance(source_error.value, ValueError)

    with pytest.raises(RuntimeError):  # PyMuPDF's FileDataError, a RuntimeError, as before
        pdf_merge.build_pdf_package(corrupt, [])


def test_merge_pdfs_to_bytes_error_parity(tmp_path: Path) -> None:
    base = _pdf(tmp_path / "base.pdf", ["BASE"])
    corrupt = tmp_path / "bad.pdf"
    corrupt.write_bytes(b"not a pdf")

    with pytest.raises(RuntimeError, match="Failed to open file"):
        pdf_merge.merge_pdfs_to_bytes(corrupt, [])
    with pytest.raises(RuntimeError, match="no such file"):
        pdf_merge.merge_pdfs_to_bytes(tmp_path / "nope.pdf", [])
    with pytest.raises(RuntimeError, match="Failed to open file"):
        pdf_merge.merge_pdfs_to_bytes(base, [corrupt])


def test_service_level_corrupt_input_maps_to_the_same_http_errors(tmp_path: Path) -> None:
    service = _included_papers_service()
    corrupt_pdf = tmp_path / "bad.pdf"
    corrupt_pdf.write_bytes(b"not a pdf")
    corrupt_png = tmp_path / "bad.png"
    corrupt_png.write_bytes(b"not a png")  # raises an UNPICKLABLE MuPDF error inside the worker

    with pytest.raises(ValidationFailedError) as pdf_error:
        service.inspect_paper(corrupt_pdf, display_name="Bad.pdf")
    assert pdf_error.value.code == "INCLUDED_PAPERS_UNREADABLE"
    assert pdf_error.value.details == {"filename": "Bad.pdf"}

    with pytest.raises(ValidationFailedError) as png_error:
        service.inspect_paper(corrupt_png, display_name="Bad.png")
    assert png_error.value.code == "INCLUDED_PAPERS_UNREADABLE"

    with pytest.raises(ValidationFailedError) as scan_error:
        book_service._image_to_pdf_bytes(b"nope", ".png")
    assert scan_error.value.code == "BOOK_SCAN_CONVERT_FAILED"
    with pytest.raises(ValidationFailedError) as pdf_as_image:
        book_service._image_to_pdf_bytes(b"%PDF", ".pdf")
    assert pdf_as_image.value.code == "BOOK_SCAN_CONVERT_FAILED"

    (tmp_path / "empty.pdf").write_bytes(b"")
    with pytest.raises(ValidationFailedError) as empty:
        service.inspect_paper(tmp_path / "empty.pdf")
    assert empty.value.code == "INCLUDED_PAPERS_EMPTY_FILE"


def test_signed_primary_and_package_page_checks_keep_their_error_codes(
    db_session: Session, data_dir: Path
) -> None:
    service = _included_papers_service()
    book, version, _document, _paper = _record(db_session, data_dir)
    corrupt = data_dir / "signed-bad.pdf"
    corrupt.write_bytes(b"not a pdf")

    with pytest.raises(ValidationFailedError) as error:
        service.publish_signed_package(db_session, book, version, corrupt, physical_scan=False)
    assert error.value.code == "INCLUDED_PAPERS_SIGNED_BASE_UNREADABLE"

    (data_dir / "generated.pdf").write_bytes(b"not a pdf")
    with pytest.raises(ValidationFailedError) as described:
        service.describe_package(db_session, book)
    assert described.value.code == "INCLUDED_PAPERS_BASE_UNREADABLE"


def test_artifact_convert_reports_unavailable_for_an_unreadable_pdf(tmp_path: Path) -> None:
    target = tmp_path / "form.docx"
    target.write_bytes(b"docx")
    (tmp_path / "form.pdf").write_bytes(b"not a pdf at all")

    outcome = artifact_service._convert(target, lambda docx: docx.with_suffix(".pdf"))

    assert outcome.status == "unavailable"
    assert outcome.pdf_path is None


def test_public_signatures_are_unchanged() -> None:
    service = _included_papers_service()
    parameters = inspect.signature

    assert list(parameters(ocr.pdf_text_layer).parameters) == ["pdf_bytes"]
    raster = parameters(ocr.pdf_to_images).parameters
    assert list(raster) == ["pdf_bytes", "dpi"]
    assert raster["dpi"].kind is inspect.Parameter.KEYWORD_ONLY
    assert raster["dpi"].default == 200
    assert list(parameters(pdf_merge.build_pdf_package).parameters) == ["fixed_base", "sources"]
    assert list(parameters(pdf_merge.merge_pdfs_to_bytes).parameters) == ["base_pdf", "sources"]
    assert list(parameters(book_service._image_to_pdf_bytes).parameters) == ["data", "ext"]
    inspect_parameters = parameters(service.inspect_paper).parameters
    assert list(inspect_parameters) == ["path", "display_name"]
    assert inspect_parameters["display_name"].kind is inspect.Parameter.KEYWORD_ONLY
    assert list(parameters(service.describe_package).parameters) == ["db", "book"]
    assert list(parameters(service.publish_signed_package).parameters) == [
        "db",
        "book",
        "version",
        "signed_primary",
        "physical_scan",
        "advance_revision",
        "data_dir",
    ]
    assert list(parameters(artifact_service._convert).parameters) == ["target", "converter"]


def test_package_source_error_survives_the_process_boundary() -> None:
    error = pickle.loads(pickle.dumps(pdf_merge.PdfPackageSourceError("Bad.pdf")))

    assert isinstance(error, pdf_merge.PdfPackageSourceError)
    assert error.filename == "Bad.pdf"
    assert error.args == ("Could not read Bad.pdf",)
    assert str(error) == "Could not read Bad.pdf"


# ============================================================================================
# D. bounded raster consumption and early close
# ============================================================================================


def test_early_close_stops_the_child_at_exactly_the_consumed_pages(probe: Probe) -> None:
    generator = ocr.pdf_to_images(_pdf_bytes([f"P{index}" for index in range(6)]), dpi=72)

    next(generator)
    next(generator)
    generator.close()

    assert probe.count("pixmap") == 2  # never rendered ahead of the consumer
    assert_confined(probe)


def test_islice_consumers_release_the_stream_without_rendering_the_rest(probe: Probe) -> None:
    pages = list(
        islice(ocr.pdf_to_images(_pdf_bytes([f"P{index}" for index in range(6)]), dpi=72), 2)
    )

    assert len(pages) == 2
    assert probe.count("pixmap") == 2
    assert_confined(probe)


def test_raster_guard_error_never_renders_the_oversized_page(probe: Probe) -> None:
    generator = ocr.pdf_to_images(_guard_pdf(), dpi=200)
    try:
        next(generator)
        with pytest.raises(ocr.InvalidImageError):
            next(generator)
    finally:
        generator.close()

    assert probe.count("pixmap") == 1
    assert_confined(probe)


def test_stream_child_reports_no_read_ahead_and_the_worker_is_reused(
    pdf_worker: Any, make_pool: Callable[..., Any]
) -> None:
    pool = make_pool(max_workers=1)
    data = _pdf_bytes(["A", "B", "C", "D"])

    stream = pool.open_stream("rasters", data, 72)
    meta, blob = next(stream)
    assert meta == (300, 400)
    assert len(blob) == 300 * 400 * 3
    next(stream)
    pid = stream.pid
    stream.close()

    assert stream.received == 2
    assert stream.produced == 2  # the child rendered exactly what the consumer took
    assert pool.snapshot().idle_pids == (pid,)  # clean early close leaves the worker reusable
    assert pool.snapshot().leased_pids == ()
    again = pool.open_stream("rasters", data, 72)
    assert again.pid == pid
    again.close()


# ============================================================================================
# E. runtime: spawn-safe startup/shutdown, isolation, timeout/cancellation own-job cleanup
# ============================================================================================


def test_workers_are_spawned_children_of_this_process(
    pdf_worker: Any, make_pool: Callable[..., Any]
) -> None:
    start_method_before = multiprocessing.get_start_method(allow_none=True)
    pool = make_pool(max_workers=1)

    pid, ppid, thread_name = pool.call("ping")

    assert pdf_worker.START_METHOD == "spawn"
    assert pdf_worker.MP_CONTEXT.get_start_method() == "spawn"
    assert multiprocessing.get_start_method(allow_none=True) == start_method_before
    assert pid != os.getpid()
    assert ppid == os.getpid()
    assert thread_name == "MainThread"
    assert pool.snapshot().idle_pids == (pid,)
    # the child entry must be importable by reference so Windows spawn can unpickle it
    assert pickle.loads(pickle.dumps(pdf_worker._worker_main)) is pdf_worker._worker_main
    assert pool.jobs[-1].outcome == "ok"
    assert pool.jobs[-1].pid == pid


def test_concurrent_leases_use_distinct_worker_processes(
    pdf_worker: Any, make_pool: Callable[..., Any]
) -> None:
    pool = make_pool(max_workers=2)
    data = _pdf_bytes(["A", "B"])

    first = pool.open_stream("rasters", data, 72)
    second = pool.open_stream("rasters", data, 72)
    next(first)
    next(second)
    try:
        assert first.pid != second.pid
        assert set(pool.snapshot().leased_pids) == {first.pid, second.pid}
    finally:
        first.close()
        second.close()
    assert set(pool.snapshot().idle_pids) == {first.pid, second.pid}


@POSIX_ONLY
def test_call_timeout_kills_only_the_leased_worker(
    pdf_worker: Any, make_pool: Callable[..., Any]
) -> None:
    pool = make_pool(max_workers=2)
    pool.warm(2)
    first, second = pool.snapshot().idle_pids  # lease order: `first` is leased next
    assert first != second
    os.kill(first, signal.SIGSTOP)  # wedge it: it will never answer
    outcome: dict[str, BaseException] = {}

    def hung_call() -> None:
        try:
            pool.call("ping", timeout=1.5)
        except BaseException as exc:
            outcome["error"] = exc

    thread = threading.Thread(target=hung_call)
    thread.start()
    assert _wait_until(lambda: first in pool.snapshot().leased_pids)

    sibling_pid = pool.call("ping")[0]  # overlaps the wedged job on the other worker

    thread.join(30)
    assert not thread.is_alive()
    assert sibling_pid == second
    assert isinstance(outcome.get("error"), pdf_worker.NativeWorkerTimeoutError)
    assert _is_gone(first)
    assert not _is_gone(second)  # the sibling's worker was NOT reaped by the timeout
    assert pool.call("ping")[0] == second  # and keeps serving
    assert "timeout" in [job.outcome for job in pool.jobs]


@POSIX_ONLY
def test_cancelling_a_stream_kills_only_that_streams_worker(
    pdf_worker: Any, make_pool: Callable[..., Any]
) -> None:
    pool = make_pool(max_workers=2)
    data = _pdf_bytes(["A", "B", "C", "D"])
    victim = pool.open_stream("rasters", data, 72)
    survivor = pool.open_stream("rasters", data, 72)
    next(victim)
    next(survivor)
    os.kill(victim.pid, signal.SIGSTOP)  # the victim's next page will never arrive
    outcome: dict[str, BaseException] = {}

    def consume() -> None:
        try:
            next(victim)
        except BaseException as exc:
            outcome["error"] = exc

    thread = threading.Thread(target=consume)
    thread.start()
    time.sleep(0.3)  # let the consumer block waiting on the wedged child
    victim.cancel()
    thread.join(30)

    assert not thread.is_alive()
    assert isinstance(outcome.get("error"), pdf_worker.NativeWorkerCancelledError)
    assert _wait_until(lambda: _is_gone(victim.pid))
    meta, _blob = next(survivor)  # the sibling stream is untouched
    assert meta == (300, 400)
    survivor.close()
    assert pool.snapshot().idle_pids == (survivor.pid,)


@POSIX_ONLY
def test_stream_step_timeout_kills_only_that_streams_worker(
    pdf_worker: Any, make_pool: Callable[..., Any]
) -> None:
    pool = make_pool(max_workers=2)
    data = _pdf_bytes(["A", "B", "C"])
    slow = pool.open_stream("rasters", data, 72, step_timeout=1.0)
    other = pool.open_stream("rasters", data, 72)
    next(slow)
    next(other)
    os.kill(slow.pid, signal.SIGSTOP)

    with pytest.raises(pdf_worker.NativeWorkerTimeoutError):
        next(slow)

    assert _wait_until(lambda: _is_gone(slow.pid))
    next(other)
    other.close()
    assert pool.snapshot().idle_pids == (other.pid,)


def test_lease_wait_expiry_is_a_busy_error_that_never_reaps_the_holder(
    pdf_worker: Any, make_pool: Callable[..., Any]
) -> None:
    pool = make_pool(max_workers=1, lease_timeout=0.5)
    holder = pool.open_stream("rasters", _pdf_bytes(["A", "B", "C"]), 72)
    next(holder)

    started = time.monotonic()
    with pytest.raises(pdf_worker.NativeWorkerBusyError):
        pool.call("ping")  # queued behind the stream: its own wait budget, no kill
    waited = time.monotonic() - started

    assert 0.4 <= waited < 10.0
    assert holder.pid in pool.snapshot().leased_pids
    meta, _blob = next(holder)  # the holder keeps streaming on the very same worker
    assert meta == (300, 400)
    holder.close()


@POSIX_ONLY
def test_pool_shutdown_cancels_in_flight_work_and_reaps_every_worker(
    pdf_worker: Any, make_pool: Callable[..., Any]
) -> None:
    pool = make_pool(max_workers=2)
    pool.warm(2)
    pids = pool.snapshot().idle_pids
    os.kill(pids[0], signal.SIGSTOP)
    outcome: dict[str, BaseException] = {}

    def hung_call() -> None:
        try:
            pool.call("ping", timeout=60)
        except BaseException as exc:
            outcome["error"] = exc

    thread = threading.Thread(target=hung_call)
    thread.start()
    assert _wait_until(lambda: pids[0] in pool.snapshot().leased_pids)

    pool.shutdown()
    thread.join(30)

    assert not thread.is_alive()
    assert isinstance(outcome.get("error"), pdf_worker.NativeWorkerCancelledError)
    assert all(_wait_until(lambda pid=pid: _is_gone(pid)) for pid in pids)
    with pytest.raises(pdf_worker.NativeWorkerError):
        pool.call("ping")  # a shut-down pool never resurrects workers


def test_module_shutdown_is_reversible_and_respawns_lazily(pdf_worker: Any) -> None:
    before = pdf_worker.call("ping")[0]

    pdf_worker.shutdown()
    assert _wait_until(lambda: _is_gone(before))
    after = pdf_worker.call("ping")[0]

    assert after != before
    assert not _is_gone(after)


_LIFECYCLE_SCRIPT = textwrap.dedent(
    """
    import os
    import sys
    import time

    from app.core import pdf_worker


    def main():
        pid, ppid, _thread = pdf_worker.call("ping")
        print("READY", pid, os.getpid(), flush=True)
        if sys.argv[1] == "wait":
            time.sleep(120)


    if __name__ == "__main__":
        main()
    """
)


@POSIX_ONLY
@pytest.mark.parametrize("how", ["exit", "kill"])
def test_no_worker_outlives_its_parent(pdf_worker: Any, how: str) -> None:
    env = dict(os.environ)
    env["PYTHONPATH"] = str(BACKEND_DIR)
    env.pop("GSSG_NATIVE_PROBE_LOG", None)
    with subprocess.Popen(
        [sys.executable, "-c", _LIFECYCLE_SCRIPT, "wait" if how == "kill" else "exit"],
        env=env,
        cwd=str(BACKEND_DIR),
        stdout=subprocess.PIPE,
        text=True,
    ) as process:
        try:
            assert process.stdout is not None
            child_pid = parent_pid = 0
            for _ in range(200):  # the worker may print its own import noise first
                line = process.stdout.readline()
                if not line:
                    break
                if line.startswith("READY "):
                    _marker, child, parent = line.split()
                    child_pid, parent_pid = int(child), int(parent)
                    break
            assert child_pid and parent_pid, "worker never reported ready"
            assert child_pid != parent_pid
            assert not _is_gone(child_pid)
            if how == "kill":
                process.kill()  # SIGKILL: no atexit, no shutdown hook may run
            else:
                process.wait(timeout=60)
            process.wait(timeout=60)
            assert _wait_until(lambda: _is_gone(child_pid), timeout=30), (
                f"worker {child_pid} outlived its parent ({how})"
            )
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()


# ============================================================================================
# F. infrastructure failures stay mapped (503); never a 422 blamed on the upload or a bare 500
# ============================================================================================


def test_infrastructure_errors_are_503_app_errors_outside_the_file_error_hierarchies(
    pdf_worker: Any,
) -> None:
    expected = {
        "NativeWorkerTimeoutError": "PDF_WORKER_TIMEOUT",
        "NativeWorkerCrashedError": "PDF_WORKER_FAILED",
        "NativeWorkerCancelledError": "PDF_WORKER_CANCELLED",
        "NativeWorkerBusyError": "PDF_WORKER_BUSY",
    }
    for name, code in expected.items():
        error = getattr(pdf_worker, name)()
        assert isinstance(error, AppError)
        assert isinstance(error, pdf_worker.NativeWorkerError)
        assert error.http_status == 503
        assert error.code == code
        # a narrow `except (RuntimeError, ValueError, OSError)` must never swallow them
        assert not isinstance(error, RuntimeError | ValueError | OSError)
        assert not isinstance(error, ValidationFailedError)
    # an op's own (unpicklable) exception is NOT an infrastructure failure
    assert not issubclass(pdf_worker.NativeOpError, pdf_worker.NativeWorkerError)


@pytest.fixture()
def wedge_next_worker(
    pdf_worker: Any, monkeypatch: pytest.MonkeyPatch
) -> Iterator[Callable[[str], int]]:
    """Rebuild the module pools with 1 s execution budgets; SIGSTOP the next worker of a pool."""
    pdf_worker.shutdown()
    monkeypatch.setattr(pdf_worker, "CALL_TIMEOUT_SECONDS", 1.0)
    monkeypatch.setattr(pdf_worker, "STEP_TIMEOUT_SECONDS", 1.0)

    def wedge(pool_name: str) -> int:
        pool = pdf_worker.get_pool(pool_name)
        pool.warm(1)
        pid = pool.snapshot().idle_pids[0]
        os.kill(pid, signal.SIGSTOP)
        return pid

    yield wedge
    pdf_worker.shutdown()


def _wedged_inspect(root: Path) -> object:
    return _included_papers_service().inspect_paper(
        _pdf(root / "ok.pdf", ["A"]), display_name="Ok.pdf"
    )


def _wedged_scan_convert(_root: Path) -> object:
    return book_service._image_to_pdf_bytes(_png_bytes(), ".png")


def _wedged_convert(root: Path) -> object:
    target = root / "form.docx"
    target.write_bytes(b"docx")
    _pdf(root / "form.pdf", ["ONE"])
    return artifact_service._convert(target, lambda docx: docx.with_suffix(".pdf"))


def _wedged_build(root: Path) -> object:
    return pdf_merge.build_pdf_package(_pdf(root / "base.pdf", ["B"]), [])


def _wedged_merge(root: Path) -> object:
    return pdf_merge.merge_pdfs_to_bytes(_pdf(root / "base.pdf", ["B"]), [])


def _wedged_text_layer(_root: Path) -> object:
    return ocr.pdf_text_layer(_pdf_bytes(["T"]))


def _wedged_describe(root: Path) -> object:
    return pdf_merge.pdf_page_count(_pdf(root / "one.pdf", ["A"]))


def _wedged_rasters(_root: Path) -> object:
    return list(ocr.pdf_to_images(_pdf_bytes(["R"]), dpi=72))


def _wedged_qr_refs(_root: Path) -> object:
    return ocr.qr_refs_from_bytes(_pdf_bytes(["Q"]))  # swallows file errors, NOT infrastructure


def _wedged_codes(_root: Path) -> object:
    return ocr.decode_codes_from_bytes(_pdf_bytes(["C"]))


_WEDGED_ENTRYPOINTS: list[tuple[str, str, Callable[[Path], object]]] = [
    ("calls", "inspect_paper", _wedged_inspect),
    ("calls", "image_to_pdf_bytes", _wedged_scan_convert),
    ("calls", "artifact_convert", _wedged_convert),
    ("calls", "build_pdf_package", _wedged_build),
    ("calls", "merge_pdfs_to_bytes", _wedged_merge),
    ("calls", "pdf_text_layer", _wedged_text_layer),
    ("calls", "page_count", _wedged_describe),
    ("streams", "pdf_to_images", _wedged_rasters),
    ("streams", "qr_refs_from_bytes", _wedged_qr_refs),
    ("streams", "decode_codes_from_bytes", _wedged_codes),
]


@POSIX_ONLY
@pytest.mark.parametrize(
    ("pool_name", "label", "invoke"),
    _WEDGED_ENTRYPOINTS,
    ids=[label for _pool, label, _invoke in _WEDGED_ENTRYPOINTS],
)
def test_a_wedged_worker_surfaces_a_503_timeout_from_every_entrypoint(
    pdf_worker: Any,
    wedge_next_worker: Callable[[str], int],
    tmp_path: Path,
    pool_name: str,
    label: str,
    invoke: Callable[[Path], object],
) -> None:
    wedged = wedge_next_worker(pool_name)

    with pytest.raises(AppError) as failure:
        invoke(tmp_path)

    assert isinstance(failure.value, pdf_worker.NativeWorkerTimeoutError), label
    assert failure.value.http_status == 503
    assert failure.value.code == "PDF_WORKER_TIMEOUT"
    assert not isinstance(failure.value, ValidationFailedError)  # not blamed on the upload
    assert _wait_until(lambda: _is_gone(wedged))


@POSIX_ONLY
def test_http_envelope_keeps_422_for_a_bad_upload_and_503_for_a_failed_worker(
    pdf_worker: Any, wedge_next_worker: Callable[[str], int], tmp_path: Path
) -> None:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.api.errors import install_handlers

    service = _included_papers_service()
    good = _pdf(tmp_path / "good.pdf", ["A", "B"])
    bad = tmp_path / "bad.pdf"
    bad.write_bytes(b"not a pdf")
    app = FastAPI()
    install_handlers(app)

    @app.get("/inspect")
    def inspect_route(which: str) -> dict[str, object]:
        path = good if which == "good" else bad
        media_type, pages = service.inspect_paper(path, display_name=path.name)
        return {"media_type": media_type, "pages": pages}

    with TestClient(app) as client:
        unreadable = client.get("/inspect", params={"which": "bad"})
        assert unreadable.status_code == 422
        assert unreadable.json()["error"]["code"] == "INCLUDED_PAPERS_UNREADABLE"

        wedge_next_worker("calls")
        failed = client.get("/inspect", params={"which": "good"})
        assert failed.status_code == 503
        assert failed.json()["error"]["code"] == "PDF_WORKER_TIMEOUT"

        recovered = client.get("/inspect", params={"which": "good"})  # fresh worker, no retry loop
        assert recovered.status_code == 200
        assert recovered.json() == {"media_type": "application/pdf", "pages": 2}


@POSIX_ONLY
def test_a_worker_that_dies_mid_job_fails_that_job_only_with_a_503_and_is_not_retried(
    pdf_worker: Any, make_pool: Callable[..., Any]
) -> None:
    pool = make_pool(max_workers=1)
    pool.warm(1)
    victim = pool.snapshot().idle_pids[0]
    os.kill(victim, signal.SIGSTOP)
    outcome: dict[str, BaseException] = {}

    def doomed_call() -> None:
        try:
            pool.call("ping", timeout=60)
        except BaseException as exc:
            outcome["error"] = exc

    thread = threading.Thread(target=doomed_call)
    thread.start()
    assert _wait_until(lambda: victim in pool.snapshot().leased_pids)
    os.kill(victim, signal.SIGKILL)  # e.g. the OOM killer
    thread.join(30)

    error = outcome.get("error")
    assert isinstance(error, pdf_worker.NativeWorkerCrashedError)
    assert isinstance(error, AppError)
    assert (error.http_status, error.code) == (503, "PDF_WORKER_FAILED")
    assert [job.outcome for job in pool.jobs] == ["crashed"]  # one attempt, no automatic retry
    assert pool.call("ping")[0] != victim  # the next job gets a fresh worker


@POSIX_ONLY
def test_a_worker_that_died_while_idle_is_replaced_before_the_next_job(
    pdf_worker: Any, make_pool: Callable[..., Any]
) -> None:
    pool = make_pool(max_workers=1)
    pool.warm(1)
    victim = pool.snapshot().idle_pids[0]
    os.kill(victim, signal.SIGKILL)
    assert _wait_until(lambda: _is_gone(victim))

    replacement = pool.call("ping")[0]  # no error: the dead idle worker is dropped at lease time

    assert replacement != victim
    assert pool.jobs[-1].outcome == "ok"
