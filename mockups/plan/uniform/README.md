# Assets → Uniform (الملابس): approval mockup

**Do not build or deploy this yet.** Static HTML for approval only: no backend, API client, persistent storage or frontend build. All employees, G-numbers, quantities and dates in `data.js` are invented sample data. Changes last only until reload.

## Open and preview

Open `http://127.0.0.1:8941/mockups/plan/uniform/index.html`. To serve it yourself, run `python -m http.server 8941 --bind 127.0.0.1` from this worktree. Fonts load from `../store-count/`; leave that folder in place.

- `index.html`: screen, bilingual strings, dialogs and in-memory interactions.
- `data.js`: stock, employees, hand-outs, returns, derived totals and consistency assertions.
- `art.js`: fixed SVG drawings, bilingual `UNIFORM_ART_KINDS` catalog and `UNIFORM_ART_GROUPS`.

| View | Query |
|---|---|
| Stock, store manager | `?tab=stock&view=edit` |
| Received | `?tab=received` |
| Person detail (only region shown on phone) | `?tab=received&person=G3105` |
| Returns | `?tab=returns` |
| Return detail | `?tab=returns&return=T-0004` |
| Hand-out form | `?view=edit&give=1` |
| Record return form | `?tab=returns&view=edit&returnForm=1` |
| Edit quantities and drawing | `?view=edit&edit=cargo` |
| Edit suit drawing only (tailored, no shelf counts) | `?view=edit&edit=suit` |
| Add item | `?tab=stock&view=edit&addItem=1` |
| View only: no mutation actions | `?view=readonly` |
| Loading / load failed, on any tab | `?view=loading`, `?view=error` |

Append `&lang=ar` and/or `&theme=dark` to any query. The mockup toolbar also switches these views.

## Decisions

- Assets has **Uniform / الملابس** beside **Store / المخزن**, with **Stock / الرصيد**, **Received / المستلمون** and **Returns / المرتجعات** sub-tabs. Existing Arabic return terms elsewhere refer to leave or document workflows, not returned goods; المرتجعات is used here.
- **Belt and cap are one size**, shelf balances 48 and 42. Every historical line uses `size: 'one'`. Their hand-out choices remain **None / بدون** and **One size / مقاس موحد**.
- Guard pieces: olive logo polo, khaki cargo trousers, brown belt, tan field boots, khaki logo cap and khaki socks (pairs).
- A formal suit is tailored jacket, trousers and white shirt as one piece. **It has no size and no shelf quantity.** Neither its item nor its hand-out/return lines have a size field. Holder chips show the G-number plus **×N** when the employee holds more than one, with the employee name and suit count in the accessible label. An employee remains a holder until all their suits are returned. The summary distinguishes holder count from **N suits issued**.
- Manager-only **Give suit / صرف بدلة** beside Update and the trailing **+** holder chip open hand-out with employee search focused. Choosing an employee preselects Give for the suit; every other piece starts at None. Closing or saving restores focus to the original row action or chip.
- **Winter uniform / الزي الشتوي** retains only the sample winter jacket, drawing `parka`, letter sizes, default hand-out quantity **1**. Its shelf counts total **40**. Two sample hand-outs record one jacket each for G3105 and G3117; the displayed shelf snapshot already reflects those hand-outs. This is an approval example, not confirmed inventory.
- Shelf and holder totals, out-of-stock sizes, received counts and return counts are computed from rows.
- **Hand out uniform / صرف ملابس:** shared employee search by name or G-number; Enter chooses a single search match, and arrow keys move through results. Stock pieces have None plus size choices, with a remaining count under each size. Tailored suits have **None / Give** (**بدون / تسليم**), still with quantity default **2**, minimum 1 and no artificial shelf maximum. Belt/cap/winter jacket default to 1; socks and other pieces to 2. Signed-in giver and sample today's date are automatic. Saving subtracts shelf stock for stock pieces only and adds a hand-out. Unavailable stock sizes cannot be chosen. Excess quantities are clamped to stock, with **Only N left** announced beside the stepper and the corrected number written on field commit. Disabled Save explains why.
- **Record return / تسجيل إرجاع:** only employees currently holding something are searchable. The form lists each held piece (and size for stock pieces only), drawing, held quantity, and a 0-to-held stepper starting at 0. Save requires an employee and a positive quantity. Signed-in receiver and sample today's date are automatic. Saving adds a newest-first return and restores stock; suits affect holders, not shelf stock. Suit returns and Received details never show a size; the holder description is simply “Holds a formal suit” / “يحمل بدلة رسمية”.
- For this approval model **all returned stock is reusable and goes straight back onto the shelf**. This remains an approval question below, not a production policy.
- Received detail shows **Currently holds**, every hand-out and clearly labelled returns. Received and Returns both use list plus sticky detail on desktop and one region at a time below 1000px, with Back and focus restoration. Return cards show the size for sized stock, use a full-width selected background and a 2px logical start-edge marker. Switching sub-tabs clears search; Retry restores the preceding edit/view-only mode and focuses the screen heading.
- **Add size:** stock Update accepts a new size at quantity 0. Empty and case-insensitive duplicate values show inline errors. Enter in either Add size field stages a size without submitting or closing its dialog. Save applies staged edits; Cancel discards them. Quantity fields floor fractions and clamp negatives to 0, then write the corrected value on field commit, without disrupting typing. One-size items cannot add sizes. The tailored suit editor is drawing-only: no size list, Add size or shelf quantity fields. Update has one 88px preview, no duplicate header illustration, and Add size fields are capped at 200px.
- **Add item:** manager-only secondary action on Stock. English and Arabic names are required, descriptions optional in both languages. Group starts unselected and requires an explicit choice of Formal, Guard uniform or Winter uniform, with a bilingual inline error. Default quantity is a positive whole number. Letter, shoe, waist and one-size presets can be edited by adding/removing sizes; at least one size is required. There is no tracking-type choice.
- **Fixed drawing choices:** exactly **12** kinds: `suit`, `boots`, `polo`, `cargo`, `belt`, `cap`, `socks`, `jacket`, `vest`, `parka`, `dressshirt`, `longsleeve`. Artwork is fixed; choosing a drawing is the only artwork option. The polo uses its original default illustration.
- **Available drawings only:** Add item hides every drawing already used by any item; tiles are not merely disabled. Update shows the current item's own drawing plus unused drawings. Saving a different drawing releases the old one for later items. Availability is recalculated whenever a dialog opens, so adding an item removes its drawing from the next Add item.
- The shared picker reads the bilingual catalog/group headings, drops groups whose drawings are all hidden, uses native labelled radios and an **88px live preview**. Add item preselects the first **visible tile in grouped display order**, currently `dressshirt`; Update keeps the item's own drawing selected. The grid scrolls inside the dialog. A matching 12-kind fallback preserves current artwork when catalog metadata is unavailable.
- If every drawing is taken, Add item shows a single explanatory sentence in the picker instead of tiles/groups. Save is disabled, with a concise availability reason beside it and linked via `aria-describedby`; submitting is also guarded. Editing an existing item still permits its current drawing.
- Existing items, including suits, can choose a different drawing through Update. Stock items save drawing, size and quantity edits together; the suit saves drawing only. Cancel discards staged edits. All views use `uniformArt(kind, cls)` and history shows the item's current drawing, not an immutable artwork snapshot.
- New items start with zero stock for every size: dashed zero cells, inclusion in Out of stock, Update and hand-out choices. Update can supply stock before hand-out. Drawing choice never changes tracking; new items are shelf-counted even with the suit drawing.
- Managers alone see mutation actions. Hand out is the sole primary on Stock/Received; Record return is primary on Returns, with Hand out secondary. Dialog Save is primary while the page behind it is inert.
- Compatible polish keeps the ledger and StoreShell type/control shapes, not a marketing restyle. Hero gutters match StoreShell at 32px desktop, body/sub-tabs at 24px, and both at 16px on phone. Chrome colour transitions use 120ms `cubic-bezier(.2,0,0,1)`. Dialogs/toast enter with opacity and an 8px rise; their light-theme shadows are two-layer overlays only. Dark overlays use a raised surface and border, without a shadow. Only changed size cells receive a 600ms navy opacity-overlay pulse after Save. All motion is inside `prefers-reduced-motion: no-preference`; reduced motion has no pulse or dialog transition. Header focus rings are white; inputs/controls keep their own focus styling. Phone dialog chrome is pinned while only its body scrolls. A data favicon avoids an unrelated 404.

## Sample arithmetic and browser evidence

The initial shelf snapshot is **347** before sample returns. Four returns restore **5** shelf pieces and two suits, giving **352 shelf pieces**, **4 suit holders**, **11 recipients**, **14 hand-out records**, **4 return records**, and **3 out-of-stock sizes across 2 pieces**. Winter contributes **40** of the 352. Assertions validate references, stock sizes, integer quantities, newest-first order, no over-return at any point, shelf reconciliation, holder removal, the winter total and its two hand-outs. They explicitly require no size field for suit lines and no size list on the suit item.

Real Chromium verification:

- Drawing availability starts at **12 catalog kinds - 8 used = 4 available**: jacket, vest, dressshirt and longsleeve, under just **2** non-empty group headings. The first visible tile, `dressshirt`, is preselected. Earlier lifecycle checks added `vest`, leaving **3** available and **0 vest radio nodes** in the next Add item. Editing polo then showed **4** choices (its own polo plus 3 unused), with polo selected. Replacing polo with jacket released polo for the next Add item.
- After adding the remaining free drawings, **12** kinds are used, Add item shows **0 radios / 0 group headings**, and Save is disabled with its reason. Enter cannot create a thirteenth item. At exhaustion, editing the vest still offers its **1** current drawing and enabled Save. The exhausted state was also checked at **390px Arabic RTL dark**, with a **390px** document width and no errors.
- The tailored suit editor has **0 size/Add size/quantity fields**, exactly **1** 88px drawing preview, checked-drawing initial focus, and retains the no-size data shape after Save. Direct Give suit and + focus employee search; Enter chooses G3194, preselecting only suit/Give with default **2**. Quantity **7** is accepted without the old artificial cap; the test resets it to 2 before Save. Giving two suits creates exactly `{ item: 'suit', qty: 2 }`, increases holders **4 → 5**, produces chip text **G3194×2** and accessible suit count, and changes the subline from **8 → 10 suits issued**. Shelf remains **352**.
- Returning one suit leaves **1** held and **5** holders; returning the second leaves **0** held and **4** holders. Both return lines omit size; shelf remains **352**. Received says “Holds a formal suit” and shows quantity without a size.
- At **390px Arabic RTL dark**, the + shortcut selects **بدون / تسليم**, distinct from submit **صرف**. Handing out **2** and returning **2** gives holders **4 → 5 → 4**, with shelf **352** unchanged, no size on either line, no page overflow and chip **G3194×2**. Returning the final suit removes that employee from holders. Focus returns to the + opener.
- Returning **2 L polos** held by G3105 changes polo L **22 → 24**, shelf **352 → 354**, and removes that polo/size line from Currently holds. The return retains `size: 'L'`. Arabic return detail was visually inspected on phone; its stepper uses logical start alignment.
- Update writes **-5 → 0** and **2.7 → 2** on commit. Enter adds **4XL** at zero without saving/closing; Enter with **4xl** shows the duplicate error. Save applies the staged size and pulses only the changed S/4XL cells. Add item also stages **4XL** with Enter without saving; an empty group shows the inline error and receives focus.
- Added Review jacket / سترة مراجعة with drawing `jacket`, letter sizes plus 4XL and all quantities **0**. Update supplied **3** in 4XL; hand-out of **2** to G3194 left **1** on the shelf and **2** held, with the correct custom-item/size record.
- All **8 combinations** of English/Arabic, light/dark and **390/1440px** were browser-driven through required-group validation and boots size 46: default **2 → 1**, with **Only 1 left** / **المتبقي قطعة واحدة فقط.** Polo XXXL input **9 → 2** similarly says Only 2 left. Every combination has no horizontal overflow, correct first-visible drawing selection and no `tab.errors()` entries. A reduced-motion run has **0 pulsing cells** and **0s** dialog transition.
- Sub-tab navigation clears prior search. View-only → error → Retry stays view-only, hides mutation actions and focuses `screen-title`. Normal hand-out radio choices precede the quantity field in DOM/tab order. Editor, Add item and hand-out sensible first focus, original-opener focus return, pinned phone modal header/footer, and white keyboard hero focus were exercised. `tab.errors()` stayed empty on both real-page tabs.

Earlier fixed-drawing lifecycle checks (same stock baseline):
- The stock polo SVG matches the original default `uniformArt('polo')` after DOM parsing. Items have no artwork-override field; both Add item and Update have no extra artwork controls.
- Added Safety vest / سترة سلامة with drawing `vest`, one size and default quantity **1**. It started at **0**, then Update supplied **5**: shelf **352 → 357**. Hand-out **1** to G3194: item **5 → 4**, shelf **357 → 356**, holdings **1**. Return **1**: item **4 → 5**, shelf **356 → 357**, holdings **0**, return records **4 → 5**.
- Separate **390px Arabic RTL dark** run added a vest, stocked **3**, handed out **1** and returned **1**: shelf **352 → 355 → 354 → 355**, item **0 → 3 → 2 → 3**, holdings **0 → 1 → 0**. Received showed the employee's vest and hid the list while detail was open.
- Phone document width stayed **390px**, dialog width **388px**, with no page overflow. Drawing preview and editor selection retained `vest`. `tab.errors()` remained empty, including after a final reload against ArtCatalog's final script.

Earlier return/editor verification also exercised required names, quantity/size validation, empty and duplicate size rejection, suit-holder removal, bounded return quantities, no-match search, readonly action hiding, Retry, modal focus return, and Back focus restoration. Their original figures are superseded by the sample totals above.

## Bilingual review

A read-only reviewer followed `.codex/agents/i18n-rtl-reviewer.toml` against inline `T.en`/`T.ar`, data and catalog labels. The new availability sentences are correct peers with no interpolation; the picker, groups and disabled Save reason remain accessible and logical in RTL. The suit review confirmed no-size records, holdings, labels, returns and editor paths. Two findings were fixed: Arabic Give is **تسليم** rather than duplicating submit **صرف**, and the now-unused size-label helper was removed from both languages. The tailored suit description is grammatical in both languages. Follow-up review is clean.

The review-driven round added employee-based counters, suit-specific accessible counts, remaining-stock notices and required group choice. Three should-fix findings were applied: suit chip labels now count suits rather than generic items, English employee counters match Arabic موظف, and the unused `noneLeft` strings were removed. The reviewer confirmed the Arabic cases in “صرف مرتين” and “المتبقي قطعتان فقط”, RTL isolation, new action focus restoration and required-group association. Follow-up review is clean, with no additional findings.

## Design and final gates

Tasteskill v2 app-screen style **achromatic-ledger**, seed **2089055445**, with GSSG palette/type retained. No redraw. Stock asks which sizes are on the shelf, Received asks who received and still holds what, and Returns asks who returned what. The size ladder and fixed drawings are the product-specific signature. Navy remains on size data; actions/chrome are ink and grey. The original Assets hero band and dark tokens stay. Zeros print 0; missing/not-applicable values are grey `-`. G-numbers and sizes are isolated and upright in RTL.

Final gates include live drawing availability, tailored suits, direct suit actions and the review-driven interaction/polish changes:

| Gate | English light | Arabic dark |
|---|---|---|
| Stock inspector, 1440 / 768 / 390 | 0 FAIL, 2 WARN | 0 FAIL, 0 WARN |
| Received inspector, 1440 / 768 / 390 | 0 FAIL, 2 WARN | 0 FAIL, 0 WARN |
| Returns inspector, 1440 / 768 / 390 | 0 FAIL, 3 WARN | 0 FAIL, 1 WARN |
| `lint.mjs --app mockups/plan/uniform/` | 0 FAIL, 6 WARN | Same source gate |

All **36** final inspector screenshots were opened as six labelled contact sheets. Reports/screenshots are under `/tmp/taste-uniform-polish-{stock,received,returns}-{en,ar}/`, not committed.

| Retained warning | Reason |
|---|---|
| `micro-label` / lint `eyebrow` | The single Assets context label is inherited from StoreShell. |
| `palette-cream` | `#f5f4f1` is the real app background. |
| `ragged-row` on Returns | A short sticky detail pane is intentionally independent of its master list. |
| lint `shadow` | Only floating dialogs and toast have shadows. |
| lint `numbering` | `padStart` is part of SVG shading arithmetic, not decorative numbering. |
| Allowed `gradient` | The existing Assets hero band is retained. |

Visual critique: the largest regions answer the ledger questions, edges align, totals reconcile and data hue stays on size cells. Phone layouts retain all fields and push detail instead of squeezing regions together. Seasonal stock extends the ledger rather than adding dashboard tiles. The smaller drawing catalog remains readable with named groups, keyboard navigation and a visible 88px preview. The long stock ledger continues below the fold; summary and first row remain visible. Drawings are approval illustrations, not product photography.

## Sizes proposed for approval

| Piece | Initial sizes |
|---|---|
| Polo shirt | S, M, L, XL, XXL, XXXL |
| Cargo trousers | Waist 28-44, even sizes |
| Belt | One size |
| Field boots | EU 38-47 |
| Cap | One size |
| Socks | One size, pairs |
| Winter jacket (sample) | S, M, L, XL, XXL, XXXL |

## Questions before the real build

1. Are the size lists right, and should manually entered sizes have business-specific restrictions?
2. Are returned pieces always fit for the shelf, or is a **damaged / not reusable** option needed?
3. Is direct per-size quantity Update enough for stock arriving from HQ, or should receipts have dates/audit records?
4. Should permissions reuse `store.view` / `store.edit`, or be uniform-specific?
5. Should sizes have a configurable low-stock threshold?
6. Is the default of 2 correct for a formal suit?
7. Should current holdings/history also appear in the employee file?
8. Should new items always be shelf-counted, or should managers be able to create other holder-tracked items?
9. Confirm the remaining sample winter jacket, its quantities/sizes and default hand-out quantity of 1.
10. Should managers be able to edit/remove items, remove existing sizes or void hand-out/return records, and what audit constraints would apply?
11. Does one unique drawing per item fit the real inventory? It caps this fixed 12-drawing approval model at **12 items**; should the real build instead allow drawing reuse or a larger catalog?
12. Should Give/Return actions also be available from a person's detail, and should the Received list show net currently held quantities rather than its historical received totals?
