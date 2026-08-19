"""Export and import the minimal employee directory needed to verify identity matching.

Checking whether BioTime's ``emp_code`` values correspond to real Sentinel
G numbers does not require a production database. It requires the G numbers.
This moves the directory columns the workforce dashboard actually reads and
nothing else, so no passport number, Emirates ID, IBAN, phone, address, date of
birth, salary, leave record, or document ever leaves the server.

Exported columns:

* ``id``          - the G number, the whole point of the exercise
* ``name_en``     - so a human can recognise a mismatch in the report
* ``name_ar``     - optional, same reason
* ``department`` / ``duty_unit`` / ``duty_post`` - the workforce scope hierarchy,
  dropped together with ``--no-duty``. ``duty_unit`` assigns a person to a crew;
  ``duty_post`` is the position within it, and coverage targets and access scopes
  are keyed on all three. ``department`` is not optional in practice: the
  hierarchy check constraint requires it to be present before a ``duty_unit`` or
  ``duty_post`` scope is valid at all. None of the three is personal data.
* ``status``      - optional; active vs departed changes whether an unmatched
  person is a problem or expected.
* ``nationality`` - optional; the only input the nationality-mix widget has.
  It is the most identifying column here, so it can be dropped with
  ``--no-nationality``. The widget itself never shows a raw small group: the
  configured ``nationality_fold_min_count`` folds any nationality below the
  threshold into "Other" so a single person cannot be picked out of the chart.

Usage on the server::

    venv/Scripts/python.exe backend/scripts/employee_directory.py export --out directory.csv
    # names omitted entirely:
    venv/Scripts/python.exe backend/scripts/employee_directory.py export --out directory.csv --no-names

Usage on the development machine::

    GSSG_DATA_DIR=... venv/Scripts/python.exe backend/scripts/employee_directory.py import \
        --in directory.csv --replace

``--replace`` clears employees that came from a previous import so a synthetic
directory cannot be mistaken for the real one. It refuses to run if any employee
row is referenced by real operational data, because this script is a directory
loader and must never quietly delete records that something else depends on.
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import func, select

from app.db import models as m  # noqa: F401  (registers every mapper)
from app.db.models import Employee
from app.db.session import SessionLocal

_COLUMNS = (
    "id",
    "name_en",
    "name_ar",
    "department",
    "duty_unit",
    "duty_post",
    "status",
    "nationality",
)

#: Tables that make an employee row load-bearing. Refusing to clear a directory
#: while these exist keeps `--replace` a directory operation, never a data loss.
_GUARD_TABLES = ("leaves", "violations", "books", "documents", "vault_files")


def _export(args: argparse.Namespace) -> int:
    db = SessionLocal()
    try:
        rows = db.scalars(select(Employee).order_by(Employee.id)).all()
        destination = Path(args.out)
        destination.parent.mkdir(parents=True, exist_ok=True)
        with destination.open("w", encoding="utf-8-sig", newline="") as handle:
            writer = csv.writer(handle)
            writer.writerow(_COLUMNS)
            for row in rows:
                writer.writerow(
                    [
                        row.id,
                        "" if args.no_names else (row.name_en or ""),
                        "" if args.no_names else (row.name_ar or ""),
                        "" if args.no_duty else (row.department or ""),
                        "" if args.no_duty else (row.duty_unit or ""),
                        "" if args.no_duty else (row.duty_post or ""),
                        row.status or "",
                        "" if args.no_nationality else (row.nationality or ""),
                    ]
                )
        print(f"exported {len(rows)} employees to {destination}")
        print(f"columns: {', '.join(_COLUMNS)}")
        print("no passport, Emirates ID, IBAN, phone, address, birth date, or leave data included")
        return 0
    finally:
        db.close()


def _employee_is_referenced(db) -> bool:
    from sqlalchemy import text

    for table in _GUARD_TABLES:
        exists = db.scalar(
            text(f"SELECT 1 FROM sqlite_master WHERE type='table' AND name='{table}'")
        )
        if not exists:
            continue
        used = db.scalar(text(f"SELECT COUNT(*) FROM {table}"))
        if used:
            print(f"refusing --replace: {used} row(s) in {table} reference employees")
            return True
    return False


def _import(args: argparse.Namespace) -> int:
    source = Path(args.inp)
    if not source.is_file():
        print(f"no such file: {source}", file=sys.stderr)
        return 2

    db = SessionLocal()
    try:
        if args.replace:
            if _employee_is_referenced(db):
                return 1
            removed = db.query(Employee).delete()
            db.flush()
            print(f"cleared {removed} existing employee row(s)")

        created = updated = 0
        with source.open("r", encoding="utf-8-sig", newline="") as handle:
            for record in csv.DictReader(handle):
                employee_id = (record.get("id") or "").strip()
                if not employee_id:
                    continue
                row = db.get(Employee, employee_id)
                name = (record.get("name_en") or "").strip() or employee_id
                if row is None:
                    db.add(
                        Employee(
                            id=employee_id,
                            name_en=name,
                            name_ar=(record.get("name_ar") or "").strip() or None,
                            department=(record.get("department") or "").strip() or None,
                            duty_unit=(record.get("duty_unit") or "").strip() or None,
                            duty_post=(record.get("duty_post") or "").strip() or None,
                            status=(record.get("status") or "").strip() or "Active",
                            nationality=(record.get("nationality") or "").strip() or None,
                        )
                    )
                    created += 1
                else:
                    row.name_en = name
                    row.name_ar = (record.get("name_ar") or "").strip() or None
                    row.department = (record.get("department") or "").strip() or None
                    row.duty_unit = (record.get("duty_unit") or "").strip() or None
                    row.duty_post = (record.get("duty_post") or "").strip() or None
                    row.status = (record.get("status") or "").strip() or "Active"
                    row.nationality = (record.get("nationality") or "").strip() or None
                    updated += 1
        db.commit()

        total = db.scalar(select(func.count()).select_from(Employee))
        with_unit = db.scalar(
            select(func.count()).select_from(Employee).where(Employee.duty_unit.isnot(None))
        )
        print(f"imported: created={created} updated={updated} total={total}")
        with_nationality = db.scalar(
            select(func.count()).select_from(Employee).where(Employee.nationality.isnot(None))
        )
        with_post = db.scalar(
            select(func.count()).select_from(Employee).where(Employee.duty_post.isnot(None))
        )
        print(f"employees carrying a duty_unit: {with_unit}/{total}")
        print(f"employees carrying a duty_post: {with_post}/{total}")
        print(f"employees carrying a nationality: {with_nationality}/{total}")
        return 0
    finally:
        db.close()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    sub = parser.add_subparsers(dest="command", required=True)

    export = sub.add_parser("export", help="write the directory CSV")
    export.add_argument("--out", required=True)
    export.add_argument("--no-names", action="store_true", help="G numbers only")
    export.add_argument(
        "--no-duty",
        action="store_true",
        help="omit department, duty_unit and duty_post",
    )
    export.add_argument(
        "--no-nationality", action="store_true", help="omit the nationality-mix column"
    )
    export.set_defaults(func=_export)

    load = sub.add_parser("import", help="load a directory CSV")
    load.add_argument("--in", dest="inp", required=True)
    load.add_argument(
        "--replace", action="store_true", help="clear existing employees first"
    )
    load.set_defaults(func=_import)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    raise SystemExit(main())
