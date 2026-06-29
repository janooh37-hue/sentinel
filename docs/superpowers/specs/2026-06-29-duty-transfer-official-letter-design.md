# Duty Transfer — Official Letter & Email Formatting

**Date:** 2026-06-29
**Status:** Approved design — pending spec review
**Area:** Duty-location internal transfers (`backend/app/services/duty_service.py`, `frontend/src/pages/dutyLocations/*`, `frontend/src/lib/basketEmail.ts`)

## Problem

The "service of duty transfer" feature (`POST /api/v1/duty/transfer`) mints a
General Book transfer letter and the operator later emails it. Both outputs are
currently **plain** — they do not match the office's real correspondence
"character":

- **The book body** (`duty_service._build_body_html`) is a bare narrative `<p>`
  plus an **unstyled** `<table>` with columns `م · الرقم · الاسم · من · إلى`.
  It is missing the **job-title** column, the red header, the formal intro and
  closing, and the letter sets **no addressee, no signing manager, and no CC**.
- **The email** has no dedicated builder. A transfer book enters the email
  basket as a single generic `General Book` item, so `buildBasketBodyHtml` drops
  it into the **generic fallback** branch and emits a one-row `البيان` table —
  nothing like the real cover email.

The real outputs are documented from two authoritative samples:

1. **The letter** — `النقل 1106.pdf` (GSSG ref `1/ 12 /GSSG/ 106`, 2026/06/11).
2. **The email** — ledger entry id=5, subject `تنقلات يوم 11/06/2026`
   (`ledger_entries.notes_html`, verified read-only against `data/gssg.db`).

## Goal

Bring the duty-transfer **document** and **email** up to the same official
standard as every other form, reproducing the two samples exactly.

---

## Reference 1 — the letter (`النقل 1106.pdf`)

The General Book template already prints the letterhead (GSSG logo), the
reference number, the date, the addressee (`recipient_name`), the signature
block (`manager_id`), and the CC line (`cc`). The transfer feature must supply:

- **Subject** → `النقل`
- **Addressee** → e.g. `مدير إدارة المؤسسة العقابية والإصلاحية / الوثبة` (operator-selected)
- **Body** (intro + table + closing), and
- **Signing manager** + **CC** (operator-selected; CC prints as `نسخه/ مدراء الأفرع …`).

**Body intro (fixed):**

> يطيب لنا أن نتقدم لسيادتكم بخالص التحية و التقدير , يرجى العلم أنه ولغايات تنظيمية في العمل تم نقل المذكورين بالجدول المرفق إلى الجهات المبينة بجانب أسمائهم إعتباراً من تاريخه .

**Table** — red header (`#C00000`), RTL, five columns (visual right→left):

| الرقم الوظيفي | المسمى الوظيفي | الاسم | من | إلى |
|---|---|---|---|---|
| `employee.id` | `employee.position_ar` | `employee.name_ar` | current `duty_unit` - `duty_post` | `to_unit` - `to_post` |

- `من` is captured **before** the move is staged (current behaviour preserved).
- Unit/post join uses `الوحدة - الموقع` (hyphen separator, matching the sample),
  falling back to just the unit, then `غير محدد`.

**Body closing (fixed), two lines:**

> للتفضل بالعلم وأمركم حول تعديل الكشوفات لديكم ولإجراءاتكم لطفاً.

> هذا وتفضلوا بقبول فائق الإحترام والتقدير.

**No effective date and no reason are rendered.** The letter uses
`إعتباراً من تاريخه` verbatim.

### Table styling

The General Book body is `arabic_rich_full`, routed through
`core/arabic_rtl.html_to_docx`, which **does** honour `<th>` bold and cell
`background`/`background-color` shading (`<w:shd>`). The table is emitted as
inline-styled HTML (same approach as `basketEmail.ts`): red `<th>` background,
white bold header text, `1px solid #000` cell borders, centered cells.

---

## Reference 2 — the email (ledger id=5)

The real email is a **narrative cover email with NO inline table** — the from/to
detail lives only in the attached book PDF. It cites the generated book's ref +
date inline. Clean target HTML (Word cruft and the draft aqua highlight from the
original are **not** reproduced):

> السلام عليكم ورحمة الله وبركاته :
>
> يطيب لنا أن نتقدم إليكم بخالص التحية و التقدير , يرجى العلم أنه ولغايات تنظيمية في العمل تم نقل المذكورين بالجدول المبين مضمون الكتاب **الرقم {ref} تاريخ {date} م** إلى الجهات المبينة بجانب أسمائهم إعتباراً من تاريخه .
>
> للتفضل بالعلم ولإجراءاتكم لطفاً.
>
> هذا وتفضلوا بقبول فائق الإحترام والتقدير.

- `{ref}` = the book's `ref_number` (already on the basket item).
- `{date}` = the book's issue date (`BookRead.created_at`), formatted `DD/MM/YYYY`.
- **Subject** → `تنقلات يوم {date}`.
- The book PDF remains the attachment (existing reference/attach flow).
- The intro differs from the letter: `نتقدم إليكم` (not `لسيادتكم`), cites the
  book ref/date, and the closing omits `وأمركم حول تعديل الكشوفات لديكم`.

Email TO/CC **addresses** (correctional-institution recipients + GSSG branch
managers) are chosen at compose time via the existing address-book flow — out of
scope for this change.

---

## Design

### Backend

**`schemas/duty.py` — `DutyTransferRequest`:**
- Remove `effective_date` and `reason`.
- Add `recipient_id: int | None = None`, `manager_id: int | None = None`,
  `cc_ids: list[int] | None = None`.
- Keep `employee_ids` (1..500), `to_unit`, `to_post`.

**`services/duty_service.py`:**
- `_build_body_html`: new fixed intro, the 5-column red-header styled table
  (add `position_ar` job-title column), the two-line closing. Drop date/reason.
- `transfer(...)`: drop `effective_date`/`reason` params; accept
  `recipient_id`/`manager_id`/`cc_ids`. Subject → `النقل`. Pass
  `recipient_id`, `manager_id`, and `cc` through to
  `document_service.generate_document` alongside `subject` + `body`.
  (Verify `generate_document` accepts `cc`/`manager_id` in `fields`; it resolves
  `recipient_id`→`recipient_name` and `cc` ids→names already.)

**`api/v1/duty.py`:** update the endpoint to forward the new fields.

### Frontend

**`lib/api.ts` types:** mirror the new `DutyTransferRequest` shape.

**`pages/dutyLocations/transferRequest.ts`:** build the new body —
`{ employee_ids, to_unit, to_post, recipient_id, manager_id, cc_ids }`.
Drop `effective_date`/`reason`.

**`pages/dutyLocations/TransferDialog.tsx`:**
- Remove the effective-date and reason inputs.
- Wrap the destination form in a react-hook-form `FormProvider` so the three
  existing field components can be reused as-is:
  - `RecipientPickerField` → `recipient_id` (addressee)
  - `ManagerPickerField` → `manager_id` (signing manager)
  - `MultiRecipientPickerField` → `cc_ids` (printed CC names)
- **Defaults:** pre-select the last-used recipient / manager / CC, persisted in
  `localStorage` (empty on first use). Non-hardcoded; overridable each time.
- Keep `to_unit`/`to_post` comboboxes and the "moving" employee list.

**Email builder — `lib/basketEmail.ts` + `lib/emailBasket.ts` + `pages/books/recordsBasket.ts`:**
- `EmailBasketItem`: add `bookDate?: string` (ISO, from `BookRead.created_at`).
- `recordsBasket.deriveRecordItem`: populate `bookDate`.
- `basketEmail.buildBasketBodyHtml`: add a transfer branch keyed on
  `formKind === 'General Book' && detail === 'النقل'` → emit the narrative cover
  email above (no table), interpolating `ref` and `dmy(bookDate)`.
- `basketEmail.buildBasketSubject`: transfer → `تنقلات يوم ${dmy(bookDate)}`.

### Detection / edge cases

- A transfer book is identified by `subject === 'النقل'`. A hand-written General
  Book titled `النقل` would also match — acceptable (rare, and the output is a
  valid transfer cover email).
- Baskets are keyed per kind; all `General Book` items share one basket and the
  body builder keys off `items[0]`. Mixing a transfer book with a non-transfer
  General Book in one basket is a pre-existing limitation — not addressed here.

## Testing

- **Backend (pytest):** `_build_body_html` emits the fixed intro, all five
  columns in RTL order with `position_ar`, the red-header styling, the two-line
  closing, one `<tr>` per employee, `من` from pre-move values, and no
  date/reason. `transfer(...)` forwards `recipient_id`/`manager_id`/`cc` and sets
  subject `النقل`. `DutyTransferRequest` rejects the removed fields gracefully.
- **Frontend (vitest):** `buildTransferRequest` yields the new shape;
  `basketEmail` transfer branch produces the exact cover-email HTML + subject for
  a transfer item and still hits the generic branch for a non-transfer General
  Book; `dmy` date formatting.
- **Manual:** run a transfer, open the generated book → compare against
  `النقل 1106.pdf`; add it to the basket → compose → compare body/subject against
  ledger id=5.

## Out of scope

- Prefilling the email's TO/CC **addresses** (address-book concern).
- Reproducing the original email's Word markup or aqua draft highlight.
- The per-kind basket model limitation (mixed General Books).
