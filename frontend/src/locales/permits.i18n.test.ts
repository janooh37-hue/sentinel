import { describe, it, expect } from 'vitest'
import en from '@/locales/en.json'
import ar from '@/locales/ar.json'

type Rec = Record<string, unknown>
function get(o: Rec, path: string): string {
  return path.split('.').reduce<unknown>((c, k) => (c as Rec)?.[k], o) as string
}

const KEYS = [
  'permits.person.scanId',
  'permits.vehicle.scanLicence',
  'permits.form.signingManager',
  'permits.actions.printPermit',
  'permits.vehicle.colour',
  'permits.vehicle.vehicleType',
  'permits.vehicle.plateEmirate',
  'permits.vehicle.plateCategory',
  'permits.vehicle.trafficNo',
  'permits.vehicle.regExpiry',
  'permits.vehicle.expiry',
  'permits.form.sendForApproval',
  'permits.form.sendForApprovalHint',
  'permits.form.sendForApprovalUnroutable',
  'permits.location.al_wathba_1',
  'permits.location.al_wathba_1Short',
  'permits.location.al_wathba_2',
  'permits.location.al_wathba_2Short',
  'permits.location.unspecified',
  'permits.location.unspecifiedShort',
  'permits.access.pair',
  'permits.access.other',
  'permits.form.accessAreas',
  'permits.form.accessAreasHelp',
  'permits.form.accessRequired',
  'permits.form.legacyAccessWarning',
  'permits.detail.sendForApproval',
  'permits.approval.none',
  'permits.approval.pending',
  'permits.approval.approved',
  'permits.approval.rejected',
  'permits.approval.returned',
  'permits.approval.sentToast',
  'permits.form.permitValidity',
  'permits.form.oneDay',
  'permits.form.oneWeek',
  'permits.form.oneMonth',
  'permits.form.sixMonths',
  'permits.form.oneYear',
  'permits.form.customPeriod',
  'permits.form.durationValue',
  'permits.form.durationUnit',
  'permits.form.unitDay',
  'permits.form.unitWeek',
  'permits.form.unitMonth',
  'permits.form.unitYear',
  'permits.person.role',
  'permits.validityUnits.day',
  'permits.validityUnits.week',
  'permits.validityUnits.month',
  'permits.validityUnits.year',
  'permits.validityPeriod.day_one',
  'permits.validityPeriod.day_other',
  'permits.validityPeriod.week_one',
  'permits.validityPeriod.week_other',
  'permits.validityPeriod.month_one',
  'permits.validityPeriod.month_other',
  'permits.validityPeriod.year_one',
  'permits.validityPeriod.year_other',
  'permits.validityPeriod.day_zero',
  'permits.validityPeriod.day_two',
  'permits.validityPeriod.day_few',
  'permits.validityPeriod.day_many',
  'permits.validityPeriod.week_zero',
  'permits.validityPeriod.week_two',
  'permits.validityPeriod.week_few',
  'permits.validityPeriod.week_many',
  'permits.validityPeriod.month_zero',
  'permits.validityPeriod.month_two',
  'permits.validityPeriod.month_few',
  'permits.validityPeriod.month_many',
  'permits.validityPeriod.year_zero',
  'permits.validityPeriod.year_two',
  'permits.validityPeriod.year_few',
  'permits.validityPeriod.year_many',
  'permits.validityFrom',
  'permits.expired',
  'permits.detail.starts',
  'permits.detail.permitTime',
  'permits.renew.help',
]

describe('permit i18n parity', () => {
  it('has >= 9 new permit keys', () => {
    expect(KEYS.length).toBeGreaterThanOrEqual(9)
  })

  for (const k of KEYS) {
    it(`${k} exists in both en and ar`, () => {
      expect(get(en as unknown as Rec, k)).toBeTruthy()
      expect(get(ar as unknown as Rec, k)).toBeTruthy()
    })
    it(`${k} ar != en (no English leak)`, () => {
      if (k === 'permits.access.pair') return
      const e = get(en as unknown as Rec, k)
      const a = get(ar as unknown as Rec, k)
      expect(a).not.toBe(e)
    })
  }

  it('uses whole-period plural forms without mechanical unit composition', () => {
    expect(get(en as unknown as Rec, 'permits.validityPeriod.month_other').replace('{{count}}', '6')).toBe('6 months')
    expect(get(ar as unknown as Rec, 'permits.validityPeriod.month_one')).toBe('شهر واحد')
    expect(get(ar as unknown as Rec, 'permits.validityPeriod.month_two')).toBe('شهران')
    expect(get(ar as unknown as Rec, 'permits.validityPeriod.month_few').replace('{{count}}', '6')).toBe('6 أشهر')
  })
})
