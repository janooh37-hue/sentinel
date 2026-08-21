# org-chart

A faithful, self‑contained reconstruction of the **Ahlan Hamad** organization chart
(`https://ahlanhamad.com/en/org-chart`), reverse‑engineered from the live page.

The site's chart component is internally called **"Shajarah"** (شجرة — Arabic for *tree*).
This repo rebuilds it from scratch: the exact card design, the recovered tidy‑tree layout
engine, the `<div>`‑based elbow connectors, the grid canvas, and pan/zoom — all data‑driven.

## Run

Just open **`index.html`** in a browser (no build, no server). It works over `file://`.

- **Live snapshot** — the real data captured from the account (one employee:
  Ahmed AlAli · Supervisor · Executive). Renders identically to the live site,
  down to `translate(48px,48px)` and a `308×176` canvas.
- **Demo (multi‑level)** — synthetic sample data to show the recovered layout engine
  scales to a real hierarchy (collapse toggles, reporting‑line tracing, elbow routing).
  The demo people are invented, not real staff.

## Files

| Path | What |
|---|---|
| `index.html` | The reconstruction (self‑contained HTML/CSS/JS). |
| `data/org-chart.json` | Captured live data + the `api.orgChart.getOrgTree` schema. |
| `FINDINGS.md` | Full reverse‑engineering report: backend, data model, layout algorithm, design tokens. |
| `docs/architecture.md` | Data‑flow and component diagrams (Mermaid). |
| `work/ahlanhamad-orgchart/` | Case workspace: scope, evidence (screenshots, route chunk), timeline. |

## How it was built

Backend: **Convex**. The chart is fed by the reactive query `api.orgChart.getOrgTree`,
which returns a flat array of employee docs linked by `managerId`; the client builds and
lays out the tree. The layout constants (`k=212, K=80, je=24, sr=72, nt=64, de=48`) and the
`hr()`/`We()` functions were recovered from the shipped route chunk and ported verbatim —
see `FINDINGS.md`.

> Scope: read‑only rendering and passive observation of the user's own authenticated
> tenant. No writes to the live account; live session tokens are redacted throughout.
