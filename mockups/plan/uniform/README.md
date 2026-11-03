# Assets → Uniform (الملابس) — approval mockup

**Do not build or deploy this yet.** This is a static mockup for approval. It has no API client, saves nothing and needs no frontend build. The quantities on the page are sample numbers, not real stock.

## Open

From this worktree:

```sh
python -m http.server 8941 --bind 127.0.0.1
```

Open `http://127.0.0.1:8941/mockups/plan/uniform/index.html`. It loads its fonts from `../store-count/`, so keep both folders together.

| View | Query |
|---|---|
| English, light | `?lang=en&theme=light` |
| Arabic, dark | `?lang=ar&theme=dark` |
| Quantity editor open | `?lang=ar&theme=light&edit=cargo` |

Check it at **390 × 844** and **1440 × 1000**.

## Decisions taken from the user (2026-11-03)

- A new Assets section tab, **Uniform / الملابس**, next to **Store / المخزن**.
- It tracks **store-room stock**, not per-employee issue.
- It is **simpler than Store**: one page with no sub-tabs. Each piece shows its stock by size, and choosing a piece opens a size-by-size quantity editor.
- There are two uniform types, taken from the reference photo:
  - **Formal suit / البدلة الرسمية:** one whole unit made of the navy blazer, navy trousers and white shirt. The **black formal shoes** are tracked separately, because the user excluded shoes from the suit.
  - **Guard uniform / زي الحراسة:** counted piece by piece. The pieces are the olive polo with logo, khaki cargo trousers, brown belt with silver buckle, tan lace-up field boots, olive baseball cap with logo, and khaki socks.
- There are two summary totals:
  - **Total pieces:** a suit counts as one piece.
  - **Full suits:** the suit is the only full-set count.
- The drawings are **fixed and code-drawn**, in the same flat SVG style and frame as `StoreItemArt` (viewBox `20 20 80 90`, floor shadow, `#fafaf6` art surface). There is **no** shape, colour or label picker. They are shown at 88px, slightly smaller than Store's 104px shelf drawings.

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
5. Should there be a low-stock alert per size (a minimum quantity)?
