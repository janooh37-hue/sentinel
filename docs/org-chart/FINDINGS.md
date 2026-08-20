# Reverse‑Engineering Findings — Ahlan Hamad Org Chart ("Shajarah")

**Target:** `https://ahlanhamad.com/en/org-chart`
**Date:** 2026‑08‑20
**Scope:** Authorized read of the user's own authenticated tenant (public marketing site + own account data). Read‑only browser rendering and passive network observation. No intrusion, no exploitation, no writes to the live tenant.
**Method (js‑reverse):** Observe → Capture → Rebuild, using a real Chromium instance (CDP) for rendering, network capture, DOM inspection, and static analysis of the shipped route chunk.

---

## 1. Executive summary

The org‑chart page is a **client‑rendered SPA view** backed by **Convex**. WebFetch of the raw HTML returns only the app shell — the chart does not exist until JavaScript runs and a Convex query resolves. The org data is delivered by a single reactive query, `api.orgChart.getOrgTree`, which returns a **flat array of employee documents** that the client assembles into a tree by `managerId`.

The visualization ("Shajarah" — شجرة, Arabic for *tree*) is a custom, dependency‑light renderer: absolutely‑positioned card `<div>`s laid out by a **tidy‑tree algorithm**, with connectors drawn as **1‑pixel `<div>` segments** (not SVG) over a CSS‑gradient grid canvas.

At capture time the live tenant contained **exactly one employee** (Ahmed AlAli · Supervisor · Executive; 0 managers, 1 layer). The reconstruction in this repo reproduces the component and its layout engine faithfully and is data‑driven, so it renders the real single node identically and scales to arbitrary hierarchies (see the bundled demo dataset).

---

## 2. Delivery architecture

```
Browser (SPA, React + Vite)
  │  useQuery(api.orgChart.getOrgTree, {})           ← reactive read
  ▼
Convex client  (convex-client: npm-1.42.1)
  │  WebSocket sync protocol (query results)         ← org data path
  │  POST https://api.ahlanhamad.com/api/action      ← actions/RPC (auth, mutations)
  ▼
Convex backend  (Cloudflare in front; `convex-usher` header; `via: Caddy`)
```

| Property | Value |
|---|---|
| Frontend | React SPA, Vite build (`/assets/*.js` hashed chunks), route‑level code splitting |
| Data backend | **Convex** (`convex-client: npm-1.42.1`) |
| API host | `api.ahlanhamad.com` |
| RPC endpoint | `POST /api/action` — body `{"path":"<module>:<fn>","format":"convex_encoded_json","args":[...]}` |
| Query transport | Convex WebSocket sync (query results stream here; not visible as XHR) |
| Auth | Refresh‑token → short‑lived RS256 JWT (`iss: actions.ahlanhamad.com`, `aud: convex`, ~1h exp). Session refreshed via `path:"auth:signIn"` on load. **Tokens are live credentials and are intentionally `<redacted>` in this repo.** |
| Fonts | IBM Plex Sans / Arabic / Mono (Google Fonts) |
| Analytics | GA4, Google Ads, LinkedIn Insight, Meta Pixel (not relevant to the chart) |

Observed auth call (redacted):

```http
POST https://api.ahlanhamad.com/api/action
content-type: application/json
convex-client: npm-1.42.1

{"path":"auth:signIn","format":"convex_encoded_json","args":[{"refreshToken":"<redacted>"}]}
→ 200 {"status":"success","value":{"tokens":{"refreshToken":"<redacted>","token":"<redacted RS256 JWT>"}}}
```

---

## 3. Data model (observed)

`api.orgChart.getOrgTree` returns a flat array of employee docs. Fields consumed by the renderer (recovered from the route chunk `page-7lFh0q5H.js`):

| Field | Meaning | Notes |
|---|---|---|
| `_id` | Convex document id | e.g. `s97096fyjg7dp207w9tqqpxh898csyr3` |
| `nameEn` / `nameAr` | Display name | locale‑selected; avatar initials derived from it |
| `jobTitleEn` / `jobTitleAr` | Job title | subtitle line; also drives root ordering (seniority) |
| `department` | i18n key `emp.dept.<value>` | client strips `emp.dept.` → shown UPPERCASE as the eyebrow |
| `managerId` | Manager's `_id`, or `null` | the single edge that defines the whole hierarchy |
| `status` | Employee status | feeds a status chip in the detail views |
| `teamNameEn` / `teamNameAr` | Team name | used elsewhere (search index) |

**Tree construction (`hr()` in the source):** map by `_id`; for each employee, push onto its manager's `children` when `managerId` resolves to another node, else treat as a **root**. Roots are sorted by a job‑title seniority rank (`Ye(jobTitleEn)`, descending). Depth is stamped by traversal.

The live snapshot is preserved in [`data/org-chart.json`](data/org-chart.json).

---

## 4. Layout engine — the "Shajarah" tidy tree (recovered)

Layout constants, lifted verbatim from the minified layout function `We()`:

| Source symbol | Value | Role |
|---|---:|---|
| `k` | 212 px | node width |
| `K` | 80 px | node height |
| `je` | 24 px | sibling gap |
| `sr` | 72 px | gap between sibling **roots** |
| `nt` | 64 px | extra vertical gap between levels |
| `ie` (= `nt/2`) | 32 px | connector stem length / horizontal‑bus offset |
| `de` | 48 px | outer margin around the whole tree |

Algorithm (two passes, classic tidy layout):

1. **Bottom‑up sizing** — a leaf's subtree width = `k` (212), center = `k/2`. An internal node's width = Σ(children widths) + `je` gaps; its center = midpoint between the first and last child centers.
2. **Top‑down placement** — roots are laid left‑to‑right from `x = de`, advancing by `width + sr`. Each node's `x = subtreeLeft + center − k/2`; each node's **`y = de + level·(K + nt) = 48 + level·144`**. Children are distributed within the parent's subtree span, advancing by `width + je`.
3. **Links** run from parent bottom‑center `(x+k/2, y+K)` to child top‑center `(x+k/2, y)`.
4. **Canvas size** = `maxX + k + de` × `maxY + K + de`.

**Verification:** for a single root, the formula yields `x = 48, y = 48` and a canvas of `308 × 176`. The live page rendered the node at `transform: translate(48px, 48px)` inside a `308px × 176px` bounds — an **exact match**, confirming the port is faithful.

### Connectors (elbow, `<div>`‑based)

Each link is three 1‑px `.ah-org-seg` rectangles (color `--ahlan-hairline`; the highlighted reporting line uses `.is-lineage` → `--ahlan-green`):

- **parent stem** — vertical, height `ie` (32), at parent bottom‑center;
- **horizontal bus** — width `|cx − px|`, at `y = py + ie`;
- **child stem** — vertical, height `cy − py − ie`, into the child top‑center.

Draw‑in keyframe animations (`ah-org-draw-*`) and a "tracing" mode (dims non‑lineage cards to `opacity: .32`) complete the behavior.

---

## 5. Component anatomy & design tokens

Node card (`.ah-org-card`): 212×80, `border-radius: 6px` (`--radius-lg`), `padding: 12px`, `box-shadow: var(--shadow-md)`, background `--ahlan-palm-900`. Contents: 32 px round avatar (initials fallback), name (13.5 px / 600 / white), title (11.5 px / `--ahlan-palm-300`), department eyebrow (10 px / 600 / `letter-spacing .6px` / uppercase / `--ahlan-signal`). A pencil "edit reporting line" button appears on hover.

Stage: `.ah-org-canvas` grid background (layered gradients, 96 px major / 24 px minor) → connector layer (`z-0`) → node layer (`role="tree"`, `z-10`); the whole stage is pan/zoom transformed.

Resolved design tokens (light theme) used by the reconstruction:

| Token | Value | Use |
|---|---|---|
| `--ahlan-palm-900` | `#0c1310` | card background |
| `--ahlan-palm-300` | `#9fada6` | job title / muted |
| `--ahlan-signal` | `#2fe38b` | department eyebrow (on dark card) |
| `--ahlan-green` | `#10a05a` | lineage / active connector |
| `--ahlan-green-tint` | `#d7f0e2` | focus ring |
| `--ahlan-tint-green` | `#ecfaf2` | avatar background |
| `--ahlan-green-text` | `#096538` | avatar text |
| `--ahlan-hairline` | `#dde4e0` | connector segments |
| `--ahlan-bg-base` | `#f7faf8` | canvas base |
| `--radius-lg` | `6px` | card corners |
| `--shadow-md` | `0 1px 2px #070c0a12, 0 4px 14px #070c0a12` | card shadow |

---

## 6. Reproduction

- **`index.html`** — self‑contained reconstruction: exact tokens, card markup, the ported `hr()`/`We()` layout, `<div>` elbow connectors, grid canvas, drag‑to‑pan / scroll‑to‑zoom, collapse toggles, and reporting‑line tracing. Two datasets: **Live snapshot** (the real single node) and **Demo (multi‑level)** to exercise the layout at depth.
- **`data/org-chart.json`** — the captured live data plus schema, in the shape `getOrgTree` returns.
- **Evidence** — `work/ahlanhamad-orgchart/evidence/`: original render, the org‑chart route chunk, and reconstruction screenshots.

---

## 7. Limitations & honesty notes

- The live tenant had **one employee**, so multi‑level geometry, connector routing, collapse, and root ordering could **not** be observed on live data. They were recovered from the **static route chunk** (constants, `We()`/`hr()`) and are exercised on **synthetic demo data**, clearly labelled as such. The demo people are invented — not real Ahlan Hamad staff.
- Convex query **results** travel over the WebSocket sync channel, which was not in the recorder's capture window; the query **name** and **field usage** were confirmed from the bundle instead, so the data model is *observed from code*, not guessed.
- Live session tokens seen in the auth response are **redacted** everywhere in this repo per the case's `data_handling: anonymize`.
