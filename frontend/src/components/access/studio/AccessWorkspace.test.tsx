import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccessWorkspace, type AccessWorkspaceProps } from './AccessWorkspace'
import { buildCopyPatch } from './copyAccessModel'
import { CheckAccess } from './CheckAccess'
import { requestWorkspaceNavigation } from './workspaceNavigation'
import { useAccessDraft } from './useAccessDraft'
import type {
  Snapshot,
  Decision,
  Patch,
  PreviewResponse,
  CheckRequest,
  CheckResponse,
} from './studioModel'

const state = vi.hoisted(() => ({
  snapshot: undefined as unknown,
  preview: vi.fn(),
  save: vi.fn(),
  refresh: vi.fn(),
  check: vi.fn(),
}))
vi.mock('@/lib/permissionStudioApi', () => ({
  useAccessSnapshot: (id: number) => ({
    data:
      (state.snapshot as Snapshot)?.subject.user_id === id
        ? state.snapshot
        : undefined,
    refetch: state.refresh,
  }),
  usePreviewAccess: () => ({ mutateAsync: state.preview, isPending: false }),
  useSaveAccess: () => ({ mutateAsync: state.save, isPending: false }),
  useCheckAccess: () => ({ mutate: state.check, isPending: false }),
}))
vi.mock('@/lib/authContext', () => ({
  useAuth: () => ({ user: { id: 1 }, status: 'authed' }),
}))
vi.mock('@/lib/api', () => ({ api: { listAuthUsers: async () => [] } }))
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: Record<string, unknown>) =>
      `${key}${values?.count == null ? '' : ` ${values.count}`}`,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}))

function decision(
  action: Decision['action'],
  capability: string | null,
  allowed = true,
): Decision {
  return {
    action,
    authorization: allowed ? 'allowed' : 'denied',
    executable_now: allowed,
    configurable: capability !== null,
    setting_capabilities: capability ? [capability] : [],
    editable_effects: capability ? [null, 'grant', 'deny'] : [],
    rule_id: 'policy',
    reasons: [
      {
        code: 'signed_in',
        source: {
          kind: 'policy',
          id: 'signed_in',
          label: { en: 'Signed-in policy', ar: 'سياسة تسجيل الدخول' },
          contribution: 'grant',
          expires_at: null,
          edit_destination: null,
        },
        applied: true,
        decisive: true,
        params: {},
      },
    ],
    reason_tree: { op: 'all', children: [{ reason_index: 0 }] },
    required_context: [],
    warnings: [],
  }
}
function fixture(id = 42): Snapshot {
  return {
    subject: {
      user_id: id,
      role: 'operator',
      status: 'active',
      authentication_eligible: true,
    },
    revision: 'r1',
    evaluated_at: '2026-10-29T12:00:00Z',
    valid_until: null,
    effective: ['messages.templates', 'books.service.demo'],
    role_defaults: ['messages.templates'],
    overrides: [],
    subject_facts: { has_approval_assignments: false },
    scope: {
      mode: 'current',
      limits_enabled: false,
      kind: 'all',
      reason_codes: [],
    },
    items: [
      {
        resource: { kind: 'notification_template', id: 'wording' },
        group_id: 'templates',
        label: { en: 'Message wording', ar: 'صياغة الرسائل' },
        description: {
          en: 'Templates remain visible',
          ar: 'تبقى القوالب ظاهرة',
        },
        aliases: { en: [], ar: [] },
        actions: [
          decision('view', null),
          decision('edit', 'messages.templates'),
        ],
      },
      {
        resource: { kind: 'service', id: 'demo' },
        group_id: 'services',
        label: { en: 'Demo service', ar: 'خدمة تجريبية' },
        description: {
          en: 'Create and browse independently',
          ar: 'الإنشاء والتصفح مستقلان',
        },
        aliases: { en: [], ar: [] },
        actions: [
          decision('create', 'books.service.demo'),
          decision('read', 'books.servicerecords.demo', false),
        ],
      },
    ],
  }
}
function previewFor(snapshot: Snapshot, patches: Patch[]): PreviewResponse {
  const proposed = structuredClone(snapshot)
  for (const item of proposed.items)
    for (const action of item.actions)
      if (
        patches.some(
          (patch) =>
            action.setting_capabilities.includes(patch.capability) &&
            patch.effect === 'deny',
        )
      ) {
        action.authorization = 'denied'
        action.executable_now = false
      }
  return { current: snapshot, proposed, impacts: [], validation: [] }
}
function mount(id = 42, props: Partial<AccessWorkspaceProps> = {}) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AccessWorkspace
        subjectId={id}
        onNavigate={vi.fn()}
        renderSearch={() => <input aria-label="Find resource" />}
        {...props}
      />
    </QueryClientProvider>,
  )
}
afterEach(() => vi.clearAllMocks())
beforeEach(() => {
  state.check.mockReset()
  state.snapshot = fixture()
  state.preview.mockImplementation(async ({ items }: { items: Patch[] }) =>
    previewFor(state.snapshot as Snapshot, items),
  )
  state.save.mockResolvedValue({})
  state.refresh.mockImplementation(async () => {
    state.snapshot = { ...(state.snapshot as Snapshot), revision: 'r2' }
    return { data: state.snapshot }
  })
})

describe('AccessWorkspace', () => {
  it('renders and filters server diagnostics with omitted default fields', () => {
    const snapshot = fixture()
    for (const item of snapshot.items) {
      for (const action of item.actions) {
        delete action.warnings
        delete action.required_context
        for (const reason of action.reasons) delete reason.params
      }
    }
    snapshot.items[0].actions[1].warnings = [
      { code: 'VISIBILITY_CONTROL_UNAVAILABLE', severity: 'info' },
    ]
    state.snapshot = snapshot
    mount()
    expect(
      screen.getByText('VISIBILITY_CONTROL_UNAVAILABLE'),
    ).toBeInTheDocument()
    fireEvent.click(
      screen.getByRole('button', { name: 'access.studio.filter.attention' }),
    )
    expect(
      document.getElementById('notification_template:wording:edit'),
    ).toBeInTheDocument()
    expect(document.getElementById('service:demo:create')).toBeNull()
    expect(screen.queryByText('access.studio.why.requiredContext')).toBeNull()
    fireEvent.click(
      screen.getByRole('button', { name: 'access.studio.filter.all' }),
    )
    expect(document.getElementById('service:demo:create')).toBeInTheDocument()
  })
  it('requires review for a new warning when the current warning list was omitted', async () => {
    const snapshot = fixture()
    delete snapshot.items[0].actions[1].warnings
    state.snapshot = snapshot
    state.preview.mockImplementation(async ({ items }: { items: Patch[] }) => {
      const response = previewFor(snapshot, items)
      const before = snapshot.items[0].actions[1]
      const after: Decision = {
        ...response.proposed.items[0].actions[1],
        warnings: [{ code: 'PREREQUISITE_BLOCKED', severity: 'warning' }],
      }
      response.proposed.items[0].actions[1] = after
      response.impacts = [{
        resource: snapshot.items[0].resource,
        action: 'edit',
        before,
        after,
      }]
      return response
    })
    mount()
    fireEvent.click(screen.getAllByRole('radio', { name: /deny/i })[0])
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.save' }))
    const acknowledge = await screen.findByRole('button', {
      name: 'access.studio.review.acknowledge',
    })
    expect(state.save).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'access.studio.save' }),
    ).toBeDisabled()
    fireEvent.click(acknowledge)
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.save' }))
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce())
  })
  it('allows personal settings and Copy for active accounts awaiting first password setup', async () => {
    const snapshot = fixture()
    snapshot.subject.authentication_eligible = false
    state.snapshot = snapshot
    mount()
    expect(screen.getByRole('heading', { name: 'access.studio.copy.title' })).toBeVisible()
    const deny = screen.getAllByRole('radio', { name: /deny/i })[0]
    expect(deny).toBeEnabled()
    fireEvent.click(deny)
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.save' }))
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce())
    expect(state.save.mock.calls[0][0].items).toEqual([
      { capability: 'messages.templates', effect: 'deny', expires_at: null },
    ])
  })
  it('clears a late navigation prompt once the saved draft finishes reloading', async () => {
    let finishRefresh: (value: { data: Snapshot }) => void = () => {}
    state.refresh.mockImplementation(() => new Promise<{ data: Snapshot }>((resolve) => { finishRefresh = resolve }))
    mount()
    fireEvent.click(screen.getAllByRole('radio', { name: /deny/i })[0])
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.save' }))
    await waitFor(() => expect(state.refresh).toHaveBeenCalledOnce())
    const proceed = vi.fn()
    act(() => { requestWorkspaceNavigation(proceed) })
    expect(screen.getByText('access.studio.leaveDirty')).toBeInTheDocument()
    await act(async () => { finishRefresh({ data: { ...fixture(), revision: 'r2' } }) })
    expect(screen.queryByText('access.studio.leaveDirty')).not.toBeInTheDocument()
    expect(screen.getByText('access.studio.saved')).toBeInTheDocument()
    expect(proceed).not.toHaveBeenCalled()
  })
  it('keeps the signed-in view policy visible while staging an edit deny and confirms only server save', async () => {
    mount()
    const row =
      document
        .getElementById('notification_template:wording:edit')
        ?.closest('article') ??
      document.getElementById('notification_template:wording:edit')
        ?.parentElement
    expect(row).toBeTruthy()
    const radios = screen.getAllByRole('radio')
    const deny =
      radios.find((radio) => radio.getAttribute('value') === 'deny') ??
      screen.getAllByRole('radio', { name: /deny/i })[0]
    fireEvent.click(deny)
    expect(
      document.getElementById('notification_template:wording:view'),
    ).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.save' }))
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce())
    expect(state.save.mock.calls[0][0].items).toEqual([
      { capability: 'messages.templates', effect: 'deny', expires_at: null },
    ])
    expect(await screen.findByText('access.studio.saved')).toBeInTheDocument()
  })
  it('describes create-only as custom while browse records remains denied', () => {
    mount()
    expect(document.getElementById('service:demo:create')).toBeTruthy()
    expect(document.getElementById('service:demo:read')).toBeTruthy()
    expect(screen.queryByText(/Hidden everywhere/i)).not.toBeInTheDocument()
    expect(screen.getAllByText(/custom/i).length).toBeGreaterThan(0)
  })
  it('applies bulk only to explicitly selected visible actions, never expands to another capability', async () => {
    const snapshot = fixture()
    snapshot.overrides = [
      {
        capability: 'messages.templates',
        effect: 'grant',
        expires_at: null,
        state: 'active',
      },
    ]
    state.snapshot = snapshot
    mount()
    fireEvent.click(
      screen.getByRole('button', { name: 'access.studio.filter.exceptions' }),
    )
    const checkboxes = screen.getAllByRole('checkbox')
    fireEvent.click(checkboxes[0])
    const bulk = screen.getByRole('group', { name: /applySelected/ })
    fireEvent.click(
      within(bulk).getByRole('button', { name: 'access.studio.setting.deny' }),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'access.studio.filter.all' }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.save' }))
    await waitFor(() => expect(state.preview).toHaveBeenCalled())
    expect(state.preview.mock.calls[0][0].items).toEqual([
      { capability: 'messages.templates', effect: 'deny', expires_at: null },
    ])
  })
  it('preserves an existing expiry when staging a different effect', async () => {
    const snapshot = fixture()
    snapshot.overrides = [
      {
        capability: 'messages.templates',
        effect: 'grant',
        expires_at: '2026-11-01T00:00:00Z',
        state: 'active',
      },
    ]
    state.snapshot = snapshot
    mount()
    fireEvent.click(screen.getAllByRole('radio', { name: /deny/i })[0])
    fireEvent.click(
      screen.getByRole('button', { name: 'access.studio.reviewAction' }),
    )
    await waitFor(() => expect(state.preview).toHaveBeenCalled())
    expect(state.preview.mock.calls[0][0].items[0].expires_at).toBe(
      '2026-11-01T00:00:00Z',
    )
    expect(state.save).not.toHaveBeenCalled()
  })
  it('does not render a late snapshot for another subject', () => {
    state.snapshot = fixture(43)
    mount(42)
    expect(screen.getByText('access.studio.loading')).toBeInTheDocument()
    expect(screen.queryByText('Message wording')).not.toBeInTheDocument()
  })
  it('keeps denied draft after 412 and requires explicit rebase and renewed review', async () => {
    state.save.mockRejectedValue({ status: 412 })
    mount()
    fireEvent.click(screen.getAllByRole('radio', { name: /deny/i })[0])
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.save' }))
    expect(
      await screen.findByText('access.studio.error.conflict'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'access.studio.reviewAction' }),
    ).toBeDisabled()
    fireEvent.click(
      screen.getByRole('button', { name: 'access.studio.rebase' }),
    )
    state.save.mockResolvedValue({})
    fireEvent.click(
      screen.getByRole('button', { name: 'access.studio.reviewAction' }),
    )
    fireEvent.click(
      await screen.findByRole('button', {
        name: 'access.studio.review.acknowledge',
      }),
    )
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.save' }))
    await waitFor(() => expect(state.save).toHaveBeenCalledTimes(2))
    expect(state.save.mock.calls[1][0].revision).toBe('r2')
    expect(state.save.mock.calls[1][0].items[0].effect).toBe('deny')
  })
  it('retains draft and prior current outcomes on save failure', async () => {
    state.save.mockRejectedValue(new Error('offline'))
    mount()
    fireEvent.click(screen.getAllByRole('radio', { name: /deny/i })[0])
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.save' }))
    expect(
      await screen.findByText('access.studio.error.failed'),
    ).toBeInTheDocument()
    expect(screen.getByText('access.studio.unsaved 1')).toBeInTheDocument()
    expect(
      document.getElementById('notification_template:wording:view'),
    ).toBeTruthy()
  })
  it('ignores preview completion after switching account', async () => {
    // The project's ES2022 library does not expose Promise.withResolvers.
    let resolve!: (value: PreviewResponse) => void
    const promise = new Promise<PreviewResponse>((done) => {
      resolve = done
    })
    state.preview.mockImplementation(() => promise)
    const rendered = mount()
    fireEvent.click(screen.getAllByRole('radio', { name: /deny/i })[0])
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.save' }))
    rendered.unmount()
    state.snapshot = fixture(43)
    mount(43)
    await act(async () =>
      resolve(
        previewFor(fixture(), [
          {
            capability: 'messages.templates',
            effect: 'deny',
            expires_at: null,
          },
        ]),
      ),
    )
    expect(state.save).not.toHaveBeenCalled()
    expect(screen.getByText('access.studio.unsaved 0')).toBeInTheDocument()
  })
  it('asks inline before outer register navigation and stays without losing the draft', () => {
    mount()
    fireEvent.click(screen.getAllByRole('radio', { name: /deny/i })[0])
    const proceed = vi.fn()
    act(() => {
      expect(requestWorkspaceNavigation(proceed)).toBe(true)
    })
    expect(screen.getByText('access.studio.leaveDirty')).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.stay' }))
    expect(proceed).not.toHaveBeenCalled()
    expect(screen.getByText('access.studio.unsaved 1')).toBeInTheDocument()
  })
  it('shows a server-confirmed receipt but blocks new edits when post-save reload fails', async () => {
    state.refresh.mockResolvedValue({ data: fixture(), isError: true })
    mount()
    fireEvent.click(screen.getAllByRole('radio', { name: /deny/i })[0])
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.save' }))
    expect(await screen.findByText('access.studio.saved')).toBeInTheDocument()
    expect(
      screen.getAllByText('access.studio.savedReloadError').length,
    ).toBeGreaterThan(0)
    expect(
      screen.queryByText('access.studio.error.failed'),
    ).not.toBeInTheDocument()
    expect(screen.getAllByRole('radio')[0]).toBeDisabled()
    state.refresh.mockImplementation(async () => {
      state.snapshot = { ...fixture(), revision: 'r2' }
      return { data: state.snapshot, isError: false }
    })
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.retry' }))
    await waitFor(() =>
      expect(screen.getAllByRole('radio')[0]).not.toBeDisabled(),
    )
    expect(state.save).toHaveBeenCalledOnce()
  })
  it('requires reviewed acknowledgment when clearing an expiry from a personal grant', async () => {
    const snapshot = fixture()
    snapshot.overrides = [
      {
        capability: 'messages.templates',
        effect: 'grant',
        expires_at: '2026-11-01T00:00:00Z',
        state: 'active',
      },
    ]
    state.snapshot = snapshot
    mount()
    const expiry = screen.getByRole('textbox', {
      name: /access.studio.expiry.label/,
    })
    fireEvent.change(expiry, { target: { value: '' } })
    fireEvent.blur(expiry)
    fireEvent.click(
      screen.getByRole('button', { name: 'access.studio.reviewAction' }),
    )
    const acknowledge = await screen.findByRole('button', {
      name: 'access.studio.review.acknowledge',
    })
    expect(state.save).not.toHaveBeenCalled()
    expect(
      screen.getByRole('button', { name: 'access.studio.save' }),
    ).toBeDisabled()
    fireEvent.click(acknowledge)
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.save' }))
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce())
    expect(state.save.mock.calls[0][0].items).toEqual([
      { capability: 'messages.templates', effect: 'grant', expires_at: null },
    ])
  })
  it('bulk Follow role deletes the override including its expiry, never leaves a timed null', async () => {
    const snapshot = fixture()
    snapshot.overrides = [
      {
        capability: 'messages.templates',
        effect: 'grant',
        expires_at: '2026-11-01T00:00:00Z',
        state: 'active',
      },
    ]
    state.snapshot = snapshot
    mount()
    fireEvent.click(screen.getAllByRole('checkbox')[0])
    fireEvent.click(
      within(screen.getByRole('group', { name: /applySelected/ })).getByRole(
        'button',
        { name: 'access.studio.setting.role' },
      ),
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'access.studio.reviewAction' }),
    )
    await waitFor(() => expect(state.preview).toHaveBeenCalled())
    expect(state.preview.mock.calls[0][0].items).toEqual([
      { capability: 'messages.templates', effect: null, expires_at: null },
    ])
    expect(state.save).not.toHaveBeenCalled()
  })
  it('does not persist the previously staged value while a new expiry field is invalid', () => {
    mount()
    fireEvent.click(screen.getAllByRole('radio', { name: /deny/i })[0])
    const expiry = screen.getByRole('textbox', {
      name: /access.studio.expiry.label/,
    })
    fireEvent.change(expiry, { target: { value: '2020-01-01T00:00:00Z' } })
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.save' }))
    expect(expiry).toBeInvalid()
    expect(state.preview).not.toHaveBeenCalled()
    expect(state.save).not.toHaveBeenCalled()
  })
  it('marks stale resource or action destinations unavailable without a replacement', () => {
    const onNavigate = vi.fn()
    mount(42, {
      initialResource: { kind: 'service', id: 'gone' },
      onNavigate,
      renderSearch: ({ onNavigate }) => (
        <button
          onClick={() =>
            onNavigate({
              resource: { kind: 'service', id: 'demo' },
              action: 'delete',
            })
          }
        >
          Open stale action
        </button>
      ),
    })
    expect(
      screen.getByText('access.studio.destinationUnavailable'),
    ).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open stale action' }))
    expect(onNavigate).not.toHaveBeenCalled()
    expect(
      screen.getByText('access.studio.destinationUnavailable'),
    ).toBeInTheDocument()
  })
  it('keeps focus on search after returning from an action in a deep-linked resource', async () => {
    mount(42, {
      initialResource: { kind: 'notification_template', id: 'wording' },
      renderSearch: ({ onNavigate }) => <>
        <input aria-label="Find resource" />
        <button onClick={() => onNavigate({
          resource: { kind: 'notification_template', id: 'wording' }, action: 'edit',
        })}>Open edit result</button>
      </>,
    })
    await waitFor(() => expect(document.getElementById('notification_template:wording:view')).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'Open edit result' }))
    await waitFor(() => expect(document.getElementById('notification_template:wording:edit')).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.backToResults' }))
    await act(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    expect(screen.getByRole('textbox', { name: 'Find resource' })).toHaveFocus()
  })
  it('retains a draft but disables mutation controls after a permission-denied save', async () => {
    state.save.mockRejectedValue({ status: 403 })
    mount()
    fireEvent.click(screen.getAllByRole('radio', { name: /deny/i })[0])
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.save' }))
    expect(
      await screen.findByText('access.studio.mutationDenied'),
    ).toBeInTheDocument()
    expect(screen.getByText('access.studio.unsaved 1')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'access.studio.save' }),
    ).toBeDisabled()
  })
  it('links a rejected validation patch back to its editable action', async () => {
    state.save.mockRejectedValue({ status: 422 })
    mount()
    fireEvent.click(screen.getAllByRole('radio', { name: /deny/i })[0])
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.save' }))
    expect(
      await screen.findByText('access.studio.error.validation'),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: 'messages.templates' }),
    ).toHaveAttribute('href', '#notification_template:wording:edit')
    expect(screen.getByText('access.studio.unsaved 1')).toBeInTheDocument()
  })
  it('keeps a blocked prerequisite as an explicit reviewed consequence without a cascade', async () => {
    state.preview.mockImplementation(async ({ items }: { items: Patch[] }) => {
      const response = previewFor(fixture(), items)
      const before = decision('create', 'books.service.demo')
      const after: Decision = {
        ...before,
        authorization: 'denied',
        executable_now: false,
        warnings: [
          {
            code: 'PREREQUISITE_BLOCKED',
            severity: 'warning',
            capabilities: ['messages.templates'],
            params: {},
          },
        ],
      }
      response.impacts = [
        {
          resource: { kind: 'service', id: 'demo' },
          action: 'create',
          before,
          after,
        },
      ]
      response.proposed.items[1].actions[0] = after
      return response
    })
    mount()
    fireEvent.click(screen.getAllByRole('radio', { name: /deny/i })[0])
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.save' }))
    const acknowledge = await screen.findByRole('button', {
      name: 'access.studio.review.acknowledge',
    })
    expect(
      screen.getByText('access.studio.review.newlyBlocked'),
    ).toBeInTheDocument()
    expect(state.save).not.toHaveBeenCalled()
    fireEvent.click(acknowledge)
    fireEvent.click(screen.getByRole('button', { name: 'access.studio.save' }))
    await waitFor(() => expect(state.save).toHaveBeenCalledOnce())
    expect(state.save.mock.calls[0][0].items).toEqual([
      { capability: 'messages.templates', effect: 'deny', expires_at: null },
    ])
  })
})

describe('draft patch defaults', () => {
  it('normalizes an omitted effect to Follow role without creating a phantom draft', () => {
    const { result } = renderHook(() => useAccessDraft(fixture()))
    act(() => result.current.stage([{ capability: 'messages.templates' }]))
    expect(result.current.dirty).toBe(false)
    expect(result.current.patches).toEqual([])
  })
  it('clears a saved personal override and its expiry when the patch effect is omitted', () => {
    const snapshot = fixture()
    snapshot.overrides = [{
      capability: 'messages.templates',
      effect: 'grant',
      expires_at: '2026-11-01T00:00:00Z',
      state: 'active',
    }]
    const { result } = renderHook(() => useAccessDraft(snapshot))
    act(() => result.current.stage([{ capability: 'messages.templates' }]))
    expect(result.current.patches).toEqual([{
      capability: 'messages.templates',
      effect: null,
      expires_at: null,
    }])
    expect(result.current.dirty).toBe(true)
  })
})

describe('Check access context', () => {
  it('accepts real string category and classification IDs and displays the server decision', async () => {
    const snapshot = fixture()
    const response: CheckResponse = {
      snapshot,
      current: decision('create', 'books.service.General Book'),
      proposed: null,
      impacts: [],
    }
    state.check.mockImplementation(
      (
        _request: CheckRequest,
        options: { onSuccess: (value: CheckResponse) => void },
      ) => options.onSuccess(response),
    )
    render(
      <CheckAccess
        subjectId={42}
        snapshot={snapshot}
        patches={[]}
        initialResource={{ kind: 'service', id: 'General Book' }}
        initialAction="create"
      />,
    )
    const category = screen.getByRole('textbox', {
      name: 'access.studio.check.categoryId',
    })
    const classification = screen.getByRole('textbox', {
      name: 'access.studio.check.classificationId',
    })
    fireEvent.change(category, { target: { value: ' GS ' } })
    fireEvent.change(classification, { target: { value: ' 12/1 ' } })
    fireEvent.change(
      screen.getByRole('textbox', { name: 'access.studio.check.grade' }),
      { target: { value: 'unclassified' } },
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'access.studio.check.submit' }),
    )
    expect(state.check.mock.calls[0][0]).toEqual({
      resource: { kind: 'service', id: 'General Book' },
      action: 'create',
      context: {
        category_id: 'GS',
        classification_id: '12/1',
        grade: 'unclassified',
      },
      proposed: [],
      expected_revision: snapshot.revision,
    })
    expect(
      await screen.findByText('access.studio.check.current'),
    ).toBeInTheDocument()
    expect(
      screen.getAllByText('access.studio.outcomes.allowed').length,
    ).toBeGreaterThan(0)
    expect(state.preview).not.toHaveBeenCalled()
    expect(state.save).not.toHaveBeenCalled()
    fireEvent.change(classification, { target: { value: '12/2' } })
    expect(
      screen.queryByText('access.studio.check.current'),
    ).not.toBeInTheDocument()
  })
  it('omits blank context identifiers rather than converting them to zero', () => {
    render(
      <CheckAccess
        subjectId={42}
        snapshot={fixture()}
        patches={[]}
        initialResource={{ kind: 'service', id: 'General Book' }}
        initialAction="create"
      />,
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'access.studio.check.categoryId' }),
      { target: { value: ' ' } },
    )
    fireEvent.change(
      screen.getByRole('textbox', { name: 'access.studio.check.classificationId' }),
      { target: { value: ' ' } },
    )
    fireEvent.click(
      screen.getByRole('button', { name: 'access.studio.check.submit' }),
    )
    expect(state.check.mock.calls[0][0].context).toEqual({})
  })
})

describe('copy personal exceptions', () => {
  it('replaces target-only exceptions, preserving source expiry and never copying role defaults', () => {
    const source = fixture(43)
    const target = fixture()
    source.subject.role = 'manager'
    source.role_defaults.push('unrelated.role.default')
    source.overrides = [
      {
        capability: 'messages.templates',
        effect: 'deny',
        expires_at: '2026-11-01T00:00:00Z',
        state: 'active',
      },
    ]
    target.overrides = [
      {
        capability: 'books.service.demo',
        effect: 'grant',
        expires_at: null,
        state: 'active',
      },
    ]
    expect(
      buildCopyPatch(source, target, Date.parse('2026-10-29T00:00:00Z'))
        .patches,
    ).toEqual([
      { capability: 'books.service.demo', effect: null, expires_at: null },
      {
        capability: 'messages.templates',
        effect: 'deny',
        expires_at: '2026-11-01T00:00:00Z',
      },
    ])
    expect(target.subject.role).toBe('operator')
  })
  it('does not turn expired or uneditable source exceptions into live grants', () => {
    const source = fixture(43)
    source.overrides = [
      {
        capability: 'messages.templates',
        effect: 'grant',
        expires_at: '2026-10-01T00:00:00Z',
        state: 'expired',
      },
      {
        capability: 'unknown.capability',
        effect: 'grant',
        expires_at: null,
        state: 'active',
      },
    ]
    expect(
      buildCopyPatch(source, fixture(), Date.parse('2026-10-29T00:00:00Z')),
    ).toEqual({
      patches: [],
      exclusions: [
        { capability: 'messages.templates', reason: 'expired' },
        { capability: 'unknown.capability', reason: 'nonconfigurable' },
      ],
    })
  })
})
