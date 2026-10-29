/**
 * Employee message templates (SMS/WhatsApp) and Outlook email-draft overrides.
 * API contract: mockups/plan/notification-templates.md ("API contract").
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { request } from '@/lib/api'
import type { components } from '@/lib/api.types'
import { useCapabilities } from '@/lib/useCapabilities'

type Schemas = components['schemas']
export type MessageTemplateRead = Schemas['MessageTemplateRead']
export type Bilingual = Schemas['MessageText']
export type NotifyPreviewRequest = Schemas['NotifyPreviewRequest']
export type NotifyPreviewResponse = Schemas['NotifyPreviewRead']
export type MsgLang = NotifyPreviewResponse['language']
export type DraftTemplateFields = Schemas['EmailDraftTemplateParts']
export type DraftTemplatesRead = Schemas['EmailDraftTemplatesRead']

/** Error codes the template writes return as 422 (`ApiError.code`). */
export const TEMPLATE_ERROR_CODES = [
  'UNKNOWN_PLACEHOLDER',
  'EMPTY_TEMPLATE',
  'UNKNOWN_TOKEN',
  'HTML_NOT_ALLOWED',
  'UNKNOWN_KEY',
] as const

/** Editing additionally requires the specific template's view capability. */
export const TEMPLATES_CAP = 'messages.templates'

export function templateViewCapability(kind: 'notify' | 'email', id: string): string {
  return `messages.templates.view.${kind}.${id}`
}

const enc = encodeURIComponent

export const messageTemplatesApi = {
  list: () => request<MessageTemplateRead[]>('GET', '/notify/templates'),
  save: (event: string, body: Bilingual) =>
    request<MessageTemplateRead>('PUT', `/notify/templates/${enc(event)}`, body),
  reset: (event: string) => request<MessageTemplateRead>('DELETE', `/notify/templates/${enc(event)}`),
  render: (event: string, body: Bilingual) =>
    request<Schemas['MessageRenderRead']>('POST', `/notify/templates/${enc(event)}/render`, body),
  preview: (body: NotifyPreviewRequest) =>
    request<NotifyPreviewResponse>('POST', '/notify/preview', body),
  drafts: () => request<DraftTemplatesRead>('GET', '/email/draft-templates'),
  saveDraft: (key: string, body: DraftTemplateFields) =>
    request<DraftTemplatesRead>('PUT', `/email/draft-templates/${enc(key)}`, body),
  resetDraft: (key: string) =>
    request<DraftTemplatesRead>('DELETE', `/email/draft-templates/${enc(key)}`),
}

export const MESSAGE_TEMPLATES_KEY = ['notify-templates'] as const
export const DRAFT_TEMPLATES_KEY = ['email-draft-templates'] as const

export function useMessageTemplates() {
  const { has } = useCapabilities()
  return useQuery({
    queryKey: MESSAGE_TEMPLATES_KEY,
    queryFn: messageTemplatesApi.list,
    staleTime: 60_000,
    select: (templates) => templates.filter((template) => has(templateViewCapability('notify', template.event))),
  })
}

export function useSaveMessageTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ event, body }: { event: string; body: Bilingual }) =>
      messageTemplatesApi.save(event, body),
    onSuccess: (next) => {
      qc.setQueryData<MessageTemplateRead[]>(MESSAGE_TEMPLATES_KEY, (l) =>
        l?.map((t) => (t.event === next.event ? next : t)),
      )
      void qc.invalidateQueries({ queryKey: ['notify-preview'] })
    },
  })
}

export function useResetMessageTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (event: string) => messageTemplatesApi.reset(event),
    onSuccess: (next) => {
      qc.setQueryData<MessageTemplateRead[]>(MESSAGE_TEMPLATES_KEY, (l) =>
        l?.map((t) => (t.event === next.event ? next : t)),
      )
      void qc.invalidateQueries({ queryKey: ['notify-preview'] })
    },
  })
}

/** Draft overrides + token whitelist. Callers building drafts treat a failed or
 *  pending load as "no overrides" (defaults). */
export function useDraftTemplates() {
  return useQuery({ queryKey: DRAFT_TEMPLATES_KEY, queryFn: messageTemplatesApi.drafts, staleTime: 60_000 })
}

export function useSaveDraftTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, body }: { key: string; body: DraftTemplateFields }) =>
      messageTemplatesApi.saveDraft(key, body),
    onSuccess: (next) => qc.setQueryData(DRAFT_TEMPLATES_KEY, next),
  })
}

export function useResetDraftTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (key: string) => messageTemplatesApi.resetDraft(key),
    onSuccess: (next) => qc.setQueryData(DRAFT_TEMPLATES_KEY, next),
  })
}

/** Token whitelist for a draft key. The backend keys `tokens` by family:
 *  `Salary Transfer Request` → salary_transfer, `leave:*` → leave,
 *  `General Book:transfer` → transfer, `absence:*` → absence,
 *  `classification:*` → classification, any other form id → form. */
export function draftTokensFor(tokens: Record<string, string[]> | undefined, key: string): string[] {
  if (!tokens) return []
  return tokens[draftTokenFamily(key)] ?? []
}

export function draftTokenFamily(key: string): string {
  if (key === 'Salary Transfer Request') return 'salary_transfer'
  if (key === 'General Book:transfer') return 'transfer'
  const prefix = key.split(':')[0]
  return ['leave', 'absence', 'classification'].includes(prefix) ? prefix : 'form'
}
