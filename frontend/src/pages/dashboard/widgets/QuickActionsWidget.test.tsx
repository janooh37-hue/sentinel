import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { DEFAULT_LAYOUT, QUICK_ACTION_IDS } from '@/lib/dashboardLayout'
import { QUICK_ACTION_META } from '@/lib/quickActions'
import { DashboardRuntimeContext } from './dashboardWidgetContext'
import { QuickActionsWidget } from './QuickActionsWidget'
import type { WidgetTier } from './types'

function mount(tier: WidgetTier, w: number, h: number, cols: number, has: (cap: string) => boolean = () => true) {
  const layout = {
    ...DEFAULT_LAYOUT,
    quick_actions: QUICK_ACTION_IDS.map((id, index) => ({ id, visible: index !== 1, order: QUICK_ACTION_IDS.length - index })),
  }
  render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <DashboardRuntimeContext.Provider value={{ layout, box: { w, h, cols }, editing: false, has, onNavigate: vi.fn(), onOpenCoverage: vi.fn() }}>
          <QuickActionsWidget tier={tier} rows={0} />
        </DashboardRuntimeContext.Provider>
      </MemoryRouter>
    </I18nextProvider>,
  )
  return within(screen.getByRole('region', { name: i18n.t('dashboard.widgets.quickActions.title') }))
}

describe.each(['en', 'ar'])('quick actions in %s', (language) => {
  beforeEach(async () => { await i18n.changeLanguage(language) })

  it.each<[WidgetTier, number, number, number, number]>([
    ['glance', 1, 1, 4, 2],
    ['summary', 2, 1, 4, 4],
    ['list', 2, 2, 4, 8],
    ['tall', 1, 2, 4, 4],
    ['summary', 6, 1, 6, 8],
    ['list', 2, 2, 2, 4],
  ])('links the saved permitted actions fitting %s at %ix%i on %i columns', (tier, w, h, cols, count) => {
    const deniedId = QUICK_ACTION_IDS.at(-1)!
    const frame = mount(tier, w, h, cols, (cap) => cap !== `books.service.${deniedId}`)
    const expected = [...QUICK_ACTION_IDS].reverse().filter((id) => id !== deniedId && id !== QUICK_ACTION_IDS[1]).slice(0, count)
    const links = frame.getAllByRole('link').filter((link) => link.getAttribute('href') !== '/services')

    expect(links).toHaveLength(count)
    expected.forEach((id, index) => {
      const meta = QUICK_ACTION_META[id]
      expect(links[index]).toHaveAccessibleName(i18n.t(`dashboard.quickActionLabels.${meta.slug}`))
      expect(links[index]).toHaveAttribute('href', meta.href)
    })
    for (const id of [deniedId, QUICK_ACTION_IDS[1]]) {
      expect(frame.queryByRole('link', { name: i18n.t(`dashboard.quickActionLabels.${QUICK_ACTION_META[id].slug}`) })).not.toBeInTheDocument()
    }
  })

  it.each(['books.view', 'documents.generate'])('offers Services without service links when %s is denied', (denied) => {
    const frame = mount('summary', 2, 1, 4, (cap) => cap !== denied)
    expect(frame.getAllByRole('link')).toHaveLength(1)
    expect(frame.getByRole('link')).toHaveAttribute('href', '/services')
    expect(frame.getByText(i18n.t('dashboard.widgets.quickActions.empty'))).toBeVisible()
  })
})
