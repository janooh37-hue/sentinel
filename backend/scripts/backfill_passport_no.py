"""Backfill Employee.passport_no by OCR'ing stored passport scans.

Dry-run by default. Auto-writes only validated-MRZ numbers into empty fields
(see passport_ocr_service). Prints filled / needs_review / no_scan buckets.

Usage:
    python -m scripts.backfill_passport_no            # dry-run
    python -m scripts.backfill_passport_no --apply    # write + DB backup
"""

from __future__ import annotations

import argparse
import shutil
from datetime import datetime

from sqlalchemy.orm import Session

from app.config import get_settings
from app.db.models import Employee
from app.db.session import SessionLocal
from app.services import passport_ocr_service as svc


def run_backfill(db: Session, *, apply: bool) -> dict[str, list[str]]:
    report: dict[str, list[str]] = {"filled": [], "needs_review": [], "no_scan": []}
    for emp in db.query(Employee).order_by(Employee.id).all():
        result = svc.extract_passport_for_employee(db, emp.id)
        if result is None:
            report["no_scan"].append(emp.id)
            continue
        if (
            result.method == "mrz"
            and result.number
            and result.confidence >= svc.MRZ_AUTOWRITE_CONFIDENCE
        ):
            if apply and not emp.passport_no:
                svc.apply_passport_extraction(db, emp, result)
            report["filled"].append(emp.id)
        else:
            report["needs_review"].append(emp.id)
    return report


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill passport numbers via OCR.")
    parser.add_argument("--apply", action="store_true", help="write changes (default: dry-run)")
    args = parser.parse_args()

    if args.apply:
        db_path = get_settings().db_path
        backup = db_path.with_suffix(
            db_path.suffix + f".bak-passport-{int(datetime.now().timestamp())}"
        )
        shutil.copy2(db_path, backup)
        print(f"DB backed up -> {backup}")

    with SessionLocal() as db:
        report = run_backfill(db, apply=args.apply)

    mode = "APPLIED" if args.apply else "DRY-RUN"
    print(f"\n=== Passport backfill ({mode}) ===")
    print(f"  filled (auto-written MRZ): {len(report['filled'])}")
    print(f"  needs review (scan, no confident number): {len(report['needs_review'])}")
    print(f"  no scan on file: {len(report['no_scan'])}")
    if report["needs_review"]:
        print("\n  NEEDS REVIEW (enter manually from the profile):")
        print("  " + ", ".join(report["needs_review"]))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
