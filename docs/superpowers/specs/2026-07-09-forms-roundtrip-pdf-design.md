# How We Work — Management PDF (Forms Roundtrip) — Design

**Date:** 2026-07-09
**Status:** Approved by user (brainstorming complete)

## Goal

Two polished PDF documents (English + Arabic) for GSSG management showing the
complete path of a form/request from the moment it starts to its final resting
place in the employee's file — quietly contrasted against the old manual way
(fill Word doc → print → carry for signatures → scan → sort → write email →
send → file in cabinet).

**Persuasion is subtle by design.** The document is about *the path of how work
gets done*, not about the app. The reader concludes on their own that the
current way is better. No headlines, no "10x faster", no feature-list energy.

## Audience, tone, language

- **Readers:** GSSG upper management.
- **Tone:** professional business English — clear, modern, polished corporate
  register. Not childish, not academic, no ornate vocabulary ("no Shakespeare").
  Sentences a busy manager reads once and understands. Same standard in Arabic:
  formal, respectful, plain.
- **Two separate PDFs:** `how-we-work-en.pdf` (English, LTR) and
  `how-we-work-ar.pdf` (Arabic, fully RTL, mirrored layout, Arabic-Indic
  numerals). Same content, native screenshots per language.
- **Authorship:** the user's real identity appears — employee **G3082**, real
  name on the cover. The staged roundtrip runs under his account.

## Document structure (~14 A4 pages)

1. **Cover** — GSSG crest, navy on cream. Title in the spirit of "How Our Work
   Moves — The Path of a Request from Start to File" (final wording during
   implementation, plain-register). Author name + G3082, date. The word "app"
   does not appear in the title.
2. **Index** — official-looking table of contents with navy leader lines and
   page numbers; all seven steps visible so the whole path is seen at a glance.
3. **The two paths** — the ONE explicit comparison in the document. Old path as
   a muted grey timeline (8 stops: write in Word → print → carry for signatures
   → wait → scan → sort → write email → send/file). New path beneath in navy
   (3 stops: request → approve → done). One calm sentence below. No verdict text.
4.–10. **The path, step by step** — one step per page, uniform rhythm:
   step number + plain title, 2–4 sentences of neutral instructional prose,
   1–2 framed screenshots, small edge progress marker ("step 3 of 7").
   On the three most dramatic steps ONLY (†), a grey-italic footnote line:
   "previously: …" naming what this step used to require.

   1. **Starting a request** — Services gallery, form tile, employee picked,
      fields pre-filled from the employee file.
   2. **Creating the document** — reference number assigned automatically
      (e.g. HR-0042, never duplicated), scannable barcode stamped, PDF appears
      instantly; annual leave auto-generates the companion Leave Undertaking
      under the same reference.
   3. **Approval and signature †** — manager's approval queue (desktop +
      phone), push notification, review of the actual document, one-tap sign;
      signature embeds into the official PDF and the record locks.
      *(previously: printed and carried desk to desk)*
   4. **Notifying the employee †** — automatic SMS in the employee's own
      language (AR/EN) with dates/duration/details; 7 form types auto-send;
      every message kept on the employee's file (Messages tab).
      *(previously: the employee asked, or never knew)*
   5. **Related correspondence** — email composed inside the system; typing
      G3082 or HR-0042 becomes a live link (smart chips); the referenced
      form's PDF attaches itself.
   6. **Incoming scans †** — signed paper scanned or arriving by email lands
      in the scan inbox, is read automatically (OCR/barcode), and files itself
      to the right record/employee; the operator confirms.
      *(previously: scan, rename, sort into folders, write an email, send)*
   7. **The completed record** — signed PDF in the employee's file, leave
      balance deducted automatically, visible in the annual report, findable
      in seconds.
11. **Oversight** — the dashboard: on leave today, awaiting approval, expiring
    passports/visas. One screenshot, short prose.
12. **The same path serves everything** — quiet catalog grid of the 16 service
    tiles (real emojis + names). One line: every one travels this same path.
13. **Looking ahead — notes for the next level** — the author's (G3082's)
    forward-looking notes, first person, professional and modest in tone: the
    current path works, and these are the areas identified for the next step.
    3–5 short grounded ideas (e.g., WhatsApp as an added notification channel —
    already built, awaiting activation; automatic reminders before a leave ends
    or a passport expires; employee self-service requests from their own phone;
    smarter automatic reading of passports and IDs; an auto-generated monthly
    management summary). Presents the system as a living path that keeps
    improving — not an absolute finished thing.
14. **Back page** — short closing paragraph (works in both languages, on any
    device, every action recorded) + document footer.

## Visual design

- **A4 portrait**, generous margins, print-safe colors (likely printed).
- **Palette from the app identity:** GSSG navy structural (headings, timeline,
  step numbers), cream/off-white surfaces, near-black body, GSSG red used at
  most ~2 times total as accent. Government-publication feel; no gradients,
  no SaaS styling (per PRODUCT.md anti-references).
- **Typography:** EN — serif headings + clean sans body. AR — proper Arabic
  typesetting (Noto Naskh Arabic or similar), mirrored RTL layout, RTL index.
- **Screenshots:** framed in subtle cards (thin navy border) with one-line
  captions; sparse annotation — a single red-ring highlight where the eye
  should land (ref number, Approve button, arrived SMS). Desktop shots wide;
  phone-approval step in a phone-shaped frame.
- **Footers:** GSSG name, document title, page number — like the org's forms.

## Production method (Approach A — approved)

Styled HTML → print CSS → headless Chrome (Playwright, already in repo) →
PDF. Same pattern as `deploy/guides/install-cert-*.html→pdf`, higher polish.
HTML sources are kept next to the PDFs so future edits can re-render.

**Deliverables:**
- `docs/how-we-work/how-we-work-en.html` + `.pdf`
- `docs/how-we-work/how-we-work-ar.html` + `.pdf`
- Screenshot assets under `docs/how-we-work/shots/` (en/ + ar/)
- A small re-render script (HTML → PDF via Playwright).

## Screenshot staging plan (approved)

1. **Local stage, never production.** Copy the production SQLite DB (+ needed
   vault files) to a scratch location; run a second backend instance locally on
   a different port. No writes to the real system.
2. **The staged story, as G3082:** one real Annual Leave Application through
   the full cycle — Services → form filled → generate (ref + PDF) → manager
   approval + signature → SMS record → email with smart chip + auto-attached
   PDF → scan arriving in scan inbox and filing itself → final record in the
   employee's file → dashboard.
3. **Capture with Playwright:** fixed 1440px desktop viewport for most scenes;
   390px phone viewport for the phone-approval scene. Every scene captured
   twice — app in EN and app in AR — so each PDF gets native-language shots.
4. **SMS caveat:** the stage copy won't actually send SMS; the Messages tab
   still shows the message record, which is what we photograph. If the staged
   record shows a "failed" badge, fall back to photographing a real, existing
   sent message in production (read-only) or present the message content
   cleanly without the badge.

## Screenshot quality gate (hard requirement)

Known issue: at some viewport sizes the GSSG logo/wordmark renders cramped —
the company name wraps or squeezes badly under Playwright. Broken or cramped
rendering must NEVER reach the PDFs. Rules:

- **Crisp capture:** `deviceScaleFactor: 2` (retina) on every shot; wait for
  fonts, images, and the logo asset to fully load before capturing (no FOUT,
  no placeholder boxes, no spinners mid-frame).
- **Aspect ratio tuned per scene:** viewport chosen so the header/logo and the
  subject UI lay out cleanly — adjust width until the logo and navigation
  render exactly as they do on a real office screen. If a scene can't look
  right at 1440px, change the viewport for that scene rather than shipping a
  cramped shot.
- **Every shot reviewed before inclusion:** each captured image is inspected
  (logo intact, no clipped text, no broken layout, no dev artifacts, no
  scrollbar litter, correct language). Any failed shot is re-staged and
  re-captured — never cropped around or "good enough"-ed.
- **AR shots held to the same bar:** RTL layout must be mirrored correctly in
  every capture; a shot with LTR leakage is a failed shot.

## Content grounding (from code exploration, 2026-07-09)

Verified facts the copy may state:
- 16 service tiles / 18 template files; emoji-led gallery
  (`ApplicationPage.tsx`, `constants.py:TEMPLATE_FILES`).
- Atomic per-category reference numbering, format `HR-0042`
  (`refs_repo.allocate_ref_with_retry`), Aztec barcode header stamp.
- Instant DOCX→PDF at generation (`pdf_chain.py`).
- Companion documents share ref + submission id (Leave Application →
  Leave Undertaking for Annual Leave).
- Four signing paths (auto / scan / in_app / chain); in_app approval embeds
  the signer's signature and locks the record; downloads then serve the
  signed PDF.
- SMS: 7 auto-send form events + 3 manual (leave_approved, duty_resumption,
  violation); bilingual bodies; per-employee history in MessagesTab
  (`sms_service.py`, `sms_templates.py`).
- Email: IMAP-synced ledger, smart chips (G-numbers + book refs become links,
  `smartLinks.ts`), reference PDFs auto-attach (`refPdfAttachments.ts`).
- Scan inbox: email attachments auto-enqueue, OCR + QR triage (auto /
  confirm / manual tiers), self-filing with operator confirm + undo
  (`scan_inbox_service.py`, `scan_triage_service.py`).
- Leave balance auto-computed (30-day cap) (`leave_service.py`); annual
  report with month-by-month view (`LeavesReport.tsx`).
- Dashboard: on-leave-today, approval queue badge, expiring passport/visa
  warnings (`dashboard.py`).
- Web push with deep links; PWA installable; approvals work from a phone.

**Accuracy rule:** every claim in the PDF must match one of the verified facts
above. Nothing invented; if a staged scene can't be produced, the claim is
dropped rather than faked.

## Out of scope

- WhatsApp (dormant channel; SMS is the live story).
- Click-by-click training material — this is a walkthrough, not a manual.
- Any change to app code. This work only adds files under `docs/how-we-work/`.

## Success criteria

- Two PDFs, EN + AR, ~14 pages each, same content, native screenshots.
- Includes the author's forward-looking notes page — the path is presented as
  improving, not absolute.
- Clean professional look consistent with GSSG identity (navy/cream, formal).
- A manager reading it understands the full roundtrip without being told
  "the app is great" — the single comparison page and three "previously"
  footnotes are the only explicit contrasts.
- Plain corporate English / formal plain Arabic throughout.
- Reproducible: HTML sources + shots + re-render script committed alongside.
