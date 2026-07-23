/**
 * Finding 1b — regression test: Report form must NOT be treated as General Book
 * word-mode (discriminator fix: `&& templateId !== 'Report'`).
 *
 * Before the fix, `isGeneralBook` was true for Report (it has arabic_rich_full),
 * causing the classification picker to show and the body editor to hide.
 *
 * Full ApplicationPage mount is infeasible in this harness (heavy, OOM-prone —
 * see ApplicationPage.tableRows.test.tsx comment block). TemplateForm-level test
 * is the strongest available seam and directly guards the discriminator.
 *
 * Asserts (per i18n-tests-must-assert-arabic memory note, lng=ar):
 *  - Body editor (arabic_rich_full) IS rendered for Report
 *  - Classification picker is NOT rendered for Report
 *
 * Also asserts General Book still gets the classification picker (no regression there).
 */

import { render, screen } from '@testing-library/react'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import i18n from 'i18next'
import { useForm, FormProvider } from 'react-hook-form'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import ar from '@/locales/ar.json'

// Mock the heavy rich editor — sentinel div so we can detect presence/absence.
vi.mock('@/components/ui/rich-editor', () => ({
  RichEditor: ({ name }: { name: string }) => <div data-testid={`rich-editor-${name}`} />,
}))

// Mock ClassificationField so it doesn't need a query.
vi.mock('./fields/ClassificationField', () => ({
  ClassificationField: () => <div data-testid="classification-field" />,
}))

// Mock EmployeePickerField — Report has one; don't need a real query.
vi.mock('./fields/EmployeePickerField', () => ({
  EmployeePickerField: ({ name }: { name: string }) => (
    <div data-testid={`employee-picker-${name}`} />
  ),
}))

// Mock api (used indirectly via hooks inside TemplateForm).
vi.mock('@/lib/api', () => ({
  api: {
    listWordTemplates: vi.fn().mockResolvedValue([]),
    listManagers: vi.fn().mockResolvedValue([]),
    listRecipients: vi.fn().mockResolvedValue([]),
    getWordTemplateTable: vi.fn().mockResolvedValue({ has_table: false, columns: [] }),
  },
}))

import { TemplateForm } from './TemplateForm'
import type { TemplateDetailResponse } from './types'

// ── schemas ──────────────────────────────────────────────────────────────────

const REPORT_SCHEMA: TemplateDetailResponse = {
  meta: {
    id: 'Report',
    name_en: 'Report',
    name_ar: 'تقرير',
    category: 'admin',
    form_number: '300-004',
    signing_path: 'in_app',
    has_code: false,
  },
  needs_manager: false,
  needs_submitter: false,
  fields: [
    { id: 'signer_id', type: 'employee_picker', label_en: 'Signer', label_ar: 'الموقّع', required: true },
    { id: 'subject', type: 'text', label_en: 'Subject', label_ar: 'الموضوع', required: true },
    { id: 'body', type: 'arabic_rich_full', label_en: 'Report Body', label_ar: 'نص التقرير', required: true },
  ],
}

const GENERAL_BOOK_SCHEMA: TemplateDetailResponse = {
  meta: {
    id: 'General Book',
    name_en: 'General Book',
    name_ar: 'الكتاب العام',
    category: 'admin',
    form_number: '',
    signing_path: 'in_app',
    has_code: false,
  },
  needs_manager: false,
  needs_submitter: false,
  fields: [
    { id: 'subject', type: 'text', label_en: 'Subject', label_ar: 'الموضوع', required: true },
    { id: 'body', type: 'arabic_rich_full', label_en: 'Body', label_ar: 'المتن', required: false },
  ],
}

// ── harness ──────────────────────────────────────────────────────────────────

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function Host({
  templateId,
  schema,
  classificationCode = null,
}: {
  templateId: string
  schema: TemplateDetailResponse
  classificationCode?: string | null
}) {
  const form = useForm({ defaultValues: {} })
  return (
    <QueryClientProvider client={makeQc()}>
      <FormProvider {...form}>
        <TemplateForm
          templateId={templateId}
          schema={schema}
          form={form}
          classificationCode={classificationCode}
          onClassificationChange={vi.fn()}
          bodyMode="word"
          onBodyModeChange={vi.fn()}
          templateName={null}
          onTemplateNameChange={vi.fn()}
        />
      </FormProvider>
    </QueryClientProvider>
  )
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('TemplateForm Report discriminator (Finding 1b)', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('Report: renders the arabic_rich_full body editor', () => {
    render(<Host templateId="Report" schema={REPORT_SCHEMA} />)
    expect(screen.getByTestId('rich-editor-body')).toBeInTheDocument()
  })

  it('Report: does NOT render the classification picker', () => {
    render(<Host templateId="Report" schema={REPORT_SCHEMA} />)
    expect(screen.queryByTestId('classification-field')).not.toBeInTheDocument()
  })

  it('General Book: still renders the classification picker (no regression)', () => {
    render(<Host templateId="General Book" schema={GENERAL_BOOK_SCHEMA} />)
    expect(screen.getByTestId('classification-field')).toBeInTheDocument()
  })

  it('General Book: does NOT render the body editor in word mode (existing behavior)', () => {
    render(<Host templateId="General Book" schema={GENERAL_BOOK_SCHEMA} />)
    expect(screen.queryByTestId('rich-editor-body')).not.toBeInTheDocument()
  })
})
