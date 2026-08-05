import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const granted = vi.hoisted(() => new Set<string>())

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/components/shell/CapabilityGate', () => ({
  CapabilityGate: ({ cap, children }: { cap: string; children: ReactNode }) =>
    granted.has(cap) ? children : null,
}))
vi.mock('@/lib/useCapabilities', () => ({
  useCapabilities: () => ({
    capabilities: granted,
    isLoading: false,
    has: (cap: string) => granted.has(cap),
  }),
}))
vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({
    user: {
      email: 'operator@gssg.ae',
      name_en: 'Operator',
      name_ar: null,
      employee_id: 'G-0001',
      role: 'operator',
    },
  }),
}))
vi.mock('@/lib/api', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({
      stamp_style: 'header',
      admin_gate_enabled: false,
      sentry_opt_in: false,
      sms_autosend_enabled: true,
      signature_size_mm: 32,
      signature_boldness: 1,
    }),
    updateSettings: vi.fn(),
    getSystemInfo: vi.fn().mockResolvedValue({
      version: '4.0.0',
      db_path: 'db',
      log_path: 'log',
      data_dir: 'data',
      python_version: '3.12',
      platform: 'Windows',
      uptime_seconds: 60,
    }),
    checkForUpdates: vi.fn(),
    setAdminKey: vi.fn(),
    listSubmitters: vi.fn().mockResolvedValue([]),
    createSubmitter: vi.fn(),
    deleteSubmitter: vi.fn(),
    listAuthUsers: vi.fn().mockResolvedValue([]),
  },
}))
vi.mock('./SigningSignatureSection', () => ({
  SigningSignatureSection: () => <div>signing-signature</div>,
}))
vi.mock('./EmailSection', () => ({ EmailSection: () => <div>email-section</div> }))
vi.mock('./ManagersSection', () => ({ ManagersSection: () => <div>managers-section</div> }))
vi.mock('@/pages/system/MigrationWizard', () => ({
  MIGRATION_SKIPPED_KEY: 'migration-skipped',
  MigrationWizard: () => null,
}))

import { SettingsPage } from './SettingsPage'

function renderPage(): void {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <SettingsPage />
    </QueryClientProvider>,
  )
}

beforeEach(() => granted.clear())

describe('SettingsPage capability alignment', () => {
  it('does not offer backend-gated controls without their capabilities', async () => {
    renderPage()

    expect(await screen.findAllByText('settings.account.title')).not.toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: /settings.signingSignature.title/ }))
    expect(screen.getByText('signing-signature')).toBeInTheDocument()
    expect(screen.queryByText('settings.appearance.title')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.defaults.title')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.submitters.title')).not.toBeInTheDocument()
    expect(screen.queryByText('migration.buttons.runMigration')).not.toBeInTheDocument()
    expect(screen.queryByText('settings.advanced.title')).not.toBeInTheDocument()
  })

  it('shows each control when the matching backend capability is present', async () => {
    granted.add('settings.edit')
    granted.add('submitters.manage')
    granted.add('system.admin')
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /settings.navigation.documents/ }))
    expect(screen.getByText('settings.defaults.title')).toBeInTheDocument()
    expect(screen.getByText('settings.submitters.title')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /settings.navigation.application/ }))
    expect(await screen.findAllByText('settings.appearance.title')).not.toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: /settings.navigation.system/ }))
    expect(screen.getByText('migration.buttons.runMigration')).toBeInTheDocument()
    expect(screen.getByText('settings.advanced.title')).toBeInTheDocument()
  })

  it('opens email settings from the communications rail', async () => {
    granted.add('email.manage')
    renderPage()

    fireEvent.click(screen.getByRole('button', { name: /settings.navigation.communications/ }))
    expect(await screen.findByText('email-section')).toBeInTheDocument()
  })
})
