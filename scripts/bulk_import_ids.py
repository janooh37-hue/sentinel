"""OPERATOR: bulk-file passport and national-ID scans into the employee vault.

Handover data usually arrives as two flat folders — one of passport scans, one
of national-ID scans — with the person's number somewhere in the file name.
This script matches each file to an ``Employee`` row and copies it into that
person's vault (``documents/passport/`` or ``documents/uae_id/``), using the
same :class:`~app.core.vault_manager.Vault` the app itself writes through, so
the files land exactly where the Records tab looks for them.

Matching rules, tried in order; the first rule that resolves to *exactly one*
employee wins. A file that matches nothing — or more than one person — is left
untouched and listed in the report. Filing an identity document under the wrong
person is worse than not filing it, so the script never guesses.

  1. ``id``   — personnel ID as a whole token in the file name
                (``G3082_passport.pdf``). Works with any ID scheme, because the
                keys come from the roster rather than from a fixed pattern.
  2. ``doc``  — document number as a whole token; passport number for the
                passport folder, national-ID number for the ID folder.
                Separators are ignored, so ``784-1990-1234567-1`` and
                ``784199012345671`` both match.
  3. ``dir``  — a folder at or below the scanned root named after the personnel
                ID (``Passports/G3082/scan01.pdf``)

Matching is on **whole tokens**, never substrings. A passport number of
``123456`` must never claim a scan of passport ``1234567``, and a roster whose
passport column holds ``N/A`` must not turn that employee into a sink that
swallows every file with "na" in its name. Unusable keys — too short, all
letters, all zeros, or a known placeholder — are dropped from the index rather
than matched loosely.

Rule 2 is inherently weaker than rules 1 and 3: a six-digit passport number can
coincide with an unrelated six-digit run in a file name. It is listed
separately in the summary so a human can scan it before trusting it.

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
import hashlib
import os
import re
import sys
from collections.abc import Iterator
from dataclasses import dataclass, field
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

# A key shorter than this cannot be matched safely — a 4-character document
# number appears by chance in a large fraction of any handover folder.
_MIN_DOC_KEY = 6
_MIN_ID_KEY = 3

# What operators type when the number is unknown. Indexed as-is, each of these
# becomes a wildcard that claims unrelated scans.
_PLACEHOLDER_KEYS = frozenset(
    {"NA", "NIL", "NONE", "TBD", "UNKNOWN", "XXX", "PENDING", "SAME", "N", "-"}
)

# Cells Excel would evaluate as a formula when the report is opened.
_CSV_INJECTION_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _squash(value: str | None) -> str:
    """Uppercase and strip every non-alphanumeric — ``784-1990-…`` → ``7841990…``."""
    return re.sub(r"[^A-Za-z0-9]", "", (value or "")).upper()


def _index_key(value: str | None, *, minimum: int) -> str:
    """Squash a value into an index key, or ``""`` if it is not safe to match on."""
    key = _squash(value)
    if (
        len(key) < minimum
        or key in _PLACEHOLDER_KEYS
        or key.isalpha()  # "PASSPORT", "SAMEASABOVE"
        or set(key) <= {"0"}  # "0", "000000"
    ):
        return ""
    return key


def _candidate_keys(stem: str) -> set[str]:
    """Every whole-token reading of a file name that a key could match.

    Each maximal alphanumeric run, plus every join of *consecutive* runs — so
    ``784-1990-1234567-1`` still yields ``784199012345671`` (separators
    ignored, as documented) but a key is never matched against a fragment of a
    longer number.
    """
    runs = [r.upper() for r in re.findall(r"[A-Za-z0-9]+", stem)]
    out: set[str] = set()
    for i in range(len(runs)):
        joined = ""
        for j in range(i, len(runs)):
            joined += runs[j]
            out.add(joined)
    return out


@dataclass(frozen=True)
class Person:
    """The three keys a file name can be matched against."""

    employee_id: str
    passport_no: str
    uae_id_no: str


@dataclass
class Match:
    src: Path
    kind: str
    rule: str
    employee_id: str | None
    outcome: str
    dest: str = ""


class Index:
    """Lookup tables built once from the roster.

    Any key that maps to more than one employee is dropped rather than kept —
    an ambiguous key must fail the match, not silently pick the first row.
    """

    def __init__(self, people: list[Person]) -> None:
        self.by_id: dict[str, Person] = {}
        self._build(
            self.by_id,
            ((_index_key(p.employee_id, minimum=_MIN_ID_KEY), p) for p in people),
        )
        self.by_passport: dict[str, Person] = {}
        self._build(
            self.by_passport,
            ((_index_key(p.passport_no, minimum=_MIN_DOC_KEY), p) for p in people),
        )
        self.by_uae_id: dict[str, Person] = {}
        self._build(
            self.by_uae_id,
            ((_index_key(p.uae_id_no, minimum=_MIN_DOC_KEY), p) for p in people),
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
            passport_no=r.passport_no or "",
            uae_id_no=r.uae_id_no or "",
        )
        for r in rows
    ]


def resolve(
    path: Path, root: Path, kind: str, index: Index
) -> tuple[Person | None, str]:
    """Return ``(person, rule)`` for a scan file, or ``(None, reason)``."""
    candidates = _candidate_keys(path.stem)

    # Rule 1 — personnel ID as a whole token in the file name.
    hits = {p for key, p in index.by_id.items() if key in candidates}
    if len(hits) == 1:
        return next(iter(hits)), "id"
    if len(hits) > 1:
        return None, "ambiguous-id"

    # Rule 2 — document number for this folder's kind, whole token only.
    hits = {p for key, p in index.by_doc_number(kind).items() if key in candidates}
    if len(hits) == 1:
        return next(iter(hits)), "doc"
    if len(hits) > 1:
        return None, "ambiguous-doc"

    # Rule 3 — a folder named after the personnel ID. Only folders at or below
    # the scanned root count: an ancestor of the root is not a claim about any
    # individual file inside it.
    for parent in path.parents:
        if root != parent and root not in parent.parents:
            break
        person = index.by_id.get(_index_key(parent.name, minimum=_MIN_ID_KEY))
        if person is not None:
            return person, "dir"

    return None, "no-match"


def scan_folder(folder: Path) -> tuple[list[Path], list[str]]:
    """Return ``(files, errors)``. Unreadable directories become errors, not silence."""
    errors: list[str] = []
    files: list[Path] = []

    def on_error(exc: OSError) -> None:
        errors.append(f"unreadable: {exc.filename}")

    for dirpath, dirnames, filenames in os.walk(folder, onerror=on_error):
        here = Path(dirpath)
        # Never descend a symlinked directory: it can point anywhere.
        dirnames[:] = [d for d in dirnames if not (here / d).is_symlink()]
        files.extend(here / name for name in filenames)
    return sorted(files), errors


@dataclass
class Digests:
    """Content hashes of what is already filed, so a re-run does not duplicate."""

    seen: dict[tuple[str, str], set[str]] = field(default_factory=dict)

    @staticmethod
    def of(path: Path) -> str:
        h = hashlib.sha256()
        with path.open("rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()

    def filed_already(self, vault: Vault, employee_id: str, kind: str, src: Path) -> bool:
        key = (employee_id, kind)
        if key not in self.seen:
            self.seen[key] = {
                self.of(p) for p in vault.list_files(employee_id, kind) if p.is_file()
            }
        digest = self.of(src)
        if digest in self.seen[key]:
            return True
        self.seen[key].add(digest)
        return False


def process(
    folder: Path,
    kind: str,
    index: Index,
    vault: Vault | None,
    digests: Digests,
    *,
    apply: bool,
    move: bool,
) -> list[Match]:
    results: list[Match] = []
    files, errors = scan_folder(folder)
    for message in errors:
        results.append(Match(folder, kind, "-", None, message))

    for src in files:
        # A symlink's suffix says nothing about its target, and copy2 would
        # dereference it — a link named *.pdf can point at the database.
        if src.is_symlink():
            results.append(Match(src, kind, "-", None, "skipped-symlink"))
            continue
        if src.suffix.lower() not in ALLOWED_DOC_EXTS:
            results.append(Match(src, kind, "-", None, "skipped-file-type"))
            continue

        person, rule = resolve(src, folder, kind, index)
        if person is None:
            results.append(Match(src, kind, "-", None, rule))
            continue

        if not apply or vault is None:
            results.append(Match(src, kind, rule, person.employee_id, "would-file"))
            continue

        try:
            if digests.filed_already(vault, person.employee_id, kind, src):
                results.append(
                    Match(src, kind, rule, person.employee_id, "already-filed")
                )
                continue
            dest = vault.add_file(person.employee_id, kind, src)
        except (OSError, ValueError) as exc:
            results.append(Match(src, kind, rule, person.employee_id, f"error: {exc}"))
            continue

        outcome = "filed"
        if move:
            try:
                src.unlink()
            except OSError:
                # The copy succeeded, so this is not a failure — but the operator
                # must know the source folder is not clean.
                outcome = "filed-copy-only"
        results.append(Match(src, kind, rule, person.employee_id, outcome, str(dest)))
    return results


def _csv_safe(value: str) -> str:
    """Neutralise a cell Excel would evaluate as a formula."""
    return "'" + value if value.startswith(_CSV_INJECTION_PREFIXES) else value


def write_report(results: list[Match], path: Path, *, redact: bool) -> None:
    """Write the per-file report.

    File names in a handover folder *are* passport and national-ID numbers, so
    this report is itself personal data. It is written owner-only, carries no
    employee names, and ``--redact`` replaces the file name with a hash.
    """
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", newline="", encoding="utf-8-sig") as fh:
        writer = csv.writer(fh)
        writer.writerow(["file", "kind", "matched_by", "employee_id", "outcome", "destination"])
        for m in results:
            name = (
                hashlib.sha256(str(m.src).encode()).hexdigest()[:16]
                if redact
                else str(m.src)
            )
            writer.writerow(
                [
                    _csv_safe(name),
                    m.kind,
                    m.rule,
                    m.employee_id or "",
                    _csv_safe(m.outcome),
                    _csv_safe(m.dest) if not redact else "",
                ]
            )


def summarise(results: list[Match], *, apply: bool, redact: bool) -> None:
    ok = [m for m in results if m.outcome in ("filed", "filed-copy-only", "would-file")]
    people = {m.employee_id for m in ok}
    print(
        f"\n{'Filed' if apply else 'Would file'}: {len(ok)} of {len(results)} files "
        f"across {len(people)} employees"
    )

    problems: dict[str, int] = {}
    for m in results:
        if m.outcome not in ("filed", "filed-copy-only", "would-file"):
            problems[m.outcome.split(":")[0]] = problems.get(m.outcome.split(":")[0], 0) + 1
    for reason, count in sorted(problems.items(), key=lambda kv: -kv[1]):
        print(f"  {reason:<24} {count}")

    # Rule 2 is the weakest rule: a short document number can coincide with an
    # unrelated run of digits. Surface those matches for a human to scan.
    by_doc = [m for m in ok if m.rule == "doc"]
    if by_doc:
        print(
            f"\n{len(by_doc)} matched by document number only — check these before trusting them:"
        )
        for m in by_doc[:10]:
            label = "(redacted)" if redact else m.src.name
            print(f"  {m.employee_id:<10} {label}")
        if len(by_doc) > 10:
            print(f"  … and {len(by_doc) - 10} more (see the CSV report)")

    unmatched = [
        m for m in results if m.outcome in ("no-match", "ambiguous-id", "ambiguous-doc")
    ]
    if unmatched and not redact:
        print("\nFirst unmatched files:")
        for m in unmatched[:10]:
            print(f"  {m.outcome:<14} {m.src.name}")
        if len(unmatched) > 10:
            print(f"  … and {len(unmatched) - 10} more (see the CSV report)")

    if not apply:
        print("\nDry run — nothing was copied. Re-run with --apply to file these.")


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("--passports", type=Path, help="Folder of passport scans")
    ap.add_argument("--uae-ids", type=Path, help="Folder of national-ID scans")
    ap.add_argument("--apply", action="store_true", help="Actually copy the files")
    ap.add_argument("--move", action="store_true", help="Delete the source after a successful copy")
    ap.add_argument("--report", type=Path, help="Write a CSV report of every file")
    ap.add_argument(
        "--redact",
        action="store_true",
        help="Hash file names in the report and summary (they contain document numbers)",
    )
    args = ap.parse_args()

    folders = [
        (f.resolve(), k)
        for f, k in (
            (args.passports, DOC_CATEGORY_PASSPORT),
            (args.uae_ids, DOC_CATEGORY_UAE_ID),
        )
        if f is not None
    ]
    if not folders:
        ap.error("give at least one of --passports / --uae-ids")
    # Validate every folder before the first write, so a typo in the second
    # argument cannot abort a --move run halfway with the sources already gone.
    for folder, _ in folders:
        if not folder.is_dir():
            ap.error(f"Not a folder: {folder}")

    with SessionLocal() as db:
        people = load_people(db)
    if not people:
        print("No employees in the database — import the roster first.")
        return 1
    print(f"Roster: {len(people)} employees")
    index = Index(people)

    dropped = len(people) - len(index.by_id)
    if dropped:
        print(f"  {dropped} personnel IDs unusable as match keys (too short or ambiguous)")

    # Only touch the data directory when actually filing: constructing a Vault
    # creates the root, which a dry run has no business doing.
    vault = Vault(get_settings().vault_dir) if args.apply else None
    digests = Digests()

    results: list[Match] = []
    try:
        for folder, kind in folders:
            print(f"Scanning {folder} as {kind}…")
            results += process(
                folder, kind, index, vault, digests, apply=args.apply, move=args.move
            )
    finally:
        # An irreversible operation must never end without its audit trail.
        if args.report and results:
            write_report(results, args.report, redact=args.redact)
            print(f"Report written to {args.report}")

    summarise(results, apply=args.apply, redact=args.redact)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
