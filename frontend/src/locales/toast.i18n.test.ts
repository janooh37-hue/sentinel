import { describe, expect, it } from 'vitest'
import { createInstance } from 'i18next'

import ar from '@/locales/ar.json'
import en from '@/locales/en.json'

// lib/toast.ts titles a toast with `common.toastState.<state>`; a missing or
// untranslated entry would put an English word on an Arabic pill.
const STATES = ['success', 'error', 'warning', 'info', 'action', 'loading'] as const

describe('toast state titles i18n parity', () => {
  for (const state of STATES) {
    it(`${state} is translated, not copied from English`, () => {
      const english = en.common.toastState[state]
      const arabic = ar.common.toastState[state]
      expect(english).toBeTruthy()
      expect(arabic).toBeTruthy()
      expect(arabic).not.toBe(english)
    })
  }

  it('has the same states in both languages', () => {
    expect(Object.keys(ar.common.toastState).sort()).toEqual(Object.keys(en.common.toastState).sort())
  })
})

const REFERENCE_MESSAGES = [
  'books.word.finished',
  'application.toast.saved', 'application.inmateReporter.savedToast',
  'vehicles.letterSaved', 'leaves.report.sendDone',
  'permits.createdToast', 'permits.items.createdToast',
  'dutyLocations.transfer.success',
  'books.pane.scanFiledHere', 'books.pane.signedCopyFiled',
  'scanBack.filed', 'scanBack.autoFiled', 'scanBack.parked',
  'intake.returnedForm.approved', 'intake.returnedForm.attachedToast',
  'books.record.deleted', 'books.record.restored', 'books.record.copiedRef',
]
const PROGRESS_MESSAGES = [
  'books.word.finishing', 'books.word.opening',
  'scanBack.filing', 'scanBack.uploading',
  'timesheet.release.downloadingWorkbook', 'timesheet.release.workbookDownloaded',
  'timesheet.employee.downloadingSheet', 'timesheet.employee.sheetDownloaded',
  'inmateStats.export.downloading', 'dutyLocations.transfer.generating',
  'dashboard.widgets.emailSync.syncingToast', 'settings.email.syncOk',
]
function message(bundle: object, key: string): string {
  return key.split('.').reduce<unknown>((value, part) => (value as Record<string, unknown>)[part], bundle) as string
}

describe('callsite toast copy', () => {
  for (const key of [...REFERENCE_MESSAGES, ...PROGRESS_MESSAGES]) {
    it(`${key} has peer English and Arabic copy`, () => {
      expect(message(en, key)).toBeTruthy()
      expect(message(ar, key)).toBeTruthy()
      expect(message(ar, key)).not.toBe(message(en, key))
      expect(message(en, key)).not.toContain('—')
      expect(message(ar, key)).not.toContain('—')
    })
  }

  for (const key of REFERENCE_MESSAGES) {
    it(`${key} keeps the reference out of its message`, () => {
      for (const bundle of [en, ar]) {
        expect(message(bundle, key)).not.toMatch(/\{\{(?:ref|no)\}\}/)
        expect(message(bundle, key)).not.toMatch(/[:·]\s*$/)
      }
    })
  }

  it('keeps references in shared non-toast UI messages', () => {
    for (const bundle of [en, ar]) {
      expect(bundle.application.inmateReporter.saved).toContain('{{ref}}')
      expect(bundle.intake.returnedForm.attached).toContain('{{ref}}')
    }
  })

  it('preserves the email sync interpolation in both languages', () => {
    for (const bundle of [en, ar]) {
      expect(bundle.settings.email.syncOk).toContain('{{imported}}')
      expect(bundle.settings.email.syncOk).toContain('{{skipped}}')
    }
  })
})

const FALLBACK_MESSAGES = [
  'common.error', 'common.copyFailed', 'editor.template.renamedToast',
  'settings.email.saved', 'settings.email.testOk', 'settings.email.deleted',
]

describe('toast fallback and plural coverage', () => {
  for (const key of FALLBACK_MESSAGES) {
    it(`${key} has translated copy with a short first clause`, () => {
      const english = message(en, key)
      const arabic = message(ar, key)
      expect(english).toBeTruthy()
      expect(arabic).toMatch(/\p{Script=Arabic}/u)
      expect(arabic).not.toBe(english)
      for (const text of [english, arabic]) {
        expect(text.split(/[.!؟…]/u)[0].trim().length).toBeLessThanOrEqual(32)
      }
    })
  }

  it('resolves every Arabic employee-transfer plural without falling back to English', async () => {
    const instance = createInstance()
    await instance.init({ lng: 'ar', fallbackLng: 'en', resources: { en: { translation: en }, ar: { translation: ar } } })
    const rules = new Intl.PluralRules('ar')
    for (const count of [0, 1, 2, 3, 11, 100]) {
      const key = `dutyLocations.transfer.movedNoBook_${rules.select(count)}`
      const translated = message(ar, key)
      expect(translated).toMatch(/\p{Script=Arabic}/u)
      const rendered = instance.t('dutyLocations.transfer.movedNoBook', { count })
      expect(rendered).toBe(translated.replaceAll('{{count}}', String(count)))
      expect(rendered).not.toMatch(/[A-Za-z]/)
      expect(rendered.length).toBeLessThanOrEqual(32)
      expect(instance.t('dutyLocations.transfer.movedNoBook', { count, lng: 'en' })).toBeTruthy()
    }
  })
})
