/**
 * Mark toggle (record header). Asserted under lng=ar as well as en — an
 * English-only assertion cannot catch an AR leak when the EN label equals
 * the key (see BookRecordPage.queueNav.test.tsx for the same pattern).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import i18n from 'i18next'

import ar from '@/locales/ar.json'
import { MarkToggle } from './MarkToggle'

describe('MarkToggle (English)', () => {
  it('disarmed renders the Mark label', () => {
    render(<MarkToggle armed={false} onToggle={vi.fn()} />)
    expect(screen.getByTestId('mark-toggle')).toHaveTextContent('Mark')
  })

  it('armed renders the Marking-on label', () => {
    render(<MarkToggle armed={true} onToggle={vi.fn()} />)
    expect(screen.getByTestId('mark-toggle')).toHaveTextContent('Marking on — tap to cancel')
  })

  it('calls onToggle when clicked', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    render(<MarkToggle armed={false} onToggle={onToggle} />)
    await user.click(screen.getByTestId('mark-toggle'))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

describe('MarkToggle (Arabic)', () => {
  beforeAll(async () => {
    i18n.addResourceBundle('ar', 'translation', ar, true, true)
    await i18n.changeLanguage('ar')
  })
  afterAll(async () => {
    await i18n.changeLanguage('en')
  })

  it('disarmed renders the Arabic label, not English or the key', () => {
    render(<MarkToggle armed={false} onToggle={vi.fn()} />)
    expect(screen.getByTestId('mark-toggle')).toHaveTextContent('تحديد')
  })

  it('armed renders the Arabic label, not English or the key', () => {
    render(<MarkToggle armed={true} onToggle={vi.fn()} />)
    expect(screen.getByTestId('mark-toggle')).toHaveTextContent('التحديد مُفعّل — انقر للإلغاء')
  })
})
