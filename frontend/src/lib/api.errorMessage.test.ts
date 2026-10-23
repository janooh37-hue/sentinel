import { afterEach, describe, expect, it } from 'vitest'

import { ApiError, apiErrorMessage } from '@/lib/api'
import i18n from '@/lib/i18n'

describe('apiErrorMessage', () => {
  afterEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('replaces the server detail of a 403 with the localized permission message', async () => {
    const denied = new ApiError(403, 'FORBIDDEN', 'Admin access required.')
    expect(apiErrorMessage(denied)).toBe("You don't have permission for this")
    await i18n.changeLanguage('ar')
    expect(apiErrorMessage(denied)).toBe('لا تملك صلاحية لهذا الإجراء')
  })

  it('treats any 403 as a permission refusal, whatever its code', () => {
    // A proxy-generated 403 carries no envelope, so its code is synthesized.
    expect(apiErrorMessage(new ApiError(403, 'HTTP_403', 'Forbidden'))).toBe("You don't have permission for this")
  })

  it('keeps server detail in English', () => {
    expect(apiErrorMessage(new ApiError(401, 'UNAUTHENTICATED', 'Sign in again.'))).toBe('Sign in again.')
    expect(apiErrorMessage(new ApiError(409, 'LEAVE_STATE_FORBIDDEN', 'Leave is already approved.'))).toBe(
      'Leave is already approved.',
    )
  })

  it('replaces non-Arabic server detail in Arabic but preserves Arabic detail', async () => {
    await i18n.changeLanguage('ar')
    expect(apiErrorMessage(new ApiError(409, 'RECORD_LOCKED', 'Record is locked.'))).toBe('تعذّر إكمال الطلب')
    expect(apiErrorMessage(new ApiError(409, 'RECORD_LOCKED', 'السجل مقفل'))).toBe('السجل مقفل')
  })

  it.each([
    ['en', 'Could not reach the server', 'Something went wrong'],
    ['ar', 'تعذر الاتصال بالخادم', 'حدث خطأ ما'],
  ])('localizes network and unexpected errors in %s', async (language, network, generic) => {
    await i18n.changeLanguage(language)
    expect(apiErrorMessage(new TypeError('Failed to fetch'))).toBe(network)
    expect(apiErrorMessage(new Error('boom'))).toBe(generic)
    expect(apiErrorMessage('Failed to fetch')).toBe(generic)
    expect(apiErrorMessage(null)).toBe(generic)
  })
})
