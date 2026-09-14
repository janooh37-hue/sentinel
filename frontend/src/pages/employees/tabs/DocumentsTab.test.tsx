import { fireEvent, render, screen } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { RecentDocumentRead } from '@/lib/api'
import { DocumentsTab } from './DocumentsTab'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))

function LocationProbe(): React.JSX.Element {
  const location = useLocation()
  return <output data-testid="location">{`${location.pathname}${location.search}`}</output>
}

const baseDocument: RecentDocumentRead = {
  id: 41,
  template_id: 'violation_notice',
  ref_number: 'REF-41',
  created_at: '2026-08-15T10:00:00Z',
  book_id: 77,
  approval_state: 'approved',
}

describe('DocumentsTab', () => {
  it.each([
    {
      label: 'a document linked to a book',
      document: baseDocument,
      buttonName: /REF-41/,
      expectedName: 'REF-41',
    },
    {
      label: 'a document without a book or reference number',
      document: {
        ...baseDocument,
        id: 42,
        template_id: 'leave_application',
        ref_number: '',
        book_id: null,
      },
      buttonName: /leave_application/,
      expectedName: 'leave_application',
    },
  ])('previews $label in place', ({ document, buttonName, expectedName }) => {
    const onPreviewDocs = vi.fn()

    render(
      <MemoryRouter initialEntries={['/employees/G100?tab=documents']}>
        <DocumentsTab
          docs={[document]}
          employeeName="John Doe"
          onPreviewDocs={onPreviewDocs}
        />
        <LocationProbe />
      </MemoryRouter>,
    )

    fireEvent.click(screen.getByRole('button', { name: buttonName }))

    expect(onPreviewDocs).toHaveBeenCalledOnce()
    expect(onPreviewDocs).toHaveBeenCalledWith([{ id: document.id, name: expectedName }])
    expect(screen.getByTestId('location')).toHaveTextContent('/employees/G100?tab=documents')
  })
})
