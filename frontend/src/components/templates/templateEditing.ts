import { useLayoutEffect, useRef } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import i18n, { type TFunction } from 'i18next'

import { ApiError } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { TEMPLATE_ERROR_CODES } from '@/lib/messageTemplates'

/** Both editors insert tokens into the last focused field, including keyboard use. */
export function useTokenInsertion<K extends string>(
  values: Record<K, string>,
  setValues: Dispatch<SetStateAction<Record<K, string>>>,
  initialField: K,
) {
  const fields = useRef<Partial<Record<K, HTMLTextAreaElement | HTMLInputElement>>>({})
  const active = useRef(initialField)
  const pending = useRef<{ key: K; caret: number } | null>(null)
  useLayoutEffect(() => {
    if (!pending.current) return
    const { key, caret } = pending.current
    pending.current = null
    fields.current[key]?.focus()
    fields.current[key]?.setSelectionRange(caret, caret)
  })
  return {
    field: (key: K) => ({
      ref: (element: HTMLTextAreaElement | HTMLInputElement | null) => {
        if (element) fields.current[key] = element
        else delete fields.current[key]
      },
      onFocus: () => {
        active.current = key
      },
    }),
    insert: (name: string) => {
      const key = active.current
      const element = fields.current[key]
      const start = element?.selectionStart ?? values[key].length
      const end = element?.selectionEnd ?? start
      const token = `{${name}}`
      pending.current = { key, caret: start + token.length }
      setValues((previous) => ({
        ...previous,
        [key]: previous[key].slice(0, start) + token + previous[key].slice(end),
      }))
    },
  }
}

/** Offending names as a localized list, each bidi-isolated for Arabic sentences. */
function tokenList(names: unknown): string {
  if (!Array.isArray(names)) return ''
  return new Intl.ListFormat(i18n.language, { type: 'conjunction' }).format(
    names.map((name) => bidi(`{${String(name)}}`)),
  )
}

/** Localized message for a template API failure; never raw server/browser text.
 *  Lists the offending names: UNKNOWN_PLACEHOLDER details are `{ar: [...], en: [...]}`,
 *  UNKNOWN_TOKEN details are `{tokens: [...]}`. */
export function templateErrorMessage(error: unknown, t: TFunction): string {
  if (!(error instanceof ApiError) || !TEMPLATE_ERROR_CODES.some((code) => code === error.code)) {
    return t('common.errorToast')
  }
  const message = t(`msgTemplates.editor.errors.${error.code}`)
  const lines =
    error.code === 'UNKNOWN_PLACEHOLDER'
      ? (['ar', 'en'] as const)
          .filter((lang) => tokenList(error.details[lang]))
          .map((lang) =>
            t('msgTemplates.editor.errors.unknownIn', {
              language: t(`msgTemplates.editor.languages.${lang}`),
              names: tokenList(error.details[lang]),
            }),
          )
      : error.code === 'UNKNOWN_TOKEN' && tokenList(error.details.tokens)
        ? [t('msgTemplates.editor.errors.unknownNames', { names: tokenList(error.details.tokens) })]
        : []
  return [message, ...lines].join(' ')
}
