"""Run the production process-pool PDF adapter against one synthetic DOCX."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path

import fitz


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--json-out", type=Path, required=True)
    args = parser.parse_args()

    source = args.source.resolve(strict=True)
    work_dir = args.work_dir.resolve()
    json_out = args.json_out.resolve()
    if source.suffix.lower() != ".docx" or not source.is_file():
        raise ValueError(f"Expected a regular DOCX source: {source}")
    work_dir.mkdir(parents=True, exist_ok=True)
    if work_dir != json_out.parent and work_dir not in json_out.parents:
        raise ValueError("JSON output must be inside the owned work directory")

    copied = work_dir / "executor-source.docx"
    if copied.exists() or copied.with_suffix(".pdf").exists():
        raise FileExistsError("Executor smoke destinations must be new")
    shutil.copy2(source, copied)
    source_hash = _sha256(source)
    os.environ.pop("GSSG_INLINE_PDF", None)

    from app.services import _pdf_executor

    executor = None
    try:
        output = _pdf_executor.convert_docx_to_pdf(copied)
        executor = _pdf_executor.get_executor()
    finally:
        if executor is not None:
            executor.shutdown(wait=True, cancel_futures=True)

    if output is None:
        raise RuntimeError("Production process-pool adapter returned no PDF")
    output = output.resolve(strict=True)
    with fitz.open(output) as pdf:
        if pdf.page_count < 1:
            raise RuntimeError("Production process-pool adapter produced an empty PDF")
        page_count = pdf.page_count
    if _sha256(source) != source_hash:
        raise RuntimeError("Original source changed during executor smoke")

    evidence = {
        "adapter": "app.services._pdf_executor.convert_docx_to_pdf",
        "chain_method": None,
        "chain_method_claimed": False,
        "inline_mode": False,
        "source": str(source),
        "source_sha256": source_hash,
        "copied_source": str(copied),
        "copied_source_sha256": _sha256(copied),
        "pdf": str(output),
        "pdf_sha256": _sha256(output),
        "page_count": page_count,
    }
    json_out.parent.mkdir(parents=True, exist_ok=True)
    json_out.write_text(json.dumps(evidence, indent=2, sort_keys=True), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
