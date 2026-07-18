/**
 * Task 12 — Body-mode toggle on plain General Book form.
 *
 * TDD: RED (before implementation) → GREEN (after).
 *
 * Tests the smallest testable seam: TemplateForm rendered with a minimal
 * General Book schema (one arabic_rich_full field + one text field) and no
 * classification (classificationCode=null). We mock the heavy editor so the
 * test doesn't need a real HugeRTE DOM.
 *
 * Asserts under lng=ar (per i18n-tests-must-assert-arabic memory note):
 *  - Toggle renders Arabic labels "اكتب هنا" and "اكتب في Word"
 *  - Default (bodyMode='editor'): rich editor is visible
 *  - After selecting "اكتب في Word": rich editor is hidden
 *  - Classification is orthogonal: toggle + editor render with a code picked
 */

import { render, screen, fireEvent } from '@testing-library/react'
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

describe('TemplateForm body-mode toggle (Arabic, Task 12)', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders Arabic toggle labels اكتب هنا and اكتب في Word', () => {
    render(<Host bodyMode="editor" onBodyModeChange={vi.fn()} />)
    expect(screen.getByText('اكتب هنا')).toBeInTheDocument()
    expect(screen.getByText('اكتب في Word')).toBeInTheDocument()
  })

  it('default editor mode: rich editor IS visible', () => {
    render(<Host bodyMode="editor" onBodyModeChange={vi.fn()} />)
    expect(screen.getByTestId('rich-editor-body')).toBeInTheDocument()
  })

  it('word mode: rich editor is HIDDEN', () => {
    render(<Host bodyMode="word" onBodyModeChange={vi.fn()} />)
    expect(screen.queryByTestId('rich-editor-body')).not.toBeInTheDocument()
  })

  it('clicking "اكتب في Word" calls onBodyModeChange("word")', () => {
    const onBodyModeChange = vi.fn()
    render(<Host bodyMode="editor" onBodyModeChange={onBodyModeChange} />)
    fireEvent.click(screen.getByText('اكتب في Word'))
    expect(onBodyModeChange).toHaveBeenCalledWith('word')
  })

  it('clicking "اكتب هنا" calls onBodyModeChange("editor")', () => {
    const onBodyModeChange = vi.fn()
    render(<Host bodyMode="word" onBodyModeChange={onBodyModeChange} />)
    fireEvent.click(screen.getByText('اكتب هنا'))
    expect(onBodyModeChange).toHaveBeenCalledWith('editor')
  })

  it('toggle IS rendered when a classification is picked — classification is orthogonal to body mode', () => {
    render(
      <Host bodyMode="editor" onBodyModeChange={vi.fn()} classificationCode="5/1" />,
    )
    expect(screen.getByText('اكتب هنا')).toBeInTheDocument()
    expect(screen.getByText('اكتب في Word')).toBeInTheDocument()
  })

  it('classification picked + editor mode: rich editor stays visible', () => {
    render(
      <Host bodyMode="editor" onBodyModeChange={vi.fn()} classificationCode="5/1" />,
    )
    expect(screen.getByTestId('rich-editor-body')).toBeInTheDocument()
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
      { name: 'الصيانة.docx', modified_at: '2026-07-19T00:00:00' },
    ])
    render(<HostWithRecipient bodyMode="word" />)
    expect(await screen.findByText('بدون قالب')).toBeInTheDocument()
    expect(await screen.findByRole('combobox', { name: 'القالب' })).toBeInTheDocument()
  })

  it('hides recipient/cc/manager fields when a template is selected', () => {
    vi.mocked(api.listWordTemplates).mockResolvedValue([
      { name: 'الصيانة.docx', modified_at: '2026-07-19T00:00:00' },
    ])
    render(<HostWithRecipient bodyMode="word" templateName="الصيانة.docx" />)
    expect(screen.queryByText(/المرسل إليه|recipient/i)).not.toBeInTheDocument()
  })
})
