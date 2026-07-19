"""Rename ops on the shared General Book template library."""

from pathlib import Path

import pytest

from app.api.errors import AppError
from app.services import book_template_service


@pytest.fixture
def library(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    monkeypatch.setattr(book_template_service, "templates_dir", lambda: tmp_path)
    (tmp_path / "الصيانة.docx").write_bytes(b"PK-fake")
    (tmp_path / "التكليف.docx").write_bytes(b"PK-fake")
    return tmp_path


def test_rename_moves_the_file(library: Path) -> None:
    info = book_template_service.rename_template("الصيانة.docx", "صيانة المباني")
    assert info.name == "صيانة المباني.docx"
    assert (library / "صيانة المباني.docx").exists()
    assert not (library / "الصيانة.docx").exists()


def test_rename_collision_is_409(library: Path) -> None:
    with pytest.raises(AppError) as ei:
        book_template_service.rename_template("الصيانة.docx", "التكليف")
    assert ei.value.http_status == 409


def test_rename_missing_is_404(library: Path) -> None:
    with pytest.raises(AppError) as ei:
        book_template_service.rename_template("غير موجود.docx", "جديد")
    assert ei.value.http_status == 404


def test_rename_bad_name_is_422(library: Path) -> None:
    with pytest.raises(AppError) as ei:
        book_template_service.rename_template("الصيانة.docx", "../evil")
    assert ei.value.http_status == 422


def test_rename_to_same_name_is_noop(library: Path) -> None:
    info = book_template_service.rename_template("الصيانة.docx", "الصيانة")
    assert info.name == "الصيانة.docx"
    assert (library / "الصيانة.docx").exists()
