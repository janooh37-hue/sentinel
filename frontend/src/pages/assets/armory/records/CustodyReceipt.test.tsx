import { render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it } from 'vitest'

import type { ArmoryCustodyReceiptRead } from '@/lib/api'
import i18n from '@/lib/i18n'

import { CustodyReceipt } from './CustodyReceipt'

const siteReceipt: ArmoryCustodyReceiptRead = {
  record_ref: 'TEST-CU-081', issued_at: '2026-11-26T10:20:00Z',
  source_safe: { name_en: 'Test Original Safe', name_ar: 'خزنة الاختبار الأصلية' },
  holder: { name_en: 'Test Original Site', name_ar: 'موقع الاختبار الأصلي' }, holder_employee_id: null,
  supervisor: { name_en: 'Test Original Supervisor', name_ar: 'مشرف الاختبار الأصلي' }, supervisor_employee_id: 'T-0081',
  armorer: { name_en: 'Test Original Armorer', name_ar: 'أمين الاختبار الأصلي' },
  firearm_included: true, licence_number: null, condition_note: 'Test condition note',
  lines: [{
    item: { id: 81, name_en: 'Test Original Firearm', name_ar: 'سلاح الاختبار الأصلي', kind: 'firearm', category: 'firearms', drawing: 'pistol' },
    qty: 1, serial_code: 'TEST-R-081',
  }],
}

function renderReceipt(receipt: ArmoryCustodyReceiptRead, language: string) {
  render(<I18nextProvider i18n={i18n}><CustodyReceipt receipt={receipt} language={language} /></I18nextProvider>)
}

beforeEach(async () => { await i18n.changeLanguage('en') })

describe('CustodyReceipt', () => {
  it('puts the requested language first and localizes each sheet independently', () => {
    renderReceipt(siteReceipt, 'ar')
    const [arabic, english] = screen.getAllByRole('article')
    expect(arabic).toHaveAttribute('lang', 'ar')
    expect(arabic).toHaveAttribute('dir', 'rtl')
    expect(english).toHaveAttribute('lang', 'en')
    expect(english).toHaveAttribute('dir', 'ltr')

    const ar = within(arabic)
    expect(ar.getByRole('heading', { name: 'سند استلام عهدة' })).toBeVisible()
    expect(ar.getByText('المجموعة العالمية للخدمات الأمنية')).toBeVisible()
    expect(ar.getByText('بيانات الرخصة غير مسجّلة.')).toBeVisible()
    expect(ar.getByText('مشرف الاختبار الأصلي')).toBeVisible()
    expect(ar.getByRole('columnheader', { name: 'الكمية' })).toBeVisible()
    expect(ar.queryByText('Test Original Supervisor')).not.toBeInTheDocument()

    const en = within(english)
    expect(en.getByRole('heading', { name: 'Custody receipt' })).toBeVisible()
    expect(en.getByText('Global Security Services Group')).toBeVisible()
    expect(en.getByText('Licence details are missing.')).toBeVisible()
    expect(en.getByText('Test Original Safe')).toBeVisible()
    expect(en.getByText('Test Original Site')).toBeVisible()
    expect(en.getByText('Test Original Supervisor')).toBeVisible()
    expect(en.getByText('T-0081')).toHaveAttribute('dir', 'ltr')
    expect(en.getByText('TEST-CU-081')).toHaveAttribute('dir', 'ltr')
    expect(en.getByText('26/11/2026 14:20')).toHaveAttribute('dir', 'ltr')
    expect(en.getByText('TEST-R-081')).toHaveAttribute('dir', 'ltr')
    expect(en.getByText('Test condition note')).toBeVisible()
    expect(en.getByRole('row', { name: /Test Original Firearm/ })).toHaveTextContent('TEST-R-081')
    expect(en.getByRole('cell', { name: '1' })).toBeVisible()

    const signatures = within(en.getByRole('region', { name: 'Signatures' }))
    expect(signatures.getByText('Guard / site supervisor signature')).toBeVisible()
    expect(signatures.getByText('Armorer signature')).toBeVisible()
    expect(signatures.getAllByText('Date')).toHaveLength(2)
    expect(signatures.queryByText('Test Original Supervisor')).not.toBeInTheDocument()
    expect(signatures.queryByText('Test Original Armorer')).not.toBeInTheDocument()
    expect(signatures.queryByText(/26\/11\/2026/)).not.toBeInTheDocument()
  })

  it('prints the person and the recorded licence in a person receipt', async () => {
    await i18n.changeLanguage('ar')
    renderReceipt({
      ...siteReceipt,
      holder: { name_en: 'Test Original Holder', name_ar: 'مستلم الاختبار الأصلي' }, holder_employee_id: 'T-0082',
      supervisor: null, supervisor_employee_id: null, licence_number: 'TEST-LIC-081',
    }, 'en')
    const [english, arabic] = screen.getAllByRole('article')
    expect(english).toHaveAttribute('lang', 'en')
    expect(arabic).toHaveAttribute('lang', 'ar')
    const en = within(english)
    expect(en.getByRole('heading', { name: 'Custody receipt' })).toBeVisible()
    expect(en.getByText('Test Original Holder')).toBeVisible()
    expect(en.getByText('T-0082')).toHaveAttribute('dir', 'ltr')
    expect(en.getByText('TEST-LIC-081')).toHaveAttribute('dir', 'ltr')
    expect(en.queryByText('Site supervisor')).not.toBeInTheDocument()
    expect(en.queryByText('Licence details are missing.')).not.toBeInTheDocument()
  })
})
