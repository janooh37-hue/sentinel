import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ApiError } from '@/lib/api'

import { DocumentState } from './DocumentState'
import { documentErrorKind } from './documentError'

describe('DocumentState', () => {
  it('loading is a status region', () => {
    render(<DocumentState kind="loading" />)
    expect(screen.getByRole('status')).toBeInTheDocument()
  })

  it('error offers retry, open and DOCX, and retry fires', async () => {
    const onRetry = vi.fn()
    render(<DocumentState kind="error" onRetry={onRetry} openUrl="/x.pdf" docxUrl="/x.docx" />)
    expect(screen.getByText('Couldn’t render this PDF')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open in new tab' })).toHaveAttribute('href', '/x.pdf')
    expect(screen.getByRole('link', { name: 'Download DOCX' })).toHaveAttribute('href', '/x.docx')
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
  })

  it('forbidden has no retry', () => {
    render(<DocumentState kind="forbidden" onRetry={() => undefined} />)
    expect(screen.getByText('You don’t have access to this file')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })

  it('empty takes title, body and action overrides', () => {
    render(<DocumentState kind="empty" title="Nothing" body="Add one" action={<button>Go</button>} />)
    expect(screen.getByText('Nothing')).toBeInTheDocument()
    expect(screen.getByText('Add one')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Go' })).toBeInTheDocument()
  })

  it('maps 401/403 to forbidden and everything else to error', () => {
    expect(documentErrorKind(403)).toBe('forbidden')
    expect(documentErrorKind(new ApiError(401, 'X', 'no'))).toBe('forbidden')
    expect(documentErrorKind(new Error('HTTP 403'))).toBe('forbidden')
    expect(documentErrorKind(new Error('HTTP 404'))).toBe('error')
    expect(documentErrorKind(new ApiError(500, 'X', 'boom'))).toBe('error')
    expect(documentErrorKind('weird')).toBe('error')
  })
})
