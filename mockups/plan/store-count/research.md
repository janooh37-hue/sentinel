# Store count — Phase 1 research and approval questions

Status: **proposal for approval; no production changes**. Scope is the gated brief in `.tmp/brief-store-count.md`. Phase 2 must not start until the parent sends approval. Existing drawn shapes, `art_kind`/`art_color`, blind-count rules and usage/request maths stay.

## Drawing labels and shelf text

Source of item identity, colour, unit and contents: `scripts/store_opening_2026-10-29.json` (13 items, 23 batches). Proposed labels reproduce the recorded brand *name*, not an authenticated logo or verified package photograph. No real packaging photographs were available. Please confirm exact printed capitalization/spelling, especially NESCAFÉ and the recorded “Lipton Red Label”; the JSON is not evidence of the actual pack's typography. Do not silently substitute a different tea brand.

Latin brands remain Latin in Arabic. Generic words translate. The adjacent item name remains the accessible name; drawings are decorative, never the only identifier. The final two columns are the short names **under** the drawing, not additional tiny text printed inside it.

| Current item | Printed drawing EN | Printed drawing AR UI | Short shelf name EN / AR | Separate pack line EN / AR |
|---|---|---|---|---|
| Nescafe Classic 190 g | NESCAFÉ · Classic | NESCAFÉ · Classic | Nescafe Classic / نسكافيه كلاسيك | 12 jars × 190 g / 12 مرطبانًا × 190 غ |
| Coffee-mate 400 g | Coffee-mate | Coffee-mate | Coffee-mate / كوفي ميت | 15 jars × 400 g / 15 مرطبانًا × 400 غ |
| Lipton Yellow Label tea 400 g | LIPTON · Yellow Label | LIPTON · Yellow Label | Lipton Yellow Label / ليبتون الأصفر | 24 boxes × 400 g / 24 علبة × 400 غ |
| Green tea | GREEN TEA | شاي أخضر | Green tea / شاي أخضر | Packet; size not recorded / علبة؛ الحجم غير مسجل |
| Lipton Red Label tea, 100 bags | LIPTON · Red Label | LIPTON · Red Label | Lipton Red Label / ليبتون الأحمر | 36 boxes × 100 bags / 36 علبة × 100 كيس |
| Rainbow milk 170 g | Rainbow | Rainbow | Rainbow milk / حليب رينبو | 96 tins × 170 g / 96 علبة × 170 غ |
| Liwa water | Liwa | Liwa | Liwa water / مياه ليوا | Carton; contents not recorded / كرتون؛ المحتويات غير مسجلة |
| Coffee cups, 40 per sleeve | CUPS | أكواب | Coffee cups / أكواب قهوة | 50 sleeves × 40 cups / 50 رزمة × 40 كوبًا |
| Big coffee cups | CUPS | أكواب | Large coffee cups / أكواب قهوة كبيرة | Carton; contents not recorded / كرتون؛ المحتويات غير مسجلة |
| Masafi café tissues, 150 sheets 2-ply | Masafi | Masafi | Masafi tissues / مناديل مسافي | 150 sheets · 2-ply; carton contents not recorded / 150 منديلًا · طبقتان؛ محتويات الكرتون غير مسجلة |
| Nitrile gloves | NITRILE | نتريل | Nitrile gloves / قفازات نتريل | Carton; contents not recorded / كرتون؛ المحتويات غير مسجلة |
| Vinyl gloves, 100 per box | VINYL | فينيل | Vinyl gloves / قفازات فينيل | 10 boxes × 100 gloves / 10 علب × 100 قفاز |
| Face masks, 3-ply blue | MASK | كمامة | Face masks / كمامات وجه | 3-ply; carton contents not recorded / 3 طبقات؛ محتويات الكرتون غير مسجلة |

### Scale and rendering contract

- Keep the incumbent SVG silhouettes/colours and light art backing in both themes. The proposal increases the labelled art's available space rather than shrinking long brands to fit old 48px icons.
- Shelf tiles at phone width use two columns with wrapping names and their own pack line; **no ellipsis, line-clamp or hidden name overflow**. Art label is a recognition cue, not a substitute for the full visible name.
- `LIPTON` and `Yellow Label`/`Red Label` use two lines. Coffee-mate stays one brand, not “CREAMER”; generic tea/milk/glove/mask words are not forced into English in Arabic UI. Rainbow/Liwa/Masafi replace generic or missing artwork labels where a brand is known.
- On focused count entry the larger drawing makes the same printing easier to inspect. At compact list/picker sizes the adjacent name and pack line carry legibility; do not squeeze multiple package details into tiny drawings.
- Dates/IDs and Latin brands use isolated LTR runs inside RTL. Neither the art nor the brand rotates/mirrors with the layout.
- No invented brands for green tea, cups, gloves or masks. No invented carton contents for the six items lacking `contains_qty`. Known inner sizes (150 tissues, three mask layers) do not imply a carton conversion.
- Exact CSS sizes and browser captures are documented in `verification.md`; tiny logo-subline readability is a review question, not a claim of packaging fidelity.

## Mobile references pulled through Mobbin MCP

Searches: “inventory stock counting”, “receiving goods delivery”, and a narrower “Shopify receiving inventory purchase order”, iOS, on 2026-11-02. All preview screens returned for these five flows were visually inspected. The narrower search repeated Shopify inventory/scanner results rather than returning a genuine warehouse purchase-order receipt. **These are analogous patterns, not examples of ADR-0009 blind counting or an exact warehouse receive-goods workflow.** No reference is evidence that our count should reveal availability. Stable Mobbin links below; expiring image URLs intentionally not used as citations or embedded assets.

| Flow and link | What the previews actually show | Borrow | Reject |
|---|---|---|---|
| [Shopify — Inventory](https://mobbin.com/flows/abc432e3-ee29-4b98-b03a-bb3eee40c098) · 3 screens | Product menu → inventory rows with thumbnails, quantities, All/Incoming filters | Recognizable object beside each row; clear current location | Availability totals and product-management menu complexity during a blind count |
| [Shopify — Inventory detail](https://mobbin.com/flows/dc2e69d0-3b01-43fe-8015-861d2d8ae65e) · 2 screens | Products landing → location-scoped mug variants with thumbnail and number | Identity stays visible at selection; contextual detail | Every variant displaying “99 available”; truncated product titles |
| [Shopify — Saving a product to inventory](https://mobbin.com/flows/6394a3fd-0534-4c84-a49c-aa9cbdddbb7c) · 3 screens | Scanner → scanned-items review → explicit Apply changes and saved feedback | Capture, review, then commit; separate reversible scanning from durable action | “Original: 100 (+1)” exposes expected stock; barcode scan is not delivery-note OCR |
| [Shop — Marking an order as delivered](https://mobbin.com/flows/e6c06e9f-26c9-476e-a3e5-d34c968eaa3d) · 3 screens | Tracking details → explicit Mark as delivered → completed status and undo | Clear verb and final state instead of a vague Save | Confetti, deals, consumer tracking and claiming receipt without checking each line |
| [Shopee — Order detail (to receive)](https://mobbin.com/flows/0be0bcad-1083-41b5-a5e5-4a9a554b08a0) · 3 screens | To Receive list, delivered state, order details with bottom Order Received action | Bottom action after identifiable goods/details; state distinct from final confirmation | Shopping recommendations, prices, cramped tabs and truncation; not warehouse receiving |

The mockup translates these patterns into **identify → count physical stock → review missing batches → record**, and **select note → correct/confirm every proposed line → record and attach**. It does not copy their stock numbers, commercial decoration or paperless receipt assumptions.

## Proposed count interaction (approval required)

A single item at a time, all its expiry batches together. Match physical shelf order by category then existing drawing-kind/name ordering. Progress explicitly counts batches (23 initially) separately from items (13); do not call 18/23 “items”. Show drawing, short name and pack before asking for full cartons and loose jars/boxes/tins/sleeves. Unknown contents means whole recorded units only. Empty is uncounted; an explicit zero means checked and none found. Review shows uncounted drawings/expiry and a direct return to that entry; recording cannot silently fill zeros. Newly found expiry batches can be added. All submitted numbers must be operator-entered; no system/previous balances or suggestions, even in review.

The static prototype demonstrates a **same-browser/device local draft**, not a delivered server draft or cross-device/offline guarantee. Production storage, user isolation, retention, changed-date handling and concurrent-tab behavior require approval/design before Phase 2. Do not store opening-stock quantities as count defaults. Monthly uniqueness and all existing backend checks remain authoritative; stale batch discovery needs an actionable return to the uncounted review, never a leaked `STORE_COUNT_MISSING_BATCHES` code.

## Approval questions for parent/user

1. **Count structure:** approve the focused per-item flow (all that item's expiries together), or prefer one expiry/batch per phone screen? The former preserves product context; the latter reduces long Coffee-mate pages (9 batches) but adds navigation. Desktop keeps a visible item navigator.
2. **Interrupted count:** is this-device/browser recovery sufficient, or must the operator resume on another device/account? Proposed mockup demonstrates this-device recovery only; shared devices need account-scoped storage and explicit clearing/retention policy. No persistence architecture is approved yet.
3. **Brand truth:** confirm exact real-package spelling/variant for all branded labels, particularly “Lipton Red Label”, NESCAFÉ and Coffee-mate. Supply a shelf/package photograph or correct the proposal; no generated brand artwork is proposed.
4. **New-item picture:** should new items remain drawing-only, or may an optional custom picture also be uploaded? This is explicitly undecided. The mockup offers drawing kind/colour and bilingual printed labels only, without pre-deciding an upload feature.
5. **Unknown packs:** can the storekeeper confirm carton contents for green tea, Liwa water, large cups, Masafi tissues, nitrile gloves and masks? Until recorded, count only their existing counting units; do not invent loose conversions.
6. **Approval gate:** approve or annotate the mockup and bilingual labels after the phone think-aloud. Phase 1 completion is not approval to build, push, merge, publish or deploy.
7. **Delivery-note evidence:** existing delivery creation and attachment are separate steps, with “finish without file”. Should a failed attachment leave a visibly incomplete delivery with retry, or block completion until the file is attached? The fixed requirement says the scan stays attached; do not quietly retain the weaker behavior.
8. **Receipt review:** the mockup proposes an explicit Confirm action per line. Approve that, or prefer a final all-lines review gate? Existing validation alone is not evidence the operator checked every proposed line.
