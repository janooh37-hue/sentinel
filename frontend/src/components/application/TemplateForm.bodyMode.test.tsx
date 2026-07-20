/**
 * M5-1 — Body-mode toggle HIDDEN for General Books (word-only flow).
 *
 * TDD: RED (before implementation) → GREEN (after).
 *
 * Tests the smallest testable seam: TemplateForm rendered with a minimal
 * General Book schema (one arabic_rich_full field + one text field) and no
 * classification (classificationCode=null). We mock the heavy editor so the
 * test doesn't need a real HugeRTE DOM.
 *
 * Asserts under lng=ar (per i18n-tests-must-assert-arabic memory note):
 *  - Toggle group (role="group") is NOT rendered for General Books
 *  - "اكتب هنا" pill is NOT present
 *  - Rich editor is hidden (bodyMode always treated as 'word')
 *  - Classification is orthogonal: toggle is still gone even with a code picked
 */

import { render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeAll, afterAll, vi, beforeEach } from 'vitest'
import i18n from 'i18next'
import { useForm, FormProvider } from 'react-hook-form'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import ar from '@/locales/ar.json'

// Mock the heavy rich editor — just render a sentinel div so we can detect presence/absence.
vi.mock('@/components/ui/rich-editor', () => ({
  RichEditor: ({ name }: { name: string }) => <div data-testid={`rich-editor-${name}`} />,
}))

// Mock the ClassificationField so it doesn't need a query.
vi.mock('./fields/ClassificationField', () => ({
  ClassificationField: () => <div data-testid="classification-field" />,
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
import { api } from '@/lib/api'
import type { TemplateDetailResponse } from './types'

const GENERAL_BOOK_SCHEMA: TemplateDetailResponse = {
  meta: { id: 'General Book', name_en: 'General Book', name_ar: 'الكتاب العام', category: 'admin', form_number: '', signing_path: 'in_app', has_code: false },
  needs_manager: false,
  needs_submitter: false,
  fields: [
    {
      id: 'subject',
      type: 'text',
      label_en: 'Subject',
      label_ar: 'الموضوع',
      required: true,
    },
    {
      id: 'body',
      type: 'arabic_rich_full',
      label_en: 'Body',
      label_ar: 'المتن',
      required: false,
    },
  ],
}

function makeQc() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function Host({
  bodyMode,
  onBodyModeChange,
  classificationCode = null,
  templateName,
  onTemplateNameChange,
}: {
  bodyMode: 'editor' | 'word'
  onBodyModeChange: (m: 'editor' | 'word') => void
  classificationCode?: string | null
  templateName?: string | null
  onTemplateNameChange?: (v: string | null) => void
}) {
  const form = useForm({ defaultValues: {} })
  return (
    <QueryClientProvider client={makeQc()}>
      <FormProvider {...form}>
        <TemplateForm
          templateId="General Book"
          schema={GENERAL_BOOK_SCHEMA}
          form={form}
          classificationCode={classificationCode}
          onClassificationChange={vi.fn()}
          bodyMode={bodyMode}
          onBodyModeChange={onBodyModeChange}
          templateName={templateName}
          onTemplateNameChange={onTemplateNameChange ?? vi.fn()}
        />
      </FormProvider>
    </QueryClientProvider>
  )
}

describe('TemplateForm body-mode toggle (M5-1: hidden for General Books)', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('does NOT render the toggle group (role="group" aria-label="وضع الكتابة")', () => {
    render(<Host bodyMode="word" onBodyModeChange={vi.fn()} />)
    expect(screen.queryByRole('group', { name: 'وضع الكتابة' })).not.toBeInTheDocument()
  })

  it('does NOT render the "اكتب هنا" (editor) pill', () => {
    render(<Host bodyMode="word" onBodyModeChange={vi.fn()} />)
    expect(screen.queryByText('اكتب هنا')).not.toBeInTheDocument()
  })

  it('does NOT render the "اكتب في Word" pill', () => {
    render(<Host bodyMode="word" onBodyModeChange={vi.fn()} />)
    expect(screen.queryByText('اكتب في Word')).not.toBeInTheDocument()
  })

  it('rich editor is hidden (word mode is the only mode)', () => {
    render(<Host bodyMode="word" onBodyModeChange={vi.fn()} />)
    expect(screen.queryByTestId('rich-editor-body')).not.toBeInTheDocument()
  })

  it('toggle is also absent when a classification code is picked — classification is orthogonal to body mode', () => {
    render(
      <Host bodyMode="word" onBodyModeChange={vi.fn()} classificationCode="5/1" />,
    )
    expect(screen.queryByRole('group', { name: 'وضع الكتابة' })).not.toBeInTheDocument()
    expect(screen.queryByText('اكتب هنا')).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// Task 11 — template picker in General Book word mode
// ---------------------------------------------------------------------------

const GENERAL_BOOK_WITH_RECIPIENT: TemplateDetailResponse = {
  ...GENERAL_BOOK_SCHEMA,
  fields: [
    ...GENERAL_BOOK_SCHEMA.fields,
    {
      id: 'recipient_id',
      type: 'recipient_picker' as const,
      label_en: 'Recipient',
      label_ar: 'المرسل إليه',
      required: false,
    },
    {
      id: 'manager_id',
      type: 'manager_picker' as const,
      label_en: 'Manager',
      label_ar: 'المدير',
      required: false,
    },
  ],
}

function HostWithRecipient({
  bodyMode,
  templateName,
}: {
  bodyMode: 'editor' | 'word'
  templateName?: string | null
}) {
  const form = useForm({ defaultValues: {} })
  return (
    <QueryClientProvider client={makeQc()}>
      <FormProvider {...form}>
        <TemplateForm
          templateId="General Book"
          schema={GENERAL_BOOK_WITH_RECIPIENT}
          form={form}
          classificationCode={null}
          onClassificationChange={vi.fn()}
          bodyMode={bodyMode}
          onBodyModeChange={vi.fn()}
          templateName={templateName}
          onTemplateNameChange={vi.fn()}
        />
      </FormProvider>
    </QueryClientProvider>
  )
}

describe('TemplateForm template picker (Arabic, Task 11)', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.mocked(api.listWordTemplates).mockResolvedValue([])
  })

  it('shows the template picker in word mode with a none default', async () => {
    vi.mocked(api.listWordTemplates).mockResolvedValue([
      { name: 'الصيانة.docx', modified_at: '2026-07-19T00:00:00', kind: 'custom' },
    ])
    render(<HostWithRecipient bodyMode="word" />)
    expect(await screen.findByText('بدون قالب')).toBeInTheDocument()
    expect(await screen.findByRole('combobox', { name: 'القالب' })).toBeInTheDocument()
  })

  it('hides recipient/cc/manager fields when a template is selected', () => {
    vi.mocked(api.listWordTemplates).mockResolvedValue([
      { name: 'الصيانة.docx', modified_at: '2026-07-19T00:00:00', kind: 'custom' },
    ])
    render(<HostWithRecipient bodyMode="word" templateName="الصيانة.docx" />)
    expect(screen.queryByText(/المرسل إليه|recipient/i)).not.toBeInTheDocument()
  })
})

// ---------------------------------------------------------------------------
// M4d-4 — TableGridField wired into TemplateForm + picker grouped by kind
// ---------------------------------------------------------------------------

// Minimal AR bundle covering keys the new code touches (avoids full ar.json OOM).
const AR_BUNDLE_M4D: Record<string, unknown> = {
  books: {
    word: {
      baseTemplate: { group: 'ابدأ من' },
      customTemplate: { group: 'قوالبي' },
      tableGrid: {
        loading: 'جارٍ تحميل أعمدة الجدول…',
        error: 'تعذّر تحميل أعمدة الجدول.',
        empty: 'لا صفوف بعد — أضف صفاً للبدء.',
        columnLabel: 'عمود {{n}}',
      },
      templatePicker: 'القالب',
      templateNone: 'بدون قالب',
    },
  },
}

function HostForTableGrid({ templateName }: { templateName: string | null }) {
  const form = useForm({ defaultValues: {} })
  return (
    <QueryClientProvider client={makeQc()}>
      <FormProvider {...form}>
        <TemplateForm
          templateId="General Book"
          schema={GENERAL_BOOK_SCHEMA}
          form={form}
          classificationCode={null}
          onClassificationChange={vi.fn()}
          bodyMode="word"
          onBodyModeChange={vi.fn()}
          templateName={templateName}
          onTemplateNameChange={vi.fn()}
        />
      </FormProvider>
    </QueryClientProvider>
  )
}

describe('TemplateForm M4d-4 — TableGridField wiring + picker grouping', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', AR_BUNDLE_M4D as never, true, true)
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  beforeEach(() => {
    vi.mocked(api.getWordTemplateTable).mockResolvedValue({ has_table: false, columns: [] })
    vi.mocked(api.listWordTemplates).mockResolvedValue([])
  })

  it('does NOT render grid when has_table is false', async () => {
    vi.mocked(api.getWordTemplateTable).mockResolvedValue({ has_table: false, columns: [] })
    vi.mocked(api.listWordTemplates).mockResolvedValue([
      { name: 'نص.docx', modified_at: '2026-07-19T00:00:00', kind: 'base' },
    ])
    render(<HostForTableGrid templateName="نص.docx" />)
    // Wait for the query to settle then assert no table
    await waitFor(() => expect(vi.mocked(api.getWordTemplateTable)).toHaveBeenCalled())
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })

  it('renders grid headers when has_table is true', async () => {
    vi.mocked(api.getWordTemplateTable).mockResolvedValue({
      has_table: true,
      columns: ['المادة', 'العدد'],
    })
    vi.mocked(api.listWordTemplates).mockResolvedValue([
      { name: 'جدول.docx', modified_at: '2026-07-19T00:00:00', kind: 'base' },
    ])
    render(<HostForTableGrid templateName="جدول.docx" />)
    await waitFor(() => expect(screen.getByText('المادة')).toBeInTheDocument())
    expect(screen.getByText('العدد')).toBeInTheDocument()
  })

  it('picker renders base and custom options as separate groups', async () => {
    vi.mocked(api.listWordTemplates).mockResolvedValue([
      { name: 'نص.docx', modified_at: '2026-07-19T00:00:00', kind: 'base' },
      { name: 'صيانة.docx', modified_at: '2026-07-19T00:00:00', kind: 'custom' },
    ])
    const { container } = render(<HostForTableGrid templateName={null} />)
    // Both options must appear in the picker
    expect(await screen.findByText('نص')).toBeInTheDocument()
    expect(await screen.findByText('صيانة')).toBeInTheDocument()
    // Groups (optgroup labels are attributes, not text nodes — query via DOM)
    expect(container.querySelector('optgroup[label="ابدأ من"]')).not.toBeNull()
    expect(container.querySelector('optgroup[label="قوالبي"]')).not.toBeNull()
  })
})
