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

// Mock api — TemplateForm's word-mode queries call these unconditionally;
// they're `enabled: false` here but the module still needs to resolve.
vi.mock('@/lib/api', () => ({
  api: {
    listWordTemplates: vi.fn().mockResolvedValue([]),
    listManagers: vi.fn().mockResolvedValue([]),
    listRecipients: vi.fn().mockResolvedValue([]),
    getWordTemplateTable: vi.fn().mockResolvedValue({ has_table: false, columns: [] }),
  },
}))

import { TemplateForm } from './TemplateForm'
import type { TemplateDetailResponse, TemplateField } from './types'

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
]

// TemplateForm's `schema` prop is a full TemplateDetailResponse — meta,
// needs_manager, needs_submitter and fields — not a bare { fields }.
const SCHEMA: TemplateDetailResponse = {
  meta: {
    id: 'Inmate Conduct Violations',
    name_en: 'Inmate Conduct Violations',
    name_ar: 'تقرير المخالفات المسلكية',
    form_number: '300-005',
    category: 'admin',
    signing_path: 'auto',
    has_code: true,
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

  it('has its own Services glyph', () => {
    expect(emojiForTemplate('Inmate Conduct Violations')).toBe('🚨')
  })

  it('renders every field type without an unknown-type warning', () => {
    render(<Harness />)
    expect(screen.getByLabelText(/date/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/time/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add inmate/i })).toBeInTheDocument()
    expect(screen.getByTestId('rich-editor-violation_details')).toBeInTheDocument()
  })

  it('labels the supervisor action in Arabic under lng=ar', async () => {
    await i18n.changeLanguage('ar')
    render(<Harness />)
    expect(screen.getByText('تم ابلاغ مدير فرع شؤون النزلاء')).toBeInTheDocument()
    await i18n.changeLanguage('en')
  })
})
