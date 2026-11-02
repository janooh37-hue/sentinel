# Store count — approval mockup (Phase 1)

**Do not build or deploy this yet.** This is the gated research/mockup deliverable for `.tmp/brief-store-count.md`, not approved production code. Phase 2 starts only after the parent sends approval. Existing `StoreItemArt` geometry/colours remain; proposed labels are layered on top. No generated illustrations or photographs replace the item drawings.

## Open

From this worktree:

```sh
python -m http.server 8931 --bind 127.0.0.1
```

Open `http://127.0.0.1:8931/mockups/plan/store-count/index.html`. Stop with Ctrl-C. This is local-only; the parent owns any laptop dev publication. The prototype has no API client, requires no frontend build, and bundles Inter/Noto Sans Arabic fonts with their licenses so it works without external font requests. Keep `index.html`, `style.css`, `app.js` and bundled font assets together.

Use browser responsive view at **390 × 844** and **1440 × 1000**. All screens support English/Arabic and light/dark, controlled at the top or in query parameters. The root language/direction changes, but Latin package brands do not mirror or transliterate on the drawing.

## Review links

Append these query strings to `index.html`:

| Screen | Query |
|---|---|
| Start/resume blind count | `?screen=count&lang=ar&theme=light` |
| Active item, phone | `?screen=count&step=count&item=ST-0001&lang=ar&theme=light` |
| Nine-expiry Coffee-mate case | `?screen=count&step=count&item=ST-0002&lang=en&theme=dark` |
| Uncounted review | `?screen=count&step=review&lang=ar&theme=dark` |
| Draft save unavailable | `?screen=count&step=count&storage=fail&lang=en&theme=light` |
| Shelf labels / all 13 items | `?screen=shelf&lang=ar&theme=dark` |
| Items | `?screen=items&lang=en&theme=light` |
| Add-item drawing/label proposal | `?screen=items&view=add&lang=ar&theme=light` |
| Receive / attach note | `?screen=deliveries&lang=ar&theme=light` |
| Illustrative confirmation (no real OCR) | `?screen=deliveries&delivery=confirm&lang=en&theme=light` |
| Empty manual receiving path | `?screen=deliveries&delivery=manual&lang=ar&theme=dark` |
| Drawing-first disposal picker | `?screen=disposals&lang=ar&theme=light` |
| Disposal item / batch entry | `?screen=disposals&item=ST-0011&lang=en&theme=dark` |
| Dashboard-style widget/picker reference | `?screen=home&lang=ar&theme=light` |

Deep links select a view, never populate count quantities or record real stock. Opening count entry from an item intentionally creates a **demo browser draft**, not a server count. Count progress distinguishes 13 items from 23 original expiry batches; added batches change the latter denominator. Brand/pack identity comes from the real opening data, **not its quantities**. Month-only expiry is shown as the month's final date, explicitly labelled.

## What to evaluate

1. Can the operator recognize the actual package from its existing silhouette/colour and proposed printing? Check all 13 shelf tiles, not only coffee. Names wrap fully and pack facts have their own small line; unknown carton contents remain unknown.
2. Does focused item counting explain the physical task immediately? Count each expiry separately. Blank is uncounted; explicit zero is checked-none. Review lists uncounted drawings/expiry with a direct return to the batch before simulated submission.
3. Enter a partial count, leave/return and reload: only the operator's own draft should resume. `storage=fail` shows failure rather than a false saved state. This is **same browser/device only**, not approved server/cross-device/offline architecture.
4. On Deliveries, attach a harmless local image/PDF or use manual entry. Illustrative scan lines are explicitly synthetic, not OCR output from the chosen document. Correct and confirm every retained line; no unmatched line auto-saves. Compare the identity/drawing treatment with existing scan correction features documented in `critique.md`.
5. On Items, try drawing kind/colour and both printed labels. Brands stay Latin on the drawing; generic labels translate. Optional custom picture upload remains a question, not an implicit product decision.
6. On Disposals, choose the physical item by drawing, then its expiry, quantity and reason. No real availability check or disposal occurs in this static demo.

## Notes and evidence

- [`critique.md`](critique.md): independent current-app critique, actual scratch runtime observations, blind API and OCR reuse audit, limitations.
- [`research.md`](research.md): 13-item EN/AR printed-label/short-name/pack proposal, five Mobbin flow links with exact relevance limits, approval questions.
- [`think-aloud.md`](think-aloud.md): four-task phone script for the user to run with the storekeeper on the existing laptop dev URL. **Not yet run.**
- [`verification.md`](verification.md): exercised mockup behavior, capture matrix, review resolutions and known limits.

The compact Home reference is an **illustrative WidgetFrame-style comparison**, not a replacement for the real Dashboard. Actual scratch home Dashboard captures are indexed in verification notes for side-by-side comparison.

The shelf gallery is the requested **drawing/name/pack recognition study**, not a full replacement dashboard. It deliberately does not invent live stock balances or alert flags. Phase 2 must retain existing on-hand quantities, plain-word stock/expiry statuses, filters and handover actions outside the blind count; this mockup does not authorize removing them. Only the counting flow must conceal system/previous quantities.

## Gate and ownership

Commit only on `feat/store-count`; no push, PR, merge, promotion or deployment. The parent merges into `feat/store-room` and publishes only after approval. No model/migration/API contract changes were made. Phase 2 must preserve ledger/usage/suggestion maths and the blind expected-batches API, and complete the build/test/reviewer criteria in the brief.

Approval questions include exact real package spelling (especially recorded Lipton Red Label), focus per item versus per batch, draft device/account scope, the six unknown pack conversions, optional custom pictures, and delivery attachment/review failure policy. See `research.md` rather than treating the mockup's demonstration choices as approvals.
