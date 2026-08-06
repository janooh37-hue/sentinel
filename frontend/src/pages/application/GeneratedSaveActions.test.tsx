import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from 'i18next'

import ar from '@/locales/ar.json'
import { GeneratedSaveActions } from './GeneratedSaveActions'

beforeEach(async () => {
  await i18n.addResourceBundle('ar', 'translation', ar, true, true)
  await i18n.changeLanguage('ar')
})

afterEach(() => {
  cleanup()
  void i18n.changeLanguage('en')
})

describe('GeneratedSaveActions', () => {
  const baseProps = {
    showNotify: true,
    notifyEmployee: true,
    notifyDisabled: false,
    saveDisabled: false,
    saving: false,
    hint: 'أكمل المرفقات المطلوبة أولًا',
    onNotifyChange: vi.fn(),
    onSave: vi.fn(),
  }

  it('renders the Arabic ready-to-save title', () => {
    render(<GeneratedSaveActions {...baseProps} />)

    expect(screen.getByText('جاهز للحفظ في السجلات')).toBeVisible()
  })

  it('renders the notification row only when requested', () => {
    const { rerender } = render(<GeneratedSaveActions {...baseProps} showNotify />)
    expect(screen.getByRole('switch', { name: 'إشعار الموظف' })).toBeVisible()

    rerender(<GeneratedSaveActions {...baseProps} showNotify={false} />)
    expect(screen.queryByRole('switch', { name: 'إشعار الموظف' })).not.toBeInTheDocument()
  })

  it('names WhatsApp before the SMS fallback when notification is on', () => {
    render(<GeneratedSaveActions {...baseProps} />)

    expect(screen.getByText(/واتساب، ثم الرسائل النصية كخيار بديل/)).toBeVisible()
  })

  it('uses the saved-without-notifying hint when notification is off', () => {
    render(<GeneratedSaveActions {...baseProps} notifyEmployee={false} />)

    expect(screen.getByText('سيتم الحفظ دون إشعار الموظف.')).toBeVisible()
  })

  it('invokes onSave once from the save button', () => {
    const onSave = vi.fn()
    render(<GeneratedSaveActions {...baseProps} onSave={onSave} />)

    fireEvent.click(screen.getByRole('button', { name: 'حفظ في السجلات' }))
    expect(onSave).toHaveBeenCalledTimes(1)
  })

  it('disables both notification and save controls while saving', () => {
    render(<GeneratedSaveActions {...baseProps} saving />)

    expect(screen.getByRole('switch', { name: 'إشعار الموظف' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'حفظ في السجلات' })).toBeDisabled()
  })

  it('keeps notification available when only save is disabled', () => {
    render(<GeneratedSaveActions {...baseProps} saveDisabled />)

    expect(screen.getByRole('switch', { name: 'إشعار الموظف' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'حفظ في السجلات' })).toBeDisabled()
  })
})
