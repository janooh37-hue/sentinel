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
| Edit suit drawing or add a size (no shelf counts) | `?view=edit&edit=suit` |
| Add item | `?tab=stock&view=edit&addItem=1` |
| View only: no mutation actions | `?view=readonly` |
| Loading / load failed, on any tab | `?view=loading`, `?view=error` |

Append `&lang=ar` and/or `&theme=dark` to any query. The mockup toolbar also switches these views.

## Decisions

- Assets has **Uniform / الملابس** beside **Store / المخزن**, with **Stock / الرصيد**, **Received / المستلمون** and **Returns / المرتجعات** sub-tabs. Existing Arabic return terms elsewhere refer to leave or document workflows, not returned goods; المرتجعات is used here.
- **Belt and cap are one size**, shelf balances 48 and 42. Every historical line uses `size: 'one'`. Their hand-out choices remain **None / بدون** and **One size / مقاس موحد**.
- Guard pieces: olive logo polo, khaki cargo trousers, brown belt, tan field boots, khaki logo cap and khaki socks (pairs).
- A formal suit is jacket, trousers and white shirt as one piece. It has sizes but **no shelf quantity**. Holder chips come from current holdings; an employee remains a holder until all their suits are returned.
- **Winter uniform / الزي الشتوي** retains only the sample winter jacket, drawing `parka`, letter sizes, default hand-out quantity **1**. Its shelf counts total **40**. Two sample hand-outs record one jacket each for G3105 and G3117; the displayed shelf snapshot already reflects those hand-outs. This is an approval example, not confirmed inventory.
- Shelf and holder totals, out-of-stock sizes, received counts and return counts are computed from rows.
- **Hand out uniform / صرف ملابس:** shared employee search by name or G-number; a None option on every piece; defaults belt/cap/winter jacket 1, socks and other pieces 2. Signed-in giver and sample today's date are automatic. Saving subtracts shelf stock and adds a hand-out. Unavailable sizes cannot be chosen, quantities cannot exceed stock, and disabled Save explains why.
- **Record return / تسجيل إرجاع:** only employees currently holding something are searchable. The form lists every held piece and size, drawing, held quantity, and a 0-to-held stepper starting at 0. Save requires an employee and a positive quantity. Signed-in receiver and sample today's date are automatic. Saving adds a newest-first return and restores stock; suits affect holders, not shelf stock.
- For this approval model **all returned stock is reusable and goes straight back onto the shelf**. This remains an approval question below, not a production policy.
- Received detail shows **Currently holds**, every hand-out and clearly labelled returns. Received and Returns both use list plus sticky detail on desktop and one region at a time below 1000px, with Back and focus restoration.
- **Add size:** stock Update accepts a new size at quantity 0. Empty and case-insensitive duplicate values show inline errors. Save applies staged edits; Cancel discards them. One-size items cannot add sizes. Suits use the same Update action for sizes and artwork but never show quantity fields.
- **Add item:** manager-only secondary action on Stock. English and Arabic names are required, descriptions optional in both languages. Group is Formal, Guard uniform or Winter uniform; default quantity is a positive whole number. Letter, shoe, waist and one-size presets can be edited by adding/removing sizes; at least one size is required. Validation is inline.
- **Fixed drawing choices:** exactly **12** kinds: `suit`, `boots`, `polo`, `cargo`, `belt`, `cap`, `socks`, `jacket`, `vest`, `parka`, `dressshirt`, `longsleeve`. Artwork is fixed; choosing a drawing is the only artwork option. The polo uses its original default illustration.
- The shared Add item/Update picker reads the bilingual catalog/group headings, skips empty groups, uses native labelled radios and an **88px live preview**. New items default to the **first catalog kind**, currently `suit`, not a separate placeholder drawing. The compact grid scrolls inside the dialog; groups have accessible names. A matching 12-kind fallback preserves the current drawing when catalog metadata is unavailable.
- Existing items, including suits, can choose a different drawing through Update. Save applies drawing, size and quantity edits together; Cancel discards them. Stock, summary, hand-out, Received, holdings, returns and dialogs all use `uniformArt(kind, cls)`. History shows the item's current drawing, not an immutable artwork snapshot.
- New items start with zero stock for every size: dashed zero cells, inclusion in Out of stock, Update and hand-out choices. Update can supply stock before hand-out. Drawing choice never changes tracking; new items are shelf-counted even with the suit drawing.
- Managers alone see mutation actions. Hand out is the sole primary on Stock/Received; Record return is primary on Returns, with Hand out secondary. Dialog Save is primary while the page behind it is inert.

## Sample arithmetic and browser evidence

The initial shelf snapshot is **347** before sample returns. Four returns restore **5** shelf pieces and two suits, giving **352 shelf pieces**, **4 suit holders**, **11 recipients**, **14 hand-out records**, **4 return records**, and **3 out-of-stock sizes across 2 pieces**. Winter contributes **40** of the 352. Assertions validate references, sizes, integer quantities, newest-first order, no over-return at any point, shelf reconciliation, holder removal, the winter total and the two one-jacket hand-outs.

Real Chromium verification of the reduced catalog:

- **12 choices in 6 non-empty groups**. The default checked drawing is the first catalog entry, `suit`. All **12** choices were visited with native radio arrow keys in Arabic RTL. The metadata fallback also contains 12 choices and preserves `parka` in the winter jacket editor.
- The stock polo SVG matches the original default `uniformArt('polo')` after DOM parsing. Items have no artwork-override field; both Add item and Update have no extra artwork controls.
- Added Safety vest / سترة سلامة with drawing `vest`, one size and default quantity **1**. It started at **0**, then Update supplied **5**: shelf **352 → 357**. Hand-out **1** to G3194: item **5 → 4**, shelf **357 → 356**, holdings **1**. Return **1**: item **4 → 5**, shelf **356 → 357**, holdings **0**, return records **4 → 5**.
- Separate **390px Arabic RTL dark** run added a vest, stocked **3**, handed out **1** and returned **1**: shelf **352 → 355 → 354 → 355**, item **0 → 3 → 2 → 3**, holdings **0 → 1 → 0**. Received showed the employee's vest and hid the list while detail was open.
- Phone document width stayed **390px**, dialog width **388px**, with no page overflow. Drawing preview and editor selection retained `vest`. `tab.errors()` remained empty, including after a final reload against ArtCatalog's final script.

Earlier return/editor verification also exercised required names, quantity/size validation, empty and duplicate size rejection, suit-holder removal, bounded return quantities, no-match search, readonly action hiding, Retry, modal focus return, and Back focus restoration. Their original figures are superseded by the sample totals above.

## Bilingual review

A read-only reviewer followed `.codex/agents/i18n-rtl-reviewer.toml` against inline `T.en`/`T.ar`, data and catalog labels. Remaining drawing/edit/save strings match in both languages; removed controls leave no stale visible or accessible strings. Groups and tiles are labelled, IDs remain dialog-prefixed, CSS stays logical, and winter descriptions/records remain bilingual. The reviewer found that the fallback lacked five retained drawings; these were added with exact catalog labels. Follow-up review is clean.

## Design and final gates

Tasteskill v2 app-screen style **achromatic-ledger**, seed **2089055445**, with GSSG palette/type retained. No redraw. Stock asks which sizes are on the shelf, Received asks who received and still holds what, and Returns asks who returned what. The size ladder and fixed drawings are the product-specific signature. Navy remains on size data; actions/chrome are ink and grey. The original Assets hero band and dark tokens stay. Zeros print 0; missing/not-applicable values are grey `-`. G-numbers and sizes are isolated and upright in RTL.

Gates ran after ArtCatalog confirmed the final 12 drawings:

| Gate | English light | Arabic dark |
|---|---|---|
| Stock inspector, 1440 / 768 / 390 | 0 FAIL, 2 WARN | 0 FAIL, 0 WARN |
| Received inspector, 1440 / 768 / 390 | 0 FAIL, 2 WARN | 0 FAIL, 0 WARN |
| Returns inspector, 1440 / 768 / 390 | 0 FAIL, 3 WARN | 0 FAIL, 1 WARN |
| `lint.mjs --app mockups/plan/uniform/` | 0 FAIL, 6 WARN | Same source gate |

All **36** final inspector screenshots were opened as six labelled contact sheets. Reports/screenshots are under `/tmp/taste-uniform-fixed-{stock,received,returns}-{en,ar}/`, not committed.

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
| Formal suit | S, M, L, XL, XXL, XXXL; manager can add sizes |
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
