"""Read-only diagnostic: measure passport-OCR extraction quality on a
representative sample of stored scans.

Picks an evenly-spaced sample across all employees who are missing a passport
number but have a passport scan on file, runs the real extraction pipeline
(NO writes), and reports the auto-write hit-rate, the method breakdown, and
per-scan timing. Written so it can be run unattended from a scheduled task.

Auto-write yield = scans that produce a checksum-VALID MRZ (confidence >=
MRZ_AUTOWRITE_CONFIDENCE); only those would be written by
`backfill_passport_no --apply`. "Structural" MRZ (detected but checksum-failing)
and "printed" hits are review-only and never auto-written.

Usage (from the backend dir, with backend on PYTHONPATH):
    python -m scripts.passport_sample_report                 # 25-scan sample
    python -m scripts.passport_sample_report --sample 40     # custom size
    python -m scripts.passport_sample_report --report path   # custom report file
"""

from __future__ import annotations

import argparse
import statistics
import time
from datetime import datetime
from pathlib import Path

from app.db.models import Employee
from app.db.session import SessionLocal
from app.services import passport_ocr_service as svc

DEFAULT_SAMPLE = 25
DEFAULT_REPORT = Path(r"C:\Users\Admin\sentinel\passport-sample-report.txt")


def _evenly_spaced(items: list[Employee], n: int) -> list[Employee]:
    """Evenly-spaced subsequence of up to *n* items across the sorted list.

    Spreads the sample across the whole ID range so a single bad-scan cluster
    can't dominate the estimate (unlike taking the first N consecutive IDs).
    """
    if n <= 0 or not items:
        return []
    if len(items) <= n:
        return items
    step = len(items) / n
    return [items[int(i * step)] for i in range(n)]


def run_sample(sample_size: int) -> list[str]:
    """Run the extraction on a representative sample; return report lines."""
    lines: list[str] = []

    def out(msg: str) -> None:
        lines.append(msg)
        print(msg, flush=True)

    started = datetime.now()
    out(f"# Passport OCR sample report — started {started:%Y-%m-%d %H:%M:%S}")

    with SessionLocal() as db:
        missing = [e for e in db.query(Employee).order_by(Employee.id).all() if not e.passport_no]
        with_scan = [e for e in missing if svc._newest_passport_scan(e.id)]
        sample = _evenly_spaced(with_scan, sample_size)

        out(f"employees missing passport_no: {len(missing)}")
        out(
            f"  with a passport scan on file: {len(with_scan)}  (no scan: {len(missing) - len(with_scan)})"
        )
        out(f"sampling {len(sample)} evenly across the scanned set\n")

        times: list[float] = []
        valid_mrz = structural_mrz = printed = none = 0

        for e in sample:
            t0 = time.perf_counter()
            try:
                res = svc.extract_passport_for_employee(db, e.id)
            except Exception as exc:
                out(f"{e.id}: ERROR {exc!r}")
                continue
            dt = time.perf_counter() - t0
            times.append(dt)

            if res is None:
                none += 1
                out(f"{e.id}: {dt:6.1f}s  method=none    (no scan resolved)")
                continue
            number = res.number or "-"
            snippet = res.source_snippet or ""
            if res.method == "mrz" and res.confidence >= svc.MRZ_AUTOWRITE_CONFIDENCE:
                valid_mrz += 1
                tag = "AUTO-WRITE"
            elif res.method == "mrz":
                structural_mrz += 1
                tag = "review"
            elif res.method == "printed":
                printed += 1
                tag = "review"
            else:
                none += 1
                tag = ""
            out(
                f"{e.id}: {dt:6.1f}s  method={res.method:7} conf={res.confidence:.2f} "
                f"number={number:12} [{tag}] {snippet}"
            )

        out("")
        out("## Summary")
        n = len(sample)
        out(f"  auto-writable (valid MRZ >= {svc.MRZ_AUTOWRITE_CONFIDENCE}): {valid_mrz}/{n}")
        out(f"  structural MRZ (detected, checksum-failed, review-only): {structural_mrz}/{n}")
        out(f"  printed (labelled number, review-only):                  {printed}/{n}")
        out(f"  none (no number found):                                  {none}/{n}")
        if times:
            out(
                f"  per-scan seconds: min={min(times):.1f} "
                f"avg={statistics.mean(times):.1f} max={max(times):.1f}"
            )
            # Project the auto-write yield and runtime over the full scanned set.
            if n:
                proj_yield = round(valid_mrz / n * len(with_scan))
                proj_minutes = round(statistics.mean(times) * len(with_scan) / 60)
                out(
                    f"  projected over {len(with_scan)} scans: "
                    f"~{proj_yield} auto-writable, ~{proj_minutes} min full run"
                )
        out(
            f"\n# finished {datetime.now():%Y-%m-%d %H:%M:%S} "
            f"(elapsed {(datetime.now() - started).total_seconds() / 60:.1f} min)"
        )

    return lines


def main() -> int:
    parser = argparse.ArgumentParser(description="Passport OCR sample quality report (read-only).")
    parser.add_argument(
        "--sample", type=int, default=DEFAULT_SAMPLE, help="number of scans to sample"
    )
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT, help="report output file")
    args = parser.parse_args()

    lines = run_sample(args.sample)
    args.report.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"\n[report written to {args.report}]", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
