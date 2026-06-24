"""DOCX → PDF conversion chain ported from `convert_docx_to_pdf`
(v3.5.4 line 821).

Preserves v3's three-method fallback in order, with the same reproducibility
quirks the v3 ``CLAUDE.md`` calls out:

  1. **docx2pdf** — wraps Word via the simplest interface, but stalls under
     `.pyw` because `sys.stdout`/`stderr` are `None` and its tqdm progress
     bar crashes. We patch in `_NullStream` for the duration of the call.
     Harmless in server context (streams exist) but kept for parity.
  2. **win32com `DispatchEx`** — fresh, isolated Word instance. Using
     `Dispatch` instead would attach to a zombie Word from a prior failure
     and corrupt the next conversion.
  3. **PowerShell COM** — last-ditch shell-out with a 30-second timeout and
     ``CREATE_NO_WINDOW`` so no console flashes onto the desktop.

Public contract (per `plans/01-core-port.md`):

    PdfChain.convert(docx_path, pdf_path=None) -> Path
        Returns the written PDF path. Raises ``PdfConversionError`` with
        the per-method error trail attached when every method fails.

    PdfChain.convert_or_none(docx_path, pdf_path=None) -> ConversionResult
        Non-raising variant returning a dataclass — matches v3's
        ``(path, error)`` tuple semantics for callers that prefer that.

Word is *not* required for the module to import; the methods detect
their dependencies on first use. Tests on non-Word runners exercise the
error-aggregation path with mocks.
"""

from __future__ import annotations

import logging
import subprocess
import sys
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Final

log = logging.getLogger(__name__)

POWERSHELL_TIMEOUT_SECONDS: Final[int] = 30
# Win32 ``CREATE_NO_WINDOW`` — keeps a console from flashing during the
# PowerShell fallback. The constant lives in ``subprocess`` on 3.7+ but is
# Windows-only, so we inline the value for cross-platform mypy.
_CREATE_NO_WINDOW: Final[int] = 0x08000000

# Word's wdFormatPDF enum value passed to SaveAs2 / SaveAs.
_WD_FORMAT_PDF: Final[int] = 17


class PdfConversionError(RuntimeError):
    """Raised when every conversion method fails. Carries per-method errors."""

    def __init__(self, errors: dict[str, str]) -> None:
        self.errors = dict(errors)
        message = "\n".join(f"{method}: {err}" for method, err in errors.items())
        super().__init__(f"All PDF conversion methods failed:\n{message}")


@dataclass(frozen=True, slots=True)
class ConversionResult:
    """Outcome of a conversion attempt."""

    path: Path | None
    method: str | None
    errors: dict[str, str]

    @property
    def ok(self) -> bool:
        return self.path is not None


class _NullStream:
    """Silent stand-in for `sys.stdout` / `sys.stderr`. Mirrors v3 line 835."""

    def write(self, *_args: object, **_kwargs: object) -> int:
        return 0

    def flush(self, *_args: object, **_kwargs: object) -> None:
        return None

    def isatty(self) -> bool:
        return False


class PdfChain:
    """DOCX → PDF converter with the v3.5.4 three-method fallback."""

    # Methods are bound at instance level so tests can monkey-patch each one
    # independently. The order is fixed: docx2pdf → win32com → PowerShell.

    def __init__(self) -> None:
        self._methods: tuple[tuple[str, Callable[[Path, Path], None]], ...] = (
            ("docx2pdf", self._via_docx2pdf),
            ("win32com", self._via_win32com),
            ("powershell", self._via_powershell),
        )

    # ------------------------------------------------------------------
    # Public surface
    # ------------------------------------------------------------------

    def convert(
        self,
        docx_path: Path | str,
        pdf_path: Path | str | None = None,
    ) -> Path:
        """Convert `docx_path` to PDF. Returns the written path.

        Raises ``FileNotFoundError`` if the source DOCX is missing and
        ``PdfConversionError`` if every method fails.
        """
        result = self.convert_or_none(docx_path, pdf_path)
        if result.path is None:
            raise PdfConversionError(result.errors)
        return result.path

    def convert_or_none(
        self,
        docx_path: Path | str,
        pdf_path: Path | str | None = None,
    ) -> ConversionResult:
        """Non-raising variant. See :meth:`convert`."""
        src = Path(docx_path).resolve()
        if not src.exists():
            raise FileNotFoundError(src)
        dst = (
            Path(pdf_path).resolve()
            if pdf_path is not None
            else src.with_suffix(".pdf")
        )

        errors: dict[str, str] = {}
        for name, method in self._methods:
            try:
                method(src, dst)
            except _MethodUnavailable as e:
                errors[name] = str(e)
                continue
            except Exception as e:
                errors[name] = str(e)
                log.debug("PDF method %s failed: %s", name, e)
                continue
            if dst.exists() and dst.stat().st_size > 0:
                log.info("Converted %s → %s via %s", src.name, dst.name, name)
                return ConversionResult(path=dst, method=name, errors=errors)
            errors[name] = f"{name} produced empty file"

        log.warning("All PDF conversion methods failed for %s", src)
        return ConversionResult(path=None, method=None, errors=errors)

    # ------------------------------------------------------------------
    # Method 1 — docx2pdf
    # ------------------------------------------------------------------

    def _via_docx2pdf(self, src: Path, dst: Path) -> None:
        try:
            import docx2pdf
        except ImportError as e:
            raise _MethodUnavailable(f"docx2pdf not installed: {e}") from e

        old_out, old_err = sys.stdout, sys.stderr
        try:
            if sys.stdout is None:
                sys.stdout = _NullStream()
            if sys.stderr is None:
                sys.stderr = _NullStream()
            docx2pdf.convert(str(src), str(dst))
        finally:
            sys.stdout, sys.stderr = old_out, old_err

    # ------------------------------------------------------------------
    # Method 2 — win32com DispatchEx
    # ------------------------------------------------------------------

    def _via_win32com(self, src: Path, dst: Path) -> None:
        if sys.platform != "win32":
            raise _MethodUnavailable("win32com only available on Windows")
        try:
            import win32com.client
        except ImportError as e:
            raise _MethodUnavailable(f"pywin32 not installed: {e}") from e

        word = None
        doc = None
        try:
            # DispatchEx forces a *fresh* Word — Dispatch would attach to a
            # zombie left by a prior failure and crash the next conversion.
            word = win32com.client.DispatchEx("Word.Application")
            word.Visible = False
            word.DisplayAlerts = False
            doc = word.Documents.Open(str(src), ReadOnly=False)
            doc.SaveAs2(str(dst), FileFormat=_WD_FORMAT_PDF)
            doc.Close(False)
            doc = None
            word.Quit()
            word = None
        finally:
            # Best-effort cleanup so Method 3 doesn't inherit a locked file.
            if doc is not None:
                try:
                    doc.Close(False)
                except Exception:
                    log.debug("doc.Close cleanup raised", exc_info=True)
            if word is not None:
                try:
                    word.Quit()
                except Exception:
                    log.debug("word.Quit cleanup raised", exc_info=True)

    # ------------------------------------------------------------------
    # Method 3 — PowerShell COM
    # ------------------------------------------------------------------

    def _via_powershell(self, src: Path, dst: Path) -> None:
        if sys.platform != "win32":
            raise _MethodUnavailable("PowerShell COM only available on Windows")
        ps_cmd = (
            f"$word = New-Object -ComObject Word.Application; "
            f"$word.Visible = $false; "
            f"$word.DisplayAlerts = 0; "
            f'$doc = $word.Documents.Open("{src}"); '
            f'$doc.SaveAs([ref]"{dst}", [ref]{_WD_FORMAT_PDF}); '
            f"$doc.Close([ref]$false); "
            f"$word.Quit()"
        )
        result = subprocess.run(
            ["powershell", "-Command", ps_cmd],
            capture_output=True,
            text=True,
            timeout=POWERSHELL_TIMEOUT_SECONDS,
            creationflags=_CREATE_NO_WINDOW,
            check=False,
        )
        if result.returncode != 0:
            raise RuntimeError(
                result.stderr.strip() or f"powershell exited {result.returncode}"
            )


class _MethodUnavailable(RuntimeError):
    """Internal — flags that a method is structurally absent (not a runtime error)."""


# Convenience module-level helpers for callers that don't want to instantiate.
_default = PdfChain()


def convert(docx_path: Path | str, pdf_path: Path | str | None = None) -> Path:
    return _default.convert(docx_path, pdf_path)


def convert_or_none(
    docx_path: Path | str, pdf_path: Path | str | None = None
) -> ConversionResult:
    return _default.convert_or_none(docx_path, pdf_path)
