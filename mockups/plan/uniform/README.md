# Assets → Uniform (الملابس): approval mockup

**Do not build or deploy this yet.** Static HTML for approval only: no backend, API client, persistent storage or frontend build. All employees, G-numbers, quantities and dates in `data.js` are invented sample data. Changes last only until reload.

## Open and preview

The worktree is served at `http://127.0.0.1:8941/mockups/plan/uniform/index.html`. To serve it yourself, run `python -m http.server 8941 --bind 127.0.0.1` from this worktree. Fonts load from `../store-count/`; leave that folder in place.

- `index.html`: screen, bilingual strings, dialogs and in-memory interactions.
- `data.js`: stock, employees, hand-outs, returns, derived totals and consistency assertions.
- `art.js`: fixed SVG drawings and the bilingual `UNIFORM_ART_KINDS` drawing catalog.

| View | Query |
|---|---|
| Stock, store manager | `?tab=stock&view=edit` |
| Received | `?tab=received` |
| Person detail (only region shown on phone) | `?tab=received&person=G3105` |
| Returns | `?tab=returns` |
| Return detail | `?tab=returns&return=T-0004` |
| Hand-out form | `?view=edit&give=1` |
| Record return form | `?tab=returns&view=edit&returnForm=1` |
| Edit quantities, drawing and colour | `?view=edit&edit=cargo` |
| Edit suit drawing/colour or add a size (no shelf counts) | `?view=edit&edit=suit` |
| Add item | `?tab=stock&view=edit&addItem=1` |
| View only: no mutation actions | `?view=readonly` |
| Loading / load failed, on any tab | `?view=loading`, `?view=error` |

Append `&lang=ar` and/or `&theme=dark` to any query. The mockup toolbar also switches these views.

## Decisions (2026-11-03)

- Assets has a **Uniform / الملابس** section beside **Store / المخزن**, with **Stock / الرصيد**, **Received / المستلمون** and **Returns / المرتجعات** sub-tabs. Existing Arabic return terms in the app refer to leave or document workflows, not returned goods; المرتجعات is used here.
- **Belt and cap are one size**, shelf balances 48 and 42. Every historical line uses `size: 'one'`. Their hand-out choices remain **None / بدون** and **One size / مقاس موحد**.
- **Formal footwear has been removed** from the sample stock and history. The fixed shoe drawing remains available for creating a different item.
- Guard pieces: olive logo polo, khaki cargo trousers, brown belt, tan field boots, khaki logo cap and khaki socks (pairs).
- A formal suit is blazer, trousers and white shirt as one piece. It has sizes but **no shelf quantity**. Holder chips are derived from current holdings, not just the latest hand-out. A person remains a holder until all their suits are returned.
- Shelf and holder totals, out-of-stock sizes, received counts and return counts are computed from rows.
- **Hand out uniform / صرف ملابس:** shared employee search by name or G-number; a None option on every piece; defaults belt/cap/winter pieces 1, socks and other pieces 2; signed-in giver and today's date recorded automatically. Saving subtracts shelf stock and adds a hand-out. Unavailable sizes cannot be chosen. Save explains why it is disabled.
- **Record return / تسجيل إرجاع:** only employees currently holding something are searchable. The form lists every held piece and size, drawing, held quantity, and a 0-to-held stepper starting at 0. Save is disabled until an employee and a positive quantity are chosen. Signed-in receiver and today's date are automatic. Saving adds a newest-first return record and restores stock quantities; suits affect holders, not shelf stock.
- For this approval model **all returned stock is reusable and goes straight back onto the shelf**. This is a question for approval below, not a production policy.
- Received details show **Currently holds**, every hand-out and clearly labelled returns. Both Received and Returns use a list plus sticky detail on desktop and one region at a time below 1000px, with Back and focus restoration.
- **Add size:** stock Update dialogs accept an additional size with an initial quantity of 0. Empty and case-insensitive duplicate values show inline errors. Changes are staged until Save; Cancel discards them. One-size pieces cannot add sizes. Suits use the same Update action for sizes and artwork, but never show quantity fields.
- **Add item:** store-manager secondary action on Stock. English and Arabic names are required; descriptions are optional in both languages; group is Formal, Guard uniform or Winter uniform; default hand-out quantity is a positive whole number. Letter, shoe, waist and one-size presets can be edited by adding/removing sizes. At least one size is required. Errors sit beside their fields.
- **Choose and customise clothing:** fixed silhouettes from `UNIFORM_ART_KINDS`, grouped by bilingual `UNIFORM_ART_GROUPS` headings. The 29-kind catalog covers shirts/knitwear, jackets/workwear, trousers/shorts, headwear, footwear and accessories. The compact tile grid scrolls inside the dialog; native radio arrows work across groups, each with an accessible group name. A sticky **88px live preview** stays visible while selecting colours. New items default to `generic`; there is no upload or shape editor.
- **Colour:** nine named fabric presets (navy, olive, khaki, tan, black, charcoal grey, white, brown, maroon), the selected drawing's original/default swatch, and a custom HTML colour input. Every choice has an English/Arabic name; the preview announces the colour, and custom hex text is LTR-isolated. Empty `artColor` means the original drawing colour; choosing a preset/custom colour saves its hex value. Only main fabric changes; badges, metal and safety details keep their fixed colours.
- **Existing items, including suits:** Update now includes the same drawing and colour picker as Add item. Save applies staged artwork with quantity/size edits; Cancel discards all edits. Every item drawing in stock, out-of-stock summary, hand-out, returns, Received, holdings and dialogs passes `item.artColor`. History deliberately shows the item's current illustration, not an immutable artwork snapshot.
- **Sample winter stock:** Winter uniform / الزي الشتوي contains a `parka` winter jacket, a `fleece` jacket and a one-size `beanie`. These are approval samples, not confirmed inventory. All default to one piece per hand-out. Initial shelf balances total **40 + 48 + 32 = 120**. Two sample hand-outs give G3105 and G3117 one of each, six pieces altogether; the displayed shelf counts already reflect those hand-outs.
- Saving an item gives it zero stock for every size: dashed zero cells, inclusion in Out of stock, an Update action and hand-out choices. Update can then supply stock and the piece can be handed out normally. Drawing choice does not change tracking: newly added pieces are shelf-counted, even with the suit drawing.
- Managers alone see Add item, Update, Add size, Hand out and Record return. Hand out is the sole primary on Stock and Received; Record return is primary on Returns, with Hand out secondary. Dialog Save becomes the primary while the page behind is inert.

## Sample arithmetic and browser verification

The sample shelf snapshot is **427 pieces before returns**. Four sample returns restore 5 stock pieces and two suits: the page opens with **432 shelf pieces**, **4 suit holders**, **11 recipients**, **14 hand-out records**, **4 return records**, and **3 out-of-stock sizes across 2 pieces**. Winter contributes **120** of the 432 shelf pieces. Data assertions validate record references/sizes, positive integer quantities, chronological order, no over-return at any point, shelf reconciliation, holder removal, winter shelf totals and winter hand-outs/holdings.

### Current clothing and colour round

Real Chromium interactions verified:

- The picker shows **29 drawing radios in 6 bilingual groups**, with a **340px** scroll viewport. Selection updates the 88px preview.
- Recoloured the polo to maroon **`#743b46`** through Update. Stock, hand-out, Received/current holdings and a sample return detail all used that colour; polo quantity remained **65**, shelf **432**.
- Created Custom hoodie / كنزة مخصصة بغطاء رأس, `hoodie` drawing, custom **`#387d7a`**, one size, default quantity 1. Its zero-stock drawing matched in the stock table and out-of-stock summary. Update supplied **6**: shelf **432 → 438**. Handed out **1** to G3194: hoodie **6 → 5**, shelf **438 → 437**, current holdings **1**, matching custom colour in hand-out and both Received summary/history drawings. Returned **1**: hoodie **5 → 6**, shelf **437 → 438**, colour retained in return form/detail.
- At **390px Arabic RTL dark**, native radio arrows visited **all 29 drawings** and changed the preview; preset/custom colours updated live. Six drawing groups were labelled, document width stayed **390px**, dialog width **388px**. Cancel restored the unmodified polo/default colour and returned focus. Suits could change drawing to `blazer` and colour to charcoal **`#55585b`** with **4** holders and shelf **432** unchanged.
- A separate Arabic phone Add item run saved a `hoodie` at **`#387d7a`**, stocked **4** and handed out **1**: shelf **432 → 436 → 435**, item **4 → 3**, Received/current holdings **1** and custom colour retained, no page overflow. Switching to Drawing default restored hoodie **`#72777d`** in both preview and colour input; switching back to custom updated both correctly.
- `tab.errors()` was empty throughout the colour/lifecycle and Arabic phone checks.

### Previous return/editor round

These checks were run before adding the 120 sample winter shelf pieces; their original baseline of 312 is retained to distinguish the evidence from the current 432 baseline:

- Belt: one ladder cell, 48. Cap: one ladder cell, 42. Removed stock item absent from data/history; hand-out belt toggles are `none` and `one`.
- G3222 held two L polos. Returned 2: polo L **22 → 24**, shelf **312 → 314**, return records **4 → 5**, current polo holdings **2 → 0**. Received detail shows the return separately from the original hand-out.
- G3082 returned both held L suits: holder count **4 → 3**, no remaining suit holdings, shelf unchanged at **314**.
- Polo Update rejected an empty size and duplicate `l`; added `4XL` at **0**, set it to **3**, then saved: shelf **314 → 317**. Suit Add size also accepted `4XL`. Belt Update had no Add size control.
- Added bilingual Winter jacket / سترة شتوية, drawing `jacket`, one size, default quantity 2. Initially stock **0** and listed out of stock. Update to **5** raised shelf **317 → 322**. Handed out **2** to G3194: jacket stock **5 → 3**, shelf **322 → 320**, current holdings **2**, giver G2741 and date 2026-11-03.
- Save validation for both required names, return disabled reason, search by G-number, no-match list, readonly mutation hiding and Retry were exercised. Modal focus returns to the opener after close.
- At **390px Arabic RTL dark**, Returns list/detail/Back, return picker and save, and Add item fields/drawing preview were exercised. Document width stayed **390px**, dialog width **388px**, and only one list/detail region was visible. `tab.errors()` remained empty.
- Follow-up Arabic checks: returning 99 was clamped to the employee's **2** held suits; an unmatched Received search showed **0 شخص**. Opening Hand out then Return produced **0 duplicate IDs** and return search `aria-controls` resolved to `return-picker-results`. Add item rejected default quantity **0** and an empty size list.

### Bilingual review

A read-only reviewer followed `.codex/agents/i18n-rtl-reviewer.toml` against inline `T.en`/`T.ar`, data and catalog labels. All eight findings were fixed: unique picker IDs across retained dialogs, no repeated picker labels, escaped and isolated multi-size suit holdings with locale commas, piece-and-size stepper accessible names, singular Return / إرجاع history labels, singular Arabic zero counts, matching bilingual fallback catalog labels, and noun parity in Holds counts. Follow-up review found no remaining i18n or RTL issues. The fallback catalog stays because this approval brief explicitly requires it.
The clothing/colour round received a fresh review with five findings, all fixed: Update's spoken name includes its visible label; live previews name the selected colour; the custom input has its own distinct label; drawing groups are programmatically labelled; fleece/beanie Arabic describes synthetic fleece/knitting rather than unconfirmed wool. The saved toast now refers to item data, not only quantities. Follow-up review found no remaining issues.



## Design and gates

Tasteskill v2 app-screen style **achromatic-ledger**, seed **2089055445**, with GSSG palette/type retained. No redraw. The screen questions are: which sizes are on the shelf; who received what and still holds it; and who returned what? The size ladder and fixed uniform drawings are the product-specific signature. Navy is on size data; actions and chrome are ink/grey. The app's original Assets hero gradient and dark palette remain unchanged. Zeros are printed 0; missing/not-applicable values are grey `-`. G-numbers and size tokens stay isolated and upright in RTL.

Final clothing-round gates ran after ArtCatalog confirmed all **29 drawings** and colour support were final:

| Gate | English light | Arabic dark |
|---|---|---|
| Stock inspector, 1440 / 768 / 390 | 0 FAIL, 2 WARN | 0 FAIL, 0 WARN |
| Received inspector, 1440 / 768 / 390 | 0 FAIL, 2 WARN | 0 FAIL, 0 WARN |
| Returns inspector, 1440 / 768 / 390 | 0 FAIL, 3 WARN | 0 FAIL, 1 WARN |
| `lint.mjs --app mockups/plan/uniform/` | 0 FAIL, 6 WARN | Same source gate |

All 36 final clothing-round inspector screenshots (fold and page sheets, every viewport and locale) were opened as six labelled contact sheets. Reports/screenshots are under `/tmp/taste-uniform-clothing-{stock,received,returns}-{en,ar}/`, not committed.

Warnings deliberately retained:

| Rule | Reason |
|---|---|
| `micro-label` / lint `eyebrow` | The single Assets context label is inherited from StoreShell. |
| `palette-cream` | `#f5f4f1` is the real app background. |
| `ragged-row` on Received / Returns | A sticky, independently scrolling detail pane is intentionally shorter than its adjacent master list. |
| lint `shadow` | Only floating dialogs and toast have shadows. |
| lint `numbering` | `padStart` builds hex color values, not numbered decoration. |
| Allowed `gradient` | The existing app Assets hero band is retained. |

Visual critique: the largest regions answer each ledger question, left/right edges align, numeric totals reconcile and data hue is limited to size cells. Both list/detail screens retain their detail independently rather than stretching short content. Phone lists remain readable, keep all fields and push detail instead of squeezing two regions; seasonal stock extends the ledger rather than adding dashboard tiles. The compact drawing grid has labelled groups, native radio keyboard navigation and its own scroll; the 88px preview remains visible above the colour controls. Swatch colours are literal fabric choices, not decorative chrome or status hues. The long stock ledger naturally continues below the fold; the summary and first stock row remain visible. No photographs are used: the uniform drawings are fixed approval illustrations, not product photography.

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
| Fleece jacket (sample) | S, M, L, XL, XXL, XXXL |
| Beanie (sample) | One size |

## Questions before the real build

1. Are the size lists above right, and should manually entered size labels have business-specific restrictions?
2. Are returned pieces always fit to go back on the shelf, or is a **damaged / not reusable** option needed?
3. Is direct per-size quantity Update enough for stock arriving from HQ, or should receipts have dates and audit records too?
4. Should permissions reuse `store.view` / `store.edit`, or be uniform-specific?
5. Should zero-stock sizes also have a configurable low-stock threshold?
6. Is the default of 2 correct for a formal suit?
7. Should current holdings and history also appear in the employee file?
8. Should a new item always be shelf-counted as shown here, or should managers be able to create other holder-tracked items?
9. Confirm the three sample winter items, their quantities, sizes and default of 1, and the nine named colour presets plus drawing default. Should the real system permit any custom colour or only approved uniform colours?
