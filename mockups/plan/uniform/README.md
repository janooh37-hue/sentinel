# Assets → Uniform (الملابس): approval mockup

**Do not build or deploy this yet.** This is a static mockup for approval. It has no API client, saves nothing and needs no frontend build. Every quantity on it is sample data from `data.js`, not real stock.

## Open

From this worktree:

```sh
python -m http.server 8941 --bind 127.0.0.1
```

Open `http://127.0.0.1:8941/mockups/plan/uniform/index.html`. The page loads its fonts from `../store-count/`, so keep both folders together. The files are:

- `index.html`: the screen.
- `data.js`: the sample stock and its consistency checks.
- `art.js`: the fixed drawings.

The bar at the top switches language, theme and preview:

| Preview | Query |
|---|---|
| Store manager (can update) | `?view=edit` |
| View only (no update actions) | `?view=readonly` |
| Loading | `?view=loading` |
| Load failed | `?view=error` |
| Quantity editor open | `?view=edit&edit=cargo` |

Add `&lang=ar` or `&theme=dark` to any of them.

## Decisions taken from the user (2026-11-03)

- A new Assets section tab, **Uniform / الملابس**, next to **Store / المخزن**.
- It tracks **store-room stock**, not per-employee issue.
- It is **simpler than Store**: one screen with no sub-tabs.
- There are two uniform types, taken from the reference photo:
  - **Formal suit / البدلة الرسمية:** one whole unit made of the navy blazer, navy trousers and white shirt. The black formal shoes are tracked separately.
  - **Guard uniform / زي الحراسة:** counted piece by piece. The pieces are the olive polo, khaki cargo trousers, brown belt, tan boots, **khaki** cap and khaki socks.
- **Summary totals:** "Total pieces", where a suit counts as one piece, and "Full suits", which is the only set count.
- **Drawings** are fixed and code-drawn, in the `StoreItemArt` frame and flat style. There is no shape, colour or label picker.

## Design (tasteskill v2, app-screen run)

Design rules follow the `design-taste-frontend` skill (Leonxlnx/taste-skill v2), using its app-screen run. The app's own palette and type are kept (`--keep palette,type`).

- **Style dealt:** `achromatic-ledger`, seed 2089055445. It was chosen over `framed-sheet` because stock counts are a ledger, and the style keeps colour off the chrome, matching PRODUCT.md's "restraint over decoration".
- **The screen's question:** which sizes of each piece are on the shelf? The size ladder answers it and is the largest element.
- **The finding** under the title is computed from the rows: how many sizes are out of stock, across how many pieces.
- **The face:** GSSG navy is the one data colour. It shades each size cell by its share of that piece's largest size. Everything else is ink and grey.
- **The signature element:** the uniform drawings beside a size ladder for each piece. Zero sizes are dashed empty slots with a printed 0.
- **The summary** is one panel split by dividers: total pieces, full suits, and the out-of-stock list.
- **States built:** loading (flat bars at their real size), load failed (inside the block, with Retry), and view-only (no update actions). The editor has labels above its fields, a live total, and returns focus to the row after saving.
- **Phone:** each piece becomes two lines, with the ladder on the second. The summary becomes a 2-column grid with the out-of-stock list at full width.
- **RTL:** the ladder mirrors, so the smallest size is at the reading start in both languages. The out-of-stock list uses the Arabic comma.

### Gate results

- `lint.mjs --app`: 0 FAIL.
- `inspect.mjs --app --allow gradient`: 0 FAIL at 1440, 768 and 390. English light has two WARNs, listed below; Arabic dark has 0 WARN.

The lint warnings are all defensible:

- **Shadows:** only on the dialog and toast, which float.
- **Zero-padding:** it builds hex colours, not index numbers.
- **Eyebrow:** the app's own Assets section label.

These items are kept on purpose because they are GSSG brand chrome shared with the Store tab:

| Rule | Why it stays |
|---|---|
| `gradient` | The Assets band is the app's real `--hero-grad` (`frontend/src/index.css`). The Uniform tab must sit under the same band as Store. |
| `micro-label` | The uppercase "Assets" section label comes from `StoreShell`. App screens allow one such context label. |
| `palette-cream` | `#f5f4f1` is the app's real light `--background`. |
| navy dark theme | The app's dark tokens (`#0a0e18`, `#131826`) are kept so the tab matches the rest of the app. |

## Proposed sizes (need approval)

| Piece | Sizes |
|---|---|
| Formal suit | S, M, L, XL, XXL, XXXL |
| Formal shoes | EU 38–47 |
| Polo shirt | S, M, L, XL, XXL, XXXL |
| Cargo trousers | Waist 28–44 (even sizes) |
| Belt | S, M, L, XL |
| Field boots | EU 38–47 |
| Cap | S, M, L |
| Socks | One size (pairs) |

## Questions before the real build

1. Are the size lists above right?
2. Should "Total pieces" include formal suits (counted as 1 each), or only loose pieces?
3. Is a direct "set the quantity per size" editor enough? Or should the page also record **received** and **handed out** movements with dates?
4. Permissions: reuse `store.view` / `store.edit`, or add separate uniform permissions?
5. The out-of-stock list shows sizes at zero. Should there also be a minimum per size ("low" before it reaches zero)?
