# Report (تقرير) Word template restyle — match تقارير شاملة.docx

**Date:** 2026-07-24
**Status:** approved (user confirmed target doc + bold 16pt body)

## Problem

The Report doc type (Word-authored body, template
`backend/templates/GSSG-GS_300-004_Report.docx`) opens in Word with a compact,
wrongly-styled body. The user's reference for the intended layout is
`C:\Users\Admin\Desktop\book template\تقارير شاملة.docx` — a real report letter
on the same GSSG letterhead.

## Decision

Restyle **only the body paragraphs** of the existing template in place. Headers,
footers (incl. the `{{ submitter_g }}` token in footer3), styles, settings, and
page geometry stay untouched — they are the deployed paper. Jinja tokens keep
their meaning; only the paragraph/run formatting around them changes.

Rejected alternative: tokenize the reference docx itself — its header/footer XML
drifts from the deployed paper and lacks the footer token.

## Target layout (from the reference)

All Arabic runs: `w:cs="Calibri"`, szCs 32 (16pt) unless noted. One blank
paragraph between the top sections.

1. `التاريخ: {{ date }}` — plain 16pt.
2. blank
3. `السيد \ {{ recipient_name }}` … `المحترم` — plain 16pt; **المحترم pushed to
   the line's end via a tab stop** (not literal spaces — recipient names vary).
4. blank
5. `تحية طيبة وبعد ,,` — plain 16pt.
6. blank
7. `الموضوع : {{ subject }}` — **centered** (`jc=center`), plain 16pt, no
   underline (conditional Jinja expr unchanged: hidden when no subject).
8. two blanks
9. `{{ body }}` anchor — **bold 16pt, justified (`jc=both`)**. This paragraph's
   formatting is what the author types in inside Word; sentinel mechanics
   unchanged.
10. blank
11. `للتفضل بالعلم وإجراءاتكم لطفاً،،،` — bold 16pt, justified.
12. **2 blank paragraphs** (user-tuned 2026-07-27; the reference's 7 pushed
    long bodies onto a second page).
13. `وتفضلوا بقبول فائق الإحترام والتقدير ,,,` — **centered, bold 16pt**.
14. **9 blank paragraphs** (space for the closing/signature zone).
15. Signature block, 18pt (szCs 36), positioned mid-page as in reference
    (leading indent copied from reference paragraphs):
    - `الإســـ…ـم : {{ manager_name }}` (kashida-elongated label; label+name 18pt plain as in reference)
    - `المسمى الوظيفي : {{ manager_title }}`
    - `التوقيـــ…ـع: {{ manager_sig }}` (elongated label; `ind left=4680` as in reference)

Removed: the `{%p if cc %} نسخة إلى … {%p endif %}` block — Reports always pass
`cc=""` and the reference has no CC line.

## Round 2 (user visual QA, 2026-07-27)

Decoded from the operator's hand-edited sample + message:

1. **Font:** Sakkal Majalla on every run (ascii/hAnsi/cs), sizes unchanged
   (16pt body block, 18pt signature block).
2. **Markers:** `تحية طيبة وبعد ،،` and `للتفضل بالعلم وإجراءاتكم لطفاً،،`
   (Arabic commas), closing line becomes
   `وتفضلوا بقبول فائق الاحترام والتقدير` (no trailing marks, الاحترام
   spelling). للتفضل and وتفضلوا lines are **not bold** (per the edited file);
   the body anchor stays bold 16pt.
3. **Signature placement (Finish/sign):** the float anchors UNDER the
   التوقيـــع label line (new top-priority anchor rule in
   `stamp_signature_above_name`: normalized paragraph starting with
   "التوقيع" → anchor the behind-text float on the paragraph below it).
   Overlap with the label is acceptable (wet-sign effect); General Book is
   unaffected (its paper has no التوقيع label → falls through to the name
   rule). The signing date (DD/MM/YYYY) is written under the signature on
   the anchor paragraph — Report books only.
4. **Report form UI:** show the picked signer's saved signature (via the
   existing employee-signature endpoint) beside the "توقيع الآن" checkbox —
   preview image when on file, amber "no saved signature" warning when not.

## Code change (one line)

`word_book_service.create_report_word_book`: date fallback
`now.strftime("%d-%m-%Y")` → `now.strftime("%d/%m/%Y")` (reference shows
`22/07/2026`).

## Safety notes

- Finish-time signing uses `stamp_signature_above_name` (anchors on the signer
  **name**, not on "التوقيع") — elongated التوقيـــع label is safe.
- `_postprocess_general_book_footer` touches only the footer — unaffected.
- Template edit workflow: edit a copy offline, then replace the repo file in one
  commit (avoid live-service template churn).

## Verification

- Existing Report backend tests stay green (`pytest backend/tests -k report`).
- Sync `backend/templates/_fields.json` if it enumerates Report tokens (cc removed).
- E2E smoke: create a Report, open the working docx, compare side-by-side with
  the reference; Finish with sign to confirm the signature still stamps.
