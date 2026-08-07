"""OPERATOR: bulk-file passport and national-ID scans into the employee vault.

Handover data usually arrives as two flat folders — one of passport scans, one
of Emirates-ID scans — with the person's number somewhere in the file name.
This script matches each file to an ``Employee`` row and copies it into that
person's vault (``documents/passport/`` or ``documents/uae_id/``), using the
same :class:`~app.core.vault_manager.Vault` the app itself writes through, so
the files land exactly where the Records tab looks for them.

Matching rules, tried in order; the first rule that resolves to *exactly one*
employee wins. A file that matches nothing — or more than one person — is left
untouched and listed in the report. Filing an identity document under the wrong
person is worse than not filing it, so the script never guesses.

  1. ``id``   — personnel ID in the file name          (``G3082_passport.pdf``)
  2. ``doc``  — document number in the file name; passport number for the
                passport folder, national-ID number for the ID folder.
                Separators are ignored, so ``784-1990-1234567-1`` and
                ``784199012345671`` both match.
  3. ``dir``  — a parent folder named after the personnel ID
                (``Passports/G3082/scan01.pdf``)

Dry-run by default: nothing is copied until ``--apply`` is passed.

Usage:
  venv/Scripts/python.exe -X utf8 scripts/bulk_import_ids.py \
      --passports "D:/Handover/Passports" --uae-ids "D:/Handover/EmiratesID"
  venv/Scripts/python.exe -X utf8 scripts/bulk_import_ids.py \
      --passports "D:/Handover/Passports" --apply --report out.csv
"""

from __future__ import annotations

import argparse
import csv
import re
import sys
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from sqlalchemy import select  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.core.constants import (  # noqa: E402
    ALLOWED_DOC_EXTS,
    DOC_CATEGORY_PASSPORT,
    DOC_CATEGORY_UAE_ID,
)
from app.core.vault_manager import Vault  # noqa: E402
from app.db import SessionLocal  # noqa: E402
from app.db.models import Employee  # noqa: E402

# Personnel IDs look like G3082 — a letter prefix plus digits. Bounded by
# non-alphanumerics so "IMG3082.jpg" does not read as employee G3082.
_ID_RE = re.compile(r"(?<![A-Za-z0-9])([A-Za-z]{1,4}\d{3,8})(?![A-Za-z0-9])")

# Runs of digits long enough to be a document number. Emirates IDs are 15
# digits; passport numbers are 6-9 alphanumerics, handled separately.
_DIGITS_RE = re.compile(r"\d{6,}")


def _squash(value: str | None) -> str:
    """Uppercase and strip every non-alphanumeric — ``784-1990-…`` → ``7841990…``."""
    return re.sub(r"[^A-Za-z0-9]", "", (value or "")).upper()


@dataclass(frozen=True)
class Person:
    """The three keys a file name can be matched against."""

    employee_id: str
    name_en: str
    passport_no: str
    uae_id_no: str


@dataclass
class Match:
    src: Path
    kind: str
    rule: str
    employee_id: str | None
    employee_name: str
    outcome: str
    dest: str = ""


class Index:
    """Lookup tables built once from the roster.

    Any key that maps to more than one employee is dropped rather than kept —
    an ambiguous key must fail the match, not silently pick the first row.
    """

    def __init__(self, people: list[Person]) -> None:
        self.by_id: dict[str, Person] = {}
        self._build(self.by_id, ((_squash(p.employee_id), p) for p in people))

        self.by_passport: dict[str, Person] = {}
        self._build(
            self.by_passport,
            ((_squash(p.passport_no), p) for p in people if p.passport_no),
        )

        self.by_uae_id: dict[str, Person] = {}
        self._build(
            self.by_uae_id,
            ((_squash(p.uae_id_no), p) for p in people if p.uae_id_no),
        )

    @staticmethod
    def _build(target: dict[str, Person], pairs: Iterator[tuple[str, Person]]) -> None:
        ambiguous: set[str] = set()
        for key, person in pairs:
            if not key:
                continue
            if key in target and target[key].employee_id != person.employee_id:
                ambiguous.add(key)
            target[key] = person
        for key in ambiguous:
            target.pop(key, None)

    def by_doc_number(self, kind: str) -> dict[str, Person]:
        return self.by_passport if kind == DOC_CATEGORY_PASSPORT else self.by_uae_id


def load_people(db) -> list[Person]:
    rows = db.execute(select(Employee)).scalars().all()
    return [
        Person(
            employee_id=r.id,
            name_en=r.name_en or "",
            passport_no=r.passport_no or "",
            uae_id_no=r.uae_id_no or "",
        )
        for r in rows
    ]


def resolve(path: Path, kind: str, index: Index) -> tuple[Person | None, str]:
    """Return ``(person, rule)`` for a scan file, or ``(None, reason)``."""
    stem = path.stem

    # Rule 1 — personnel ID anywhere in the file name.
    hits = {
        index.by_id[_squash(token)]
        for token in _ID_RE.findall(stem)
        if _squash(token) in index.by_id
    }
    if len(hits) == 1:
        return next(iter(hits)), "id"
    if len(hits) > 1:
        return None, "ambiguous-id"

    # Rule 2 — document number for this folder's kind.
    table = index.by_doc_number(kind)
    squashed = _squash(stem)
    hits = {p for key, p in table.items() if key and key in squashed}
    if len(hits) == 1:
        return next(iter(hits)), "doc"
    if len(hits) > 1:
        return None, "ambiguous-doc"

    # Rule 3 — a parent folder named after the personnel ID.
    for parent in path.parents:
        person = index.by_id.get(_squash(parent.name))
        if person is not None:
            return person, "dir"

    return None, "no-match"


def scan_folder(folder: Path) -> list[Path]:
    if not folder.is_dir():
        raise SystemExit(f"Not a folder: {folder}")
    return sorted(p for p in folder.rglob("*") if p.is_file())


def process(
    folder: Path,
    kind: str,
    index: Index,
    vault: Vault,
    *,
    apply: bool,
    move: bool,
) -> list[Match]:
    results: list[Match] = []
    for src in scan_folder(folder):
        if src.suffix.lower() not in ALLOWED_DOC_EXTS:
            results.append(Match(src, kind, "-", None, "", "skipped-file-type"))
            continue

        person, rule = resolve(src, kind, index)
        if person is None:
            results.append(Match(src, kind, "-", None, "", rule))
            continue

        if not apply:
            results.append(
                Match(src, kind, rule, person.employee_id, person.name_en, "would-file")
            )
            continue

        try:
            dest = vault.add_file(person.employee_id, kind, src)
        except (OSError, ValueError) as exc:
            results.append(
                Match(src, kind, rule, person.employee_id, person.name_en, f"error: {exc}")
            )
            continue

        if move:
            try:
                src.unlink()
            except OSError:
                pass
        results.append(
            Match(src, kind, rule, person.employee_id, person.name_en, "filed", str(dest))
        )
    return results


def write_report(results: list[Match], path: Path) -> None:
    with path.open("w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh)
        writer.writerow(
            ["file", "kind", "matched_by", "employee_id", "employee_name", "outcome", "destination"]
        )
        for m in results:
            writer.writerow(
                [str(m.src), m.kind, m.rule, m.employee_id or "", m.employee_name, m.outcome, m.dest]
            )


def summarise(results: list[Match], *, apply: bool) -> None:
    ok = [m for m in results if m.outcome in ("filed", "would-file")]
    people = {m.employee_id for m in ok}
    print(f"\n{'Filed' if apply else 'Would file'}: {len(ok)} of {len(results)} files "
          f"across {len(people)} employees")

    problems: dict[str, int] = {}
    for m in results:
        if m.outcome not in ("filed", "would-file"):
            problems[m.outcome] = problems.get(m.outcome, 0) + 1
    for reason, count in sorted(problems.items(), key=lambda kv: -kv[1]):
        print(f"  {reason:<24} {count}")

    unmatched = [m for m in results if m.outcome in ("no-match", "ambiguous-id", "ambiguous-doc")]
    if unmatched:
        print("\nFirst unmatched files:")
        for m in unmatched[:10]:
            print(f"  {m.outcome:<14} {m.src.name}")
        if len(unmatched) > 10:
            print(f"  … and {len(unmatched) - 10} more (see the CSV report)")

    if not apply:
        print("\nDry run — nothing was copied. Re-run with --apply to file these.")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--passports", type=Path, help="Folder of passport scans")
    ap.add_argument("--uae-ids", type=Path, help="Folder of national-ID scans")
    ap.add_argument("--apply", action="store_true", help="Actually copy the files")
    ap.add_argument("--move", action="store_true", help="Delete the source after a successful copy")
    ap.add_argument("--report", type=Path, help="Write a CSV report of every file")
    args = ap.parse_args()

    if not args.passports and not args.uae_ids:
        ap.error("give at least one of --passports / --uae-ids")

    vault = Vault(get_settings().vault_dir)
    with SessionLocal() as db:
        people = load_people(db)
    if not people:
        print("No employees in the database — import the roster first.")
        return 1
    print(f"Roster: {len(people)} employees")
    index = Index(people)

    results: list[Match] = []
    for folder, kind in ((args.passports, DOC_CATEGORY_PASSPORT), (args.uae_ids, DOC_CATEGORY_UAE_ID)):
        if folder is None:
            continue
        print(f"Scanning {folder} as {kind}…")
        results += process(folder, kind, index, vault, apply=args.apply, move=args.move)

    summarise(results, apply=args.apply)
    if args.report:
        write_report(results, args.report)
        print(f"Report written to {args.report}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
