/**
 * Task 6 — Services-gallery glyph + form assembly gate for the Inmate Conduct
 * Violations form. Everything else (fields, i18n keys, backend) ships from
 * Tasks 1-5; this is the seam that proves it all wires together in
 * TemplateForm's field-type switch.
 *
 * Harness note: TemplateForm calls `useQuery` unconditionally (word-templates
 * + table-schema queries, both `enabled: false` for this template) at
 * TemplateForm.tsx:399/405, so a QueryClientProvider is a hard runtime
 * requirement the props type can't express. Scaffolding below (makeQc, the
 * `@/lib/api` mock, the RichEditor sentinel mock) is copied from the proven
 * `TemplateForm.bodyMode.test.tsx` harness rather than reinvented.
 */

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'
import { FormProvider, useForm } from 'react-hook-form'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import i18n from '@/lib/i18n'
import { emojiForTemplate } from '@/pages/application/formEmoji'

// Mock the heavy rich editor — sentinel div so we can detect presence/absence
// without needing a real HugeRTE DOM (same pattern as TemplateForm.bodyMode.test.tsx).
vi.mock('@/components/ui/rich-editor', () => ({
  RichEditor: ({ name }: { name: string }) => <div data-testid={`rich-editor-${name}`} />,
}))

// Mock api — TemplateForm's word-mode queries call these unconditionally,
// and this schema's employee_picker/manager_picker fields (EmployeePicker,
// ManagerPickerField) each hit their own api.* method. All disabled/gated at
// mount, but the module still needs every method the render tree references
// to resolve as a callable — an absent key throws "is not a function" the
// moment a query becomes enabled, not at mock-definition time.
vi.mock('@/lib/api', () => ({
  api: {
    listWordTemplates: vi.fn().mockResolvedValue([]),
    listManagers: vi.fn().mockResolvedValue([]),
    listRecipients: vi.fn().mockResolvedValue([]),
    getWordTemplateTable: vi.fn().mockResolvedValue({ has_table: false, columns: [] }),
    listEmployees: vi.fn().mockResolvedValue({ items: [] }),
    getEmployee: vi.fn().mockResolvedValue(null),
  },
}))

import { TemplateForm } from './TemplateForm'
import type { TemplateDetailResponse, TemplateField } from './types'

// The real, full field list from backend/templates/_fields.json (Task 1),
// `key` renamed to `id` per the frontend TemplateField shape — not the
// 5-field subset that would only exercise inmates_table/time in isolation.
// Task 6's job is an end-to-end assembly gate: every field type this form
// ships must dispatch through TemplateForm's switch without the render tree
// throwing, including the two pickers (employee_picker, manager_picker) that
// hit live api.* methods.
const FIELDS: TemplateField[] = [
  { id: 'report_date', label_en: 'Date', label_ar: 'التاريخ', type: 'date', required: true },
  { id: 'report_time', label_en: 'Time', label_ar: 'الوقت', type: 'time', required: true },
  { id: 'inmates', label_en: 'Inmates', label_ar: 'النزلاء', type: 'inmates_table', required: true },
  {
    id: 'violation_details',
    label_en: 'Violation details',
    label_ar: 'تفاصيل المخالفة',
    type: 'arabic_rich',
    required: true,
  },
  {
    id: 'action_notified',
    label_en: 'Branch manager of Inmate Affairs was notified',
    label_ar: 'تم ابلاغ مدير فرع شؤون النزلاء',
    type: 'checkbox',
  },
  {
    id: 'action_written',
    label_en: 'A conduct violation was written against the inmate',
    label_ar: 'تم كتابة مخالفة مسلكية في حق النزلاء',
    type: 'checkbox',
  },
  {
    id: 'action_transferred',
    label_en: 'Inmate moved to section B and restrained',
    label_ar: 'تم نقل النزيل الى قسم B وتقييده',
    type: 'checkbox',
  },
  {
    id: 'action_other',
    label_en: 'Other action',
    label_ar: 'إجراء آخر',
    type: 'text',
  },
  {
    id: 'reporter_id',
    label_en: 'Reported by',
    label_ar: 'مقدم التقرير',
    type: 'employee_picker',
    required: true,
  },
  {
    id: 'manager_id',
    label_en: 'Signing manager',
    label_ar: 'المُوقِّع',
    type: 'manager_picker',
  },
  {
    id: 'hand_sign_manager',
    label_en: "Embed manager's saved signature",
    label_ar: 'تضمين توقيع المدير المحفوظ',
    type: 'hand_sign_checkbox',
  },
]

// TemplateForm's `schema` prop is a full TemplateDetailResponse — meta,
// needs_manager, needs_submitter and fields — not a bare { fields }.
const SCHEMA: TemplateDetailResponse = {
  meta: {
    id: 'Inmate Conduct Violations',
    name_en: 'Inmate Conduct Violations',
    name_ar: 'المخالفات المسلكية',
    form_number: '300-005',
    category: 'admin',
    signing_path: 'auto',
    has_code: true,
    notifies_employee: false,
    feature_minted: false,
  },
  needs_manager: true,
  needs_submitter: false,
  fields: FIELDS,
}

function makeQc(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function Harness(): React.JSX.Element {
  const form = useForm({ defaultValues: { inmates: [] } })
  return (
    <QueryClientProvider client={makeQc()}>
      <FormProvider {...form}>
        <TemplateForm templateId="Inmate Conduct Violations" schema={SCHEMA} form={form} />
      </FormProvider>
    </QueryClientProvider>
  )
}

describe('Inmate Conduct Violations form', () => {
  // Pin the language rather than relying on the LanguageDetector's resolved
  // default — @/lib/i18n re-inits the shared i18next singleton (already
  // init'd by src/test/setup.ts) with the detector wired in.
  beforeAll(async () => {
    await i18n.changeLanguage('en')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('has its own Services glyph, distinct from the similarly-named Violation Form', () => {
    // 🚨 is already spoken for by 'Violation Form' (quickActions.ts) — this
    // form got its own glyph after review caught the collision.
    expect(emojiForTemplate('Inmate Conduct Violations')).toBe('⛓️')
    expect(emojiForTemplate('Inmate Conduct Violations')).not.toBe(
      emojiForTemplate('Violation Form'),
    )
  })

  it('renders every field type without an unknown-type warning', () => {
    render(<Harness />)
    expect(screen.getByLabelText(/date/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/time/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add inmate/i })).toBeInTheDocument()
    expect(screen.getByTestId('rich-editor-violation_details')).toBeInTheDocument()
    // Three fixed action checkboxes + the free-text "other action" line.
    expect(screen.getByText('A conduct violation was written against the inmate')).toBeInTheDocument()
    expect(screen.getByText('Inmate moved to section B and restrained')).toBeInTheDocument()
    expect(screen.getByLabelText('Other action')).toBeInTheDocument()
    // Employee picker (reporter_id) — hits the mocked api.listEmployees /
    // api.getEmployee (both disabled at mount, but the module must resolve).
    expect(screen.getByPlaceholderText('Pick an employee…')).toBeInTheDocument()
    // Manager picker (manager_id) — real ManagerPickerField hitting the
    // mocked api.listManagers().
    expect(screen.getByText('Signing manager')).toBeInTheDocument()
    // hand_sign_checkbox with no paired `manager_sig_path` signature field in
    // this schema renders standalone via EmbedSignatureCheckbox (not
    // suppressed — that only happens when a paired signature field exists).
    expect(screen.getByText("Embed manager's saved signature")).toBeInTheDocument()
  })

  it('labels the supervisor action in Arabic under lng=ar', async () => {
    await i18n.changeLanguage('ar')
    render(<Harness />)
    expect(screen.getByText('تم ابلاغ مدير فرع شؤون النزلاء')).toBeInTheDocument()
    await i18n.changeLanguage('en')
  })

  // Task 9 review: the prior Arabic test above only ever checked one field
  // (action_notified). report_time (TimeField) and action_other's label were
  // asserted in English ONLY (getByLabelText(/time/i) is language-agnostic —
  // it would pass just as well against a broken/English label under lng=ar).
  // This repo's documented trap is exactly a green suite that never actually
  // rendered the Arabic string.
  it('labels report_time and action_other in Arabic under lng=ar', async () => {
    await i18n.changeLanguage('ar')
    render(<Harness />)
    // report_time is required, so its label also carries a trailing "*" —
    // exact: false matches the label text regardless, same as the original
    // English assertion's /time/i regex avoided the same asterisk collision.
    expect(screen.getByLabelText('الوقت', { exact: false })).toBeInTheDocument()
    expect(screen.queryByLabelText('Time', { exact: false })).not.toBeInTheDocument()
    expect(screen.getByLabelText('إجراء آخر')).toBeInTheDocument()
    expect(screen.queryByLabelText('Other action')).not.toBeInTheDocument()
    await i18n.changeLanguage('en')
  })
})
