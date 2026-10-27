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

  it('treats any 403 without a specific code as a permission refusal', () => {
    // A proxy-generated 403 carries no envelope, so its code is synthesized.
    expect(apiErrorMessage(new ApiError(403, 'HTTP_403', 'Forbidden'))).toBe("You don't have permission for this")
  })

  it.each([
    ['ACCOUNT_REJECTED', 'Your access request was declined. Contact IT.', 'رُفض طلب الوصول. تواصل مع قسم تقنية المعلومات.'],
    ['ACCOUNT_PENDING', 'Your account is awaiting admin approval.', 'حسابك في انتظار موافقة المسؤول.'],
    ['ACCOUNT_DISABLED', 'This account is disabled. Contact your administrator.', 'هذا الحساب معطّل. تواصل مع المسؤول.'],
    ['ACCOUNT_LOCKED', 'This account is locked. Contact IT to unlock it.', 'هذا الحساب مقفل. تواصل مع قسم تقنية المعلومات لإلغاء القفل.'],
    [
      'DOCX_LOCKED_AFTER_SIGNING',
      'This document is signed, so its editable Word file is locked.',
      'هذا المستند موقّع، لذا أصبح ملف Word القابل للتعديل مقفلاً.',
    ],
    ['SECRET_CLEARANCE_REQUIRED', 'Secret clearance is required for Secret records.', 'المعاملات السرية تتطلب تصريح الاطلاع على السري.'],
    ['DISTRIBUTION_NOT_NAMED', 'Only an Unclassified record with named distribution can be restored.', 'لا يمكن الاستعادة إلا لمعاملة غير سرية موزعة على مسمّين.'],
    ['RECORD_TYPE_FORBIDDEN', "You don't have access to this record type.", 'لا تملك صلاحية الوصول إلى هذا النوع من المعاملات.'],
    [
      'INCLUDED_PAPERS_CREATOR_ONLY',
      'Only the person who created this record can manage its included papers.',
      'لا يدير الأوراق المضمّنة في هذه المعاملة إلا من أنشأها.',
    ],
    ['WORD_SESSION_NOT_OWNER', 'This Word session belongs to another user.', 'جلسة Word هذه تابعة لمستخدم آخر.'],
    [
      'INMATE_REPORTER_IDENTITY_MISMATCH',
      'The signer must be the employee linked to your account.',
      'يجب أن يكون الموقّع هو الموظف المرتبط بحسابك.',
    ],
    ['APPROVED_IMPORT_TOKEN_FORBIDDEN', 'This staged import belongs to another user.', 'ملف الاستيراد المؤقت تابع لمستخدم آخر.'],
  ])('keeps the specific meaning of a %s refusal ahead of the permission fallback', async (code, en, ar) => {
    const refusal = new ApiError(403, code, 'server detail')
    expect(apiErrorMessage(refusal)).toBe(en)
    await i18n.changeLanguage('ar')
    expect(apiErrorMessage(refusal)).toBe(ar)
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
