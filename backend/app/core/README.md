# `app.core` — Public Contract

Pure-Python business logic ported from `gssg_manager.pyw` v3.5.4. Higher
layers (`app.services`, `app.api`) wire these modules into the HTTP
surface; nothing in `core/` imports FastAPI, SQLAlchemy, Tkinter, or
PySide6.

This document is the canonical reference for callers — if a signature
changes here, downstream phases break, so think before you edit.

---

## Modules

### `constants`

Cross-cutting strings ported from v3.5.4 lines 196-409. Wire values are
preserved byte-identical so the Phase 09 v3→v4 data migration is a no-op.

Notable exports:

| Name | Type | Notes |
|---|---|---|
| `TEMPLATE_FILES` | `Mapping[str, str]` | 16 form short-names → DOCX filenames. |
| `STAMP_STYLES` | `tuple[str, ...]` | Three reference-stamp styles. |
| `DEFAULT_CATEGORIES` | `Mapping[str, str]` | Books DB category IDs → bilingual labels. |
| `PROJECT_LOCATION` | `str` | `"0331"` — default site code. |
| `DEFAULT_MANAGER_NAME` / `DEFAULT_MANAGER_TITLE` | `str` | General Book signature defaults. |
| `ARABIC_WEEKDAYS` | `tuple[str, ...]` | Monday-first to match `datetime.weekday()`. |
| `ALLOWED_DOC_EXTS` | `frozenset[str]` | `{.pdf, .png, .jpg, .jpeg}`. |
| `FORM_TYPE_SUBFOLDER` | `Mapping[str, str]` | Personnel forms → per-employee subfolder. |
| `VIOLATION_NAMES` | `Mapping[int, str]` | Row index → English violation name. |

All mappings are `MappingProxyType` (immutable). Don't mutate at runtime.

---

### `dateutils`

```python
excel_date_to_datetime(value) -> datetime | None
```

Coerces v3's loose date inputs (str, int, float, datetime, None) into a
`datetime`. **Quirk preserved verbatim:** serials > 59 are decremented by
1 *and* the base is `1899-12-30`, which produces dates one day earlier
than Microsoft Excel's stored convention. We keep this for migration
parity — every v3 importer was tuned against it.

---

### `refs`

```python
RefAllocator(start: int = 1)
    .peek(category: str) -> str      # "{cat}-{n:04d}", no advance
    .next(category: str) -> str      # allocate + advance
    .reserve(category: str) -> str   # alias of next (v3 name)
    .counter -> int                  # current counter value
    .set_counter(n: int) -> None     # restore from persistence
```

Single global monotonic counter shared across all categories — matches v3
`BooksDatabase.next_ref_number`. Phase 02 wires persistence through
SQLAlchemy; Phase 01 keeps it in-memory.

---

### `vault_manager`

```python
Vault(root_dir: Path | str)
    .normalize_g_number(g: str) -> str        # uppercase, strip, ensure 'G' prefix
    .emp_root(g: str) -> Path
    .ensure_folder(g: str) -> Path             # creates full subfolder skeleton
    .path(g: str, kind: str) -> Path           # uae_id|passport|other|leaves|violations
    .form_output_dir(g, form_type) -> Path | None
    .add_file(g, kind, src) -> Path            # collision-safe copy into vault
    .list_files(g, kind) -> list[Path]
    .collision_safe_name(target_dir, filename) -> Path  # @staticmethod
    .delete_file(path) -> bool                 # @staticmethod, lenient
```

Per-employee folder tree under `<root>/<G>/`. Layout matches v3 verbatim
so Phase 09 migration is move-only:

```
<root>/<G>/
  documents/uae_id/
  documents/passport/
  documents/other/
  leaves/
  violations/
  <form-subfolder>/   (acknowledgment, leaves, salary_transfer, …)
```

---

### `docx_engine` + `docx_render`  ⭐ **rewritten**

The original X-mark / cell-coordinate approach (~900 lines of 16 hand-
coded `fill_*` methods) was replaced by a **docxtpl Jinja-token
renderer** plus a thin dispatcher. Adding a new form is now a template
edit — no code change required for most forms.

**Public contract:**

```python
DocxEngine(templates_dir: Path | str)
    .fill(form_type, data, output_path) -> Path
    .stamp_ref_number(docx_path, ref_number, style) -> bool  # @staticmethod

# Lower-level generic renderer:
docx_render.render(
    template_path, data, output_path,
    *, post_process=None, strict=False,
) -> Path
```

**Token convention** (per template DOCX):

* Tokens match data-dict keys exactly: `{{ employee_id }}` ↔
  `data["employee_id"]`.
* Missing keys render as empty string (lenient mode). Pass `strict=True`
  to raise on missing tokens — useful in tests.
* `data["today"]` defaults to today's date in `dd/mm/yyyy`.
* Signature paths pass through `data["<name>_sig_path"]`; the renderer
  converts present-and-existing paths to `InlineImage`, missing/blank
  paths to `""`. Use token `{{ employee_sig }}` for data key
  `employee_sig_path`.

**Jinja globals registered for templates:**

| Helper | Returns |
|---|---|
| `tick(label)` | `☑` if `data["leave_type"]` matches, else `□` |
| `check(key)` | `✓` if `data["doc_selections"][key]` is truthy, else `□` |
| `item(i, field, default="")` | Safe index into `data["items"]` — empty rows stay blank |
| `vio(row, field, default="")` | Looks up violation with `v["row"]==row` |
| `clearance(table_idx, row)` | Formatted "Y - remark" / "N" from `data["clearance_marks"]` |
| `weekday_ar` (variable) | Arabic weekday name for `data["today"]` |

**v3 → v4 data convention compatibility:** Callers pass v3-shaped dicts
(`sig1_path` for manager, `sig2_path` for employee). The dispatcher
renames these internally to v4 token names (`manager_sig_path` /
`employee_sig_path`). Existing service-layer code keeps working.

**`post_process` hook:** optional `(doc, context) -> None` callable run
after Jinja rendering. Used for the 3 forms that need OOXML manipulation
beyond Jinja's reach:

* **Leave Permit** + **Admin Leave** — behind-text floating signature
  anchoring so the image doesn't grow row heights and bump the date
  label below it.
* **Resignation Letter** — dotted-line paragraph replacement for long
  reasons (`...................` paragraphs → reason text).
* **General Book** — append signature images after the manager-title
  paragraph (paragraph-based template, no anchor cell).

**Adding a new form:**

1. Drop the tokenized DOCX into `backend/templates/` (use
   `scripts/tokenize_all_templates.py` as the canonical authoring
   approach — open in Word to verify).
2. Register `(form_type, template_filename)` in
   `core.constants.TEMPLATE_FILES`.
3. Add an entry to `_FORM_REGISTRY` in `docx_engine.py` with the
   appropriate adapter (defaults to `_adapt_common`) and optional
   `post_process`.
4. Add a fixture-data entry under `tests/fixtures/fixture_data.py` if
   you want content-parity coverage.

No new fill_* method, no cell-coordinate map, no per-form code (unless
the form needs a post-process hook).

---

### `leave_calc`

```python
class LeaveHistory(Protocol):
    def get_employee_leaves_in_year(g, year, leave_type) -> float: ...
    def get_employee_leaves_in_period(g, start, end, leave_type) -> float: ...

LeaveBalance(history: LeaveHistory)
    .compute(employee_id, join_date, *, as_of=None) -> BalanceResult

@dataclass(frozen=True)
class BalanceResult:
    annual: float
    annual_taken: float
    sick_remaining: float
    sick_taken: float
    eligible: bool
    message: str
```

Hardcoded HR rules from v3 (no config file):

| Constant | Value | Meaning |
|---|---|---|
| `PROBATION_MONTHS` | 6 | Ineligible until probation ends. |
| `ANNUAL_ACCRUAL_PER_MONTH` | 2.5 | Days accrued per completed month. |
| `ANNUAL_CAP_PER_YEAR` | 30 | Max accrual per calendar year. |
| `CARRY_OVER_CAP` | 15 | Max days rolled into the new year. |
| `TOTAL_AVAILABLE_CAP` | 45 | Cap on carry-over + current-year accrual. |
| `SICK_DAYS_PER_YEAR` | 90 | Sick allowance per *anniversary* year. |

`history` is a Protocol — pass any object that satisfies the shape.
Phase 02 wires the SQLAlchemy implementation; tests use an in-memory
fake.

---

### `signature`

```python
signature.validate(png_bytes: bytes) -> SignatureMeta
signature.vault_path(vault: Vault, g_number: str) -> Path
signature.save(png_bytes: bytes, g_number: str, vault: Vault) -> Path
```

Validates incoming PNG bytes (magic header, dimensions in
`[60×30, 4096×4096]`, ≤5 MiB) and writes to
`<vault>/<G>/documents/signature.png`. Drawing has moved to the React
client; this server-side module only validates and stores.

Raises `SignatureError` on any validation failure. Transparency is
reported via `SignatureMeta.has_alpha` but not required.

---

### `manager_override`

```python
manager_override.apply(
    base_data: dict,
    manager_record: Mapping | None = None,
    *, hand_sign: bool = False,
) -> dict   # mutates and returns
```

Picker-driven manager assignment. **Critical:** when no manager is
picked, `manager_name` / `sig1_path` are left untouched — Arabic-letter
forms carry a user-typed manager name in the same key and blanking it
would silently clobber the typed entry. `hand_sign=True` strips
`sig1_path` regardless, leaving the name in place so there's room for an
ink signature on print.

---

### `submitter`

```python
submitter.normalize_g(g_number: str) -> str
submitter.label(record) -> str                # "Name (G1234)"
submitter.resolve(text, records) -> record | None
submitter.combo_values(records) -> list[str]
submitter.add(records, g, name) -> list[SubmitterRecord]
submitter.remove(records, g) -> list[SubmitterRecord]
NONE_SENTINEL: str
```

Helpers for the Leave Application submitter picker. The submitter
(HR/admin staff who hands the form to the manager) is not the leave
applicant — the distinction matters for the undertaking sheet's bottom
signature block.

---

### `pdf_chain`

```python
PdfChain()
    .convert(docx_path, pdf_path=None) -> Path           # raises PdfConversionError
    .convert_or_none(docx_path, pdf_path=None) -> ConversionResult

# Module-level convenience:
pdf_chain.convert(docx_path, pdf_path=None) -> Path
pdf_chain.convert_or_none(docx_path, pdf_path=None) -> ConversionResult
```

Three-method fallback in fixed order:

1. **docx2pdf** — patched with `_NullStream` for `.pyw` (legacy) and
   server contexts where stdout/stderr may be `None`.
2. **win32com `DispatchEx`** — fresh isolated Word; `Dispatch` would
   attach to a zombie left by a prior failure.
3. **PowerShell COM** — last-ditch shell-out, 30s timeout,
   `CREATE_NO_WINDOW`.

`PdfConversionError.errors` carries the per-method error trail when
every method fails.

---

### `arabic_rtl`

```python
arabic_rtl.stamp_run(run, family: str) -> None
arabic_rtl.stamp_paragraph(paragraph) -> None
arabic_rtl.set_run_shading(run, rgb: tuple[int, int, int]) -> None
arabic_rtl.stamp_arabic_runs(paragraph, family="Arial") -> int
arabic_rtl.html_to_docx(html, paragraph, **kwargs) -> None  # RAISES NotImplementedError
```

OOXML run-level helpers for Arabic/RTL text. Word renders runs that
carry both `<w:rtl/>` and `<w:cs/>` using their complex-script properties
— and silently ignores the Latin font properties python-docx writes by
default. `stamp_run` mirrors `<w:sz>` → `<w:szCs>`, `<w:b>` → `<w:bCs>`,
`<w:i>` → `<w:iCs>` so the rendered output matches what the editor
showed.

`html_to_docx` is **deferred to Phase 04** (TinyMCE → DOCX pipeline).

---

## Templates

Tokenized templates live in `backend/templates/`. Pristine v3 originals
are snapshotted to `backend/templates/_originals/` on first run of
`scripts/tokenize_all_templates.py`.

When templates need changes:

* **For form-layout edits** — open the template in Word, edit, save
  back into `backend/templates/`. Don't re-run the tokenizer; you'll
  blow away your edits.
* **For wholesale re-tokenization** — delete the relevant template from
  `backend/templates/`, re-run `scripts/tokenize_all_templates.py`. It
  re-derives the tokenized file from `_originals/`.

If HR edits the v3 templates in the field (in their own working copy of
v3.5.4), those edits don't automatically flow into v4. Re-snapshot by
copying the new v3 files into `_originals/` and re-running the tokenizer.

---

## Test layout

- `backend/tests/unit/` — per-module behaviour tests (no I/O beyond
  `tmp_path`). 173 tests.
- `backend/tests/integration/` — cross-module + parity:
  - `test_content_parity.py` — 16 forms × 2 checks (smoke + cell-text
    diff against v3 golden DOCXs captured by
    `scripts/capture_v3_outputs.py`). Acceptable divergences (stray
    v3 `X` markers in unfilled cells, Wingdings `` vs `□`) are
    handled by `_is_acceptable_divergence`.
- `backend/tests/fixtures/v3_outputs/` — committed golden DOCX files.
  Regenerate when fixture data or v3 source changes.

Coverage at end of Phase 01: **76%** on `app/core/` (plan target 70%).
