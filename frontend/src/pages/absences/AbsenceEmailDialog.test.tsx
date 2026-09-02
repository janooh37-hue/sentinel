import { render, screen } from '@testing-library/react'
import i18n from 'i18next'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type { AbsenceRegisterRowRead } from '@/lib/api'
import ar from '@/locales/ar.json'
import en from '@/locales/en.json'

import { AbsenceEmailDialog } from './AbsenceEmailDialog'

const ROWS: AbsenceRegisterRowRead[] = [
  {
    employee_id: 'G1001',
    employee_name_en: 'John Doe',
    employee_name_ar: 'جون دو',
    duty_post: 'Guard',
    duty_unit: 'السرية الثالثة',
    start_date: '2026-07-09',
    end_date: '2026-07-10',
    days: 2,
    notes: 'no call',
  },
  {
    employee_id: 'G1001',
    employee_name_en: 'John Doe',
    employee_name_ar: 'جون دو',
    duty_post: 'Guard',
    duty_unit: 'السرية الثالثة',
    start_date: '2026-07-12',
    end_date: '2026-07-12',
    days: 1,
    notes: null,
  },
]

function renderDialog(rows: AbsenceRegisterRowRead[]) {
  return render(
    <MemoryRouter>
      <AbsenceEmailDialog open rows={rows} onOpenChange={() => undefined} />
    </MemoryRouter>,
  )
}

beforeEach(async () => {
  i18n.addResourceBundle('ar', 'translation', ar, true, true)
  await i18n.changeLanguage('en')
})

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('AbsenceEmailDialog accessibility', () => {
  it('gives repeated employee case selectors distinct row-specific names', () => {
    renderDialog(ROWS)

    const first = screen.getByRole('combobox', {
      name: 'Case for جون دو (G1001), 09/07/2026 to 10/07/2026',
    })
    const second = screen.getByRole('combobox', {
      name: 'Case for جون دو (G1001), 12/07/2026 to 12/07/2026',
    })
    expect(first.id).not.toBe(second.id)
    expect(
      screen.getByText('Case for جون دو (G1001), 09/07/2026 to 10/07/2026'),
    ).toHaveAttribute('for', first.id)
    expect(
      screen.getByText('Case for جون دو (G1001), 12/07/2026 to 12/07/2026'),
    ).toHaveAttribute('for', second.id)
  })

  it('uses singular and plural English violation attachment labels', () => {
    const view = renderDialog(ROWS.slice(0, 1))
    expect(
      screen.getByRole('checkbox', { name: 'A signed violation form is attached' }),
    ).toBeInTheDocument()

    view.rerender(
      <MemoryRouter>
        <AbsenceEmailDialog open rows={ROWS} onOpenChange={() => undefined} />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('checkbox', { name: 'Signed violation forms are attached' }),
    ).toBeInTheDocument()
  })

  it('uses singular and dual Arabic violation attachment labels', async () => {
    await i18n.changeLanguage('ar')
    const view = renderDialog(ROWS.slice(0, 1))
    expect(
      screen.getByRole('checkbox', { name: 'مرفق مخالفة موقّعة من قبله' }),
    ).toBeInTheDocument()

    view.rerender(
      <MemoryRouter>
        <AbsenceEmailDialog open rows={ROWS} onOpenChange={() => undefined} />
      </MemoryRouter>,
    )
    expect(
      screen.getByRole('checkbox', { name: 'مرفق مخالفتان موقّعتان من قبلهما' }),
    ).toBeInTheDocument()
  })

  it('defines matching case-row keys and every used plural category', () => {
    expect(en.absences.email.caseRow).toBeDefined()
    expect(ar.absences.email.caseRow).toBeDefined()
    expect(en.absences.email).toMatchObject({
      violationAttached_one: 'A signed violation form is attached',
      violationAttached_other: 'Signed violation forms are attached',
    })
    expect(ar.absences.email).toMatchObject({
      violationAttached_one: 'مرفق مخالفة موقّعة من قبله',
      violationAttached_two: 'مرفق مخالفتان موقّعتان من قبلهما',
      violationAttached_few: 'مرفق {{count}} مخالفات موقّعة من قبلهم',
      violationAttached_many: 'مرفق {{count}} مخالفة موقّعة من قبلهم',
      violationAttached_other: 'مرفق {{count}} مخالفة موقّعة من قبلهم',
    })
  })
})
