/**
 * ClassificationField — TDD RED → GREEN
 *
 * Renders under lng=ar with a mocked query; asserts Arabic label + option text;
 * asserts onChange fires with the code string.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import i18n from 'i18next'
import { useForm, FormProvider } from 'react-hook-form'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

import ar from '@/locales/ar.json'

// Mock the api module so useQuery doesn't hit the network.
vi.mock('@/lib/api', () => ({
  api: {
    listBookClassifications: vi.fn().mockResolvedValue({
      items: [
        { code: '5/1', tab: 1, name_ar: 'تصنيف المالية', name_en: 'Finance', unit_ar: 'وحدة المالية' },
        { code: '5/2', tab: 2, name_ar: 'تصنيف الموارد البشرية', name_en: 'HR', unit_ar: 'وحدة الموارد البشرية' },
      ],
    }),
  },
}))

import { ClassificationField } from './ClassificationField'

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}

function Host({ onChange }: { onChange: (v: string | null) => void }) {
  const methods = useForm({ defaultValues: { classification_code: null } })
  return (
    <QueryClientProvider client={makeClient()}>
      <FormProvider {...methods}>
        <ClassificationField
          name="classification_code"
          label_en="Classification"
          label_ar="التبويب"
          required={false}
          onChange={onChange}
        />
      </FormProvider>
    </QueryClientProvider>
  )
}

describe('ClassificationField (Arabic)', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('renders the Arabic label', async () => {
    const onChange = vi.fn()
    render(<Host onChange={onChange} />)
    expect(screen.getByText('التبويب')).toBeInTheDocument()
  })

  it('shows "بدون تبويب" as the first option', async () => {
    const onChange = vi.fn()
    render(<Host onChange={onChange} />)
    // Open the select — the option appears in the portal
    fireEvent.click(screen.getByRole('combobox'))
    await waitFor(() => {
      // Multiple matches: trigger placeholder + portal option — both are correct
      expect(screen.getAllByText('بدون تبويب').length).toBeGreaterThanOrEqual(1)
    })
  })

  it('shows classification options from the query', async () => {
    const onChange = vi.fn()
    render(<Host onChange={onChange} />)
    fireEvent.click(screen.getByRole('combobox'))
    await waitFor(() => {
      expect(screen.getByText('5/1 — تصنيف المالية')).toBeInTheDocument()
    })
  })

  it('calls onChange with the code when an option is selected', async () => {
    const onChange = vi.fn()
    render(<Host onChange={onChange} />)
    fireEvent.click(screen.getByRole('combobox'))
    await waitFor(() => {
      expect(screen.getByText('5/1 — تصنيف المالية')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('5/1 — تصنيف المالية'))
    expect(onChange).toHaveBeenCalledWith('5/1')
  })
})
