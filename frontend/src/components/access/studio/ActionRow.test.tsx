import { fireEvent, render, screen, within } from '@testing-library/react'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'
import ar from '@/locales/ar.json'
import { ActionRow } from './ActionRow'
import { ReasonText } from './WhyAccess'
import type { AccessItem, Decision, Patch, Snapshot } from './studioModel'
import { SettingIdentity } from './SettingIdentity'

function fixture(): { item: AccessItem; snapshot: Snapshot; decision: Decision } {
  const decision: Decision = {
    action: 'edit', authorization: 'denied', executable_now: false,
    configurable: true, setting_capabilities: ['employees.edit'],
    editable_effects: [null, 'grant', 'deny'], rule_id: 'capability.required',
    reasons: [{
      code: 'NOT_GRANTED', capability: 'employees.edit', applied: true,
      decisive: true, params: {}, source: {
        kind: 'role', id: 'operator', label: { en: 'Operator role', ar: 'دور المشغّل' },
        contribution: 'deny', expires_at: null, edit_destination: null,
      },
    }],
    reason_tree: { op: 'all', children: [{ reason_index: 0 }] },
    required_context: [], warnings: [],
  }
  const item: AccessItem = {
    resource: { kind: 'capability', id: 'employees.edit' }, group_id: 'people',
    label: { en: 'Employee records', ar: 'سجلات الموظفين' },
    description: { en: 'Maintain employee records', ar: 'تحديث سجلات الموظفين' },
    aliases: { en: [], ar: [] }, actions: [decision],
  }
  const snapshot: Snapshot = {
    subject: { user_id: 42, role: 'operator', status: 'active', authentication_eligible: true },
    revision: 'r1', evaluated_at: '2026-10-29T12:00:00Z', valid_until: null,
    effective: [], role_defaults: [], overrides: [], items: [item],
    subject_facts: { has_approval_assignments: false },
    scope: { mode: 'current', limits_enabled: false, kind: 'all', reason_codes: [] },
  }
  return { item, snapshot, decision }
}

async function translations(language = 'en') {
  const instance = i18next.createInstance()
  await instance.init({ lng: language, fallbackLng: 'en', resources: { en: { translation: en }, ar: { translation: ar } }, interpolation: { escapeValue: false } })
  return instance
}

describe('compact action rows', () => {
  it.each([
    ['Follow role', null, null],
    ['Allow', 'grant', '2030-11-01T00:00:00Z'],
    ['Deny', 'deny', '2030-11-01T00:00:00Z'],
  ] satisfies [string, Patch['effect'], string | null][])('stages the exact setting for %s', async (name, effect, expiry) => {
    const data = fixture()
    data.snapshot.overrides = [{ capability: 'employees.edit', effect: effect === 'grant' ? 'deny' : 'grant', expires_at: '2030-11-01T00:00:00Z', state: 'active' }]
    const onStage = vi.fn()
    const instance = await translations()
    render(<I18nextProvider i18n={instance}><ActionRow {...data} patches={[]} disabled={false} selected={false} onSelect={vi.fn()} onStage={onStage} /></I18nextProvider>)
    expect(screen.getByRole('radio', { name })).not.toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name }))
    expect(onStage).toHaveBeenCalledExactlyOnceWith([{ capability: 'employees.edit', effect, expires_at: expiry }])
  })

  it('keeps explanations and exact identifiers behind their own disclosures', async () => {
    const data = fixture()
    data.snapshot.overrides = [{ capability: 'employees.edit', effect: 'grant', expires_at: '2030-11-01T00:00:00Z', state: 'active' }]
    const instance = await translations()
    render(<I18nextProvider i18n={instance}><ActionRow {...data} patches={[]} disabled={false} selected={false} onSelect={vi.fn()} onStage={vi.fn()} /></I18nextProvider>)
    expect(screen.getByText('Role baseline:')).not.toBeVisible()
    expect(screen.queryByText('NOT_GRANTED')).not.toBeInTheDocument()
    expect(screen.getByText('Why?').closest('summary')).toHaveAccessibleName('Why? Edit · Employee records')
    fireEvent.click(screen.getByText('Why?'))
    expect(screen.getByText('Role baseline:')).toBeVisible()
    expect(screen.getAllByText('No applicable source grants this capability.')[0]).toBeVisible()
    const technical = screen.getByText('Technical details').closest('details')!
    expect(technical).not.toHaveAttribute('open')
    for (const identifier of within(technical).getAllByText('employees.edit')) expect(identifier).not.toBeVisible()
    expect(screen.queryByText('2026-10-29T12:00:00Z')).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Expiry/)).not.toBeVisible()
    fireEvent.click(screen.getByText('Technical details'))
    expect(screen.getByRole('textbox', { name: /Expiry/ })).toHaveValue('2030-11-01T00:00:00Z')
  })

  it('labels a shared setting by its catalog meaning rather than the first dependent resource', async () => {
    const data = fixture()
    data.snapshot.items.unshift({ ...data.item, resource: { kind: 'notification_template', id: 'example' }, label: { en: 'Unrelated template', ar: 'قالب آخر' } })
    const instance = await translations()
    render(<I18nextProvider i18n={instance}><SettingIdentity snapshot={data.snapshot} capability="employees.edit" /></I18nextProvider>)
    expect(screen.getByText('Employee records')).toBeVisible()
    expect(screen.queryByText('Unrelated template')).not.toBeInTheDocument()
  })
})

describe.each(['en', 'ar'])('human reason wording in %s', (language) => {
  it('renders all mapped reasons as words rather than machine codes', async () => {
    const instance = await translations(language)
    const reason = fixture().decision.reasons[0]
    const codes = [...new Set([...Object.keys(en.access.studio.reasonCodes), 'INMATE_REPORTER_ROUTE_FORBIDDEN', 'TEMPLATE_NOT_FOUND'])]
    const { container } = render(<I18nextProvider i18n={instance}>{codes.map((code) => <p key={code}><ReasonText reason={{ ...reason, code }} /></p>)}</I18nextProvider>)
    for (const code of codes) {
      const wording = instance.t(`access.studio.reasonCodes.${code}`)
      expect(wording).not.toContain(code)
      expect(container).toHaveTextContent(wording)
      expect(screen.queryByText(code)).not.toBeInTheDocument()
    }
  })

  it('uses a readable translated fallback for an unrecognized future reason', async () => {
    const instance = await translations(language)
    const reason = fixture().decision.reasons[0]
    const { container } = render(<I18nextProvider i18n={instance}><ReasonText reason={{ ...reason, code: 'FUTURE_POLICY_CONDITION' }} /></I18nextProvider>)
    expect(container.textContent).not.toContain('FUTURE_POLICY_CONDITION')
    expect(container.textContent).not.toContain('access.studio')
    expect(container.textContent!.trim().length).toBeGreaterThan(10)
  })
})
