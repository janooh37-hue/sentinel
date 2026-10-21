/**
 * Employee message templates (SMS/WhatsApp) and Outlook email-draft overrides.
 * API contract: mockups/plan/notification-templates.md ("API contract").
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { request } from '@/lib/api'

// TEMP: replace with api.types once generated
export type MsgLang = 'ar' | 'en'
// TEMP: replace with api.types once generated
export type Bilingual = { ar: string; en: string }
// TEMP: replace with api.types once generated
export type MessageTiming = 'on_approval' | 'on_save' | 'on_status_change' | 'scheduled' | 'manual'
// TEMP: replace with api.types once generated
export interface MessageTemplateVariable {
  name: string
  label_en: string
  label_ar: string
  sample: string
}
// TEMP: replace with api.types once generated
export interface MessageTemplateRead {
  event: string
  label: Bilingual
  group: 'leaves' | 'forms' | 'violations' | 'reminders'
  services: string[]
  timing: MessageTiming
  default: Bilingual
  override: Bilingual | null
  variables: MessageTemplateVariable[]
}
// TEMP: replace with api.types once generated
export interface MessageRenderResponse {
  text: Bilingual
  segments: { ar: number; en: number }
}
// TEMP: replace with api.types once generated
export interface NotifyPreviewRequest {
  template_id: string
  employee_id: string | null
  fields: Record<string, unknown>
  revise_of_book_id: number | null
}
// TEMP: replace with api.types once generated
export interface NotifyPreviewResponse {
  event: string | null
  language: MsgLang
  timing: MessageTiming | string
  text: Bilingual | null
  segments: { ar: number; en: number } | null
}
// TEMP: replace with api.types once generated
export interface DraftTemplateFields {
  subject?: string
  intro?: string
  closing?: string
}
// TEMP: replace with api.types once generated
export interface DraftTemplatesRead {
  overrides: Record<string, DraftTemplateFields>
  tokens: Record<string, string[]>
}

/** Error codes the template writes return as 422 (`ApiError.code`). */
export const TEMPLATE_ERROR_CODES = [
  'UNKNOWN_PLACEHOLDER',
  'EMPTY_TEMPLATE',
  'UNKNOWN_TOKEN',
  'HTML_NOT_ALLOWED',
] as const

/** Capability that unlocks editing; viewing needs none. */
export const TEMPLATES_CAP = 'messages.templates'

const enc = encodeURIComponent

export const messageTemplatesApi = {
  list: () => request<MessageTemplateRead[]>('GET', '/notify/templates'),
  save: (event: string, body: Bilingual) =>
    request<MessageTemplateRead>('PUT', `/notify/templates/${enc(event)}`, body),
  reset: (event: string) => request<MessageTemplateRead>('DELETE', `/notify/templates/${enc(event)}`),
  render: (event: string, body: Bilingual) =>
    request<MessageRenderResponse>('POST', `/notify/templates/${enc(event)}/render`, body),
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
  return useQuery({ queryKey: MESSAGE_TEMPLATES_KEY, queryFn: messageTemplatesApi.list, staleTime: 60_000 })
}

/** Templates whose `services` include `service` (a template_id or page key). */
export function useServiceMessageTemplates(service: string) {
  const q = useMessageTemplates()
  return { ...q, data: q.data?.filter((t) => t.services.includes(service)) }
}

export function useSaveMessageTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ event, body }: { event: string; body: Bilingual }) =>
      messageTemplatesApi.save(event, body),
    onSuccess: (next) =>
      qc.setQueryData<MessageTemplateRead[]>(MESSAGE_TEMPLATES_KEY, (l) =>
        l?.map((t) => (t.event === next.event ? next : t)),
      ),
  })
}

export function useResetMessageTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (event: string) => messageTemplatesApi.reset(event),
    onSuccess: (next) =>
      qc.setQueryData<MessageTemplateRead[]>(MESSAGE_TEMPLATES_KEY, (l) =>
        l?.map((t) => (t.event === next.event ? next : t)),
      ),
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

/** Token whitelist for a draft key: exact key, then its family (text before the
 *  first `:`), else none. */
export function draftTokensFor(tokens: Record<string, string[]> | undefined, key: string): string[] {
  if (!tokens) return []
  return tokens[key] ?? tokens[key.split(':')[0]] ?? []
}
