# Phase 1 verification and review record

This records **exercised evidence**, not Phase 2 sign-off. No production implementation, API/model change, migration, push, PR, merge, publication or deployment was performed. The static interactions are explicitly simulated. The storekeeper phone study has not been run.

## Current-app research runtime

`RuntimeAssessment` independently installed dependencies and ran the real application against a fresh scratch DB, never laptop/dev data or `.env`:

| Command / scenario | Observed result |
|---|---|
| `pnpm -C frontend install` | Success; 455 packages installed |
| `~/.venvs/sentinel/bin/python .tmp/scratch/store_count_runtime.py --seed` | Existing Alembic head `0111_store_room`; imported real opening data: 13 items, 23 count lines; art already populated |
| Scratch backend / Vite | Ready on loopback 8932 / 8933; explicit `Settings(_env_file=None)` and scheduler disabled |
| New count | All 40 quantity fields blank; 0/23 |
| Partial entry + reload | Quantity and note lost; returned 0/23 |
| Partial entry + Items navigation + return | Quantity lost; returned 0/23 |
| Edit October count | Date/note restored; all quantities still blank (correctly blind) |
| Live expected-batches API | 23 metadata-only rows; no expected/historical stock quantities or `on_hand`; `contains_qty` is package metadata |
| Real OCR, synthetic PNG only | Two known rows matched at 100, one unknown remained unmatched; invalid confirmation did not create delivery |
| Empty white PNG | Empty-read message → empty manual form, selected note retained |

Details/source limits: `critique.md` and `.tmp/store-count/current-runtime-assessment-b.json`. OCR-unavailable (as opposed to empty read), learned aliases, successful durable delivery attachment/retry and Arabic physical-keyboard behavior in the incumbent app were **source-audited, not forced live**. Synthetic note accuracy is not accuracy against actual HQ notes. Current OCR remains `eng`, not `ara+eng`; no Phase 1 fix was made.

Current screen captures are `.tmp/store-count/current-*.png` (English/light, 390 × 844, DPR 1.25). Source-only Assessment A received seven of these and visually inspected them independently, after completing its unanchored source assessment. A could not create its own browser tab because its scout lacked browser/eval tools; no independent live interaction by A is claimed. Parent additionally captured the actual home Dashboard at:

- `.tmp/store-count/current-home-en-light-390.png`
- `.tmp/store-count/current-home-en-light-1440.png`

The actual home uses an internal page scroller; these are viewport comparisons, not whole-dashboard captures. The mockup's Home reference is illustrative, not a substitute for these real-app images.

## Static mockup smoke (actual Chromium interaction)

Served with `python -m http.server 8931 --bind 127.0.0.1`; no build or backend is needed for the prototype.

| Exercised path | Result |
|---|---|
| Clean Start counting | First item fields blank; batches counted 0/23 |
| Enter Arabic `٣` and Persian `۲` | Inputs normalized to `3` and `2`; progress 1/23 |
| Save & exit → Resume → reload | Entered `3` / `2` retained; device-only saved message truthful |
| Review partial count | 22 uncounted rows with drawings/expiry; submit disabled; entered quantity alone shown in reviewed section |
| Select missing expiry | Returned to corresponding item; correct batch quantity field focused |
| Add month-only `2030-06` | New blank batch showed **30/06/2030**, progress denominator 24 |
| Add same expiry again | No duplicate, still one added batch |
| Remove added batch | Explicit confirmation; removed without inventing a zero; denominator returned 23 |
| Decimal `1.5` | `aria-invalid=true`, explicit whole-number instruction, not counted |
| Explicit zeros across all 13 items / 23 batches | Review showed 23/23 and zero missing; confirmation checkbox enabled simulated submission; final screen said **Demo submission complete**, not a real save |
| Skip → Previous | Coffee-mate next; previous item retained typed `4` / `0` |
| `storage=fail`, edit then Save & exit | Remained on counting screen with **Draft NOT saved** instruction; no false successful exit |
| Upload harmless scratch PNG → synthetic example | Actual file retained locally; three illustrative source rows; received fields blank; unmatched drawing picker offered all 13 items |
| Confirm unmatched line | Blocked with “Match this line to an item first” |
| Receive 3 where synthetic note said 4 cartons | Confirmation blocked until discrepancy reason supplied |
| Skip then restore line | Source and entered corrections preserved; reversible exclusion |
| Match unknown by drawing, confirm all three retained lines | Three explicit confirmations; simulated submit enabled; result clearly said no delivery saved/no server upload |
| Manual OCR-unavailable path after attaching file | One empty line with no selected item; same file retained |
| Add-item change category/unit then drawing | Protective/Box selections preserved; bilingual print fields and verified contents preview worked; no real item created |
| Disposal | All 13 drawings available; item → original batch → 0 cartons + 2 loose boxes → Damaged; clear demo review with isolated date/name |
| Keyboard count entry | Tab moved from full cartons to loose input; visible solid focus outline |
| Browser diagnostics after workflows | No recorded JavaScript errors; no `/api/` resource requests from static page |
| Month-only native-input fallback emulation | In Chromium, changed month inputs to plain text to model unsupported pickers. `09/2028` rejected with YYYY-MM instruction in both add-batch and receipt confirmation; no added/confirmed invalid row. This is **not** a Firefox/Safari run. |
| `node --check mockups/plan/store-count/app.js` | Success on final JS after month-format guard |

A rapid zero-entry smoke exposed a noninteractive toast covering quantity actions. Fixed by making the toast pointer-transparent; missing rows were then explicitly counted and the full review completed. A done-state side navigator exposed a small overflow; labels now wrap and completion text has its own mobile row. These are mockup fixes only.

Browser harness limitations encountered: native Confirm paused a direct helper, and its documented dialog helpers aborted; closing/reopening that managed tab and using a raw browser dialog-accept handler allowed the removal scenario to complete. Two optional incumbent navigation captures stalled, but required baseline screenshots/API/interruption scenarios were already captured. No implementation defect is inferred merely from those transport failures.

## Final visual capture matrix

**96 final captures:** 12 states × widths 390/1440 × EN/AR × light/dark. Paths and measured metadata: `.tmp/store-count/mockup-capture-matrix.json`. At 390 use height 844; at 1440 use height 1000; final matrix DPR 1. All 96 had document width equal to viewport width and **zero measured printed SVG label overflow**. Shelf captures are full-page; other captures are first viewport (long content remains scrollable).

File pattern:

```text
.tmp/store-count/mockup-{state}-{en|ar}-{light|dark}-{390|1440}.png
```

States: `count`, `count-start`, `count-review`, `coffee-batches`, `shelf`, `items`, `add-item`, `delivery-confirm`, `delivery-manual`, `disposal-picker`, `disposal`, `home`.

Additional behavior evidence: `.tmp/store-count/mockup-count-review-partial-en-light-390.png` (one entered batch, remaining batches listed). This is local scratch evidence; the committed HTML/CSS/JS regenerates the surfaces without those files.

Final screenshots were inspected directly: Arabic dark phone count and full shelf, English light phone count and desktop count. Independent RTL reviewer inspected the final Arabic phone count/shelf and English desktop images. The first Nescafe quantity input's bottom edge measured **785–787 CSS px in English** and **765 CSS px in Arabic**, visible within the 844px phone viewport. These values are for the recorded default 19px root font and this item; no claim is made that every long label or increased-font setting keeps an input above the fold.

### Artwork and typography at size

- Original shape coordinates, paths and item colours match `StoreItemArt.tsx`; the frame is tightened from `0 0 120 120` to **`20 20 80 90`**, removing empty margins without clipping any package/shadow. This is an explicit mockup framing proposal, not a production change.
- Shelf art box: **145.5px** at 390 and **160px** at 1440. Focused art: **128px** phone / **144px** desktop. The side navigator is only 52px: its package-print text is not readable as body copy; adjacent names provide identification.
- The narrowest English shelf brand, Coffee-mate, measures about **10.2px screen font** on phone and **11.2px** desktop after natural proportional font fitting. Other tested English shelf print is larger. Full wrapping names remain adjacent; the real phone study must judge recognition/reading comfort, not only lack of overflow.
- Long new-item preview labels wrap and fit naturally; no horizontal glyph stretching. Real recorded brands are not split or invented.
- Arabic pack facts use natural clauses (“كرتون: 12 مرطبانًا، 190 غ لكل مرطبان”), not an unstable bidi multiplication string. Arithmetic pack facts in `research.md` are equivalent; unknown contents remain unknown.
- Root 19px, em-scaled type, 16px rounded WidgetFrame-like surfaces, bundled Inter/Noto Sans Arabic. Local accessible aliases slightly raise dark muted/primary-text and light warning contrast; no production tokens were modified.

### Contrast and accessibility scope

Calculated from the actual CSS token values for eight text/background pairs in each theme. All sixteen ratios were ≥4.5:1; lowest: light success/soft **4.56:1**, dark on-primary/primary **4.59:1**. Evidence `.tmp/store-count/mockup-token-contrast.json`. This is a token-pair check, **not an exhaustive pixel/opacity/AA or screen-reader audit**. Native controls/buttons have 44px minimum targets; checkbox labels provide larger hit areas.

No axe run or actual iOS/Android, Firefox, Safari, virtual-keyboard, screen-reader, 200%-zoom or largest-font-scale certification is claimed. Phase 2's axe/build/test/screenshot acceptance still applies to the implemented app.

## Read-only reviews and disposition

| Review | Findings and final disposition |
|---|---|
| `DesignAssessment` | Current-app source critique + supplied image supplement, kept independent of detector. Provisional 23/40; findings and evidence in `critique.md`. |
| `RuntimeAssessment` | Independent current-app detector/browser/OCR/interruption evidence, not a production fix. |
| `RtlMockupReview` using `.codex/agents/i18n-rtl-reviewer.toml` | Initial source + supplied screenshots found raw drawing IDs, language-button accessible-name mismatch, reversed product name, garbled Arabic pack order and clipped mobile tabs. Corrected. Final source/image reread: **no remaining must-fix in scope**. |
| `MockupSpecReview` | Initial delivery evidence/skip restoration and Arabic table mismatch corrected. Final source reread: code-side must-fixes resolved, **no new blockers**; missing verification doc and force-add requirement are fulfilled by this document and commit. |

Other resolved review points: neutral bilingual progress; keyboard-friendly drawing matching; add-item category/unit retention and structured known contents; removable mistaken batch; normalized digits; truthful storage failure/unload warning; disposal route preselection and original-batch-only choice; received-date DD/MM/YYYY echo. The new-item vocabulary is illustrative; Phase 2 must preserve existing recorded unit names (e.g. green tea remains علبة), not blindly copy the preview options into the data model.

Detectors:

- Current Store CLI detector: once, one broken-image test-mock false positive. Browser overlay: five shared-shell small-text findings plus one global easing token per inspected page; see `critique.md`. Overlay was headless, not user-visible, and its temporary server was stopped.
- Mockup detector: once on the initial completed implementation before review corrections, one `overused-font` warning for Inter. Rejected as incompatible with the brief's incumbent-font requirement. No claim is made of a fresh final detector or zero broad accessibility violations.

## Gate and retained limits

No storekeeper findings or packaging truth were invented. Exact printed brand spelling, six unknown carton contents, count step granularity, production draft account/device policy, optional custom picture uploads and delivery attachment/review policy remain approval questions in `research.md` and the handoff.

Scratch DB/evidence remain under `.tmp/` only; no generated frontend build assets or real data are committed. Temporary servers/tabs are stopped at handoff. `store-room.md` / `assets-store.md` and production callsites/tests/contracts are intentionally unchanged: this is the Phase 1 mockup gate, not the Phase 2 build/progress update.

Cleanup observed: `store-count-static-mockup`, `store-count-scratch-frontend` and `store-count-scratch-backend` were stopped; parent browser tabs were closed/released. The one-off scratch runtime launcher was removed after shutdown; its command above is a historical verification record, not a retained runnable entrypoint. The standalone mockup run command remains supported. Scratch screenshots/JSON and the seeded scratch DB are retained locally for the parent, uncommitted.
