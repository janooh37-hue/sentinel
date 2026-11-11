import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { QueueNav } from './QueueNav'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, o?: { n?: string; total?: string }) => `${key}|${o?.n ?? ''}|${o?.total ?? ''}`,
  }),
}))
vi.mock('@/components/ui/hint', () => ({ Hint: ({ children }: { children: React.ReactNode }) => <>{children}</> }))

describe('QueueNav position', () => {
  it('says "n of total" for a complete list', () => {
    render(<QueueNav position={1} total={500} onPrev={vi.fn()} onNext={vi.fn()} />)
    expect(screen.getByTestId('queue-position').textContent).toContain('books.record.queuePosition|')
  })

  it('says "n of total+" when the list was cut off at its fetch limit', () => {
    render(<QueueNav position={1} total={500} more onPrev={vi.fn()} onNext={vi.fn()} />)
    expect(screen.getByTestId('queue-position').textContent).toContain('500+')
  })

  it('appends a plus to the compact counter', () => {
    render(<QueueNav compact position={1} total={500} more onPrev={vi.fn()} onNext={vi.fn()} />)
    expect(screen.getByTestId('queue-position')).toHaveTextContent('1/500+')
  })
})
