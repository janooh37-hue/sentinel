# Product

<!-- impeccable:product-schema 1 -->

## Platform

web


## Users

GSSG HR and admin staff working from desktops inside a packaged Windows
(pywebview) shell. Half the audience reads in Arabic; the other half in
English. They arrive at the app with a concrete record to produce or
maintain — file a leave, attest a clearance, generate a violation notice,
forward correspondence from the IONOS mailbox, route a book through
approval, attach a signed PDF to an employee file. Their day is short
focused interactions across many employees, not long sessions on one
record. Their workflow is auditable: every action eventually shows up in
a Word document, a ledger row, or a permission grant that another person
will read.

## Product Purpose

GSSG Manager is the system of record for employee documents,
correspondence, and approvals. It replaces a v3.5.4 Tkinter desktop tool
without losing the gravitas of the originals: the DOCX outputs it
produces still carry official weight, and the app surrounding them needs
to feel the same way. Success looks like an HR officer trusting the app
the way they trust the signed-paper original — they find the record,
they generate it, they file it, and nothing in the chrome distracts from
the integrity of the document.

## Positioning

GSSG Manager is an integrated ERP and document-control system whose
defensible distinction is continuity from an HR action through official
document generation, correspondence, approval, permission control, and an
auditable record. Neighboring tools may manage people or files; this product
keeps the operational action and its document-grade evidence in one controlled
workflow.

## Operating Context

Staff use the system in short, focused interactions across many employees and
records. Work moves between employee files, leave and clearance processes,
violations, correspondence, books, approvals, signed PDFs, permission grants,
and generated Word documents. The application runs as a local/LAN web system
and packaged Windows shell; its outputs are read and acted on by other staff,
so continuity, traceability, and document integrity are operational
requirements.

## Capabilities and Constraints

- Employee, leave, clearance, violation, correspondence, book, approval,
  document-generation, and permission workflows belong to one ERP.
- Generated DOCX/PDF records, ledger entries, approval history, and permission
  grants are durable operational artifacts rather than presentation-only UI.
- English and Arabic are equal operating languages.
- The product is local/LAN-first and must preserve same-origin operation,
  sensitive HR data boundaries, and auditable actions.
- Microsoft Word COM remains part of document rendering and conversion in the
  Windows operating environment.

## Brand Commitments

**Formal, official, document-grade.**

Voice: precise, instructional, neutral. Labels read like the form fields
they map to. Tone never marketing, never chatty, never apologetic.
Errors state what is wrong; empty states state what to do; confirmations
state what happened. Visual posture aligns: GSSG navy carries authority,
GSSG red is reserved for genuine warning or accent, surfaces stay cream
or near-black, motion is calm and reduced-motion-aware. Closer to a UAE
government services portal than a SaaS dashboard.

## Anti-references

- **Generic SaaS dashboards.** No hero-metric template, no gradient
  accent stripe, no identical-card-grid landing, no purple/blue startup
  palette. If a page would look at home in a YC demo day deck, it is
  wrong for this product.
- **Consumer / marketing flourishes.** No glassmorphism, no gradient
  text, no decorative illustration, no "delight" added for its own sake.
  Personality is conveyed by typographic discipline and color restraint,
  not by ornament.
- **Heavy enterprise / SAP-style chrome.** No crowded toolbars, no
  modal-stacked flows, no dense unbreathing tables, no dated grey
  framing. Density is earned by content, not imposed by chrome.
- **The v3.5.4 Tkinter aesthetic we replaced.** No native Windows-form
  panels, no system dialogs in place of designed surfaces, no unstyled
  data grids. The v4 web app is a deliberate departure, not a port of
  the look.

## Evidence on Hand

The repository contains real templates, generated-document workflows, ledger
and approval structures, and production-shaped interfaces that future work may
use as product evidence. No approved testimonials, benchmarks, measured
outcomes, or public case-study claims have been supplied; future work must not
fabricate them.

## Product Principles

1. **Document-grade gravitas — with legible wayfinding.** This app produces
   official records. The interface should carry the same weight as the
   documents it generates: calm typography, structural color, deliberate
   spacing. But gravitas is about weight and clarity, not austerity.
   Distinctive per-item iconography — including the emoji on the form
   (Services / quick-action) tiles — is *encouraged* as wayfinding: a
   memorable glyph lets an operator spot the right form at a glance, where a
   wall of uniform gray icons would force them to read every label. What's
   wrong is gratuitous decoration that carries no meaning, not a recognizable
   cue that speeds the task. (Per the operator: the emoji are a visual guide,
   not "playful" ornament — keep them.)
2. **Restraint over decoration.** Every accent earns its place. The red
   token is rare on purpose; navy is the workhorse; surfaces are quiet.
   New work should remove visual noise more often than it adds it.
3. **Bilingual as a peer, not a translation.** Arabic/RTL is half the
   audience. A design that only looks right in EN is broken. Verify
   layouts, alignment, and motion in both languages before declaring a
   task done.
4. **Workflow before flourish.** HR staff arrive with a task: file the
   leave, attest the document, send the email, approve the book. The
   shortest correct path to that task always wins over visual
   showmanship. Information architecture beats animation.
5. **Quiet confidence, not enterprise clutter.** Refuse SAP-style
   density, but also refuse SaaS hero energy. Find the third lane:
   structured, calm, deliberate, official. Closer to a printed form
   than to a marketing page.

## Accessibility & Inclusion

**WCAG AA + first-class RTL parity** is the contract.

- AA contrast on every text/background pair across both light and dark
  themes; verify when introducing new tokens.
- Keyboard reachable everywhere; visible focus rings (the project's
  `--focus-ring` token).
- AR/RTL is not an afterthought: layouts mirror, icons flip where
  semantic, scroll directions invert, ledger threading reads
  right-to-left. Test every new surface in both EN and AR at the same
  resolution.
- `prefers-reduced-motion` is already wired through the motion system
  (tailwindcss-animate plugin + reduced-motion guards); honor it on any
  new motion.
- Never signal state by color alone — pair every status color with a
  label, icon, or shape.
- Forms must be navigable with screen readers and label-associated;
  generated DOCX form fields are the legal record, but the editing
  experience must be equally accessible.
