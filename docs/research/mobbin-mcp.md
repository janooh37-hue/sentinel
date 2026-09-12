# Mobbin MCP: what it offers and how the Walker cites a reference pattern

Research for [#137](https://github.com/janooh37-hue/sentinel/issues/137), part of the Walker map [#136](https://github.com/janooh37-hue/sentinel/issues/136). Researched 2026-09-13. Sources are primary (Mobbin docs, Mobbin site, Mobbin terms, the live endpoint) unless marked *secondary*.

## TL;DR

- Mobbin has an **official hosted MCP server** at `https://api.mobbin.com/mcp` (Streamable HTTP, OAuth, no API key). Shipped end of April 2026.
- Requires a **paid plan: Pro ($10/mo billed yearly), Team ($16/member/mo), or Enterprise**. Free accounts cannot connect. "Unlimited usage during beta but may require AI credits in the future."
- Three tools: `search_screens`, `search_flows`, `search_sections`. Natural-language `query` (max 500 chars), `platform` = `ios` | `web` (Android not exposed). Results come back as inline images plus metadata: `mobbin_url` (permanent link), `app_name`, `platform`, `image.url` (expiring signed URL).
- Rate limit: **60 requests / 60 s per user**, `429` + `Retry-After`.
- For a GitHub issue the Walker can cite the `mobbin_url` and `app_name`; the terms allow "citations, images, and paraphrasing ... only in limited extent, and only if crediting the respective IP Holders". Do not re-host the image URLs (they expire and re-hosting is prohibited). Link, name the app, describe the pattern in words.
- Coverage skews consumer / iOS; web is present (`platform: web`) but B2B HR/admin flows are thin. For an HR admin web app, **Nicelydone** (SaaS-only, 203k screens, 12 MCP tools, Pro plan) and **Refero** (web + iOS, MCP with bearer token, 8,000 calls/month) are the better-fit fallbacks.

## 1. Does Mobbin offer an MCP server?

Yes, official.

| Item | Value | Source |
|---|---|---|
| Name | Mobbin MCP (registry id `com.mobbin/mobbin`) | https://github.com/mcp/com.mobbin/mobbin |
| Endpoint | `https://api.mobbin.com/mcp`, Streamable HTTP | https://docs.mobbin.com/mcp/introduction, https://github.com/mobbin/mobbin-mcp-server (MIT) |
| Auth | OAuth via browser; Dynamic Client Registration (RFC 7591), PKCE S256, scope `openid`. Protected-resource metadata at `https://api.mobbin.com/.well-known/oauth-protected-resource/mcp` (verified live 2026-09-13: authorization server is a Supabase auth instance; unauthenticated `tools/list` returns `401 {"error":{"code":"unauthorized"}}`) | https://docs.mobbin.com/mcp/build-an-integration |
| Plans | "Available on Pro, Team, and Enterprise plans"; pricing matrix row "MCP: Free = Not included, Pro/Team/Enterprise = Included" | https://docs.mobbin.com/overview, https://mobbin.com/pricing |
| Pricing (yearly billing) | Pro $10/month (1 member), Team $16/member/month, Enterprise custom; quarterly billing costs 33% more; Finance+ add-on $399/mo (Team/Enterprise) | https://mobbin.com/pricing |
| REST API (separate) | `POST https://api.mobbin.com/v1/screens/search`, Bearer API key from Settings > API Keys, **Team and Enterprise only** (`403` otherwise) | https://docs.mobbin.com/api/quickstart |
| Rate limit | MCP: 60 requests per 60 seconds per user. API: 60 per 60 s per workspace. `429 Too Many Requests` with `Retry-After` seconds | https://docs.mobbin.com/rate-limits |
| Usage cap | "Unlimited usage during beta but may require AI credits in the future" (terms already define non-transferable "AI Credits") | https://mobbin.com/mcp, https://mobbin.com/terms |
| Library | 621,500+ screens, 142,200+ flows; same library as the website | https://mobbin.com/mcp |

### Install for Claude Code

From https://docs.mobbin.com/mcp/clients/claude-code-cli:

```bash
claude mcp add mobbin --scope user --transport http https://api.mobbin.com/mcp
```

Then start a session, run `/mcp`, pick `mobbin`, choose **Authenticate**, sign in to Mobbin in the browser. Mobbin recommends adding the verified connector in Claude Desktop/Web first, after which the CLI "will automatically have access".

Equivalent JSON (from the official repo README):

```json
{ "mcpServers": { "mobbin": { "url": "https://api.mobbin.com/mcp", "type": "streamableHttp" } } }
```

Note for the Walker (unattended agent): the OAuth is a **browser sign-in per user**; there is no API-key path on Pro. A headless pipeline must either reuse a token obtained interactively once (Claude Code stores it after `/mcp` auth) or use the REST API, which needs a Team plan. Account sharing is "strictly prohibited" (terms 4.1), so the Walker should run under one dedicated seat.

## 2. Tools exposed

Documented names (https://docs.mobbin.com/mcp/features):

| Tool | Docs description |
|---|---|
| `search_screens` | "Searches UI screens." |
| `search_flows` | "Searches multi-step user flows such as onboarding and checkout." |
| `search_sections` | "Searches website sections such as pricing pages and footers." |

There is **no** search-by-app, get-app-flows, or get-screen-detail tool in the official server (those existed only in the archived unofficial `pdcolandrea/mobbin-mcp`, which scraped internal endpoints and was deprecated 2026-05-15). App-specific queries work by naming the app in the natural-language `query` ("Duolingo onboarding flow").

Parameters. Mobbin's docs page does not print schemas; the REST endpoint schema (https://docs.mobbin.com/openapi.json) is the primary source and the MCP tools mirror it (*secondary* confirmation: scalekit.com/connectors/mobbinmcp and developertoolkit.ai, which list the live tool schemas):

| Parameter | search_screens | search_flows | search_sections |
|---|---|---|---|
| `query` string 1-500 chars, required | yes | yes | yes |
| `platform` `ios` or `web`, required | yes | yes | no (web-only) |
| `limit` | 1-30, default 20 | 1-10, default 5 | 1-30 |
| `mode` `deep` (default), `standard`, `fast` | yes | - | - |
| `page` | - | yes | yes |
| `exclude_screen_ids` UUID[] | yes | - | - |
| `image_format` (WebP default, JPG option) | yes | yes | yes |

Response per screen (REST schema, same fields reported for MCP): `id`, `image {url,width,height,url_expires_at}`, `mobbin_url`, `app_name`, `platform`. Flows additionally return "evenly-spaced preview images inline along with metadata for each flow, including per-screen previews". In Claude Desktop/ChatGPT the result renders as an interactive gallery (MCP Apps extension); in Claude Code CLI the agent receives the images and metadata without the gallery.

Android is on the website but is not a `platform` value.

## 3. Query shape for a friction point, and what to cite

How queries actually reach Mobbin (https://mobbin.com/blog/how-to-use-mobbin-mcp, Mobbin's own analysis of 317k queries): the client LLM rewrites the user ask into one or more `query` strings; 85% are generic pattern searches ("login screen", "settings screen", "empty state"), 15% name an app. Industry qualifiers change the result set materially ("onboarding" vs "banking app onboarding"). Over-stuffed queries get cut at 500 chars.

Recommended shape for the Walker: one `search_flows` call first, then `search_screens` for the specific step.

| Friction finding | `search_flows` query (`platform: web`) | `search_screens` follow-up |
|---|---|---|
| User cannot find how to attach a signature to a document | `add signature to document before sending, e-signature setup and placement flow` (DocuSign / Dropbox Sign / PandaDoc are the likely hits) | `signature field placement on document with draw type upload options` |
| Leave approval takes too many clicks | `manager approves time off request from notification, one-tap approve reject` (Rippling / Gusto / Deel / BambooHR style) | `pending approvals list with inline approve and reject actions` |
| Arabic user sees English status label | not a Mobbin question; Mobbin has no RTL/localisation filter. Skip the citation for i18n findings. | - |

Rules of thumb: name the task in user words, add the vertical ("HR", "payroll", "e-signature"), add the UI element the fix needs. Use `mode: deep` (default) and `limit` 5-10 to keep tokens down. Serialize calls; parallel fan-out is what hits the 60/min limit.

What to put in the GitHub issue:

- **Permanent URL**: the `mobbin_url` field (`https://mobbin.com/explore/flows/<uuid>` or `/explore/screens/<uuid>`). These are canonical, stable links; viewing needs a Mobbin account for full flows (Free is "limited").
- **Flow name / app name**: `app_name` plus the flow title as returned. Cite as "Reference: Gusto (web), time-off approval flow, mobbin.com/explore/flows/...".
- **Screenshots**: `image.url` is a signed URL with `url_expires_at`; do not paste it. Re-hosting is forbidden: terms section 3 prohibits "mirror, cache, archive or re-host any materials or content retrieved from the Platform" and "use any content retrieved via the API or MCP Services to create a standalone content repository". Terms 10.2: "Citations, images, and paraphrasing may only be published elsewhere in limited extent, and only if crediting the respective IP Holders." Terms 10.4 leaves fair use to Singapore law and puts liability on the user. So: link + app credit + a one-paragraph description of the pattern, no image attachment in the issue. The repo is private, which lowers but does not remove the exposure.
- **Permitted use**: MCP/API content is for "your personal or internal business use, or integration into your own proprietary products" (terms section 3). An internal issue tracker qualifies. Training/benchmarking AI on the material is prohibited.

## 4. Limitations for a business HR web app, and alternatives

- Mobbin's top queries are consumer: onboarding, dashboards, paywalls ~30%; fintech 9.4% is the biggest vertical; most-searched apps are Linear, Notion, Stripe, Duolingo, Airbnb (Mobbin blog). "Mobbin's strongest screens are iOS consumer apps" (*secondary*: toolworthy.ai alternatives roundup). Web coverage exists (explore/web/screens/admin-dashboard, /saas-dashboard, /app-categories/crm pages exist) but HR/leave/approval/e-signature flows in Arabic-first admin apps will not have a close match; expect a "nearest pattern" (approval inbox, document signing), not a comparable product.
- No Android, no RTL/locale metadata, no industry filter other than through the query text.
- Auth is interactive OAuth; no service-account path below Team.
- Results in the CLI cost context tokens (20 inline images by default); set `limit` low.
- Duplicates and off-target hits are common enough that users report re-prompting (*secondary*: designproject.io write-up).

Alternatives with MCP servers:

| Library | Fit for HR web app | MCP | Plan | Source |
|---|---|---|---|---|
| **Nicelydone** | Best: SaaS/web only, 203k+ screens, 12.8k+ flows, 12 tools (search by page type, flows, UI components, app collections) with structured metadata (page type, UI elements, layout patterns) | yes, one-command install (shown after sign-in) | Pro subscription | https://nicelydone.club/mcp |
| **Refero** | Good: web + iOS, 150k+ screens, 6k+ flows; tools for sites/apps, styles, screens, flows; `refero_skill` on GitHub for agents | `https://api.refero.design/mcp`; `claude mcp add --transport http refero https://api.refero.design/mcp --header "Authorization: Bearer <token>"` (bearer token, so headless-friendly); 8,000 tool calls/month | Pro, Team, or Lifetime | https://doc.refero.design/mcp/getting-started, https://github.com/referodesign/refero_skill |
| Page Flows | Video recordings of flows, 79k screens; no MCP found | no | paid | *secondary*: toolworthy.ai |

Refero's bearer-token auth is the practical reason to prefer it over Mobbin for an unattended Walker if a Team-plan REST key from Mobbin is off the table.

## What changes the Walker plan

1. Mobbin MCP exists and is cheap (Pro $10/mo), but its auth is browser OAuth per user. The Walker needs one dedicated Mobbin seat authenticated once in Claude Code, or Refero (bearer token) as the primary reference source.
2. The citation in each issue is `app_name` + flow title + `mobbin_url`, plus a prose description. No screenshots attached.
3. Query recipe: `search_flows(platform="web", query="<task in user words> <vertical> <UI element>", limit<=10)`, then optional `search_screens` for the specific step; one call at a time; skip citations for pure i18n/RTL findings.
4. Expect nearest-pattern matches, not HR-specific ones; Nicelydone is the better library for admin/SaaS flows if a second subscription is acceptable.
