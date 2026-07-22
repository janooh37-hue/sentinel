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
  'permits.vehicle.plateCategory',
  'permits.vehicle.trafficNo',
  'permits.vehicle.regExpiry',
  'permits.vehicle.expiry',
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
      const e = get(en as unknown as Rec, k)
      const a = get(ar as unknown as Rec, k)
      expect(a).not.toBe(e)
    })
  }
})
