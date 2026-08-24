# General Book dynamic reference-line formatting

**Goal:** Every newly rendered General Book shows its dynamically allocated reference as `الرقم: 1/{tab}/{serial}` with the Arabic label on the right and the reference in stored order, using Calibri 16 pt italic.

**Non-goals:** Do not hardcode a serial, change counter allocation, change the database value, rename files, or edit each DOCX template individually.

## Implementation

1. Add the formatting at the shared General Book post-process in `backend/app/core/docx_engine.py`; both the canonical template and library/base templates pass through this function.
2. Find only the body paragraph whose text begins with the Arabic `الرقم:` label.
3. Preserve the rendered dynamic value verbatim (`1/{tab}/{serial}`).
4. Keep the paragraph/Arabic label RTL and make the numeric reference its own LTR run immediately after the colon so Word displays the stored segment order.
5. Apply Calibri, 16 pt, italic to both label and reference runs. Preserve the existing paragraph layout and all unrelated content.

## Tests

1. Extend `backend/tests/test_general_book_ref_line.py` to assert:
   - a dynamic value such as `1/5/142` is rendered verbatim;
   - label then value are adjacent runs;
   - label/paragraph remain RTL and the reference run is explicitly LTR;
   - both runs are Calibri, 16 pt, italic.
2. Add one library-template-path assertion so saved/base templates use the same shared formatting.
3. Run:

```powershell
venv\Scripts\python.exe -m pytest backend/tests/test_general_book_ref_line.py backend/tests/test_book_template_retokenize.py backend/tests/test_word_book_service.py backend/tests/test_word_book_finish.py backend/tests/test_word_book_preview.py -q
venv\Scripts\python.exe -m ruff check backend/app/core/docx_engine.py backend/tests/test_general_book_ref_line.py
```

## Acceptance

- With the counter currently ending at 141, the next allocated book remains 142 and the DOCX displays `الرقم: 1/{tab}/142`.
- Word visually shows the Arabic label on the right followed by the non-reversed reference.
- Default, base-table/base-text, and saved library templates behave consistently.
