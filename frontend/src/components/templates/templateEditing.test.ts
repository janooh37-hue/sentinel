import i18n from 'i18next'
import { afterEach, describe, expect, it } from 'vitest'

import { ApiError } from '@/lib/api'
import ar from '@/locales/ar.json'
import { templateErrorMessage } from './templateEditing'

const t = i18n.t.bind(i18n)

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('templateErrorMessage', () => {
  it('lists UNKNOWN_TOKEN names from details.tokens in English and Arabic', async () => {
    const error = new ApiError(422, 'UNKNOWN_TOKEN', 'server', { tokens: ['ref.__class__', 'x'] })
    expect(templateErrorMessage(error, t)).toBe(
      'Unknown token. Use only the listed variables. Not recognised: \u2068{ref.__class__}\u2069 and \u2068{x}\u2069.',
    )
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
    expect(templateErrorMessage(error, t)).toBe(
      'رمز غير معروف. استخدم المتغيرات المدرجة فقط. غير معروف: \u2068{ref.__class__}\u2069 و\u2068{x}\u2069.',
    )
  })

  it('names the language for each UNKNOWN_PLACEHOLDER list', async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
    const error = new ApiError(422, 'UNKNOWN_PLACEHOLDER', 'server', { ar: ['foo'], en: ['bar'] })
    expect(templateErrorMessage(error, t)).toBe(
      'متغير غير معروف. استخدم المتغيرات المدرجة فقط. الرسالة العربية: \u2068{foo}\u2069. الرسالة الإنجليزية: \u2068{bar}\u2069.',
    )
  })

  it.each([
    ['en', ['body', 'intro'], 2000, 'Template text must be {{limit}} characters or fewer.'],
    ['en', ['body', 'ar'], 1000, 'Template text must be {{limit}} characters or fewer.'],
    ['ar', ['body', 'intro'], 2000, 'يجب ألا يتجاوز نص القالب {{limit}} حرفًا.'],
    ['ar', ['body', 'en'], 1000, 'يجب ألا يتجاوز نص القالب {{limit}} حرفًا.'],
  ] as const)('localizes a too-long %s template field %j with limit %i', async (language, loc, limit, message) => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage(language)
    const error = new ApiError(422, 'VALIDATION_ERROR', 'raw server validation', {
      errors: [
        { type: 'missing', loc: ['body', 'other'] },
        { type: 'string_too_long', loc, ctx: { max_length: limit } },
      ],
    })
    expect(templateErrorMessage(error, t)).toBe(message.replace('{{limit}}', String(limit)))
  })

  it('never shows raw server text for other failures', () => {
    expect(templateErrorMessage(new ApiError(502, 'HTTP_502', 'Bad Gateway'), t)).toBe('Something went wrong')
    expect(templateErrorMessage(new TypeError('Failed to fetch'), t)).toBe('Something went wrong')
    expect(templateErrorMessage(new ApiError(422, 'VALIDATION_ERROR', 'raw validation', {
      errors: [{ type: 'missing', loc: ['body', 'ar'] }],
    }), t)).toBe('Something went wrong')
  })
})
