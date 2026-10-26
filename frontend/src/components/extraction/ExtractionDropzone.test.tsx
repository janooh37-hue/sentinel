import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { toast } from '@/lib/toast'
import { extractDocument, type ExtractionResponse } from '@/lib/extraction'
import { ExtractionDropzone } from './ExtractionDropzone'

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@/components/shell/CapabilityGate', () => ({ CapabilityGate: ({ children }: { children: ReactNode }) => children }))
vi.mock('@/lib/extraction', () => ({ extractDocument: vi.fn() }))
vi.mock('@/lib/toast', () => ({ toast: {
  loading: vi.fn(() => 'ocr-job'), error: vi.fn(), dismiss: vi.fn(),
} }))

beforeEach(() => vi.clearAllMocks())

describe('ExtractionDropzone toast lifecycle', () => {
  it.each([true, false])('resolves OCR loading (success=%s)', async (success) => {
    const response: ExtractionResponse = {
      id: 1, document_type: 'emirates_id', document_type_confidence: 1, alternatives: [], fields: [],
      matched_employee_id: null, match_score: 0, matched_employee_name_en: null, matched_employee_name_ar: null,
    }
    if (success) vi.mocked(extractDocument).mockResolvedValue(response)
    else vi.mocked(extractDocument).mockRejectedValue(new Error('OCR is not available'))
    const onExtracted = vi.fn()
    const view = render(<ExtractionDropzone onExtracted={onExtracted} />)
    fireEvent.change(view.container.querySelector('input[type="file"]')!, {
      target: { files: [new File([], 'scan.pdf', { type: 'application/pdf' })] },
    })
    expect(toast.loading).toHaveBeenCalledWith('books.pane.scanReading')
    if (success) {
      await waitFor(() => expect(toast.dismiss).toHaveBeenCalledWith('ocr-job'))
      expect(onExtracted).toHaveBeenCalledWith(response)
    } else {
      await waitFor(() => expect(toast.error).toHaveBeenCalledWith('extraction.dropzone.errorUnavailable', { id: 'ocr-job' }))
      expect(onExtracted).not.toHaveBeenCalled()
      expect(toast.dismiss).not.toHaveBeenCalled()
    }
  })
})
