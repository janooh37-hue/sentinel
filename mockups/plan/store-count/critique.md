# Current Store — read-only Impeccable critique

Method: dual-agent (A: `DesignAssessment` · B: `RuntimeAssessment`), with parent visual synthesis. Assessment A's unanchored source assessment finished before detector output entered the parent synthesis. A subsequently inspected seven supplied English/light phone screenshots; its scout tool exposure could not open a browser. B independently ran the real app, OCR, interruption scenarios and detector. No production code changed. All findings concern the **current implementation**, not an approved design.

Target: `frontend/src/pages/assets/store` (slug `frontend-src-pages-assets-store`). Audience: first-time, phone-first storekeeper, likely Arabic. Mode: Operate. Product/design references: `PRODUCT.md`, `DESIGN.md` §4, ADR 0009, `store-room.md`, `assets-store.md`. The older `mockups/store-room.html` is a visual reference, **not proof of current production behavior**.

## Overall impression and specificity

The category shelves are distinctive and grounded in the physical store. The operational tabs abandon this useful identity for names, codes and batch worksheets. The redesign opportunity is not a fresh decorative skin: carry recognizable packages into each quantity decision, make unfinished work visible and recoverable, and teach scan-first receiving.

Actual package drawings currently have **no printed words** (`frontend/src/components/StoreItemArt.tsx:25–94`). The older mockup prints NESCAFE/CREAMER/TEA/etc.; do not describe those as production labels. The proposal adds a label layer to existing shapes rather than replacing hard-coded production words.

The user-reported cut-off name remains a valid requirement to remove clamping. In this scratch English/light 390px capture the names wrapped rather than visibly ellipsized. `StoreShelves.tsx:40` still has `line-clamp-3`, so clipping remains possible with other content/language/text scales. No claim is made that this exact reported clipping was reproduced in the captured configuration.

## Nielsen design health

Scores are **provisional expert assessment**, not measured usability or accessibility certification. A scored implementation affordances; B's runtime evidence confirms specific problems but does not convert the score into a user study.

| # | Heuristic | Score / 4 | Principal issue |
|---|---|---|---|
| 1 | Visibility of system status | 3 | Progress/pending feedback exists; no durable draft status |
| 2 | Match with real world | 2 | Shelf recognition becomes text/code/batch interpretation |
| 3 | User control and freedom | 2 | Cancel/navigation can discard count work |
| 4 | Consistency and standards | 2 | Artwork identity disappears in four operational tabs |
| 5 | Error prevention | 2 | Good blank/zero constraints; no interruption protection or explicit line-review tracking |
| 6 | Recognition rather than recall | 2 | Text-only item/batch selection, no illustrated missing-entry review |
| 7 | Flexibility and efficiency | 2 | Scan/manual alternatives; no focused/resumable count |
| 8 | Aesthetic and minimalist design | 3 | Quiet surfaces, but excessive first-viewport metadata and long forms |
| 9 | Error recovery | 3 | Inline errors, first-invalid focus and attachment retry are useful |
| 10 | Help and documentation | 2 | Blind instructions clear; immediate physical task/pack guidance less clear |
| **Total** | **Acceptable; substantial improvement needed** | **23/40** | **Not a release or accessibility score** |

## Four tabs and shelves

| Surface | Source and observed behavior | First-time operator consequence |
|---|---|---|
| Items | `StoreItemsPage.tsx:37–103`: desktop table/mobile cards, bilingual names, unit/contains, stock/minimum, edit/archive; no drawings. Actual 390px card is spacious, only about one full item fits. | Physically recognized goods must be translated into long names/codes. Preserve clear pack conversion but add recognition rather than compressing everything. |
| Deliveries | `StoreDeliveriesPage.tsx:60–108`: primary **Log delivery**, secondary **Scan delivery note**; empty-state copy teaches Log delivery. Text-only lines. | Monthly scan-first work is presented as the secondary path twice. |
| Stock counts/history | `StoreCountsPage.tsx:32–83`: month opens blank editing workflow for editors; viewers expand recorded lines. Visible month/date/23 batches do not explain View versus Edit. | An editor trying to inspect can enter replacement counting unexpectedly. |
| New stock count | `StoreCountPage.tsx:74–112,153–218`: genuine blank fields, item groups, expiry, local validation/focus, entered/total, sticky mobile actions. At 390, chrome/date/optional note fill the viewport while first quantity begins below the fold. | The policy is explained better than the immediate task. Repeated expiry rows are a worksheet, not a guided shelf walk. |
| Disposals | `DisposalDialog.tsx:53–69,94–151`: global text batch selector combines code, item, expiry and on-hand. Screenshot shows long clipped option runs. | Operator solves package recognition and batch choice at once. Prefer drawing → item → concise expiry options → quantity/reason. Empty page itself is clear. |
| Shelves | `StoreShelves.tsx:23–43`: category grouping, 104px art, three phone columns, clamped name, quantity and textual badges; no separate pack line. Shelf arrives after extensive chrome/month strip/filter content. | Strong identity appears late and does not follow into tasks. Actual filtering removes nonmatches; old mockup dims them—do not confuse the two behaviors. |

Paths in the table are under `frontend/src/pages/assets/store/`, including `components/` where applicable.

## Priority issues

### P1 — Interrupted counting loses work

**Observed:** new count started 0/23 with all 40 quantity fields blank. Entering `3` and a note gave 1/23; reload lost quantity and note and returned 0/23. Entering `5`, going to Items and returning also lost it. Merely switching apps without document destruction was not tested and may retain mounted memory. Editing the existing October count restored its date/note but all 40 quantity fields still opened blank, correctly blind.

Source: `StoreCountPage.tsx:75–83` component state; `92–95` restores batch identity, not quantities. Proposal: resumable **operator-entered draft** with truthful save state, not prefill from expected or saved count quantities. Storage/device/account policy needs approval. Suggested command: impeccable harden.

### P1 — Recognition breaks at the point of entry

Source: text-only `StoreCountPage.tsx:187–196`, `components/RecordParts.tsx:19–25`, `StoreItemPicker.tsx:23–37`, `DisposalDialog.tsx:94–116`. Count requires physical identity, pack and expiry together. Optional note/date dominates the current first viewport. Proposal: focused item with its batches, drawings/pack lines throughout, illustrated uncounted review with return-to-batch links; metadata secondary. Suggested commands: impeccable shape/adapt.

### P1 — Receiving is reusable but not yet the fixed bilingual contract

The existing scan pipeline, crops, correction reasons and attachment retry are valuable. Current OCR is English-only; expiry is not proposed; parsed quantities have no verified carton/loose unit interpretation; review is one global Save rather than explicit per-line confirmation. Do not rebuild what works or claim these gaps are already solved. Detailed audit below. Suggested commands: impeccable clarify/harden.

### P1 — Arabic quantity input needs device validation

Source: `QuantityInput.tsx:62–66,93–97` and `storeUtils.ts:245–253` accept ASCII `\d`, without Arabic/Persian digit normalization. [INFERENCE] Arabic keyboard/paste may reject `٣`/`١٢`. This was source-audited, not live-tested with an Arabic keyboard. The phone study must exercise the actual input method. Suggested command: impeccable harden.

### P2 — Clamped names and setup density

Source: `StoreShelves.tsx:40` clamps names; `StoreItemDialog.tsx:179–235` exposes drawing/color choices alongside bilingual units/contents. Proposal: short wrapping name, separate pack line, plain-word status. New-item artwork should be easy to preview, with unknown pack conversions left unknown. Suggested commands: impeccable distill/adapt.

## What works and must survive

1. Blindness is real: live `/api/v1/store/counts/expected?counted_on=2026-11-02` returned 23 metadata-only rows, no stock quantities. `contains_qty` is package metadata, not stock. Saved count GET contained historical quantities, but edit inputs remained blank. Preserve this distinction.
2. Local blank validation already focuses missing inputs before a request (`StoreCountPage.tsx:153–171`). This is **not** a purely server-error-only flow; the missing feature is a clear illustrated pre-submit uncounted overview.
3. Count progress, native controls, expiry-aware disposal guards and scan correction/retry are useful foundations. A real redesign does not require replacing their quantity or ledger mathematics.

## Delivery scan audit: reuse versus gap

| Requirement | Current evidence | Phase 2 implication, subject to approval |
|---|---|---|
| One scan/upload intake | File/PDF intake, mobile capture, cancellation built | Reuse; promote its discoverability |
| Shared OCR gate | `store_service.py:975–976` uses `OCR_GATE` | Preserve gate and resource bounds |
| `ara+eng` | Same line uses **`lang="eng"`** | Fixed bilingual requirement remains unmet |
| Code/name/alias match | `store_service.py:987–1028`: normalized code, EN/AR names, active aliases; fuzzy threshold 85 | Reuse, calibrate against real notes; synthetic match is not field accuracy |
| Unmatched never auto-saved | Real synthetic note gave 2 matches and 1 unmatched; invalid Save yielded inline errors; deliveries remained empty | Preserve explicit review and unmatched block |
| Expiry proposal | `StoreScanLine` has no expiry field; confirmation starts blank | Not implemented; no invented dates |
| Cartons + loose proposal | Synthetic `12` Nescafe displayed 1 carton + 0 jars; `15` Coffee-mate 1 carton + 0 jars | Parser treats quantity as base units without identifying note unit; resolve physical-unit semantics before trusting proposals |
| Drawing on every line | Confirmation currently text-only | Reuse line model, add identity presentation |
| Confirm every line | Current validation and global Save; no per-row reviewed state | Mockup proposes explicit Confirm per retained line |
| Unavailable/empty OCR | White PNG produced empty-read state, manual empty form retained selected file. Unavailable case source-audited, not forced. | Keep manual path usable with same accepted file |
| Undated goods | Scan requires expiry, manual allows undated | Reconcile actual undated items without fabricating expiry |
| Scan stays attached | Creation then attachment; retry or finish-without-file supported (`useScanDeliverySave.ts`) | Failure contract needs approval; fixed attachment promise currently stronger than implementation |
| Typical HQ note | Parser expects quantity + price-like column, real notes not supplied | Synthetic OCR cannot establish real-note coverage |

No OCR/parsing behavior was changed in Phase 1. Synthetic input is explicitly synthetic. Alias learning, attachment success/retry and forced OCR-unavailable behavior were not live-exercised.

## Cognitive load, personas and emotional journey

Source-derived checklist: single focus **fail**, chunking **fail**, grouping **pass**, hierarchy **provisional pass**, one thing at a time **fail**, minimal choices **fail**, working-memory support **fail**, progressive disclosure **fail**. Six failures is high by the playbook. Concrete choice loads: six Store tabs, thirteen text item choices, nine Coffee-mate expiry batches, twelve drawing options including default. These are not reasons to hide stock; they are reasons to stage physical decisions.

- **Jordan / first-timer:** sees policy and Save before the first quantity, must translate package → name/code, and cannot tell a month inspection from replacement editing.
- **Sam / accessibility-dependent:** labels, native buttons and error associations are strengths. Screenshots cannot prove keyboard/screen-reader compliance. Shelf selected-quantity bubble is `aria-hidden` (`StoreShelves.tsx:42`), so selected amount is not announced through it.
- **Casey / interrupted phone operator:** long expiry lists and work loss are the main risk; numeric keyboard and reachable sticky actions help. Do not promise resume from memory-only state.

Journey: confident recognition on shelf → uncertainty on worksheet → repetitive batch reading → anxiety about lost/missing work → reassuring saved toast. The proposed mockup targets the middle of that journey, without exposing expected quantities to make it superficially easier.

## Detector evidence and limitations

- CLI run **once** on `frontend/src/pages/assets/store`: exit 2, **one `broken-image` warning**, `StoreDeliveryScanPage.test.tsx:19`, `<img alt="Note crop" />` inside a test mock. False positive for shipped UI; no production Store finding.
- B successfully injected `detect.js` after mutable-script/title preflight and verified overlay DOM on count edit, Items, Deliveries and Disposals. The browser was hidden/headless: **no user-visible Human overlay is claimed**.
- Each injected surface reported the same six shared-shell signals: five `undersized-ui-text` at 10.5px in global bottom tabs (`components/shell/BottomTabBar.tsx:60`), plus `bounce-easing` for global `--ease-spring` (`index.css:160`). The former is real shell text outside scoped Store work; token detection alone does not prove active Store bounce motion.
- Overlay server PID 340385/port 8400 was stopped. Scratch app service cleanup is recorded in `verification.md`. No ignore list existed. No actual phone, Arabic current-app screenshot, dark current-app screen-reader or field delivery-note study was run.
- Primary evidence: `.tmp/store-count/current-runtime-assessment-b.json`, `current-blind-api.json`, `current-synthetic-ocr.json`, `current-browser-detector.json` and `current-*.png`. These are local scratch artifacts, not production/dev data.
- Parent separately scanned the **new mockup** once: one `overused-font` warning for Inter, intentionally suppressed as a false positive because `DESIGN.md` mandates the incumbent Inter/Noto Arabic families. This is separate from the current-app critique.

## Questions to consider (handoff, not authorization)

- Count structure: focused item/all its batches, or one expiry batch per screen? See `research.md` for tradeoffs.
- Review: explicit per-line receipt confirmation, or a final all-lines gate? Existing validation alone cannot prove review.
- Interrupted work: this-browser draft, or account/server draft with cross-device resume?
- Attachment failure: visibly incomplete delivery plus retry, or no completion until file is attached?
- New items: drawing-only or optional custom-picture upload? This remains undecided.

Questions are intentionally carried to the handoff instead of blocking Phase 1 here, as the brief requires. The four-task phone script is in `think-aloud.md`; it has **not** been run with the storekeeper. Phase 2 waits for parent approval.
