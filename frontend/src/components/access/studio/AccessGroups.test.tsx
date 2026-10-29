import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18next, { type i18n } from 'i18next'
import { I18nextProvider } from 'react-i18next'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import en from '@/locales/en.json'
import { AccessGroups, type AccessGroupsProps } from './AccessGroups'
import type { AccessItem, Decision, Snapshot } from './studioModel'

const groupIds = ['administration', 'correspondence', 'templates', 'people', 'services']

function fixture(): Snapshot {
  const items: AccessItem[] = groupIds.map((group) => {
    const decision: Decision = {
      action: 'view', authorization: 'allowed', executable_now: true,
      configurable: true, setting_capabilities: [`${group}.view`],
      editable_effects: [null, 'grant', 'deny'], rule_id: 'capability.required',
      reasons: [], reason_tree: { op: 'all', children: [] },
      required_context: [], warnings: [],
    }
    return {
      resource: { kind: 'capability', id: `${group}.view` }, group_id: group,
      label: { en: `${group} access`, ar: `${group} access` },
      description: { en: 'View records', ar: 'عرض السجلات' },
      aliases: { en: [], ar: [] }, actions: [decision],
    }
  })
  return {
    subject: { user_id: 42, role: 'operator', status: 'active', authentication_eligible: true },
    revision: 'r1', evaluated_at: '2026-10-29T12:00:00Z', valid_until: null,
    effective: items.flatMap((item) => item.actions[0].setting_capabilities),
    role_defaults: [], overrides: [], items,
    subject_facts: { has_approval_assignments: false },
    scope: { mode: 'current', limits_enabled: false, kind: 'all', reason_codes: [] },
  }
}

let instance: i18n
beforeEach(async () => {
  instance = i18next.createInstance()
  await instance.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } })
})

function propsFor(snapshot = fixture()): AccessGroupsProps {
  return { items: snapshot.items, snapshot, patches: [], disabled: false, selected: new Set(), onSelect: vi.fn(), onStage: vi.fn() }
}
function groups(props: AccessGroupsProps) {
  return <I18nextProvider i18n={instance}><AccessGroups {...props} /></I18nextProvider>
}
function header(group: string) {
  return screen.getByRole('button', { name: new RegExp(`^${instance.t(`access.studio.groups.${group}`)}`) })
}

describe('compact access groups', () => {
  it('starts collapsed and orders groups by task frequency rather than incoming catalog order', () => {
    render(groups(propsFor()))
    const buttons = screen.getAllByRole('button')
    expect(buttons.map((button) => button.textContent?.split(instance.t('access.studio.groupSummary.allowed', { count: 1 }))[0]?.trim())).toEqual(
      ['services', 'people', 'templates', 'correspondence', 'administration'].map((group) => instance.t(`access.studio.groups.${group}`)),
    )
    for (const button of buttons) expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('opens only live search-hit groups and preserves a separately opened group when search clears', () => {
    const props = propsFor()
    const rendered = render(groups(props))
    fireEvent.click(header('people'))
    rendered.rerender(groups({ ...props, matchingGroups: ['templates'] }))
    expect(header('templates')).toHaveAttribute('aria-expanded', 'true')
    expect(header('administration')).toHaveAttribute('aria-expanded', 'false')
    expect(document.getElementById('capability:templates.view:view')).toBeVisible()
    rendered.rerender(groups({ ...props, matchingGroups: [] }))
    expect(header('people')).toHaveAttribute('aria-expanded', 'true')
  })

  it('opens and focuses a collapsed search destination without changing any setting', async () => {
    const props = propsFor()
    const rendered = render(groups(props))
    rendered.rerender(groups({ ...props, focusDestination: 'capability:administration.view:view' }))
    expect(header('administration')).toHaveAttribute('aria-expanded', 'true')
    await waitFor(() => expect(document.getElementById('capability:administration.view:view')).toHaveFocus())
    expect(props.onStage).not.toHaveBeenCalled()
    expect(props.onSelect).not.toHaveBeenCalled()
  })

  it('opens personal exceptions only when their filter is active and summarizes same-result exceptions', () => {
    const snapshot = fixture()
    snapshot.overrides = [{ capability: 'templates.view', effect: 'grant', expires_at: null, state: 'active' }]
    const template = snapshot.items.find((item) => item.group_id === 'templates')!
    template.actions.push({ ...template.actions[0], action: 'reset' })
    const props = propsFor(snapshot)
    const rendered = render(groups(props))
    expect(header('templates')).toHaveAttribute('aria-expanded', 'false')
    expect(header('templates')).toHaveTextContent(instance.t('access.studio.groupSummary.exceptions', { count: 1 }))
    rendered.rerender(groups({ ...props, filter: 'exceptions' }))
    expect(header('templates')).toHaveAttribute('aria-expanded', 'true')
    expect(header('people')).toHaveAttribute('aria-expanded', 'false')
  })

  it.each(['unknown', 'warning', 'expired'] as const)('automatically opens %s attention items but lets the operator collapse them', (kind) => {
    const snapshot = fixture()
    const action = snapshot.items[0].actions[0]
    if (kind === 'warning') action.warnings = [{ code: 'PREREQUISITE_BLOCKED', severity: 'warning' }]
    else if (kind === 'expired') snapshot.overrides = [{ capability: 'administration.view', effect: 'grant', expires_at: '2020-01-01T00:00:00Z', state: 'expired' }]
    else action.authorization = kind
    render(groups(propsFor(snapshot)))
    expect(header('administration')).toHaveAttribute('aria-expanded', 'true')
    expect(header('services')).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(header('administration'))
    expect(header('administration')).toHaveAttribute('aria-expanded', 'false')
  })

  it('keeps record-dependent outcomes neutral and omits zero counts', () => {
    const snapshot = fixture()
    snapshot.items[0].actions[0].authorization = 'needs_context'
    snapshot.items[0].actions[0].executable_now = null
    snapshot.items[0].actions[0].required_context = ['grade']
    snapshot.items[0].actions[0].warnings = [{ code: 'EXACT_RECORD_REQUIRES_CONTEXT', severity: 'info' }]
    render(groups(propsFor(snapshot)))
    expect(header('administration')).toHaveAttribute('aria-expanded', 'false')
    expect(header('administration')).not.toHaveTextContent(/\b0\b/)
    fireEvent.click(header('administration'))
    expect(screen.getAllByText(instance.t('access.studio.outcomes.depends_grade'))[0]).toBeVisible()
    expect(header('administration')).not.toHaveTextContent(instance.t('access.studio.groupSummary.attention', { count: 1 }))
  })
})
