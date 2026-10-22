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
