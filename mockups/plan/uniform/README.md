# Assets → Uniform (الملابس): approval mockup

**Do not build or deploy this yet.** This is a static mockup for approval. It has no API client, saves nothing and needs no frontend build. Every person, G-number, quantity and date on it is sample data from `data.js`.

## Open

From this worktree:

```sh
python -m http.server 8941 --bind 127.0.0.1
```

Open `http://127.0.0.1:8941/mockups/plan/uniform/index.html`. The page loads its fonts from `../store-count/`, so keep both folders together. The files are:

- `index.html`: the screen.
- `data.js`: the sample employees, stock and hand-out records, with their consistency checks.
- `art.js`: the fixed drawings.

The bar at the top switches language, theme and preview:

| View | Query |
|---|---|
| Stock tab, store manager | `?tab=stock&view=edit` |
| Received tab | `?tab=received` |
| One person's record (phone shows only this) | `?tab=received&person=G3105` |
| Hand-out form open | `?view=edit&give=1` |
| Quantity editor open | `?view=edit&edit=cargo` |
| View only (no Hand out, no Update) | `?view=readonly` |
| Loading / load failed | `?view=loading`, `?view=error` |

Add `&lang=ar` or `&theme=dark` to any of them.

## Decisions taken from the user (2026-11-03)

- **The tab:** a new Assets section tab, **Uniform / الملابس**, next to **Store / المخزن**. It has two sub-tabs, **Stock / الرصيد** and **Received / المستلمون**.
- **Guard uniform / زي الحراسة:** store-room stock counted by size, piece by piece. The pieces are:
  - olive polo with logo
  - khaki cargo trousers
  - brown belt
  - tan boots
  - khaki cap with logo
  - khaki socks
- **Formal suit / البدلة الرسمية:** a blazer, trousers and white shirt, given as one unit.
  - **Tracked by holder, not on the shelf.** Fewer than about 50 employees hold one, so the Stock tab lists holders by G-number and size instead of counting suits.
  - **Black formal shoes are separate:** they're still counted on the shelf by size.
- **Summary:** shows pieces on the shelf (suits are excluded), the number of suit holders, and which sizes are out of stock.
- **Hand out uniform / صرف ملابس:**
  - **Employee:** chosen with a search by name or G-number, as in the app's employee lookup.
  - **Sizes:** each piece has a size toggle, where **None / بدون** means it isn't given.
  - **Quantities** start at these defaults: belt 1, cap 1, socks 2, every other piece 2.
  - **Giver:** the signed-in user is recorded automatically.
  - **What saving does:** it lowers the shelf stock (not suits), adds the record, and makes the employee a suit holder when a suit was given.
- **Received tab:** lists everyone who has received uniform. Choosing a person shows every hand-out with its date, giver, pieces, sizes and quantities.
- **Drawings:** fixed and code-drawn, in the `StoreItemArt` frame and flat style. There's no shape, colour or label picker.

## Design (tasteskill v2, app-screen run)

Design rules follow the `design-taste-frontend` skill (Leonxlnx/taste-skill v2), using its app-screen run. The app's own palette and type are kept (`--keep palette,type`).

- **Style dealt:** `achromatic-ledger`, seed 2089055445. It was chosen over `framed-sheet` because stock and hand-outs are a ledger, and the style keeps colour off the chrome (PRODUCT.md: "restraint over decoration").
- **The screens' questions:**
  - Stock: which sizes of each piece are on the shelf?
  - Received: who has received what?
  - In each case the largest element answers it: the size ladder, and the people list.
- **The finding** under the title is computed from the rows. On Stock it is the sizes out of stock; on Received it is how many people have received uniform and the date of the latest hand-out.
- **The face:** GSSG navy is the one data colour, on the size cells only. Everything else is ink and grey.
- **The main job is one click away.** The **Hand out uniform** button is the screen's only primary action, and only store managers see it. The Save button stays disabled until an employee and at least one size are chosen, and the reason is shown next to it. Sizes with none left can't be chosen, and quantities can't go above what's on the shelf.
- **Received tab layout:** the list and the selected person sit side by side, and the person panel is sticky. Below 1000px only one shows at a time, with a back button, and focus moves to the person's name and back to their row.
- **States built:** loading (flat bars at their real size), load failed (inside the block, with Retry), and view-only (no Hand out and no Update).
- **RTL:** the ladder and size toggles mirror. G-numbers and size labels stay upright inside Arabic text. Lists use the Arabic comma.

### Gate results

- `lint.mjs --app`: 0 FAIL.
- `inspect.mjs --app --allow gradient`: 0 FAIL at 1440, 768 and 390, on both tabs, in English light and Arabic dark.

The remaining warnings can each be defended:

| Rule | Why it stays |
|---|---|
| `gradient` | The Assets band is the app's real `--hero-grad` (`frontend/src/index.css`). The Uniform tab must sit under the same band as Store. |
| `micro-label` | The uppercase "Assets" section label comes from `StoreShell`. App screens allow one such context label. |
| `palette-cream` | `#f5f4f1` is the app's real light `--background`. |
| `ragged-row` (Received) | The person panel is a sticky detail pane beside a long list. It follows the scroll, so it's meant to be shorter. |
| lint `shadow` | The shadows are only on the dialogs and the toast, which float. |
| lint `numbering` | The zero-padding builds hex colours, not index numbers. |
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
2. Is a direct "set the quantity per size" editor enough for stock arriving from HQ? Or should receiving be recorded with dates too?
3. Permissions: reuse `store.view` / `store.edit`, or add separate uniform permissions?
4. The out-of-stock list shows sizes at zero. Should there also be a minimum per size ("low" before it reaches zero)?
5. The mockup applies the "2" default to the suit and formal shoes as well (they fall under "all other"). Is that right?
6. Should an employee's received uniform also appear on their employee file, or only in this tab?
