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
