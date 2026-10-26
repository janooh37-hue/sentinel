/**
 * Phone header — real-geometry browser regression.
 *
 * Covers the phone top bar (menu button, GSSG brand, notifications bell, profile avatar), the desktop TopNav that
 * landscape phones >= 768px get, the profile and notification popovers (empty AND populated) and the navigation
 * drawer. Everything is measured in a real Chromium page: getBoundingClientRect, elementFromPoint hit-testing,
 * real touch gestures, keyboard and focus. Nothing here asserts class names or source text.
 *
 * Fully mocked: every `/api/v1` request is answered below (synthetic user, no production data, no backend, no
 * lock overlay). Strict, like `lock-word-handoff.spec.ts` / `record-page-v2.spec.ts`: an unstubbed `/api/v1`
 * request is aborted and recorded, and the test fails at teardown.
 *
 * iOS notch / home-indicator insets are emulated with CDP `Emulation.setSafeAreaInsetsOverride` (Chromium
 * only). That makes `env(safe-area-inset-*)` resolve to the injected numbers; it is an emulation of the inset
 * VALUES, not evidence about real iOS Safari toolbars or a physical notch. Likewise "Safari-like" cells only
 * model ONE Safari behaviour (a tap does not focus a button) by cancelling `mousedown`; they are not WebKit.
 *
 * What a cell contains (see `Cell`):
 *   - `rich` (default): a wide capability set and a POPULATED notifications panel (unread items, "Mark all
 *     read", "View all in inbox", pending access request, approvals...). `rich: false` is the thin, empty case.
 *   - `rootPx`: overrides the root font size ("200% text"). The app's own Aa tops out at 24px, so this is a
 *     stress beyond its range. The 160/195 CSS px cells are a 320/390px phone at 200% BROWSER zoom: they get the
 *     SAME full contract as every other cell (every control reachable, hit-testable and >= 44px, nothing in a
 *     panel clipped or panning sideways); the 136px-wide panel reflows its rows instead of squeezing them.
 *   - `safari`: taps do not focus buttons, like Safari.
 *
 * Touch cells (isMobile + hasTouch => `pointer: coarse`) require EVERY control in the header, the open panels
 * and the drawer to be a >= 44 x 44 CSS px, hit-testable target. Mouse (desktop) cells instead pin the compact
 * desktop layout so the coarse rules cannot leak into it.
 *
 * Matrix: widths 320/360/375/390/430, landscape 667x375 + 740x360, the TopNav tier at 768 / 844x390 / 932x430,
 * desktop 1024/1280; English + Arabic (RTL); text scale Aa 16/19/22/24; stress root 32px and 200% zoom.
 *
 * RUN — from the worktree, never from the production checkout (no backend needed):
 *   pnpm -C frontend exec vite --port 5199 --strictPort --host 127.0.0.1            # terminal A
 *   PLAYWRIGHT_BASE_URL=http://127.0.0.1:5199 pnpm -C frontend exec playwright test e2e/mobile-header.spec.ts
 */
import type { Browser, BrowserContext, Locator, Page, Route } from '@playwright/test'
import { expect as hard, test } from '@playwright/test'

// Measurement assertions are soft so one run lists EVERY failing geometry/focus fact (the RED run is a
// report, not a first-failure abort). `hard` guards the flow steps the rest of a test depends on.
const expect = hard.configure({ soft: true })

// A RED run accumulates several 5s soft-assertion timeouts per test; 30s (the default) would cut the report short.
test.describe.configure({ timeout: 180_000 })

type Lang = 'en' | 'ar'

// Panels are rounded-2xl (16px): probe this far in from a corner so the rounded-off corner pixels are not hit.
const CORNER_PROBE = 20

interface Insets {
  top: number
  bottom: number
  left: number
  right: number
}

interface Cell {
  w: number
  h: number
  lang: Lang
  aa: number
  insets: Insets
  touch: boolean
  dpr: number
  /** Wide capability set + populated notifications. false = the thin capability set and an empty bell. */
  rich: boolean
  /** Root font-size override in px: "200% text" (the app's own Aa stops at 24). */
  rootPx?: number
  /** Safari-like taps: a tap never focuses a button. */
  safari?: boolean
  /**
   * The BROWSER's default font size in px (CDP `Page.setFontSizes`; a user's "Font size: Large / Very large"
   * browser setting). It is NOT the CSS root font size: it changes what `rem` means inside a media query, so
   * Tailwind's `md` (48rem) moves to 864 / 960 / 1152 CSS px at 18 / 20 / 24px (and below 768px under 16px)
   * while the app's own px query (`useIsMobile`, 767px) and its Aa-driven root font size do not move.
   */
  browserFont?: number
  /** Stored theme preference; the app default (light) when unset. */
  theme?: 'dark'
}

const NO_INSETS: Insets = { top: 0, bottom: 0, left: 0, right: 0 }
const MD = 768
// WCAG 2.5.5 / Apple HIG minimum touch target, CSS px.
const TARGET = 44
// Breathing room required between the safe inset (or screen edge) and the header's controls.
const BREATHING = 12
// Sub-pixel layout rounding.
const EPS = 0.75

function cell(w: number, h: number, over: Partial<Cell> = {}): Cell {
  return {
    w,
    h,
    lang: 'en',
    aa: 16,
    insets: NO_INSETS,
    touch: w < 1024,
    dpr: 2,
    rich: true,
    ...over,
  }
}
const portrait = (top: number, bottom: number): Insets => ({ top, bottom, left: 0, right: 0 })
const landscape = (left: number, right: number, bottom = 21): Insets => ({ top: 0, bottom, left, right })

// ───────────────────────────── synthetic API ──────────────────────────────

const SESSION_USER = {
  id: 1,
  email: 'synthetic.user@example.invalid',
  employee_id: 'G0000',
  name_en: 'Synthetic Longname Officer',
  name_ar: 'ضابط تجريبي طويل الاسم للاختبار',
  position: 'Records Officer',
  department: 'Records',
  photo_url: null,
  role: 'admin',
  status: 'active',
  is_admin: true,
  is_manager: false,
  has_signature: true,
  idle_lock_seconds: 1800,
  lock_layout: 'band',
}

const THIN_CAPS = ['books.view', 'settings.view', 'dashboard.view', 'employees.view', 'services.view']
// Everything the shell chrome gates on: the bell's ledger/expiry/leaves/scan rows, the TopNav utilities
// (scan, debug, settings), the drawer's admin links and every destination.
const RICH_CAPS = [
  ...THIN_CAPS,
  'ledger.view',
  'expiry.view',
  'leaves.view',
  'documents.scan',
  'documents.generate',
  'vehicles.view',
  'permits.view',
  'system.admin',
  'users.manage',
]

const UNREAD_ITEMS = Array.from({ length: 5 }, (_, i) => ({
  id: 100 + i,
  subject:
    i % 2 === 0
      ? `Synthetic message ${i} with a deliberately long subject line that has to truncate`
      : `رسالة تجريبية رقم ${i} بعنوان طويل عمدا لاختبار القص داخل اللوحة`,
  counterparty: `sender${i}@example.invalid`,
  counterparty_name: `Synthetic Sender ${i}`,
  entry_date: `2026-01-0${i + 1}T09:00:00Z`,
  attachment_count: i % 2,
  preview: `Preview text of synthetic message number ${i}, long enough to need an ellipsis in a narrow panel`,
}))

/**
 * `fullDesktop`: a mouse desktop wide enough to print the destination LABELS (>= 1240px). With all eight
 * destinations the existing TopNav row already overflows there (the strip runs into the utilities; unchanged
 * and out of this fix's scope), so those cells omit the two extra destinations; every other cell keeps them.
 */
function stubs(lang: Lang, aa: number, rich: boolean, fullDesktop: boolean, theme: 'light' | 'dark'): Record<string, unknown> {
  return {
    '/auth/me': SESSION_USER,
    '/auth/me/capabilities': rich
      ? fullDesktop
        ? RICH_CAPS.filter((cap) => cap !== 'vehicles.view' && cap !== 'permits.view')
        : RICH_CAPS
      : THIN_CAPS,
    '/auth/capabilities': [],
    '/auth/users': rich ? [{ id: 2, email: 'pending.user@example.invalid', status: 'pending', role: 'operator' }] : [],
    '/system/migration-status': { has_db: true, has_data: true, v3_data_dir_detected: null, last_migration: null },
    '/settings': {
      stamp_style: 'x',
      default_manager_id: null,
      manager_hand_sign_default: false,
      theme,
      language: lang,
      font_scale: aa,
      sig_personnel_path: null,
      sig_admin_path: null,
      legacy_signature_path: null,
      admin_gate_enabled: false,
      sentry_opt_in: false,
      sms_autosend_enabled: false,
      email_signature: '',
      signature_size_mm: 28,
      signature_boldness: 1,
      inmate_reporter_manager_user_id: null,
    },
    '/email/account': null,
    '/notifications/counts': { approvals: 3, leaves: 0, scans: 0, emails: 0, monthly_reviews: 0, monthly_approvals: 0 },
    '/scan-inbox/count': rich
      ? { awaiting_confirmation: 2, unrouted: 1, total: 3 }
      : { awaiting_confirmation: 0, unrouted: 0, total: 0 },
    '/ledger/unread-recent': rich ? { items: UNREAD_ITEMS, total_unread: 12 } : { items: [], total_unread: 0 },
    '/ledger/unread-count': { count: rich ? 12 : 0 },
    '/ledger/flag-count': { count: rich ? 2 : 0 },
    '/leaves/awaiting-return/count': { count: rich ? 2 : 0 },
    '/expiry/summary': rich ? { expired: 1, critical: 1, urgent: 2 } : { expired: 0, critical: 0, urgent: 0 },
    '/workforce/access/me': { workforce_access_tier: 'none', scopes: [] },
    '/dashboard/layout': null,
    '/dashboard/summary': {
      totals: {
        employees_active: 0,
        our_staff: 0,
        loaned: 0,
        on_leave_today: 0,
        present_today: 0,
        forms_this_month: 0,
        open_violations_count: 0,
      },
      on_leave_today: [],
      upcoming_leave_ends: [],
      recent_documents: [],
      recent_ledger: [],
      email_sync: { last_synced_at: null, enabled: false, interval_minutes: 15, incoming_today: 0 },
    },
    '/inmate-violations/statistics/awaiting-close': { months: [] },
    '/books/approval-summary': {
      can_view_sent: true,
      available_received_kinds: ['approver'],
      signature: { count: 2, oldest: null },
      review: { count: 0, oldest: null },
      sent: { count: 0, oldest: null },
      returned_count: 0,
      actionable_count: 2,
    },
    '/books/inbox/summary': { unread: 1, received: 1, sent: 0, archived: 0, by_purpose: {} },
    '/books/facets': { total: 0, items: [], mine: 0 },
    '/books': [],
    '/books/approval-log': { items: [], total: 0, limit: 50, offset: 0 },
    '/email/draft-templates': { overrides: {}, tokens: {} },
  }
}

interface Harness {
  ctx: BrowserContext
  page: Page
  unmocked: string[]
  cell: Cell
}

async function openApp(browser: Browser, c: Cell): Promise<Harness> {
  const ctx = await browser.newContext({
    viewport: { width: c.w, height: c.h },
    deviceScaleFactor: c.dpr,
    isMobile: c.touch,
    hasTouch: c.touch,
    locale: c.lang === 'ar' ? 'ar' : 'en-US',
  })
  const page = await ctx.newPage()
  const unmocked: string[] = []
  const table = stubs(c.lang, c.aa, c.rich, !c.touch && c.w >= 1240, c.theme ?? 'light')
  await page.route('**/*', (route: Route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return route.abort('failed')
    if (!url.pathname.startsWith('/api/')) return route.continue()
    const key = url.pathname.replace('/api/v1', '')
    if (key === '/notifications/stream') {
      return route.fulfill({ status: 200, contentType: 'text/event-stream', body: 'event: counts\ndata: {}\n\n' })
    }
    if (req.method() === 'GET' && key in table) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(table[key]) })
    }
    unmocked.push(`${req.method()} ${key}`)
    return route.abort('failed')
  })
  const cdp = await ctx.newCDPSession(page)
  await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: c.insets })
  if (c.browserFont) await cdp.send('Page.setFontSizes', { fontSizes: { standard: c.browserFont, fixed: 13 } })
  await page.addInitScript(
    ([lang, aa, theme]) => {
      localStorage.setItem('i18nextLng', String(lang))
      localStorage.setItem('lang', String(lang))
      localStorage.setItem('gssg.fontScale', String(aa))
      if (theme) localStorage.setItem('gssg.theme', String(theme))
    },
    [c.lang, c.aa, c.theme ?? ''],
  )
  if (c.safari) {
    // Safari does not focus a <button> (or link) on a tap. Cancelling `mousedown` — the default action that moves
    // focus — models exactly that one behaviour in Chromium; `click` still fires.
    await page.addInitScript(() => {
      document.addEventListener(
        'mousedown',
        (e) => {
          if (e.target instanceof Element && e.target.closest('button, a, [role=button], label, summary')) {
            e.preventDefault()
          }
        },
        true,
      )
    })
  }
  await page.goto('/')
  await page.locator('header').first().waitFor()
  await expect(page.locator('html')).toHaveAttribute('dir', c.lang === 'ar' ? 'rtl' : 'ltr')
  await expect(page.locator('html')).toHaveAttribute('data-font-scale', String(c.aa))
  if (c.theme) await expect(page.locator('html')).toHaveAttribute('data-theme', c.theme)
  if (c.rootPx) await page.addStyleTag({ content: `html[data-font-scale]{font-size:${c.rootPx}px !important}` })
  // The shell is up once the pull-to-refresh scroller (the real page scroller) is mounted.
  await page.locator('[data-ptr-scroller]').first().waitFor()
  // The cell really exercises the variant it claims: touch cells are `pointer: coarse`, desktop cells are not.
  hard(
    await page.evaluate(() => window.matchMedia('(pointer: coarse)').matches),
    `pointer: coarse must be ${c.touch}`,
  ).toBe(c.touch)
  if (c.browserFont) {
    // The cell really exercises the variant it claims: the rem media query follows the BROWSER font size.
    const md = await page.evaluate(() => ({
      on: window.matchMedia('(min-width: 48rem)').matches,
      w: window.innerWidth,
    }))
    hard(md.on, `a ${c.browserFont}px browser font puts Tailwind md at ${48 * c.browserFont}px (viewport ${md.w}px)`).toBe(
      md.w >= 48 * c.browserFont,
    )
  }
  return { ctx, page, unmocked, cell: c }
}

// ───────────────────────────── measurement ────────────────────────────────

interface Rect {
  x: number
  y: number
  r: number
  b: number
  w: number
  h: number
}

const rectOf = (loc: Locator): Promise<Rect> =>
  loc.evaluate((el) => {
    const b = el.getBoundingClientRect()
    return { x: b.x, y: b.y, r: b.right, b: b.bottom, w: b.width, h: b.height }
  })

/** True when elementFromPoint at (x, y) is `loc` or one of its descendants. */
const hitsAt = (loc: Locator, x: number, y: number): Promise<boolean> =>
  loc.evaluate(
    (el, [px, py]) => {
      const hit = document.elementFromPoint(px as number, py as number)
      return hit !== null && el.contains(hit)
    },
    [x, y],
  )

async function viewportInfo(page: Page): Promise<{ vw: number; vh: number; docSW: number; root: number }> {
  return page.evaluate(() => ({
    vw: window.innerWidth,
    vh: window.innerHeight,
    docSW: document.scrollingElement?.scrollWidth ?? 0,
    root: parseFloat(getComputedStyle(document.documentElement).fontSize),
  }))
}

/** A point in the page that is not inside an interactive element and not inside `avoid`. */
async function blankPoint(page: Page, avoid: Locator): Promise<{ x: number; y: number }> {
  const box = await rectOf(avoid)
  const p = await page.evaluate(
    ([bx, by, br, bb]) => {
      const interactive = 'a,button,input,select,textarea,label,summary,[role=button],[role=dialog],[tabindex]'
      const vw = window.innerWidth
      const vh = window.innerHeight
      for (let y = 4; y < vh; y += 14) {
        for (let x = 4; x < vw; x += 14) {
          if (x >= (bx as number) - 6 && x <= (br as number) + 6 && y >= (by as number) - 6 && y <= (bb as number) + 6) {
            continue
          }
          const el = document.elementFromPoint(x, y)
          if (el && el !== document.documentElement && el !== document.body && !el.closest(interactive)) {
            return { x, y }
          }
        }
      }
      return null
    },
    [box.x, box.y, box.r, box.b],
  )
  if (!p) throw new Error('no blank point found outside the open panel')
  return p
}

const ACTION_TIMEOUT = 5_000
const press = (c: Cell, loc: Locator): Promise<void> =>
  c.touch ? loc.tap({ timeout: ACTION_TIMEOUT }) : loc.click({ timeout: ACTION_TIMEOUT })
const pressAt = (page: Page, c: Cell, x: number, y: number): Promise<void> =>
  c.touch ? page.touchscreen.tap(x, y) : page.mouse.click(x, y)

/** A real touch stream (touchstart, many touchmoves, touchend) through CDP — not a scrollTop assignment. */
async function touchDrag(
  h: Harness,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 14,
): Promise<void> {
  const cdp = await h.ctx.newCDPSession(h.page)
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] })
  for (let i = 1; i <= steps; i += 1) {
    const t = i / steps
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }],
    })
    await h.page.waitForTimeout(16)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
  await h.page.waitForTimeout(350) // let any fling settle
}

const isPhoneHeader = (c: Cell): boolean => c.w < MD

// ───────────────────────────── locators (no English-only names) ───────────

const COPY = {
  en: { account: 'Account', notifications: 'Notifications', menu: 'Menu', close: 'Close', markAll: 'Mark all read' },
  ar: { account: 'الحساب', notifications: 'الإشعارات', menu: 'القائمة', close: 'إغلاق', markAll: 'تحديد الكل كمقروء' },
} as const

type DialogKind = 'account' | 'notifications' | 'menu'

const dialogOf = (h: Harness, kind: DialogKind): Locator =>
  h.page.getByRole('dialog', { name: COPY[h.cell.lang][kind], exact: true })

const headerOf = (page: Page): Locator => page.locator('header').first()
// The avatar trigger is named by the signed-in e-mail (locale-independent); the bell and the menu button by
// their localised accessible names (NavBell and the nav.menu key are translated).
const avatarOf = (page: Page): Locator => headerOf(page).getByRole('button', { name: SESSION_USER.email })
const bellOf = (page: Page, lang: Lang): Locator =>
  headerOf(page).getByRole('button', { name: new RegExp(`^${COPY[lang].notifications}`) })
const menuButtonOf = (page: Page, lang: Lang): Locator =>
  headerOf(page).getByRole('button', { name: COPY[lang].menu, exact: true })

// ───────────────────────────── shared checks ──────────────────────────────

// Everything a finger or a mouse can act on. A hidden checkbox (the theme switch) is represented by its <label>,
// which is the real hit area.
const CONTROL_SELECTOR =
  'a[href]:visible, button:visible, input[type=range]:visible, label:has(input[type=checkbox]):visible, [role=button]:visible'

const labelOf = (loc: Locator): Promise<string> =>
  loc.evaluate((el) => {
    const named = el.getAttribute('aria-label') ?? el.querySelector('input')?.getAttribute('aria-label')
    return (named ?? el.textContent?.trim() ?? el.tagName).slice(0, 28)
  })

/**
 * Every control under `root` can be scrolled to, sits inside the viewport and the safe insets, receives the
 * hit at its centre and — on a touch cell — is a >= 44 x 44 CSS px target. NO control is exempt. The one thing a
 * control cannot do is fit a window smaller than itself: a notification row at 200% text on a 375px-tall landscape
 * phone is taller than the panel's visible height (the panel cap leaves ~219px), so for such a control the contract
 * is that BOTH ends can be scrolled to the panel edges and the part on screen is hit-testable.
 */
async function expectControls(h: Harness, root: Locator, what: string): Promise<void> {
  const { page, cell: c } = h
  const { vw, vh } = await viewportInfo(page)
  const list = root.locator(CONTROL_SELECTOR)
  const n = await list.count()
  const room = await root.evaluate((el) => el.clientHeight)
  expect(n, `${what}: has controls`).toBeGreaterThan(0)
  for (let i = 0; i < n; i += 1) {
    const ctl = list.nth(i)
    await ctl.evaluate((el) => el.scrollIntoView({ block: 'nearest', inline: 'nearest' }))
    const b = await rectOf(ctl)
    const label = await labelOf(ctl)
    const id = `${what}: "${label}"`
    expect(b.x, `${id} start edge clears the left inset`).toBeGreaterThanOrEqual(c.insets.left - EPS)
    expect(b.r, `${id} end edge clears the right inset`).toBeLessThanOrEqual(vw - c.insets.right + EPS)
    expect(b.y, `${id} top`).toBeGreaterThanOrEqual(-EPS)
    if (b.h > room + 1) {
      const edge = 3 // the panel's own 1px border, plus rounding
      await ctl.evaluate((el) => el.scrollIntoView({ block: 'start' }))
      const pr = await rectOf(root)
      const top = await rectOf(ctl)
      expect(top.y, `${id} (${Math.round(b.h)}px, taller than the ${room}px panel) top scrolls to the panel's top edge`).toBeLessThanOrEqual(pr.y + edge)
      expect(top.y, `${id} top is inside the panel`).toBeGreaterThanOrEqual(pr.y - EPS)
      expect(await hitsAt(ctl, top.x + top.w / 2, pr.y + Math.min(room, top.h) / 2), `${id}: the visible part is tappable`).toBe(true)
      await ctl.evaluate((el) => el.scrollIntoView({ block: 'end' }))
      const end = await rectOf(ctl)
      expect(end.b, `${id} bottom scrolls to the panel's bottom edge`).toBeGreaterThanOrEqual(pr.b - edge)
      expect(end.b, `${id} bottom clears the home indicator`).toBeLessThanOrEqual(vh - c.insets.bottom + EPS)
    } else {
      expect(b.b, `${id} bottom clears the home indicator (control ${Math.round(b.h)}px tall, panel shows ${room}px)`).toBeLessThanOrEqual(vh - c.insets.bottom + EPS)
      expect(await hitsAt(ctl, b.x + b.w / 2, b.y + b.h / 2), `${id} is tappable at its centre`).toBe(true)
    }
    if (c.touch) {
      expect(b.w, `${id} is >= ${TARGET}px wide (${Math.round(b.w)}x${Math.round(b.h)})`).toBeGreaterThanOrEqual(TARGET - 0.01)
      expect(b.h, `${id} is >= ${TARGET}px tall (${Math.round(b.w)}x${Math.round(b.h)})`).toBeGreaterThanOrEqual(TARGET - 0.01)
    }
  }
  await root.evaluate((el) => {
    el.scrollTop = 0
  })
}

/**
 * Nothing inside `root` is clipped or pushes sideways, interactive or not: every painted descendant (the role
 * chip, labels, icons, steppers, rows) lies inside the root's horizontal box, no element hides overflowing
 * content (overflow hidden/clip with scrollWidth/scrollHeight past its box) and no text is cut to an ellipsis.
 * Vertical overflow of the root itself is fine: the panel is the scroller. The page never pans sideways.
 */
async function expectNoClip(h: Harness, root: Locator, what: string): Promise<void> {
  const { page } = h
  const report = await root.evaluate((el) => {
    const pr = el.getBoundingClientRect()
    const off: string[] = []
    const name = (n: Element): string =>
      `${n.tagName.toLowerCase()}${n.getAttribute('aria-label') ? `[${n.getAttribute('aria-label')}]` : ''} "${(n.textContent ?? '').trim().slice(0, 20)}"`
    const rs = getComputedStyle(el)
    if (el.scrollWidth > el.clientWidth + 1) off.push(`root scrolls sideways (${el.scrollWidth} > ${el.clientWidth})`)
    if (rs.overflowX !== 'hidden' && rs.overflowX !== 'clip' && rs.overflowX !== 'auto' && rs.overflowX !== 'scroll') {
      off.push(`root overflow-x ${rs.overflowX}`)
    }
    for (const n of el.querySelectorAll('*')) {
      if (n.closest('svg') && n.tagName.toLowerCase() !== 'svg') continue
      const b = n.getBoundingClientRect()
      if (b.width === 0 || b.height === 0) continue
      if (b.width <= 1 && b.height <= 1) continue
      if (b.x < pr.x - 1 || b.right > pr.right + 1) {
        off.push(`${name(n)} spills out of the panel: x ${Math.round(b.x)}..${Math.round(b.right)} vs ${Math.round(pr.x)}..${Math.round(pr.right)}`)
      }
      const cs = getComputedStyle(n)
      const clips = (v: string): boolean => v === 'hidden' || v === 'clip'
      if (!n.hasAttribute('data-message-text') && clips(cs.overflowX) && n.scrollWidth > n.clientWidth + 1) off.push(`${name(n)} hides ${n.scrollWidth - n.clientWidth}px sideways`)
      if (clips(cs.overflowY) && n.scrollHeight > n.clientHeight + 1) off.push(`${name(n)} hides ${n.scrollHeight - n.clientHeight}px vertically`)
      // Intentional single-line truncation of ARBITRARY MESSAGE TEXT only (e-mail subject, sender and preview lines,
      // `data-message-text`): user-authored data whose full text opens by tapping the row. Every label, title,
      // count and name of the app's own UI must wrap instead of being cut.
      const preview = n.hasAttribute('data-message-text')
      if (!preview && cs.textOverflow === 'ellipsis' && n.scrollWidth > n.clientWidth + 1) off.push(`${name(n)} is cut to an ellipsis`)
    }
    return off
  })
  expect(report, `${what}: no clipped or sideways-spilling content`).toEqual([])
  const { vw, docSW } = await viewportInfo(page)
  expect(docSW, `${what}: open panel adds no horizontal page overflow`).toBeLessThanOrEqual(vw)
  expect(await page.evaluate(() => window.scrollX), `${what}: the page is not panned sideways`).toBe(0)
}

/** The account identity strip shows the name, the role chip, the e-mail and the sync line in full, inside the panel. */
async function expectIdentityVisible(h: Harness, panel: Locator): Promise<void> {
  const p = await rectOf(panel)
  const strip = panel.locator('[data-account-identity]')
  hard(await strip.count(), 'profile menu: identity strip renders').toBe(1)
  for (const [what, loc] of [
    ['role chip', strip.locator('[data-role-chip]')],
    ['display name', strip.locator('[data-account-name]')],
    ['e-mail', strip.getByText(SESSION_USER.email)],
  ] as const) {
    hard(await loc.count(), `profile menu: ${what} renders`).toBe(1)
    const b = await rectOf(loc)
    expect(b.x, `profile menu: ${what} start edge inside the panel`).toBeGreaterThanOrEqual(p.x - EPS)
    expect(b.r, `profile menu: ${what} end edge inside the panel`).toBeLessThanOrEqual(p.r + EPS)
    const clipped = await loc.evaluate((el) => el.scrollWidth > el.clientWidth + 1)
    expect(clipped, `profile menu: ${what} is not cut off`).toBe(false)
  }
}

/**
 * Optional evidence: with HEADER_SHOTS=<dir> every popover / drawer check also saves viewport screenshots there
 * (open at the top, and scrolled to the end). No-op otherwise, so the suite stays side-effect free.
 */
async function shot(h: Harness, panel: Locator, what: string, state: string): Promise<void> {
  const dir = process.env.HEADER_SHOTS
  if (!dir) return
  const c = h.cell
  const id = `${c.w}x${c.h}-${c.lang}-aa${c.aa}${c.rootPx ? `-root${c.rootPx}` : ''}${c.browserFont ? `-bf${c.browserFont}` : ''}${c.theme ? `-${c.theme}` : ''}${c.safari ? '-safari' : ''}-${what.replace(/\W+/g, '-')}-${state}`
  if (state === 'end') await panel.evaluate((el) => { el.scrollTop = el.scrollHeight })
  await h.page.screenshot({ path: `${dir}/${id}.png` })
  if (state === 'end') await panel.evaluate((el) => { el.scrollTop = 0 })
}

async function expectHeaderGeometry(h: Harness): Promise<void> {
  const { page, cell: c } = h
  const { vw, docSW, root } = await viewportInfo(page)
  const hdr = headerOf(page)
  const hb = await rectOf(hdr)
  expect(hb.x, 'header spans from the left edge').toBeCloseTo(0, 0)
  expect(hb.r, 'header spans to the right edge').toBeCloseTo(vw, 0)
  expect(hb.y, 'header is pinned at the top').toBeCloseTo(0, 0)
  expect(docSW, 'no horizontal page overflow').toBeLessThanOrEqual(vw)
  expect(await page.evaluate(() => window.scrollX), 'the page is not scrolled sideways').toBe(0)
  expect(
    await hdr.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    'header content does not overflow its own box',
  ).toBe(true)

  // Every element in the header stays inside the viewport minus the physical safe insets. (The TopNav destination
  // strip may scroll sideways on touch; its links are checked after scrolling to them, below.)
  const bounds = await hdr.evaluate((el) => {
    const out: Array<{ tag: string; label: string; x: number; r: number }> = []
    for (const node of el.querySelectorAll('*')) {
      if (node.closest('.topnav-destinations')) continue
      const b = node.getBoundingClientRect()
      if (b.width === 0 || b.height === 0) continue
      out.push({
        tag: node.tagName,
        label: node.getAttribute('aria-label') ?? node.textContent?.slice(0, 12) ?? '',
        x: b.x,
        r: b.right,
      })
    }
    return out
  })
  for (const b of bounds) {
    expect(b.x, `${b.tag} "${b.label}" start edge`).toBeGreaterThanOrEqual(c.insets.left - EPS)
    expect(b.r, `${b.tag} "${b.label}" end edge`).toBeLessThanOrEqual(vw - c.insets.right + EPS)
  }

  // The brand mark keeps its 1:1 aspect wherever it shows (it was squeezed into an ellipse / a sliver before).
  const logo = hdr.locator('img[alt="GSSG"]').first()
  if (await logo.isVisible()) {
    const lb = await rectOf(logo)
    expect(Math.abs(lb.w - lb.h), `logo stays square (${Math.round(lb.w)}x${Math.round(lb.h)})`).toBeLessThanOrEqual(1)
    expect(lb.w, 'logo is not collapsed').toBeGreaterThanOrEqual(24)
  }

  if (!isPhoneHeader(c)) {
    // The desktop TopNav (landscape phones and tablets >= 768px land here): same inset + 44px contract for every
    // control, and the same top breathing room as the phone bar. The status-bar / notch inset applies to this tier
    // too (a standalone iPad is 768px+ with a top inset), then >= 12px on top of it; with no inset the row keeps its
    // desktop geometry (0.875rem padding, so the controls start 14px down).
    await expectControls(h, hdr, 'TopNav control')
    const tops = await hdr.locator(CONTROL_SELECTOR).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().y))
    expect(tops.length, 'TopNav has controls').toBeGreaterThan(5)
    for (const y of tops) {
      expect(
        y - c.insets.top,
        `TopNav control sits >= ${BREATHING}px below the status bar / notch inset (y=${y}, inset=${c.insets.top})`,
      ).toBeGreaterThanOrEqual(BREATHING - EPS)
    }
    return
  }

  // The header's own height is arithmetic the popover height cap mirrors (headerPopover.ts): top inset + 0.75rem +
  // the 44px controls + 0.75rem + 1px border. Nothing inside it (a wordmark line box at 200% text, a glyph) may
  // stretch it.
  const expectedH = c.insets.top + 1.5 * root + TARGET + 1
  expect(hb.h, `phone header is ${expectedH}px tall (inset ${c.insets.top} + 1.5 x ${root}px + ${TARGET} + 1), got ${hb.h}`).toBeCloseTo(
    expectedH,
    0,
  )

  // Phone bar: the three header triggers, >= 44px, hit-testable, separated, with real top breathing room.
  const controls = hdr.locator('button')
  await expect(controls).toHaveCount(3)
  const rects: Rect[] = []
  for (let i = 0; i < 3; i += 1) {
    const ctl = controls.nth(i)
    const b = await rectOf(ctl)
    rects.push(b)
    expect(b.w, `control ${i} width`).toBeGreaterThanOrEqual(TARGET - 0.01)
    expect(b.h, `control ${i} height`).toBeGreaterThanOrEqual(TARGET - 0.01)
    expect(
      b.y - c.insets.top,
      `control ${i} sits >= ${BREATHING}px below the status bar / notch inset (y=${b.y}, inset=${c.insets.top})`,
    ).toBeGreaterThanOrEqual(BREATHING - EPS)
    expect(hb.b - b.b, `control ${i} has >= ${BREATHING}px below it inside the header`).toBeGreaterThanOrEqual(BREATHING - EPS)
    expect(b.x, `control ${i} start edge on screen`).toBeGreaterThanOrEqual(-EPS)
    expect(b.r, `control ${i} end edge on screen`).toBeLessThanOrEqual(vw + EPS)
    expect(await hitsAt(ctl, b.x + b.w / 2, b.y + b.h / 2), `header control ${i}: centre must hit the control`).toBe(true)
  }
  const ordered = [...rects].sort((a, b) => a.x - b.x)
  for (let i = 1; i < ordered.length; i += 1) {
    expect(ordered[i].x, 'adjacent header targets do not overlap').toBeGreaterThanOrEqual(ordered[i - 1].r - EPS)
  }
}

async function expectPanelContained(h: Harness, panel: Locator, trigger: Locator, what: string): Promise<void> {
  const { page, cell: c } = h
  const { vw, vh, root } = await viewportInfo(page)
  // Measure the settled box: the notifications panel scales in (anim-pop-in).
  await panel.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)).then(() => undefined))
  const p = await rectOf(panel)
  expect(p.x, `${what}: start edge inside the viewport`).toBeGreaterThanOrEqual(-EPS)
  expect(p.r, `${what}: end edge inside the viewport`).toBeLessThanOrEqual(vw + EPS)
  expect(p.b, `${what}: bottom edge inside the viewport`).toBeLessThanOrEqual(vh + EPS)
  expect(p.x, `${what}: clear of the left safe inset`).toBeGreaterThanOrEqual(c.insets.left - EPS)
  expect(p.r, `${what}: clear of the right safe inset`).toBeLessThanOrEqual(vw - c.insets.right + EPS)
  expect(p.b, `${what}: clear of the home indicator`).toBeLessThanOrEqual(vh - c.insets.bottom + EPS)
  const anchor = isPhoneHeader(c) ? await rectOf(headerOf(page)) : await rectOf(trigger)
  expect(p.y, `${what}: opens below the header / its trigger, not over it`).toBeGreaterThanOrEqual(anchor.b - EPS)
  // The popover never makes the page scroll (it used to hang below the viewport and the focus move scrolled the
  // whole document, taking the header off screen), and on the TopNav tier it stays hung from its own trigger,
  // flush with the trigger's inline-end edge, at any browser default font size.
  const doc = await page.evaluate(() => {
    const s = document.scrollingElement
    return { top: s?.scrollTop ?? 0, sh: s?.scrollHeight ?? 0, ch: s?.clientHeight ?? 0 }
  })
  expect(doc.top, `${what}: the document did not scroll when the panel opened`).toBe(0)
  expect(doc.sh, `${what}: the document has no scroll range (${doc.sh} > ${doc.ch})`).toBeLessThanOrEqual(doc.ch + 1)
  if (!isPhoneHeader(c)) {
    const t = await rectOf(trigger)
    if (c.lang === 'ar') expect(p.x, `${what}: flush with its trigger's inline-end edge (RTL)`).toBeCloseTo(t.x, 0)
    else expect(p.r, `${what}: flush with its trigger's inline-end edge`).toBeCloseTo(t.r, 0)
  }

  // Content taller than the panel must scroll inside it, and the height cap must leave the intended margin:
  // 0.75rem on a phone (the cap mirrors the header's real height), a visible gap on the TopNav tier.
  const overflow = await panel.evaluate((el) => ({
    sh: el.scrollHeight,
    ch: el.clientHeight,
    oy: getComputedStyle(el).overflowY,
  }))
  if (overflow.sh > overflow.ch + 1) {
    expect(['auto', 'scroll'], `${what}: overflowing content scrolls`).toContain(overflow.oy)
    const gap = vh - c.insets.bottom - p.b
    if (isPhoneHeader(c)) {
      expect(gap, `${what}: capped panel leaves 0.75rem (=${0.75 * root}px) above the bottom inset, got ${gap}`).toBeGreaterThanOrEqual(
        0.75 * root - 1.5,
      )
      expect(gap, `${what}: the cap is not wastefully short (gap ${gap})`).toBeLessThanOrEqual(0.75 * root + 1.5)
    } else {
      expect(
        gap,
        `${what}: capped TopNav-tier panel keeps 0.75rem (=${0.75 * root}px) above the bottom inset (gap ${gap})`,
      ).toBeGreaterThanOrEqual(0.75 * root - 1.5)
    }
  }
  // Nothing from the header or page paints over the panel.
  const probes: Array<[number, number]> = [
    [p.x + CORNER_PROBE, p.y + CORNER_PROBE],
    [p.r - CORNER_PROBE, p.y + CORNER_PROBE],
    [p.x + CORNER_PROBE, p.b - CORNER_PROBE],
    [p.r - CORNER_PROBE, p.b - CORNER_PROBE],
    [p.x + p.w / 2, p.y + p.h / 2],
  ]
  for (const [x, y] of probes) {
    expect(await hitsAt(panel, x, y), `${what}: topmost layer at (${Math.round(x)},${Math.round(y)})`).toBe(true)
  }
}

const activeInside = (loc: Locator): Promise<boolean> =>
  loc.evaluate((el) => el === document.activeElement || el.contains(document.activeElement))

/**
 * The open notifications panel is the ONLY thing a finger scrolls on a touch screen: no nested list scroller,
 * a real drag scrolls the panel (never the page behind it or the header), and the footer link is reachable
 * by gesture alone.
 */
async function expectSingleScrollOwner(h: Harness, panel: Locator, what: string): Promise<void> {
  const { page, cell: c } = h
  const list = panel.locator('ul').first()
  hard(await list.count(), `${what}: populated list is rendered`).toBeGreaterThan(0)
  const ls = await list.evaluate((el) => ({ oy: getComputedStyle(el).overflowY, sh: el.scrollHeight, ch: el.clientHeight }))
  if (c.touch) {
    expect(ls.oy, `${what}: the list is not a second scroller inside the scrolling panel`).toBe('visible')
    expect(ls.sh, `${what}: the list shows all of its rows`).toBeLessThanOrEqual(ls.ch + 1)
  }

  const link = panel.locator('a[href*="/ledger"]')
  const markAll = panel.getByRole('button', { name: COPY[c.lang].markAll })
  hard(await link.count(), `${what}: "View all in inbox" renders`).toBe(1)
  hard(await markAll.count(), `${what}: "Mark all read" renders`).toBe(1)

  const dims = await panel.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
  if (!c.touch || dims.sh <= dims.ch + 1) return

  // Real gesture: put the page scroller mid-way first so a leaking drag would visibly move it.
  const scroller = page.locator('[data-ptr-scroller]').first()
  await scroller.evaluate((el) => {
    el.scrollTop = 120
  })
  const pageBefore = await scroller.evaluate((el) => el.scrollTop)
  const headerBefore = await rectOf(headerOf(page))
  const pb = await rectOf(panel)
  const x = Math.round(pb.x + pb.w / 2)
  for (let i = 0; i < 25; i += 1) {
    const top = await panel.evaluate((el) => el.scrollTop)
    if (top + dims.ch >= dims.sh - 1) break
    await touchDrag(h, { x, y: Math.round(pb.y + pb.h * 0.85) }, { x, y: Math.round(pb.y + pb.h * 0.2) })
  }
  const end = await panel.evaluate((el) => ({ top: el.scrollTop, max: el.scrollHeight - el.clientHeight }))
  expect(end.top, `${what}: a touch drag scrolled the panel itself to its end`).toBeGreaterThanOrEqual(end.max - 2)
  expect(await list.evaluate((el) => el.scrollTop), `${what}: the list did not scroll separately`).toBe(0)
  expect(await scroller.evaluate((el) => el.scrollTop), `${what}: the page behind did not scroll`).toBe(pageBefore)
  const headerAfter = await rectOf(headerOf(page))
  expect(headerAfter.y, `${what}: header stayed pinned during the drag`).toBeCloseTo(headerBefore.y, 1)
  expect(headerAfter.h, `${what}: header kept its height during the drag`).toBeCloseTo(headerBefore.h, 1)

  // At the end of the gesture the footer link is on screen and tappable without any scrollIntoView.
  const { vw, vh } = await viewportInfo(page)
  const lb = await rectOf(link)
  expect(lb.b, `${what}: footer link visible after the gesture (bottom ${lb.b})`).toBeLessThanOrEqual(vh - c.insets.bottom + EPS)
  expect(lb.y, `${what}: footer link visible after the gesture (top ${lb.y})`).toBeGreaterThanOrEqual(headerBefore.b - EPS)
  expect(lb.r, 'footer link inside the viewport').toBeLessThanOrEqual(vw + EPS)
  expect(await hitsAt(link, lb.x + lb.w / 2, lb.y + lb.h / 2), `${what}: footer link is tappable after the gesture`).toBe(true)
  expect(lb.h, `${what}: footer link is a >= ${TARGET}px target`).toBeGreaterThanOrEqual(TARGET - 0.01)

  // And back up: the top row and "Mark all read" return without moving the page.
  for (let i = 0; i < 25; i += 1) {
    if ((await panel.evaluate((el) => el.scrollTop)) <= 1) break
    await touchDrag(h, { x, y: Math.round(pb.y + pb.h * 0.2) }, { x, y: Math.round(pb.y + pb.h * 0.85) })
  }
  expect(await panel.evaluate((el) => el.scrollTop), `${what}: dragging back down returns to the top`).toBeLessThanOrEqual(2)
  expect(await scroller.evaluate((el) => el.scrollTop), `${what}: the page behind still did not scroll`).toBe(pageBefore)
  const mb = await rectOf(markAll)
  expect(mb.h, `${what}: "Mark all read" is a >= ${TARGET}px target`).toBeGreaterThanOrEqual(TARGET - 0.01)
  expect(mb.w, `${what}: "Mark all read" is >= ${TARGET}px wide`).toBeGreaterThanOrEqual(TARGET - 0.01)
  await scroller.evaluate((el) => {
    el.scrollTop = 0
  })
}

async function exercisePopover(h: Harness, trigger: Locator, kind: 'account' | 'notifications'): Promise<void> {
  const { page, cell: c } = h
  const what = kind === 'account' ? 'profile menu' : 'notifications'
  const panel = dialogOf(h, kind)

  // Pointer / touch flow. Focus return is asserted on EVERY close, including with Safari-like taps that never
  // focus the trigger in the first place.
  await press(c, trigger)
  await hard(panel, `${what}: opens`).toBeVisible()
  await expectPanelContained(h, panel, trigger, what)
  await expectNoClip(h, panel, what)
  await shot(h, panel, what, 'top')
  await shot(h, panel, what, 'end')
  await expectControls(h, panel, what)
  if (kind === 'notifications' && c.rich) await expectSingleScrollOwner(h, panel, what)
  if (kind === 'account') await expectIdentityVisible(h, panel)
  expect(await activeInside(panel), `${what}: focus moves into the dialog on open`).toBe(true)

  await page.keyboard.press('Escape')
  await expect(panel, `${what}: Escape closes`).toBeHidden()
  await expect(trigger, `${what}: Escape returns focus to the trigger (tap focus: ${c.safari ? 'no' : 'yes'})`).toBeFocused()

  await press(c, trigger)
  await hard(panel, `${what}: re-opens`).toBeVisible()
  const spot = await blankPoint(page, panel)
  await pressAt(page, c, spot.x, spot.y)
  await expect(panel, `${what}: outside tap closes`).toBeHidden()

  await press(c, trigger)
  await hard(panel).toBeVisible()
  await press(c, trigger)
  await expect(panel, `${what}: trigger toggles closed`).toBeHidden()

  // Keyboard flow: activate the focused trigger, dismiss, and land back on the trigger.
  await trigger.focus()
  await page.keyboard.press('Enter')
  await hard(panel, `${what}: Enter opens`).toBeVisible()
  expect(await activeInside(panel), `${what}: keyboard open moves focus into the dialog`).toBe(true)
  await page.keyboard.press('Escape')
  await expect(panel, `${what}: Escape closes (keyboard)`).toBeHidden()
  await expect(trigger, `${what}: Escape returns focus to the trigger`).toBeFocused()

  await page.keyboard.press('Enter')
  await hard(panel, `${what}: Enter re-opens`).toBeVisible()
  const again = await blankPoint(page, panel)
  await pressAt(page, c, again.x, again.y)
  await expect(panel, `${what}: outside tap closes (keyboard-opened)`).toBeHidden()
  await expect(trigger, `${what}: outside tap returns focus to the trigger`).toBeFocused()
}

// ───────────────────────────── the matrix ─────────────────────────────────

const PHONES: Array<[string, Cell]> = [
  ['320x568 en Aa16 (inset 20)', cell(320, 568, { insets: portrait(20, 0) })],
  ['320x568 ar Aa16', cell(320, 568, { lang: 'ar', insets: portrait(20, 0) })],
  ['320x568 en Aa24', cell(320, 568, { aa: 24, insets: portrait(20, 0) })],
  ['320x568 ar Aa24', cell(320, 568, { lang: 'ar', aa: 24, insets: portrait(20, 0) })],
  ['360x640 ar Aa16 (no notch)', cell(360, 640, { lang: 'ar' })],
  ['375x667 en Aa19', cell(375, 667, { aa: 19, insets: portrait(20, 0) })],
  ['390x844 en Aa16 (notch 47/34)', cell(390, 844, { insets: portrait(47, 34) })],
  ['390x844 ar Aa16 (notch 47/34)', cell(390, 844, { lang: 'ar', insets: portrait(47, 34) })],
  ['390x844 en Aa24', cell(390, 844, { aa: 24, insets: portrait(47, 34) })],
  ['390x844 ar Aa24', cell(390, 844, { lang: 'ar', aa: 24, insets: portrait(47, 34) })],
  ['430x932 en Aa16 (island 59/34)', cell(430, 932, { insets: portrait(59, 34) })],
  ['430x932 ar Aa22', cell(430, 932, { lang: 'ar', aa: 22, insets: portrait(59, 34) })],
  ['667x375 en landscape (notch 47/47)', cell(667, 375, { insets: landscape(47, 47) })],
  ['667x375 ar landscape (notch 47/47)', cell(667, 375, { lang: 'ar', insets: landscape(47, 47) })],
  ['667x375 en landscape Aa24', cell(667, 375, { aa: 24, insets: landscape(47, 47) })],
  ['740x360 en landscape (no insets)', cell(740, 360, { insets: NO_INSETS })],
  ['390x844 en Safari-like taps (no tap focus)', cell(390, 844, { safari: true, insets: portrait(47, 34) })],
  ['667x375 ar landscape Safari-like taps', cell(667, 375, { lang: 'ar', safari: true, insets: landscape(47, 47) })],
  ['390x844 en thin capability set, empty bell', cell(390, 844, { rich: false, insets: portrait(47, 34) })],
  ['320x568 en Aa24 thin capability set, empty bell', cell(320, 568, { rich: false, aa: 24, insets: portrait(20, 0) })],
]

// >= 768px renders the desktop TopNav, including landscape phones/tablets.
const WIDE: Array<[string, Cell]> = [
  ['844x390 en landscape phone (TopNav tier, notch 47/47)', cell(844, 390, { insets: landscape(47, 47) })],
  ['844x390 ar landscape phone (TopNav tier, notch 47/47)', cell(844, 390, { lang: 'ar', insets: landscape(47, 47) })],
  ['844x390 en landscape phone Aa24', cell(844, 390, { aa: 24, insets: landscape(47, 47) })],
  ['932x430 en landscape phone (TopNav tier, island 59/59)', cell(932, 430, { insets: landscape(59, 59) })],
  ['932x430 ar landscape phone (TopNav tier, island 59/59)', cell(932, 430, { lang: 'ar', insets: landscape(59, 59) })],
  ['844x390 en thin capability set, empty bell', cell(844, 390, { rich: false, insets: landscape(47, 47) })],
  ['768x1024 en tablet', cell(768, 1024, { insets: portrait(24, 20) })],
  ['768x1024 ar tablet', cell(768, 1024, { lang: 'ar', insets: portrait(24, 20) })],
  ['1024x1366 en tablet (touch, top inset 24)', cell(1024, 1366, { touch: true, insets: portrait(24, 20) })],
  ['1024x768 en Aa19 desktop (mouse)', cell(1024, 768, { aa: 19, touch: false, dpr: 1 })],
  ['1280x800 en desktop (mouse)', cell(1280, 800, { touch: false, dpr: 1 })],
  ['1280x800 ar desktop (mouse)', cell(1280, 800, { lang: 'ar', touch: false, dpr: 1 })],
]

// Beyond the app's own range (Aa 24, >= 320px). Root 32px is "200% text"; the 195/160px viewports are a 390/320px
// phone at 200% BROWSER zoom (zoom never being disabled by the viewport meta). Full contract everywhere.
const STRESS: Array<[string, Cell]> = [
  ['320x568 en, root text 32px (200%)', cell(320, 568, { rootPx: 32, insets: portrait(20, 0) })],
  ['320x568 ar, root text 32px (200%)', cell(320, 568, { lang: 'ar', rootPx: 32, insets: portrait(20, 0) })],
  ['390x844 en, root text 32px (200%)', cell(390, 844, { rootPx: 32, insets: portrait(47, 34) })],
  ['195x422 en, 390px phone at 200% zoom', cell(195, 422, { dpr: 4, insets: portrait(24, 17) })],
  ['160x284 ar, 320px phone at 200% zoom', cell(160, 284, { lang: 'ar', dpr: 4, insets: portrait(10, 0) })],
  ['160x284 en, 320px phone at 200% zoom', cell(160, 284, { dpr: 4, insets: portrait(10, 0) })],
  ['667x375 en landscape, root text 32px (200%)', cell(667, 375, { rootPx: 32, insets: landscape(47, 47) })],
  ['667x375 ar landscape, root text 32px (200%)', cell(667, 375, { lang: 'ar', rootPx: 32, insets: landscape(47, 47) })],
  ['740x360 en landscape, root text 32px (200%, no insets)', cell(740, 360, { rootPx: 32, insets: NO_INSETS })],
  ['195x422 ar, 390px phone at 200% zoom', cell(195, 422, { lang: 'ar', dpr: 4, insets: portrait(24, 17) })],
]

test.describe('phone header', () => {
  for (const [name, c] of [...PHONES, ...STRESS]) {
    test(`header geometry, profile and bell popovers — ${name}`, async ({ browser }) => {
      const h = await openApp(browser, c)
      try {
        await expectHeaderGeometry(h)
        await exercisePopover(h, avatarOf(h.page), 'account')
        await exercisePopover(h, bellOf(h.page, c.lang), 'notifications')
        await expectHeaderGeometry(h)
        expect(h.unmocked, 'every /api/v1 request is stubbed').toEqual([])
      } finally {
        await h.ctx.close()
      }
    })
  }

  test('opening one popover closes the other', async ({ browser }) => {
    const h = await openApp(browser, cell(390, 844, { insets: portrait(47, 34) }))
    try {
      const { page, cell: c } = h
      await press(c, avatarOf(page))
      await hard(dialogOf(h, 'account')).toBeVisible()
      await press(c, bellOf(page, c.lang))
      await hard(dialogOf(h, 'notifications')).toBeVisible()
      await expect(dialogOf(h, 'account')).toBeHidden()
      expect(h.unmocked).toEqual([])
    } finally {
      await h.ctx.close()
    }
  })
})

test.describe('landscape phones on the desktop TopNav tier and desktop popovers', () => {
  for (const [name, c] of WIDE) {
    test(`header, profile and bell popovers — ${name}`, async ({ browser }) => {
      const h = await openApp(browser, c)
      try {
        await expectHeaderGeometry(h)
        await exercisePopover(h, avatarOf(h.page), 'account')
        await exercisePopover(h, bellOf(h.page, c.lang), 'notifications')
        expect(h.unmocked, 'every /api/v1 request is stubbed').toEqual([])
      } finally {
        await h.ctx.close()
      }
    })
  }

  for (const lang of ['en', 'ar'] as const) {
    test(`desktop mouse layout is unchanged: compact controls, 20rem profile popover inline-end aligned — ${lang}`, async ({
      browser,
    }) => {
      const h = await openApp(browser, cell(1280, 800, { lang, touch: false, dpr: 1 }))
      try {
        const { page } = h
        // Mouse desktop keeps the compact widgets: none of the coarse-pointer 44px rules may leak into it.
        const compact = async (loc: Locator, what: string, maxH = 36): Promise<void> => {
          const b = await rectOf(loc.first())
          expect(b.h, `desktop ${what} stays compact (${Math.round(b.w)}x${Math.round(b.h)})`).toBeLessThanOrEqual(maxH)
        }
        const hdr = headerOf(page)
        expect((await rectOf(hdr)).h, 'desktop TopNav keeps its height').toBeLessThanOrEqual(76)
        // With no inset the row keeps its pre-existing geometry: 0.875rem of padding above and below.
        expect(await hdr.evaluate((el) => getComputedStyle(el).paddingTop), 'desktop TopNav keeps its 14px top padding').toBe('14px')
        await compact(hdr.locator('[data-topnav-aa] button'), 'text-size A button', 30)
        await compact(hdr.locator('label:has(input[type=checkbox])'), 'theme switch', 30)
        await compact(hdr.locator('[data-topnav-language-label]').locator('xpath=..'), 'language toggle')
        await compact(bellOf(page, lang), 'bell', 42)
        await compact(avatarOf(page), 'avatar', 42)

        await avatarOf(page).click()
        const panel = dialogOf(h, 'account')
        await hard(panel).toBeVisible()
        const p = await rectOf(panel)
        const t = await rectOf(avatarOf(page))
        expect(p.w, 'panel width unchanged on desktop').toBeCloseTo(320, 0)
        if (lang === 'en') expect(p.r, 'ends where the trigger ends').toBeCloseTo(t.r, 0)
        else expect(p.x, 'ends where the trigger ends (RTL)').toBeCloseTo(t.x, 0)
        const steppers = panel.locator('div.grid button')
        const nStep = await steppers.count()
        expect(nStep, 'lock timer and layout buttons render').toBeGreaterThanOrEqual(5)
        for (let i = 0; i < nStep; i += 1) {
          const b = await rectOf(steppers.nth(i))
          expect(b.h, `desktop lock control ${i} keeps its 30px height`).toBeCloseTo(30, 0)
          expect(b.w, `desktop lock control ${i} keeps its compact width (${b.w})`).toBeLessThanOrEqual(37)
        }
        await page.keyboard.press('Escape')

        // The populated bell keeps its capped, internally scrolling list on a mouse desktop.
        await bellOf(page, lang).click()
        const bell = dialogOf(h, 'notifications')
        await hard(bell).toBeVisible()
        await bell.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)).then(() => undefined))
        expect((await rectOf(bell)).w, 'bell panel keeps its 380px width').toBeCloseTo(380, 0)
        const list = await bell.locator('ul').first().evaluate((el) => ({
          oy: getComputedStyle(el).overflowY,
          mh: getComputedStyle(el).maxHeight,
        }))
        expect(list, 'desktop notification list keeps its own 360px scroller').toEqual({ oy: 'auto', mh: '360px' })
        const markAll = await rectOf(bell.getByRole('button', { name: COPY[lang].markAll }))
        expect(markAll.h, `desktop "Mark all read" stays a text link (h=${markAll.h})`).toBeLessThanOrEqual(24)
        expect(h.unmocked).toEqual([])
      } finally {
        await h.ctx.close()
      }
    })
  }
})

test.describe('populated notifications panel: single scroll owner under a real gesture', () => {
  for (const [name, c] of [
    ['390x844 en', cell(390, 844, { insets: portrait(47, 34) })],
    ['390x844 ar', cell(390, 844, { lang: 'ar', insets: portrait(47, 34) })],
    ['320x568 en Aa24', cell(320, 568, { aa: 24, insets: portrait(20, 0) })],
    ['667x375 en landscape', cell(667, 375, { insets: landscape(47, 47) })],
    ['667x375 ar landscape', cell(667, 375, { lang: 'ar', insets: landscape(47, 47) })],
    ['844x390 en landscape phone (TopNav tier)', cell(844, 390, { insets: landscape(47, 47) })],
    ['932x430 ar landscape phone (TopNav tier)', cell(932, 430, { lang: 'ar', insets: landscape(59, 59) })],
  ] as Array<[string, Cell]>) {
    test(`panel scrolls, list does not, footer reachable by drag — ${name}`, async ({ browser }) => {
      const h = await openApp(browser, c)
      try {
        const { page } = h
        await press(c, bellOf(page, c.lang))
        const panel = dialogOf(h, 'notifications')
        await hard(panel).toBeVisible()
        await expectPanelContained(h, panel, bellOf(page, c.lang), 'notifications')
        const dims = await panel.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
        expect(dims.sh, 'populated panel is taller than its cap in this cell').toBeGreaterThan(dims.ch + 1)
        await expectSingleScrollOwner(h, panel, 'notifications')
        expect(h.unmocked).toEqual([])
      } finally {
        await h.ctx.close()
      }
    })
  }
})

test.describe('pinned header over the real page scroller', () => {
  for (const [name, c] of [
    ['390x844 en', cell(390, 844, { insets: portrait(47, 34) })],
    ['390x844 ar Aa24', cell(390, 844, { lang: 'ar', aa: 24, insets: portrait(47, 34) })],
    ['667x375 en landscape', cell(667, 375, { insets: landscape(47, 47) })],
  ] as Array<[string, Cell]>) {
    test(`a real touch scroll gesture moves the page, not the header — ${name}`, async ({ browser }) => {
      const h = await openApp(browser, c)
      try {
        const { page } = h
        const scroller = page.locator('[data-ptr-scroller]').first()
        const before = await rectOf(headerOf(page))
        const sizes = await scroller.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
        expect(sizes.sh, 'fixture page is taller than its scroller').toBeGreaterThan(sizes.ch + 200)
        expect(
          await page.evaluate(() => {
            const se = document.scrollingElement as HTMLElement
            return se.scrollHeight <= se.clientHeight
          }),
          'the document itself never scrolls; the page scroller owns scrolling',
        ).toBe(true)

        const sb = await rectOf(scroller)
        const x = Math.round(sb.x + sb.w / 2)
        // Finger drags up over the page content: the page scroller must follow.
        await touchDrag(h, { x, y: Math.round(sb.y + sb.h * 0.8) }, { x, y: Math.round(sb.y + sb.h * 0.2) })
        await expect
          .poll(() => scroller.evaluate((el) => el.scrollTop), { message: 'touch drag scrolled the page scroller' })
          .toBeGreaterThan(50)
        // Finger drags over the header itself, down and up: nothing scrolls or rubber-bands it away.
        const hb = await rectOf(headerOf(page))
        const hy = Math.round(hb.b - 6)
        await touchDrag(h, { x, y: hy }, { x, y: hy + 160 })
        await touchDrag(h, { x, y: hy }, { x: x + 40, y: Math.max(1, hy - 90) })

        const after = await rectOf(headerOf(page))
        expect(after.y, 'header did not move').toBeCloseTo(before.y, 1)
        expect(after.h, 'header did not change height').toBeCloseTo(before.h, 1)
        expect(
          await page.evaluate(() => ({
            doc: document.scrollingElement?.scrollTop ?? -1,
            vv: window.visualViewport?.offsetTop ?? -1,
          })),
          'document / visual viewport stayed put',
        ).toEqual({ doc: 0, vv: 0 })
        await expectHeaderGeometry(h)

        // Still usable while the page is scrolled: the popover opens inside the viewport.
        await press(h.cell, avatarOf(page))
        const panel = dialogOf(h, 'account')
        await hard(panel).toBeVisible()
        await expectPanelContained(h, panel, avatarOf(page), 'profile menu over a scrolled page')
        await page.keyboard.press('Escape')
        expect(h.unmocked).toEqual([])
      } finally {
        await h.ctx.close()
      }
    })
  }
})

test.describe('navigation drawer', () => {
  const DRAWERS: Array<[string, Cell]> = [
    ['390x844 en', cell(390, 844, { insets: portrait(47, 34) })],
    ['390x844 en Safari-like taps (no tap focus)', cell(390, 844, { safari: true, insets: portrait(47, 34) })],
    ['390x844 ar Aa24', cell(390, 844, { lang: 'ar', aa: 24, insets: portrait(47, 34) })],
    ['390x844 ar Aa24 Safari-like taps', cell(390, 844, { lang: 'ar', aa: 24, safari: true, insets: portrait(47, 34) })],
    ['430x932 en Aa22', cell(430, 932, { aa: 22, insets: portrait(59, 34) })],
    ['320x568 en Aa24', cell(320, 568, { aa: 24, insets: portrait(20, 0) })],
    ['320x568 ar Aa16 Safari-like taps', cell(320, 568, { lang: 'ar', safari: true, insets: portrait(20, 0) })],
    ['320x568 en, root text 32px (200%)', cell(320, 568, { rootPx: 32, insets: portrait(20, 0) })],
    ['195x422 en, 390px phone at 200% zoom', cell(195, 422, { dpr: 4, insets: portrait(24, 17) })],
    ['160x284 ar, 320px phone at 200% zoom', cell(160, 284, { lang: 'ar', dpr: 4, insets: portrait(10, 0) })],
    ['667x375 en landscape', cell(667, 375, { insets: landscape(47, 47) })],
    ['667x375 ar landscape Safari-like taps', cell(667, 375, { lang: 'ar', safari: true, insets: landscape(47, 47) })],
  ]
  for (const [name, c] of DRAWERS) {
    test(`drawer opens inside the viewport, every control is a 44px target, focus returns to the button — ${name}`, async ({
      browser,
    }) => {
      const h = await openApp(browser, c)
      try {
        const { page, cell: cc } = h
        const { vw, vh } = await viewportInfo(page)
        const burger = menuButtonOf(page, cc.lang)
        await press(cc, burger)
        const drawer = dialogOf(h, 'menu')
        await hard(drawer).toBeVisible()
        await page.waitForTimeout(450) // slide-in animation
        const d = await rectOf(drawer)
        expect(d.x, 'drawer start edge on screen').toBeGreaterThanOrEqual(-EPS)
        expect(d.r, 'drawer end edge on screen').toBeLessThanOrEqual(vw + EPS)
        expect(vw - d.w, 'a strip of page >= 44px stays visible to tap-to-close').toBeGreaterThanOrEqual(TARGET - EPS)
        expect(d.b, 'drawer bottom').toBeLessThanOrEqual(vh + EPS)

        // Every link, button, slider and switch in the drawer — header close, nav links, the Aa A / slider / A,
        // the language toggle and the theme switch — reachable, tappable and (touch) >= 44 x 44.
        const count = await drawer.locator(CONTROL_SELECTOR).count()
        expect(count, 'drawer has links, the Aa row, language and theme controls').toBeGreaterThan(9)
        await expectControls(h, drawer, 'drawer')
        await expectNoClip(h, drawer, 'drawer')
        await shot(h, drawer, 'drawer', 'top')
        await shot(h, drawer, 'drawer', 'end')
        expect(
          await drawer.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          'drawer content does not overflow sideways',
        ).toBe(true)
        // The text-size and language rows belong to the drawer, and the language toggle is not English-only
        // by locator: it is found by structure.
        await expect(drawer.locator('[data-topnav-aa] button')).toHaveCount(2)
        await expect(drawer.locator('[data-topnav-language-label]')).toHaveCount(1)

        const close = drawer.getByRole('button', { name: COPY[cc.lang].close })
        await drawer.evaluate((el) => {
          el.scrollTop = 0
        })
        const cb = await rectOf(close)
        expect(cb.w).toBeGreaterThanOrEqual(TARGET - 0.01)
        expect(cb.h).toBeGreaterThanOrEqual(TARGET - 0.01)

        // Escape closes and focus returns to the menu BUTTON even when the tap never focused it.
        await page.keyboard.press('Escape')
        await expect(drawer, 'Escape closes the drawer').toBeHidden()
        await expect(burger, `Escape returns focus to the menu button (tap focus: ${cc.safari ? 'no' : 'yes'})`).toBeFocused()

        // Tap on the scrim strip beside the drawer closes it, and focus is back on the button.
        await press(cc, burger)
        await hard(drawer).toBeVisible()
        await page.waitForTimeout(450)
        const db = await rectOf(drawer)
        const stripX = cc.lang === 'ar' ? db.x / 2 : (db.r + vw) / 2
        await pressAt(page, cc, stripX, vh / 2)
        await expect(drawer, 'tapping the scrim closes the drawer').toBeHidden()
        await expect(burger, 'scrim tap returns focus to the menu button').toBeFocused()

        // The Close button too.
        await press(cc, burger)
        await hard(drawer).toBeVisible()
        await page.waitForTimeout(450)
        await press(cc, close)
        await expect(drawer, 'the Close button closes the drawer').toBeHidden()
        await expect(burger, 'Close returns focus to the menu button').toBeFocused()

        // Keyboard: Enter on the focused menu button opens, Escape / scrim tap close and focus returns.
        await burger.focus()
        await page.keyboard.press('Enter')
        await hard(drawer, 'Enter opens the drawer').toBeVisible()
        await page.keyboard.press('Escape')
        await expect(drawer).toBeHidden()
        await expect(burger, 'keyboard: Escape returns focus to the menu button').toBeFocused()
        expect(h.unmocked).toEqual([])
      } finally {
        await h.ctx.close()
      }
    })
  }
})

test.describe('viewport meta', () => {
  test('pinch zoom stays allowed and the page opts into edge-to-edge insets', async ({ browser }) => {
    const h = await openApp(browser, cell(390, 844, { insets: portrait(47, 34) }))
    try {
      const content = await h.page.locator('meta[name="viewport"]').getAttribute('content')
      expect(content).toContain('viewport-fit=cover')
      expect(content).not.toMatch(/user-scalable\s*=\s*(no|0)/)
      expect(content).not.toMatch(/maximum-scale/)
      // iOS Home Screen apps can letterbox the standalone viewport when this
      // legacy translucent status-bar mode is requested. Keep the OS-managed
      // status bar instead of trying to offset a fixed dock into an unavailable band.
      const statusBarMeta = h.page.locator('meta[name="apple-mobile-web-app-status-bar-style"]')
      const statusBarStyle = (await statusBarMeta.count()) > 0 ? await statusBarMeta.getAttribute('content') : null
      expect(statusBarStyle).not.toBe('black-translucent')
    } finally {
      await h.ctx.close()
    }
  })
})

// ───────────────────── browser default font size (not the CSS root font size) ─────────────────────
//
// The app picks the phone bar vs the desktop TopNav with a px query (`useIsMobile`, 767px). Tailwind's `md` is
// 48rem, and `rem` inside a media query follows the BROWSER's default font size, not the html font-size the Aa
// control sets. With a larger default font `md` moves up (864 / 960 / 1152 px at 18 / 20 / 24px), so for a while the
// app renders the TopNav while every `md:` rule is off: the popovers must follow the bar that RENDERS, not `md`.
// Below 16px the opposite happens (the phone bar renders above 48rem), and `md:hidden` must not hide the phone bar.
const BROWSER_FONT: Array<[string, Cell]> = [
  ['844x390 en landscape phone, browser font 18px (md = 864px, TopNav renders)', cell(844, 390, { browserFont: 18, insets: landscape(47, 47) })],
  ['900x800 en mouse, browser font 20px (md = 960px, TopNav renders)', cell(900, 800, { browserFont: 20, touch: false, dpr: 1 })],
  ['900x800 ar mouse, browser font 20px', cell(900, 800, { lang: 'ar', browserFont: 20, touch: false, dpr: 1 })],
  ['900x600 en tablet touch, browser font 20px', cell(900, 600, { browserFont: 20, insets: landscape(47, 47) })],
  ['1024x768 en mouse, browser font 24px (md = 1152px, TopNav renders)', cell(1024, 768, { browserFont: 24, touch: false, dpr: 1 })],
  ['1024x768 ar mouse, browser font 24px', cell(1024, 768, { lang: 'ar', browserFont: 24, touch: false, dpr: 1 })],
  ['390x844 en phone bar, browser font 24px', cell(390, 844, { browserFont: 24, insets: portrait(47, 34) })],
  ['667x375 en landscape phone bar, browser font 24px', cell(667, 375, { browserFont: 24, insets: landscape(47, 47) })],
  ['700x800 en phone bar, browser font 12px (md = 576px, so `md:hidden` must not hide the bar)', cell(700, 800, { browserFont: 12, insets: portrait(20, 0) })],
]

test.describe('browser default font size', () => {
  for (const [name, c] of BROWSER_FONT) {
    test(`the bar that renders owns the popover placement; the document never scrolls — ${name}`, async ({ browser }) => {
      const h = await openApp(browser, c)
      try {
        await expectHeaderGeometry(h)
        await exercisePopover(h, avatarOf(h.page), 'account')
        await exercisePopover(h, bellOf(h.page, c.lang), 'notifications')
        await expectHeaderGeometry(h)
        expect(h.unmocked, 'every /api/v1 request is stubbed').toEqual([])
      } finally {
        await h.ctx.close()
      }
    })
  }
})

// ───────────────────── desktop popover height follows the real header ─────────────────────

test.describe('TopNav popover height', () => {
  for (const [name, c, scrolls] of [
    ['1024x768 Aa22 mouse', cell(1024, 768, { aa: 22, touch: false, dpr: 1 }), true],
    ['1024x768 Aa24 mouse', cell(1024, 768, { aa: 24, touch: false, dpr: 1 }), true],
    ['1280x800 Aa16 mouse', cell(1280, 800, { touch: false, dpr: 1 }), false],
    ['768x1024 touch, top inset 24', cell(768, 1024, { insets: portrait(24, 20) }), false],
  ] as Array<[string, Cell, boolean]>) {
    test(`the account panel gets all the room under the header, no flat guess — ${name}`, async ({ browser }) => {
      const h = await openApp(browser, c)
      try {
        const { page } = h
        await press(c, avatarOf(page))
        const panel = dialogOf(h, 'account')
        await hard(panel).toBeVisible()
        await expectPanelContained(h, panel, avatarOf(page), 'profile menu')
        const m = await panel.evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight }))
        const { vh, root } = await viewportInfo(page)
        const p = await rectOf(panel)
        const gap = vh - c.insets.bottom - p.b
        // The room under the header is 100dvh - panel top - bottom inset - 0.75rem. Whatever the content needs up to
        // that, the panel gets: it ends at the margin when the content is taller, and shows everything when not.
        // (The old flat `6rem` cap wasted ~30px at Aa22: the avatar trigger grows with the text size, a fixed cap did not.)
        if (m.sh > m.ch + 1) {
          expect(scrolls, `the panel is taller than the room under the header in this cell (${m.sh} > ${m.ch})`).toBe(true)
          expect(gap, `a taller panel is capped at the 0.75rem margin, no earlier (gap ${gap}, panel ${p.y}..${p.b} of ${vh})`).toBeLessThanOrEqual(
            0.75 * root + 6,
          )
        } else {
          expect(scrolls, `the panel fits under the header in this cell (${m.sh} <= ${m.ch})`).toBe(false)
        }
        // Everything stays reachable: each control scrolls into view inside the panel.
        await expectControls(h, panel, 'profile menu')
        expect(h.unmocked).toEqual([])
      } finally {
        await h.ctx.close()
      }
    })
  }
})

// ───────────────────── TopNav destinations strip: visible overflow cue (touch) ─────────────────────

/**
 * True when the strip's own background paints something in the 6px at its `edge` (the covers are solid for 8px). The links are hidden for the
 * measurement (their text anti-aliasing differs with or without a background layer and would read as a cue), and
 * the same pixels are captured with and without the strip's background layers: a cue exists exactly when they differ.
 */
async function stripPaintsCue(page: Page, strip: Locator, edge: 'left' | 'right'): Promise<boolean> {
  const b = await rectOf(strip)
  const clip = { x: edge === 'left' ? b.x : b.r - 6, y: b.y, width: 6, height: Math.max(1, b.h - 14) }
  const hide = await page.addStyleTag({ content: '[data-topnav] .topnav-destinations > *{visibility:hidden !important}' })
  const withCue = await page.screenshot({ clip, animations: 'disabled' })
  const style = await page.addStyleTag({ content: '[data-topnav] .topnav-destinations{background-image:none !important}' })
  const without = await page.screenshot({ clip, animations: 'disabled' })
  await style.evaluate((el) => el.remove())
  await hide.evaluate((el) => el.remove())
  return !withCue.equals(without)
}

test.describe('TopNav destinations strip scrolls on touch and shows it', () => {
  for (const [name, c] of [
    ['844x390 en Aa24 (3 of 6 destinations visible at rest)', cell(844, 390, { aa: 24, insets: landscape(47, 47) })],
    ['844x390 ar Aa24', cell(844, 390, { lang: 'ar', aa: 24, insets: landscape(47, 47) })],
    ['932x430 en Aa24', cell(932, 430, { aa: 24, insets: landscape(59, 59) })],
    ['768x1024 en Aa16 tablet', cell(768, 1024, { insets: portrait(24, 20) })],
    ['768x1024 ar Aa16 tablet', cell(768, 1024, { lang: 'ar', insets: portrait(24, 20) })],
    ['844x390 en Aa24, dark theme', cell(844, 390, { aa: 24, theme: 'dark', insets: landscape(47, 47) })],
  ] as Array<[string, Cell]>) {
    test(`a cue marks the edge with hidden destinations and follows the scroll position — ${name}`, async ({ browser }) => {
      const h = await openApp(browser, c)
      try {
        const { page } = h
        const strip = headerOf(page).locator('.topnav-destinations')
        const m = await strip.evaluate((el) => ({ sw: el.scrollWidth, cw: el.clientWidth }))
        hard(m.sw, `this cell's strip overflows (${m.sw} > ${m.cw})`).toBeGreaterThan(m.cw + 1)
        // Hidden destinations are past the inline-end edge at rest (LTR: right, RTL: left), past the other one at the end.
        const rtl = c.lang === 'ar'
        const ahead = rtl ? 'left' : 'right'
        const behind = rtl ? 'right' : 'left'
        expect(await stripPaintsCue(page, strip, ahead), `cue on the ${ahead} edge: destinations are hidden past it at rest`).toBe(true)
        expect(await stripPaintsCue(page, strip, behind), `no cue on the ${behind} edge at rest: nothing is hidden past it`).toBe(false)
        const dir = process.env.HEADER_SHOTS
        if (dir) await page.screenshot({ path: `${dir}/topnav-strip-${c.w}x${c.h}-${c.lang}-aa${c.aa}${c.theme ? `-${c.theme}` : ''}-rest.png`, clip: { x: 0, y: 0, width: c.w, height: Math.min(c.h, 140) } })
        // A finger swipe reaches the rest: scroll the strip to its end the way the browser does.
        await strip.evaluate((el, dirSign) => {
          el.scrollLeft = dirSign * (el.scrollWidth - el.clientWidth)
        }, rtl ? -1 : 1)
        await page.waitForTimeout(150)
        expect(await stripPaintsCue(page, strip, behind), `cue on the ${behind} edge: destinations are hidden past it at the end`).toBe(true)
        expect(await stripPaintsCue(page, strip, ahead), `no cue on the ${ahead} edge at the end`).toBe(false)
        if (dir) await page.screenshot({ path: `${dir}/topnav-strip-${c.w}x${c.h}-${c.lang}-aa${c.aa}${c.theme ? `-${c.theme}` : ''}-end.png`, clip: { x: 0, y: 0, width: c.w, height: Math.min(c.h, 140) } })
        expect(h.unmocked).toEqual([])
      } finally {
        await h.ctx.close()
      }
    })
  }

  test('a mouse desktop gets no cue: its strip never scrolls', async ({ browser }) => {
    const h = await openApp(browser, cell(1280, 800, { touch: false, dpr: 1 }))
    try {
      const strip = headerOf(h.page).locator('.topnav-destinations')
      expect(await stripPaintsCue(h.page, strip, 'left'), 'no cue on the left edge').toBe(false)
      expect(await stripPaintsCue(h.page, strip, 'right'), 'no cue on the right edge').toBe(false)
    } finally {
      await h.ctx.close()
    }
  })
})

// ───────────────────── keyboard: Tab order and focus inside the panels ─────────────────────

const TABBABLE = 'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'

/** Tags every tabbable, rendered control of `root` with its DOM position and returns how many there are. */
const tagTabbables = (root: Locator): Promise<number> =>
  root.evaluate((el, sel) => {
    // A visually hidden checkbox (the theme switch) has no box of its own: its <label> is the control on screen.
    const boxOf = (e: HTMLElement): DOMRect => {
      const r = e.getBoundingClientRect()
      return r.width === 0 || r.height === 0 ? (e.closest('label') ?? e).getBoundingClientRect() : r
    }
    const list = [...el.querySelectorAll<HTMLElement>(sel)].filter((e) => {
      const r = boxOf(e)
      return r.width > 0 && r.height > 0 && !(e as HTMLButtonElement).disabled && e.tabIndex >= 0
    })
    // Blurred focus-indicator signature of every control (see focusedIn): focus must change it.
    const sig = (e: HTMLElement): string => {
      const label = e.closest('label')
      const nodes = [e, label, e.parentElement, ...(label ? label.querySelectorAll<HTMLElement>('*') : [])].filter(
        (n): n is HTMLElement => n !== null && n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().height > 0, // a 0x0 hidden input paints nothing
      )
      return nodes
        .map((n) => {
          const cs = getComputedStyle(n)
          return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderColor, cs.backgroundColor].join('|')
        })
        .join('||')
    }
    // A control that already holds focus (Radix focuses the first one on open) is measured with focus parked on
    // the container, so its blurred signature is not its focused one.
    const active = document.activeElement as HTMLElement | null
    const parked = active !== null && list.includes(active)
    if (parked) el.focus({ preventScroll: true })
    list.forEach((e, i) => {
      e.dataset.qaTab = String(i)
      e.dataset.qaBlurSig = sig(e)
    })
    if (parked) active.focus({ preventScroll: true })
    return list.length
  }, TABBABLE)

/** Which tagged control holds focus (-1: a control outside the root, -2: nothing / body), plus where it paints. */
const focusedIn = (root: Locator): Promise<{ idx: number; x: number; y: number; r: number; b: number; ring: boolean; visible: boolean; desc: string }> =>
  root.evaluate((el) => {
    const a = document.activeElement as HTMLElement | null
    const desc = a ? `${a.tagName.toLowerCase()}${a.getAttribute('aria-label') ? `[${a.getAttribute('aria-label')}]` : ''} "${(a.textContent ?? '').trim().slice(0, 20)}"` : 'nothing'
    const none = { idx: -2, x: 0, y: 0, r: 0, b: 0, ring: false, visible: false, desc }
    if (!a || a === document.body) return none
    if (!el.contains(a)) return { ...none, idx: -1 }
    const own = a.getBoundingClientRect()
    const rect = own.width === 0 || own.height === 0 ? (a.closest('label') ?? a).getBoundingClientRect() : own
    const pr = el.getBoundingClientRect()
    // The focus indicator may sit on the control, on the label/box that wraps a visually hidden input, or on a
    // sibling the input drives (the theme switch's slider ring). It must be a REAL paint change against the
    // control's own blurred signature recorded by tagTabbables: a selector that is true whenever focus is inside
    // (`:has(:focus-visible)`) proves nothing.
    const label = a.closest('label')
    const nodes = [a, label, a.parentElement, ...(label ? label.querySelectorAll<HTMLElement>('*') : [])].filter(
        (n): n is HTMLElement => n !== null && n.getBoundingClientRect().width > 0 && n.getBoundingClientRect().height > 0, // a 0x0 hidden input paints nothing
      )
    const now = nodes
      .map((n) => {
        const cs = getComputedStyle(n)
        return [cs.outlineStyle, cs.outlineWidth, cs.outlineColor, cs.boxShadow, cs.borderColor, cs.backgroundColor].join('|')
      })
      .join('||')
    const ring = a.dataset.qaBlurSig !== undefined && now !== a.dataset.qaBlurSig
    const vis = rect.right > pr.left - 1 && rect.left < pr.right + 1 && rect.bottom > pr.top - 1 && rect.top < pr.bottom + 1
    return {
      desc,
      idx: Number(a.dataset.qaTab ?? -3),
      x: rect.x - pr.x,
      y: rect.y - pr.y + el.scrollTop,
      r: rect.right - pr.x,
      b: rect.bottom - pr.y + el.scrollTop,
      ring: ring && a.matches(':focus-visible'),
      visible: vis && rect.top >= pr.top - 1 && rect.bottom <= pr.bottom + 1,
    }
  })

/** The document never scrolled and the header is where it was: focusing a control must not drag the page around. */
async function expectPageStill(h: Harness, headerBefore: Rect, what: string): Promise<void> {
  const top = await h.page.evaluate(() => document.scrollingElement?.scrollTop ?? 0)
  expect(top, `${what}: the document did not scroll`).toBe(0)
  const hb = await rectOf(headerOf(h.page))
  expect(hb.y, `${what}: header stayed put`).toBeCloseTo(headerBefore.y, 1)
}

/**
 * Tab / Shift+Tab through an open popover: focus enters at its first control, walks every control in DOM order
 * (no positive tabindex, nothing skipped, nothing reached twice), each focused control is fully visible inside the
 * panel with a visible focus indicator, the walk follows the reading order (top to bottom, inline-start to
 * inline-end within a row), the page never scrolls, and the popover is non-modal: Tab past the last control leaves
 * it, Shift+Tab walks back and past the first control reaches the trigger.
 */
async function expectPopoverTabOrder(h: Harness, trigger: Locator, kind: 'account' | 'notifications'): Promise<void> {
  const { page, cell: c } = h
  const what = `${kind === 'account' ? 'profile menu' : 'notifications'} keyboard`
  const panel = dialogOf(h, kind)
  const headerBefore = await rectOf(headerOf(page))
  await trigger.focus()
  await page.keyboard.press('Enter')
  await hard(panel, `${what}: Enter opens`).toBeVisible()
  await panel.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)).then(() => undefined))
  const n = await tagTabbables(panel)
  hard(n, `${what}: the panel has tabbable controls`).toBeGreaterThan(3)

  let prev: Awaited<ReturnType<typeof focusedIn>> | null = null
  for (let i = 0; i < n; i += 1) {
    await page.keyboard.press('Tab')
    const f = await focusedIn(panel)
    const id = `${what}: Tab ${i + 1} of ${n}`
    expect(f.idx, `${id} lands on control ${i} in DOM order`).toBe(i)
    expect(f.visible, `${id}: the focused control is fully visible inside the panel`).toBe(true)
    expect(f.ring, `${id}: the focused control shows a focus indicator`).toBe(true)
    if (prev) {
      const sameRow = Math.abs((f.y + f.b) / 2 - (prev.y + prev.b) / 2) < 8
      if (sameRow) {
        if (c.lang === 'ar') expect(f.x, `${id}: same row runs inline-start (right) to inline-end (left)`).toBeLessThanOrEqual(prev.x + 1)
        else expect(f.x, `${id}: same row runs inline-start (left) to inline-end (right)`).toBeGreaterThanOrEqual(prev.x - 1)
      } else {
        expect(f.y, `${id}: reading order goes down the panel`).toBeGreaterThan(prev.y - 1)
      }
    }
    await expectPageStill(h, headerBefore, id)
    prev = f
  }
  await page.keyboard.press('Tab')
  expect((await focusedIn(panel)).idx, `${what}: Tab past the last control leaves the popover (it is not a trap)`).toBeLessThan(0)
  await page.keyboard.press('Shift+Tab')
  expect((await focusedIn(panel)).idx, `${what}: Shift+Tab comes back to the last control`).toBe(n - 1)
  for (let i = n - 2; i >= 0; i -= 1) {
    await page.keyboard.press('Shift+Tab')
    expect((await focusedIn(panel)).idx, `${what}: Shift+Tab walks back to control ${i}`).toBe(i)
  }
  await page.keyboard.press('Shift+Tab')
  await expect(trigger, `${what}: Shift+Tab before the first control reaches the trigger`).toBeFocused()
  await expect(panel, `${what}: still open (focus moved, nothing dismissed it)`).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel, `${what}: Escape closes`).toBeHidden()
  await expect(trigger, `${what}: and focus is on the trigger`).toBeFocused()
}

test.describe('keyboard: Tab order and focus in the header panels', () => {
  const KEYBOARD: Array<[string, Cell]> = [
    ['390x844 en phone bar', cell(390, 844, { insets: portrait(47, 34) })],
    ['390x844 ar Aa24 phone bar', cell(390, 844, { lang: 'ar', aa: 24, insets: portrait(47, 34) })],
    ['667x375 en landscape phone bar (panels scroll)', cell(667, 375, { insets: landscape(47, 47) })],
    ['844x390 en landscape phone (TopNav tier)', cell(844, 390, { insets: landscape(47, 47) })],
    ['1280x800 en desktop mouse', cell(1280, 800, { touch: false, dpr: 1 })],
    ['1280x800 ar desktop mouse', cell(1280, 800, { lang: 'ar', touch: false, dpr: 1 })],
  ]
  for (const [name, c] of KEYBOARD) {
    test(`profile and notifications panels — ${name}`, async ({ browser }) => {
      const h = await openApp(browser, c)
      try {
        await expectPopoverTabOrder(h, avatarOf(h.page), 'account')
        await expectPopoverTabOrder(h, bellOf(h.page, c.lang), 'notifications')
        expect(h.unmocked).toEqual([])
      } finally {
        await h.ctx.close()
      }
    })
  }

  for (const [name, c] of [
    ['390x844 en', cell(390, 844, { insets: portrait(47, 34) })],
    ['390x844 ar Aa24', cell(390, 844, { lang: 'ar', aa: 24, insets: portrait(47, 34) })],
    ['667x375 en landscape', cell(667, 375, { insets: landscape(47, 47) })],
  ] as Array<[string, Cell]>) {
    test(`drawer keeps Tab inside and wraps in order — ${name}`, async ({ browser }) => {
      const h = await openApp(browser, c)
      try {
        const { page } = h
        const burger = menuButtonOf(page, c.lang)
        await burger.focus()
        await page.keyboard.press('Enter')
        const drawer = dialogOf(h, 'menu')
        await hard(drawer).toBeVisible()
        await page.waitForTimeout(450)
        const n = await tagTabbables(drawer)
        hard(n, 'drawer has tabbable controls').toBeGreaterThan(9)
        // Focus opens on the dialog itself (not a tabbable control): the first Tab then enters at control 0.
        const opened = await focusedIn(drawer)
        expect(opened.idx, `focus is inside the drawer on open (${opened.desc})`).toBeGreaterThanOrEqual(-3)
        expect(opened.idx, `focus is inside the drawer on open (${opened.desc})`).toBeLessThan(n)
        expect([-1, -2], `focus is inside the drawer on open (${opened.desc})`).not.toContain(opened.idx)
        let at = opened.idx >= 0 ? opened.idx : -1
        for (let i = 0; i < n + 3; i += 1) {
          await page.keyboard.press('Tab')
          const f = await focusedIn(drawer)
          expect(f.idx, `drawer Tab ${i + 1} (of ${n} controls): next control in DOM order, wrapping at the end (focus is trapped); focus is on ${f.desc}`).toBe((at + 1) % n)
          expect(f.visible, `drawer Tab ${i + 1}: focused control fully visible in the drawer`).toBe(true)
          expect(f.ring, `drawer Tab ${i + 1}: focus indicator`).toBe(true)
          at = f.idx
        }
        await page.keyboard.press('Shift+Tab')
        expect((await focusedIn(drawer)).idx, 'Shift+Tab steps back one control').toBe((at - 1 + n) % n)
        await page.keyboard.press('Escape')
        await expect(drawer).toBeHidden()
        await expect(burger, 'Escape returns focus to the menu button').toBeFocused()
        expect(h.unmocked).toEqual([])
      } finally {
        await h.ctx.close()
      }
    })
  }

  // Shift+Tab from the first control wraps (Radix focus trap, preventScroll) to the LAST control: the theme switch,
  // whose checkbox is visually hidden (0x0). The drawer must reveal its visible <label>, clear of the bottom inset,
  // and the label must be what a finger would hit.
  for (const [name, c] of [
    ['667x375 en landscape', cell(667, 375, { insets: landscape(47, 47) })],
    ['667x375 ar landscape Aa24', cell(667, 375, { lang: 'ar', aa: 24, insets: landscape(47, 47) })],
    ['390x844 en Aa24', cell(390, 844, { aa: 24, insets: portrait(47, 34) })],
    ['390x844 ar Aa24', cell(390, 844, { lang: 'ar', aa: 24, insets: portrait(47, 34) })],
    ['160x284 en, 320px phone at 200% zoom', cell(160, 284, { dpr: 4, insets: portrait(10, 0) })],
    ['160x284 ar, 320px phone at 200% zoom', cell(160, 284, { lang: 'ar', dpr: 4, insets: portrait(10, 0) })],
  ] as Array<[string, Cell]>) {
    test(`drawer Shift+Tab backward wrap reveals the theme switch label — ${name}`, async ({ browser }) => {
      const h = await openApp(browser, c)
      try {
        const { page } = h
        const burger = menuButtonOf(page, c.lang)
        await burger.focus()
        await page.keyboard.press('Enter')
        const drawer = dialogOf(h, 'menu')
        await hard(drawer).toBeVisible()
        await page.waitForTimeout(450)
        const n = await tagTabbables(drawer)
        hard(n, 'drawer has tabbable controls').toBeGreaterThan(9)
        // Radix focuses the first tabbable (Close) when the drawer opens.
        expect((await focusedIn(drawer)).idx, 'the drawer opens with focus on control 0').toBe(0)
        await page.keyboard.press('Shift+Tab')
        const wrapped = await focusedIn(drawer)
        expect(wrapped.idx, `Shift+Tab from the first control wraps to the last (${wrapped.desc})`).toBe(n - 1)
        const probe = await drawer.locator('label.theme-switch').evaluate((el, ins) => {
          const r = el.getBoundingClientRect()
          const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
          return {
            top: r.top,
            bottom: r.bottom,
            left: r.left,
            right: r.right,
            ih: window.innerHeight,
            iw: window.innerWidth,
            hitInside: hit !== null && el.contains(hit),
            insetTop: ins.top,
            insetBottom: ins.bottom,
            focused: el.querySelector('input') === document.activeElement,
          }
        }, c.insets)
        const what = `Shift+Tab wrap (${name})`
        expect(probe.focused, `${what}: focus is on the theme switch input`).toBe(true)
        expect(probe.bottom, `${what}: label bottom (${probe.bottom}) is above the bottom inset (${probe.ih - probe.insetBottom})`).toBeLessThanOrEqual(probe.ih - probe.insetBottom + 1)
        expect(probe.top, `${what}: label top (${probe.top}) is below the top inset (${probe.insetTop})`).toBeGreaterThanOrEqual(probe.insetTop - 1)
        expect(probe.left, `${what}: label inside viewport (left)`).toBeGreaterThanOrEqual(-1)
        expect(probe.right, `${what}: label inside viewport (right)`).toBeLessThanOrEqual(probe.iw + 1)
        expect(probe.hitInside, `${what}: the label centre is hit-testable`).toBe(true)
        expect(wrapped.ring, `${what}: the theme switch shows a real focus indicator`).toBe(true)
        await page.keyboard.press('Shift+Tab')
        const prev = await focusedIn(drawer)
        expect(prev.idx, `${what}: next Shift+Tab walks to control ${n - 2}`).toBe(n - 2)
        expect(prev.visible, `${what}: that control is fully visible`).toBe(true)
        await page.keyboard.press('Escape')
        await expect(drawer).toBeHidden()
        await expect(burger, 'Escape returns focus to the menu button').toBeFocused()
        expect(h.unmocked).toEqual([])
      } finally {
        await h.ctx.close()
      }
    })
  }
})
