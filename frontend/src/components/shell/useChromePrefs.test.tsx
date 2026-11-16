import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

import { api } from '@/lib/api'
import { getStoredFontScale, getStoredTheme, persistFontScale, persistTheme } from '@/lib/theme'
import { useChromePrefs } from './useChromePrefs'

vi.mock('@/lib/api', () => ({ api: { getSettings: vi.fn(), updateSettings: vi.fn() } }))

afterEach(() => {
  cleanup()
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-font-scale')
  vi.clearAllMocks()
})

it('keeps scoped-role chrome preferences local without fetching or mutating settings', () => {
  persistTheme('dark')
  persistFontScale(22)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const { result, unmount } = renderHook(() => useChromePrefs(true), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })

  expect(result.current.theme).toBe('dark')
  expect(result.current.fontScale).toBe(22)
  act(() => {
    result.current.setTheme('light')
    result.current.setFontScale(24)
  })
  expect(result.current.theme).toBe('light')
  expect(result.current.fontScale).toBe(24)
  expect(getStoredTheme()).toBe('light')
  expect(getStoredFontScale()).toBe(24)
  expect(api.getSettings).not.toHaveBeenCalled()
  expect(api.updateSettings).not.toHaveBeenCalled()
  unmount()

  const remounted = renderHook(() => useChromePrefs(true), {
    wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  })
  expect(remounted.result.current.theme).toBe('light')
  expect(remounted.result.current.fontScale).toBe(24)
})
