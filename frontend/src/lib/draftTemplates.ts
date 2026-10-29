import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { api } from '@/lib/api'
import { buildBasketBodyHtml, buildBasketSubject, defaultBasketDraftText } from '@/lib/basketEmail'
import type { EmailBasketItem } from '@/lib/emailBasket'
import type { DraftTemplateFields } from '@/lib/messageTemplates'
import { templateViewCapability } from '@/lib/messageTemplates'
import { useCapabilities } from '@/lib/useCapabilities'
import { buildAbsenceEmail, defaultAbsenceDraftText, type AbsenceEmailRow } from '@/pages/absences/absenceEmail'

export type DraftOverrides = Record<string, DraftTemplateFields>
export interface DraftVariant {
  key: string
  label: { en: string; ar: string }
  services: string[]
}

const LEAVE_TYPES = ['Sick', 'Annual', 'Compassionate', 'Duty', 'Emergency', 'Hajj', 'Others']
const FORM_LABELS: Record<string, string> = {
  'General Book': 'general',
  'Salary Transfer Request': 'salaryTransfer',
  'Passport Release Form': 'passport',
  'Resignation Letter': 'resignation',
  'Resignation Declaration': 'resignationDeclaration',
  'Duty Resumption Form': 'resumption',
  'Salary Deduction Form': 'deduction',
}

export function useDraftVariants(): DraftVariant[] {
  const { t } = useTranslation()
  const { has } = useCapabilities()
  const classifications = useQuery({
    queryKey: ['books', 'classifications'],
    queryFn: api.listBookClassifications,
    staleTime: Infinity,
  })
  const templates = useQuery({ queryKey: ['templates'], queryFn: api.listTemplates, staleTime: Infinity })
  const label = (key: string) => ({
    en: t(`msgTemplates.drafts.${key}`, { lng: 'en' }),
    ar: t(`msgTemplates.drafts.${key}`, { lng: 'ar' }),
  })
  const variants: DraftVariant[] = LEAVE_TYPES.map((type) => ({
    key: `leave:${type}`, label: label(`leave.${type}`), services: ['Leave Application Form', 'leaves'],
  }))
  const forms = new Map((templates.data?.items ?? []).map((form) => [form.id, form]))
  for (const id of [...new Set([...Object.keys(FORM_LABELS), ...forms.keys()])]) {
    if (id === 'Leave Application Form') continue
    const form = forms.get(id)
    variants.push({
      key: id,
      label: form ? { en: form.name_en, ar: form.name_ar } : label(FORM_LABELS[id]),
      services: [id],
    })
  }
  variants.push(
    { key: 'General Book:transfer', label: label('transfer'), services: ['General Book'] },
    { key: 'absence:absent', label: label('absent'), services: ['absences'] },
    { key: 'absence:returned', label: label('returned'), services: ['absences'] },
  )
  for (const item of classifications.data?.items ?? []) {
    variants.push({
      key: `classification:${item.code}`,
      label: { en: `${item.code} — ${item.name_en}`, ar: `${item.code} — ${item.name_ar}` },
      services: ['General Book'],
    })
  }
  return variants.filter((variant) => has(templateViewCapability('email', variant.key)))
}

export function draftKeysForService(variants: DraftVariant[], service: string): string[] {
  return variants.filter((variant) => variant.services.includes(service)).map((variant) => variant.key)
}

function sampleBasketItem(key: string): EmailBasketItem {
  return {
    bookId: 1, docId: 1, ref: '1/12/GSSG/106', employeeId: 'G1001',
    nameEn: 'Ahmed Ali', nameAr: 'أحمد علي', positionEn: 'Security Guard', positionAr: 'حارس أمن',
    formKind: key.startsWith('classification:') || key === 'General Book:transfer'
      ? 'General Book' : key.startsWith('leave:') ? 'Leave Application Form' : key,
    classificationCode: key.startsWith('classification:') ? key.slice('classification:'.length) : undefined,
    leaveType: key.startsWith('leave:') ? key.slice('leave:'.length) : undefined,
    detail: key === 'General Book:transfer' ? 'النقل' : 'المستند المرفق',
    bookDate: '2026-06-11', startDate: '2026-06-11', endDate: '2026-06-15',
    resumptionDate: '2026-06-16', lastWorkDay: '2026-06-30', joinDate: '2020-01-01',
    bankName: 'بنك أبوظبي الأول', nationality: 'الإمارات', phone: '0501234567',
  }
}

function sampleAbsenceRow(key: string): AbsenceEmailRow {
  return {
    employee_id: 'G1001', employee_name_en: 'Ahmed Ali', employee_name_ar: 'أحمد علي',
    duty_post: 'Guard', duty_unit: 'السرية الثالثة', start_date: '2026-06-11',
    end_date: '2026-06-15', days: 5, notes: null,
    case: key === 'absence:returned' ? 'returned' : 'absent',
  }
}

export function renderDraftSample(key: string, overrides: DraftOverrides): { subject: string; bodyHtml: string } {
  if (key.startsWith('absence:')) {
    return buildAbsenceEmail([sampleAbsenceRow(key)], { violationAttached: false, overrides })
  }
  const items = [sampleBasketItem(key)]
  return { subject: buildBasketSubject(items, overrides), bodyHtml: buildBasketBodyHtml(items, overrides) }
}

export function defaultDraftText(key: string) {
  return key.startsWith('absence:')
    ? defaultAbsenceDraftText([sampleAbsenceRow(key)])
    : defaultBasketDraftText([sampleBasketItem(key)])
}
