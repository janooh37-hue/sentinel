import { fireEvent, render, screen, within } from '@testing-library/react'
import i18next from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'
import ar from '@/locales/ar.json'
import { ActionRow } from './ActionRow'
import { needsAttention, type AccessItem, type Decision, type Patch, type Snapshot } from './studioModel'
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
    ['followRole', null, null],
    ['allow', 'grant', '2030-11-01T00:00:00Z'],
    ['deny', 'deny', '2030-11-01T00:00:00Z'],
  ] satisfies [string, Patch['effect'], string | null][])('stages the exact setting for %s', async (key, effect, expiry) => {
    const data = fixture()
    data.snapshot.overrides = [{ capability: 'employees.edit', effect: effect === 'grant' ? 'deny' : 'grant', expires_at: '2030-11-01T00:00:00Z', state: 'active' }]
    const onStage = vi.fn()
    const instance = await translations()
    const name = instance.t(`access.studio.settings.${key}`)
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
    expect(screen.getByText(`${instance.t('access.studio.roleBaseline')}:`)).not.toBeVisible()
    expect(screen.queryByText('NOT_GRANTED')).not.toBeInTheDocument()
    expect(screen.getByText(instance.t('access.studio.why.short')).closest('summary')).toHaveAccessibleName(`${instance.t('access.studio.why.short')} ${instance.t('access.studio.actions.edit')} · Employee records`)
    fireEvent.click(screen.getByText(instance.t('access.studio.why.short')))
    expect(screen.getByText(`${instance.t('access.studio.roleBaseline')}:`)).toBeVisible()
    expect(screen.getAllByText(instance.t('access.studio.reasonCodes.NOT_GRANTED'))[0]).toBeVisible()
    const technical = screen.getByText(instance.t('access.studio.why.technical')).closest('details')!
    expect(technical).not.toHaveAttribute('open')
    for (const identifier of within(technical).getAllByText('employees.edit')) expect(identifier).not.toBeVisible()
    expect(screen.queryByText('2026-10-29T12:00:00Z')).not.toBeInTheDocument()
    expect(screen.getByLabelText(new RegExp(instance.t('access.studio.expiry.label')))).not.toBeVisible()
    fireEvent.click(screen.getByText(instance.t('access.studio.why.technical')))
    expect(screen.getByRole('textbox', { name: new RegExp(instance.t('access.studio.expiry.label')) })).toHaveValue('2030-11-01T00:00:00Z')
  })

  it('labels a shared setting by its catalog meaning rather than the first dependent resource', async () => {
    const data = fixture()
    data.snapshot.items.unshift({ ...data.item, resource: { kind: 'notification_template', id: 'example' }, label: { en: 'Unrelated template', ar: 'قالب آخر' } })
    const instance = await translations()
    render(<I18nextProvider i18n={instance}><SettingIdentity snapshot={data.snapshot} capability="employees.edit" /></I18nextProvider>)
    expect(screen.getByText('Employee records')).toBeVisible()
    expect(screen.queryByText('Unrelated template')).not.toBeInTheDocument()
  })

  it('shows the expired setting type and date inline and stages renewal or role return for review', async () => {
    const data = fixture()
    data.snapshot.overrides = [{ capability: 'employees.edit', effect: 'deny', expires_at: '2020-01-01T00:00:00Z', state: 'expired' }]
    const instance = await translations()
    const onStage = vi.fn()
    render(<I18nextProvider i18n={instance}><ActionRow {...data} patches={[]} disabled={false} selected={false} onSelect={vi.fn()} onStage={onStage} /></I18nextProvider>)
    const time = new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short', numberingSystem: 'latn' }).format(new Date('2020-01-01T00:00:00Z'))
    expect(screen.getByText(instance.t('access.studio.attention.expired', { setting: 'Employee records', type: instance.t('access.studio.settings.deny'), time }))).toBeVisible()
    expect(needsAttention(data.decision, data.snapshot)).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: instance.t('access.studio.attention.setAgain', { type: instance.t('access.studio.settings.deny') }) }))
    expect(onStage).toHaveBeenLastCalledWith([{ capability: 'employees.edit', effect: 'deny', expires_at: null }], true)
    fireEvent.click(screen.getByRole('button', { name: instance.t('access.studio.attention.followRole') }))
    expect(onStage).toHaveBeenLastCalledWith([{ capability: 'employees.edit', effect: null, expires_at: null }], true)
  })

  it('names a missing permission and stages only that exact editable prerequisite for review', async () => {
    const data = fixture()
    data.decision.warnings = [{ code: 'PREREQUISITE_BLOCKED', severity: 'warning', capabilities: ['employees.view'] }]
    data.snapshot.items.push({ ...data.item, resource: { kind: 'capability', id: 'employees.view' }, label: { en: 'View employee records', ar: 'عرض سجلات الموظفين' }, actions: [{ ...data.decision, action: 'view', warnings: [], setting_capabilities: ['employees.view'] }] })
    const instance = await translations()
    const onStage = vi.fn()
    render(<I18nextProvider i18n={instance}><ActionRow {...data} patches={[]} disabled={false} selected={false} onSelect={vi.fn()} onStage={onStage} /></I18nextProvider>)
    expect(needsAttention(data.decision, data.snapshot)).toBe(true)
    expect(screen.getAllByText(instance.t('access.studio.attention.prerequisite', { permission: 'View employee records' })).find((element) => !element.closest('details'))).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: instance.t('access.studio.attention.alsoAllow', { permission: 'View employee records' }) }))
    expect(onStage).toHaveBeenCalledExactlyOnceWith([{ capability: 'employees.view', effect: 'grant', expires_at: null }], true)
  })

  it('does not offer a prerequisite grant when the catalog does not allow editing it', async () => {
    const data = fixture()
    data.decision.warnings = [{ code: 'PREREQUISITE_BLOCKED', severity: 'warning', capabilities: ['employees.view'] }]
    const instance = await translations()
    render(<I18nextProvider i18n={instance}><ActionRow {...data} patches={[]} disabled={false} selected={false} onSelect={vi.fn()} onStage={vi.fn()} /></I18nextProvider>)
    expect(screen.queryByRole('button', { name: new RegExp(instance.t('access.studio.attention.alsoAllow', { permission: '' })) })).not.toBeInTheDocument()
    expect(screen.getAllByText(instance.t('access.studio.attention.prerequisiteUnknown')).find((element) => !element.closest('details'))).toBeVisible()
  })

  it.each(['EXACT_RECORD_REQUIRES_CONTEXT', 'CONDITIONAL_PREREQUISITE_BLOCKED'])('does not flag normal record-dependent access with %s and keeps its explanation available', async (code) => {
    const data = fixture()
    data.decision.authorization = 'needs_context'
    data.decision.executable_now = null
    data.decision.required_context = ['grade']
    data.decision.warnings = [{ code, severity: code === 'EXACT_RECORD_REQUIRES_CONTEXT' ? 'info' : 'warning', capabilities: ['employees.view'] }]
    const instance = await translations()
    render(<I18nextProvider i18n={instance}><ActionRow {...data} patches={[]} disabled={false} selected={false} onSelect={vi.fn()} onStage={vi.fn()} /></I18nextProvider>)
    expect(needsAttention(data.decision, data.snapshot)).toBe(false)
    expect(screen.getAllByText(instance.t('access.studio.outcomes.depends_grade'))[0]).toBeVisible()
    expect(screen.queryByText(instance.t('access.studio.filter.attention'))).not.toBeInTheDocument()
    fireEvent.click(screen.getByText(instance.t('access.studio.why.short')))
    expect(screen.getByText(instance.t('access.studio.context.grade'))).toBeVisible()
  })

  it('flags unknown outcomes as an unsuccessful check rather than denied access', async () => {
    const data = fixture()
    data.decision.authorization = 'unknown'
    data.decision.executable_now = null
    const instance = await translations()
    render(<I18nextProvider i18n={instance}><ActionRow {...data} patches={[]} disabled={false} selected={false} onSelect={vi.fn()} onStage={vi.fn()} /></I18nextProvider>)
    expect(needsAttention(data.decision, data.snapshot)).toBe(true)
    expect(screen.getAllByText(instance.t('access.studio.outcomes.unknown'))[0]).toBeVisible()
    fireEvent.click(screen.getByText(instance.t('access.studio.why.short')))
    expect(screen.getAllByText(instance.t('access.studio.reasonCodes.NOT_GRANTED'))[0]).toBeVisible()
  })
})

