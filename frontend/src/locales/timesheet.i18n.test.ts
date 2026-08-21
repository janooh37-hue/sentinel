import { describe, it, expect } from 'vitest'
import i18n from '@/lib/i18n'
import en from '@/locales/en.json'
import ar from '@/locales/ar.json'

type Rec = Record<string, unknown>
function get(o: Rec, path: string): string {
  return path.split('.').reduce<unknown>((c, k) => (c as Rec)?.[k], o) as string
}

const KEYS = [
  'timesheet.eyebrow',
  'timesheet.title',
  'timesheet.lede',
  'timesheet.entry.label',
  'timesheet.entry.hint',
  'timesheet.searchLabel',
  'timesheet.searchPlaceholder',
  'timesheet.ready',
  'timesheet.closed',
  'timesheet.closedOn',
  'timesheet.reopenConsequence',
  'timesheet.freezeWarning',
  'timesheet.prevMonth',
  'timesheet.nextMonth',
  'timesheet.roster',
  'timesheet.sheetMain',
  'timesheet.sheetDrivers',
  'timesheet.deliverable',
  'timesheet.attendance',
  'timesheet.statistics',
  'timesheet.zoom',
  'timesheet.zoomCompact',
  'timesheet.zoomDefault',
  'timesheet.zoomRoomy',
  'timesheet.codesLabel',
  'timesheet.codes.present',
  'timesheet.codes.annual',
  'timesheet.codes.sick',
  'timesheet.codes.absence',
  'timesheet.codes.national',
  'timesheet.codes.newGuard',
  'timesheet.codes.offRoster',
  'timesheet.codes.notBilled',
  'timesheet.brushHint',
  'timesheet.derivedHint',
  'timesheet.readOnlyHint',
  'timesheet.undo',
  'timesheet.thisMonth',
  'timesheet.blocking',
  'timesheet.warning',
  'timesheet.allClear',
  'timesheet.startingPoint',
  'timesheet.leaving',
  'timesheet.removedFromSheet',
  'timesheet.loading',
  'timesheet.emptyTitle',
  'timesheet.emptyReason',
  'timesheet.downloadAttendance',
  'timesheet.downloadStatistics',
  'timesheet.reopen',
  'timesheet.clearCell',
  // The sheet itself (Task 8): the masthead label, the cell's accessible name,
  // the five identity column headers, the roster badges and the two refusal
  // reasons a cell can carry.
  'timesheet.asPrinted',
  'timesheet.cellLabel',
  'timesheet.note',
  'timesheet.colRow',
  'timesheet.colDay',
  'timesheet.colId',
  'timesheet.colName',
  'timesheet.colNat',
  'timesheet.colDesig',
  'timesheet.headcount',
  'timesheet.block1',
  'timesheet.block2',
  'timesheet.badgeNew',
  'timesheet.badgeFrom',
  'timesheet.badgeTo',
  'timesheet.startedOn',
  'timesheet.lastWorked',
  'timesheet.rosterEdge',
  'timesheet.frozen',
  'timesheet.selectRow',
  'timesheet.rangePainted',
  // All six CLDR forms for every counted phrase, not just `_one`/`_other`:
  // `TimesheetToolbar.tsx:175-177` and the head status chip render `_zero`,
  // `_two`, `_few` and `_many` under `ar`, so an untranslated variant is a
  // visible Arabic-page defect that only these assertions can catch.
  'timesheet.rows_zero',
  'timesheet.rows_one',
  'timesheet.rows_two',
  'timesheet.rows_few',
  'timesheet.rows_many',
  'timesheet.rows_other',
  'timesheet.days_zero',
  'timesheet.days_one',
  'timesheet.days_two',
  'timesheet.days_few',
  'timesheet.days_many',
  'timesheet.days_other',
  'timesheet.toFix_zero',
  'timesheet.toFix_one',
  'timesheet.toFix_two',
  'timesheet.toFix_few',
  'timesheet.toFix_many',
  'timesheet.toFix_other',
  'timesheet.corrections_zero',
  'timesheet.corrections_one',
  'timesheet.corrections_two',
  'timesheet.corrections_few',
  'timesheet.corrections_many',
  'timesheet.corrections_other',
  'timesheet.filled_zero',
  'timesheet.filled_one',
  'timesheet.filled_two',
  'timesheet.filled_few',
  'timesheet.filled_many',
  'timesheet.filled_other',
  'timesheet.fillRefused_zero',
  'timesheet.fillRefused_one',
  'timesheet.fillRefused_two',
  'timesheet.fillRefused_few',
  'timesheet.fillRefused_many',
  'timesheet.fillRefused_other',
  // The dock and its five panels (Task 9): the four group labels, the
  // two-block rule, the whole-workbook tally, every preflight `kind` the
  // backend can emit, the roster-movement sentences, the G-number picker with
  // its two-month extract and red-block helper, and the release strip.
  'timesheet.postsLabel',
  'timesheet.impliedPosts',
  'timesheet.impliedOk',
  'timesheet.impliedDrift',
  'timesheet.twoBlockRule',
  'timesheet.needsEdit',
  'timesheet.cellsByCode',
  'timesheet.panelChecks',
  'timesheet.rosterMovement',
  'timesheet.confirmStart',
  'timesheet.startConfirmed',
  'timesheet.showRow',
  'timesheet.newEmployee',
  'timesheet.removedLabel',
  'timesheet.removedReason',
  'timesheet.filesLabel',
  'timesheet.cells_zero',
  'timesheet.cells_one',
  'timesheet.cells_two',
  'timesheet.cells_few',
  'timesheet.cells_many',
  'timesheet.cells_other',
  // `Issue.kind` is the stable machine string; the panel owns the words, so
  // every kind `timesheet_service` can emit needs a pair here. Blocking:
  // no_designation, no_nationality. Warning: unknown_leave, overlapping_leave,
  // departed_but_active, no_doj, duplicate_name.
  'timesheet.issues.no_designation',
  'timesheet.issues.no_nationality',
  'timesheet.issues.unknown_leave',
  'timesheet.issues.overlapping_leave',
  'timesheet.issues.departed_but_active',
  'timesheet.issues.no_doj',
  'timesheet.issues.duplicate_name',
  'timesheet.employee.sheet',
  'timesheet.employee.hint',
  'timesheet.employee.placeholder',
  'timesheet.employee.results',
  'timesheet.employee.noMatch',
  'timesheet.employee.prompt',
  'timesheet.employee.showInGrid',
  'timesheet.employee.extractOne',
  'timesheet.employee.extractTwo',
  'timesheet.employee.twoMonths',
  'timesheet.employee.spanMonths',
  'timesheet.employee.printedRow',
  'timesheet.employee.billStart',
  'timesheet.employee.redBlock',
  'timesheet.employee.redBlockRange',
  'timesheet.employee.blockNote',
  'timesheet.employee.nothingToBlock',
  'timesheet.release.title',
  'timesheet.release.files',
  'timesheet.release.blocked',
  'timesheet.release.close',
  'timesheet.release.closeNote',
  'timesheet.release.reopenConfirm',
  // The action on the employee record. `record.action` interpolates a month
  // NAME and `record.oneMonth` a month name plus its year: neither is
  // isolated, and deliberately so. An isolate around Arabic-plus-digits would
  // embed the whole value LTR and push the month name to the wrong end; the
  // unisolated form is correct because there is no neutral trapped BETWEEN two
  // number runs, which is the only configuration that reorders (see the range
  // guard below). `record.actionTwo` uses the Arabic dual — no digit at all.
  'timesheet.record.action',
  'timesheet.record.actionTwo',
  // Visible, not a `title`: a tooltip is mouse-only and exposed as a
  // description, so "2 months" would never say WHICH two to a keyboard or
  // touch operator. Two number runs, but Arabic letters separate them — the
  // reordering the guard below pins needs a bare neutral between the runs.
  'timesheet.record.bothMonths',
  'timesheet.record.oneMonth',
  // The printed rank order, reordered from Settings.
  'timesheet.designations.title',
  'timesheet.designations.description',
  'timesheet.designations.moveUp',
  'timesheet.designations.moveDown',
  'timesheet.designations.save',
  'timesheet.designations.revert',
  'timesheet.designations.unsaved',
  'timesheet.designations.saved',
  'timesheet.designations.stale',
  // The route from a finding to the record that fixes it (UI spec §9), and
  // the pointer at the page that owns employee creation (locked rule 8).
  'timesheet.openRecord',
  'timesheet.openLookup',
]

describe('timesheet i18n parity', () => {
  it('has >= 40 timesheet keys', () => {
    expect(KEYS.length).toBeGreaterThanOrEqual(40)
  })

  // No `nav.*` key: the time sheet is a subpage under Employees, entered from
  // EmployeeLookupPage, and NAV_ITEMS keeps its seven entries.
  it('adds no nav entry for the time sheet', () => {
    expect(get(en as unknown as Rec, 'nav.timesheet')).toBeUndefined()
    expect(get(ar as unknown as Rec, 'nav.timesheet')).toBeUndefined()
  })

  for (const k of KEYS) {
    it(`${k} exists in both en and ar`, () => {
      expect(get(en as unknown as Rec, k)).toBeTruthy()
      expect(get(ar as unknown as Rec, k)).toBeTruthy()
    })
    it(`${k} ar != en (no English leak)`, () => {
      const e = get(en as unknown as Rec, k)
      const a = get(ar as unknown as Rec, k)
      expect(a).not.toBe(e)
    })
  }

  it('carries no code letter as copy — codes.ts owns them as data', () => {
    const letters = ['P', 'AL', 'SL ', 'AB', 'TR', 'NG', '-', 'X']
    const values = KEYS.flatMap((k) => [
      get(en as unknown as Rec, k),
      get(ar as unknown as Rec, k),
    ])
    for (const letter of letters) {
      expect(values).not.toContain(letter)
    }
  })

  /**
   * The three Arabic sentences that interpolate a numeric RANGE carry an
   * explicit isolate around it — `U+2066 LRI` … `U+2069 PDI`.
   *
   * They are load-bearing and invisible, which is the whole reason this is
   * pinned rather than left to review: measured in Chromium, `الأيام 1–9`
   * without the isolate paints as **`9–1`**, `حجب 1–17` as `17–1` and
   * `يوم 6–17` as `17–6`. The digits become AN after Arabic-letter context
   * (UBA W2), the en dash is neutral and resolves R between two number runs
   * (N1), and the run reorders — so the sentence says "days 9 to 1" on the one
   * surface an operator corrects the month from. Delete the two characters and
   * every other test in this file still passes.
   *
   * Same shape as the `'SL '` trailing space this plan already protects: an
   * invisible character a well-meaning editor drops, silently.
   *
   * `rangePainted` is the least obvious of the three — nothing renders it, the
   * `onFill` SUCCESS TOAST does, which is how the red-block helper reaches it.
   */
  it('isolates every Arabic numeric range, in balanced pairs', () => {
    const LRI = '\u2066'
    const PDI = '\u2069'
    const ranged = [
      'timesheet.startedOn',
      'timesheet.employee.redBlockRange',
      'timesheet.rangePainted',
    ]
    // The isolate has to wrap the RANGE and nothing else. Anchoring the
    // captured span subsumes "contains a number" and "contains a dash", and it
    // is the only form that rejects the fix that looks right and is not:
    // markers moved out to the sentence boundary keep one balanced pair and a
    // span still holding an interpolation and the dash, while fixing nothing —
    // an LRI around the whole Arabic sentence puts the Arabic at embedding
    // level 3 and the digit runs at 4 with the dash left at 3, so the level-3
    // reversal reorders them exactly as the unisolated paragraph did. `9–1`
    // again, suite green.
    const RANGE = /^\u2066(?:\d+|\{\{\w+\}\})–(?:\d+|\{\{\w+\}\})\u2069$/
    for (const key of ranged) {
      const value = get(ar as unknown as Rec, key)
      // Balanced, not merely present: a stray opener leaks the isolation into
      // the rest of the sentence, and a stray closer does nothing at all.
      const opens = value.split(LRI).length - 1
      const closes = value.split(PDI).length - 1
      expect(opens, `${key} has no isolate opener`).toBeGreaterThan(0)
      expect(closes, `${key} isolate is unbalanced`).toBe(opens)
      const isolated = value.match(/\u2066[^\u2066\u2069]*\u2069/)?.[0]
      expect(isolated, `${key} has no isolated span`).toBeDefined()
      expect(isolated, `${key} isolates something other than a bare range`).toMatch(RANGE)
    }
  })

  it('pluralizes corrections through configured i18next resources', async () => {
    await i18n.changeLanguage('en')
    try {
      expect(i18n.t('timesheet.corrections', { count: 1 })).toBe('1 correction')
      expect(i18n.t('timesheet.corrections', { count: 3 })).toBe('3 corrections')
      await i18n.changeLanguage('ar')
      expect(i18n.t('timesheet.corrections', { count: 1 })).toBe('تصحيح واحد')
      expect(i18n.t('timesheet.corrections', { count: 2 })).toBe('تصحيحان')
      expect(i18n.t('timesheet.corrections', { count: 3 })).toBe('3 تصحيحات')
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})
