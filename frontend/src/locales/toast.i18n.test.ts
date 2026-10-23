import { describe, expect, it } from 'vitest'

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
