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

  it('keeps the server detail of every other error', () => {
    expect(apiErrorMessage(new ApiError(401, 'UNAUTHENTICATED', 'Sign in again.'))).toBe('Sign in again.')
    expect(apiErrorMessage(new ApiError(409, 'LEAVE_STATE_FORBIDDEN', 'Leave is already approved.'))).toBe(
      'Leave is already approved.',
    )
    expect(apiErrorMessage(new Error('boom'))).toBe('Error: boom')
  })
})
