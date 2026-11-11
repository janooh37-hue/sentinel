import { cleanup, render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import i18n from '@/lib/i18n'

const capabilityState = vi.hoisted(() => ({ allowed: new Set<string>() }))

vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: capabilityState.allowed,
    isLoading: false,
    has: (capability: string) => capabilityState.allowed.has(capability),
  }),
}))

import { AssetsSectionTabs } from './AssetsSectionTabs'

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

describe.each(['en', 'ar'])('Assets section navigation (%s)', (language) => {
  it.each([
    { caps: [], pathname: '/holdings' },
    { caps: ['uniform.view'], pathname: '/holdings/uniform' },
    { caps: ['store.view'], pathname: '/holdings/store' },
    { caps: ['store.view', 'uniform.view'], pathname: '/holdings/store' },
  ])('shows only viewable child destinations for $caps', async ({ caps, pathname }) => {
    await i18n.changeLanguage(language)
    capabilityState.allowed = new Set(caps)
    render(
      <MemoryRouter initialEntries={[pathname]}>
        <AssetsSectionTabs />
      </MemoryRouter>,
    )

    const navigation = screen.getByRole('navigation', { name: i18n.t('assets.sectionTabs.aria') })
    for (const section of ['store', 'uniform']) {
      const link = within(navigation).queryByRole('link', { name: i18n.t(`assets.sectionTabs.${section}`) })
      if (caps.includes(`${section}.view`)) {
        expect(link).toHaveAttribute('href', `/holdings/${section}`)
        if (pathname === `/holdings/${section}`) {
          expect(link).toHaveAttribute('aria-current', 'page')
        } else {
          expect(link).not.toHaveAttribute('aria-current')
        }
      } else {
        expect(link).not.toBeInTheDocument()
      }
    }
  })
})
