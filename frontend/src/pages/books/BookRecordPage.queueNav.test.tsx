/**
 * Header queue arrows. Asserted under lng=ar as well as en — an English-only
 * assertion cannot catch an AR leak when the EN label equals the key.
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import i18n from 'i18next'

import ar from '@/locales/ar.json'
import { QueueNav } from './QueueNav'

vi.mock('@/lib/api', () => ({ api: { listAwaitingBooks: vi.fn() } }))

describe('QueueNav (English)', () => {
  it('renders the position and both arrows for a middle book', () => {
    render(<QueueNav position={2} total={3} onPrev={vi.fn()} onNext={vi.fn()} />)
    expect(screen.getByTestId('queue-position')).toHaveTextContent('2 of 3')
    expect(screen.getByTestId('queue-prev')).toBeEnabled()
    expect(screen.getByTestId('queue-next')).toBeEnabled()
  })

  it('renders nothing when the queue holds fewer than two books', () => {
    const { container } = render(
      <QueueNav position={1} total={1} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the book is not in the queue', () => {
    const { container } = render(
      <QueueNav position={null} total={5} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it('disables the edge arrow at the head and the tail', () => {
    const { rerender } = render(
      <QueueNav position={1} total={3} onPrev={vi.fn()} onNext={vi.fn()} />,
    )
    expect(screen.getByTestId('queue-prev')).toBeDisabled()
    rerender(<QueueNav position={3} total={3} onPrev={vi.fn()} onNext={vi.fn()} />)
    expect(screen.getByTestId('queue-next')).toBeDisabled()
  })

  it('calls the handlers', async () => {
    const user = userEvent.setup()
    const onPrev = vi.fn()
    const onNext = vi.fn()
    render(<QueueNav position={2} total={3} onPrev={onPrev} onNext={onNext} />)
    await user.click(screen.getByTestId('queue-prev'))
    await user.click(screen.getByTestId('queue-next'))
    expect(onPrev).toHaveBeenCalledTimes(1)
    expect(onNext).toHaveBeenCalledTimes(1)
  })
})

describe('QueueNav (Arabic)', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('labels and counter are Arabic, not English', () => {
    render(<QueueNav position={2} total={3} onPrev={vi.fn()} onNext={vi.fn()} />)
    expect(screen.getByLabelText('السجل السابق بانتظار الاعتماد')).toBeInTheDocument()
    expect(screen.getByLabelText('السجل التالي بانتظار الاعتماد')).toBeInTheDocument()
    expect(screen.getByTestId('queue-position')).toHaveTextContent('2 من 3')
  })
})
