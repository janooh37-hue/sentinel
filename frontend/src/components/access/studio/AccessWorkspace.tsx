import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/lib/authContext'
import {
  useAccessSnapshot,
  usePreviewAccess,
  useSaveAccess,
} from '@/lib/permissionStudioApi'
import type { ResourceSearchProps, StudioDestination } from './contracts'
import { AccessGroups } from './AccessGroups'
import { CheckAccess } from './CheckAccess'
import { ChangeReview } from './ChangeReview'
import { CopyAccess } from './CopyAccess'
import {
  destinationId,
  savedSetting,
  localized,
  isMessageTemplate,
  stageActionSetting,
  type AccessItem,
  type Decision,
  type Patch,
  type PreviewResponse,
  type Resource,
  type Snapshot,
} from './studioModel'
import { useAccessDraft } from './useAccessDraft'
import { registerWorkspaceNavigation } from './workspaceNavigation'

export interface AccessWorkspaceProps {
  subjectId: number
  initialResource?: Resource
  onNavigate: (destination: StudioDestination) => void
  renderSearch: (props: ResourceSearchProps) => ReactNode
}
const control =
  'min-h-11 rounded-md border border-border px-3 py-2 text-start hover:bg-surface-tinted focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50'

export function AccessWorkspace(props: AccessWorkspaceProps) {
  const query = useAccessSnapshot(props.subjectId)
  const { t } = useTranslation()
  if (!query.data || query.data.subject.user_id !== props.subjectId)
    return (
      <section aria-busy={query.isPending}>
        {query.isError ? (
          <div role="alert">
            {t('access.studio.loadError')}{' '}
            <button className={control} onClick={() => void query.refetch()}>
              {t('access.studio.retry')}
            </button>
          </div>
        ) : (
          <div role="status">
            <p>{t('access.studio.loading')}</p>
            <div
              aria-hidden="true"
              className="mt-3 h-16 rounded-md bg-surface-tinted motion-safe:animate-pulse"
            />
          </div>
        )}
      </section>
    )
  return (
    <WorkspaceSession
      key={props.subjectId}
      {...props}
      snapshot={query.data}
      readError={query.isError}
      refresh={async () => {
        const result = await query.refetch()
        return result.isError ? undefined : result.data
      }}
    />
  )
}

function WorkspaceSession({
  subjectId,
  initialResource,
  onNavigate,
  renderSearch,
  snapshot,
  refresh,
  readError,
}: AccessWorkspaceProps & {
  snapshot: Snapshot
  refresh: () => Promise<Snapshot | undefined>
  readError: boolean
}) {
  const { t, i18n } = useTranslation()
  const { user, status } = useAuth()
  const queryClient = useQueryClient()
  const draft = useAccessDraft(snapshot)
  const previewMutation = usePreviewAccess(subjectId)
  const saveMutation = useSaveAccess(subjectId)
  const [preview, setPreview] = useState<{
    version: number
    value: PreviewResponse
  }>()
  const [reviewed, setReviewed] = useState<number>()
  const [acknowledged, setAcknowledged] = useState(false)
  const [renewedReview, setRenewedReview] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<
    'failed' | 'conflict' | 'unknown' | 'validation'
  >()
  const [mutationDenied, setMutationDenied] = useState(false)
  const [awaitingRefresh, setAwaitingRefresh] = useState(false)
  const [refreshFailed, setRefreshFailed] = useState(false)
  const [destinationUnavailable, setDestinationUnavailable] = useState(false)
  const workspaceRef = useRef<HTMLElement>(null)
  const searchRef = useRef<HTMLDivElement>(null)
  const [receipt, setReceipt] = useState(false)
  const [filter, setFilter] = useState('all')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const initialItem = initialResource
    ? snapshot.items.find(
        (item: AccessItem) =>
          item.resource.kind === initialResource.kind &&
          item.resource.id === initialResource.id,
      )
    : undefined
  const initialAction = initialItem?.actions[0]?.action
  const initialDestination =
    initialItem && initialAction
      ? destinationId(initialItem.resource, initialAction)
      : undefined
  const [focusDestination, setFocusDestination] = useState<string | undefined>(initialDestination)
  const [leave, setLeave] = useState<StudioDestination>()
  const [pendingNavigation, setPendingNavigation] = useState<() => void>()
  const navigationPromptRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (leave || pendingNavigation) navigationPromptRef.current?.focus()
  }, [leave, pendingNavigation])
  const [conflictBaseline, setConflictBaseline] = useState<Snapshot>()
  const alive = useRef(true)
  const generation = useRef(0)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    if (!draft.dirty) return
    const guard = (event: BeforeUnloadEvent) => {
      event.preventDefault()
    }
    window.addEventListener('beforeunload', guard)
    return () => window.removeEventListener('beforeunload', guard)
  }, [draft.dirty])
  const locked =
    mutationDenied ||
    awaitingRefresh ||
    status !== 'authed' ||
    user?.id === subjectId ||
    snapshot.subject.role === 'admin' ||
    snapshot.subject.status !== 'active'
  const busy = submitting || saveMutation.isPending || previewMutation.isPending
  useEffect(
    () =>
      registerWorkspaceNavigation((proceed) => {
        if (!draft.dirty) return busy
        setPendingNavigation(() => proceed)
        return true
      }),
    [busy, draft.dirty],
  )
  const currentPreview =
    preview?.version === draft.version ? preview.value : undefined
  function requiresReview(value?: PreviewResponse) {
    return (
      renewedReview ||
      draft.patches.length > 1 ||
      draft.patches.some(
        (patch) =>
          patch.expires_at != null ||
          savedSetting(draft.baseline, patch.capability).expires_at != null,
      ) ||
      value?.impacts.some(
        (impact: PreviewResponse['impacts'][number]) =>
          !impact.after.setting_capabilities.some((id: string) =>
            draft.patches.some((patch) => patch.capability === id),
          ) ||
          (impact.after.warnings?.length ?? 0) >
            (impact.before.warnings?.length ?? 0),
      ) === true
    )
  }
  const needsReview = requiresReview(currentPreview)
  function stage(patches: Patch[]) {
    if (busy || locked) return
    generation.current++
    draft.stage(patches)
    setPreview(undefined)
    setReviewed(undefined)
    setAcknowledged(false)
    setReceipt(false)
    setError(undefined)
  }
  async function evaluate() {
    const request = ++generation.current
    try {
      const value = await previewMutation.mutateAsync({
        expected_revision: draft.baseline.revision,
        items: draft.patches,
      })
      if (!alive.current || request !== generation.current) return undefined
      if (
        value.current.subject.user_id !== subjectId ||
        value.proposed.subject.user_id !== subjectId
      )
        return undefined
      setPreview({ version: draft.version, value })
      return value
    } catch (cause) {
      if (alive.current && request === generation.current) await failure(cause)
      return undefined
    }
  }
  async function failure(cause: unknown) {
    const code =
      cause && typeof cause === 'object' && 'status' in cause
        ? cause.status
        : undefined
    if (code === 412) {
      setError('conflict')
      setPreview(undefined)
      setReviewed(undefined)
      setAcknowledged(false)
      setRenewedReview(true)
      setRefreshFailed(false)
      const next = await refresh()
      if (!alive.current) return
      if (next?.subject.user_id === subjectId) setConflictBaseline(next)
      else setRefreshFailed(true)
    } else if (code === 403) {
      setMutationDenied(true)
      setError(undefined)
      await queryClient.invalidateQueries({ queryKey: ['my-capabilities'] })
    } else if (code === 422) setError('validation')
    else setError('failed')
  }
  async function save() {
    if (locked || busy || !draft.dirty || error === 'conflict') return
    const invalid = workspaceRef.current?.querySelector<HTMLInputElement>(
      'input[data-access-expiry]:invalid',
    )
    if (invalid) {
      invalid.reportValidity()
      invalid.focus()
      return
    }
    setSubmitting(true)
    try {
      const value = currentPreview ?? (await evaluate())
      if (!value || !alive.current) return
      const affected = value.proposed.items
        .flatMap((item: AccessItem) => item.actions)
        .filter((action: Decision) =>
          action.setting_capabilities.some((id: string) =>
            draft.patches.some((patch) => patch.capability === id),
          ),
        )
      const incomplete =
        affected.some(
          (action: Decision) => action.authorization === 'unknown',
        ) ||
        value.impacts.some(
          (impact: PreviewResponse['impacts'][number]) =>
            impact.after.authorization === 'unknown',
        )
      if (
        value.validation.some(
          (issue: PreviewResponse['validation'][number]) =>
            issue.severity === 'error',
        ) ||
        incomplete
      ) {
        setError('unknown')
        return
      }
      if (
        requiresReview(value) &&
        (reviewed !== draft.version || !acknowledged)
      ) {
        setReviewed(draft.version)
        workspaceRef.current
          ?.querySelector<HTMLElement>('[data-change-review]')
          ?.focus()
        return
      }
      await saveMutation.mutateAsync({
        revision: draft.baseline.revision,
        items: draft.patches,
      })
      if (!alive.current) return
      setReceipt(true)
      setAwaitingRefresh(true)
      const next = await refresh()
      if (!alive.current) return
      if (!next || next.subject.user_id !== subjectId) {
        setRefreshFailed(true)
        return
      }
      draft.discard(next)
      setPreview(undefined)
      setReceipt(true)
      setError(undefined)
      setRenewedReview(false)
      setAwaitingRefresh(false)
      setRefreshFailed(false)
      setPendingNavigation(undefined)
      setLeave(undefined)
      if (pendingNavigation) pendingNavigation()
      else if (leave) onNavigate(leave)
    } catch (cause) {
      if (alive.current) await failure(cause)
    } finally {
      if (alive.current) setSubmitting(false)
    }
  }
  async function retrySnapshot() {
    setRefreshFailed(false)
    const next = await refresh()
    if (!alive.current) return
    if (!next || next.subject.user_id !== subjectId) {
      setRefreshFailed(true)
      return
    }
    if (awaitingRefresh) {
      draft.discard(next)
      setPreview(undefined)
      setAwaitingRefresh(false)
      setRenewedReview(false)
      setError(undefined)
      setPendingNavigation(undefined)
      setLeave(undefined)
    } else if (error === 'conflict') setConflictBaseline(next)
  }
  function navigate(destination: StudioDestination) {
    if (busy) return
    if (destination.userId != null && destination.userId !== subjectId) {
      if (draft.dirty) setLeave(destination)
      else onNavigate(destination)
      return
    }
    if (destination.resource) {
      const item = snapshot.items.find(
        (item: AccessItem) =>
          item.resource.kind === destination.resource?.kind &&
          item.resource.id === destination.resource.id,
      )
      const action = destination.action ?? item?.actions[0]?.action
      if (
        item &&
        action &&
        item.actions.some((decision: Decision) => decision.action === action)
      ) {
        setFilter('all')
        setDestinationUnavailable(false)
        setFocusDestination(destinationId(item.resource, action))
        onNavigate(destination)
      } else setDestinationUnavailable(true)
    } else if (draft.dirty) setLeave(destination)
    else onNavigate(destination)
  }
  const items: AccessItem[] = draft.baseline.items.filter(
    (item: AccessItem) =>
      filter === 'all' ||
      item.actions.some((action: Decision) =>
        filter === 'exceptions'
          ? action.setting_capabilities.some((id: string) =>
              draft.baseline.overrides.some(
                (override: Snapshot['overrides'][number]) =>
                  override.capability === id,
              ),
            )
          : action.authorization === 'unknown' ||
            action.authorization === 'needs_context' ||
            (action.warnings?.length ?? 0) > 0,
      ),
  )
  const selectedActions: { item: AccessItem; action: Decision }[] =
    items.flatMap((item: AccessItem) =>
      item.actions
        .filter((action: Decision) =>
          selected.has(destinationId(item.resource, action.action)),
        )
        .map((action: Decision) => ({ item, action })),
    )
  return (
    <section
      ref={workspaceRef}
      className="min-w-0 space-y-5 pb-[max(1rem,env(safe-area-inset-bottom))] [overflow-wrap:anywhere]"
      aria-busy={busy}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">{t('access.studio.access')}</h2>
        <p>
          {t('access.studio.account')} <bdi dir="ltr">{subjectId}</bdi> ·{' '}
          {t(`access.roleName.${snapshot.subject.role}`)} ·{' '}
          {t(`access.studio.status.${snapshot.subject.status}`)}
        </p>
      </header>
      <p className="text-sm text-muted-foreground">
        {t('access.studio.evaluated')}{' '}
        <time dir="ltr" dateTime={draft.baseline.evaluated_at}>
          {draft.baseline.evaluated_at}
        </time>{' '}
        · {t(`access.studio.scope.${draft.baseline.scope.mode}`)}
      </p>
      {locked && !awaitingRefresh && (
        <p role="status">
          {t(
            mutationDenied
              ? 'access.studio.mutationDenied'
              : user?.id === subjectId
                ? 'access.studio.selfLocked'
                : snapshot.subject.role === 'admin'
                  ? 'access.studio.adminLocked'
                  : snapshot.subject.status !== 'active'
                    ? 'access.studio.inactiveLocked'
                    : 'access.studio.readOnly',
          )}
        </p>
      )}
      {(readError || refreshFailed) && (
        <div role="alert">
          {t(
            awaitingRefresh
              ? 'access.studio.savedReloadError'
              : 'access.studio.loadError',
          )}{' '}
          <button
            className={control}
            disabled={busy}
            onClick={() => void retrySnapshot()}
          >
            {t('access.studio.retry')}
          </button>
        </div>
      )}
      {(destinationUnavailable || (initialResource && !initialDestination)) && (
        <p role="alert">{t('access.studio.destinationUnavailable')}</p>
      )}
      {status !== 'authed' && draft.dirty && (
        <p role="alert">{t('access.studio.authLost')}</p>
      )}
      {(leave || pendingNavigation) && (
        <div ref={navigationPromptRef} tabIndex={-1} role="alert" className="space-y-2 rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring">
          <p>{t('access.studio.leaveDirty')}</p>
          <div className="flex flex-wrap gap-2">
            <button
              className={control}
              disabled={busy}
              onClick={() => void save()}
            >
              {t('access.studio.save')}
            </button>
            <button
              className={control}
              disabled={busy}
              onClick={() => {
                draft.discard()
                if (pendingNavigation) pendingNavigation()
                else if (leave) onNavigate(leave)
              }}
            >
              {t('access.studio.discard')}
            </button>
            <button
              className={control}
              onClick={() => {
                setLeave(undefined)
                setPendingNavigation(undefined)
              }}
            >
              {t('access.studio.stay')}
            </button>
          </div>
        </div>
      )}
      <div ref={searchRef}>
        {renderSearch({
          subjectId,
          items: snapshot.items,
          onNavigate: navigate,
        })}
      </div>
      {focusDestination && (
        <button
          className={control}
          onClick={() => {
            setFocusDestination(undefined)
            searchRef.current?.querySelector('input')?.focus()
          }}
        >
          {t('access.studio.backToResults')}
        </button>
      )}
      <div
        className="flex flex-wrap gap-2"
        role="group"
        aria-label={t('access.studio.filters')}
      >
        {['all', 'exceptions', 'attention'].map((value) => (
          <button
            key={value}
            className={control}
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
          >
            {t(`access.studio.filter.${value}`)}
          </button>
        ))}
      </div>
      {selectedActions.length > 0 && (
        <fieldset
          className="space-y-3 rounded-md border border-border p-3"
          disabled={busy || locked}
        >
          <legend>
            {t('access.studio.applySelected', {
              count: selectedActions.length,
            })}
          </legend>
          <ul className="space-y-2">
            {selectedActions.map(({ item, action }) => (
              <li key={destinationId(item.resource, action.action)}>
                <p>
                  <bdi>{localized(item.label, i18n.language)}</bdi> ·{' '}
                  {t(`access.studio.actions.${action.action}`)}
                </p>
                {isMessageTemplate(item.resource) && ['edit', 'reset'].includes(action.action) && (
                  <p className="max-w-prose text-sm text-muted-foreground">
                    {t('access.studio.templateEditImpliesView')}
                  </p>
                )}
                <bdi dir="ltr" className="block text-xs">
                  {destinationId(item.resource, action.action)}
                </bdi>
                <ul className="text-xs">
                  {action.setting_capabilities.map((id: string) => (
                    <li key={id}>
                      <bdi dir="ltr">{id}</bdi>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-3">
            {([null, 'grant', 'deny'] satisfies Patch['effect'][]).map(
              (effect) => {
                const allowed = selectedActions.filter(
                  ({ action }) =>
                    action.configurable &&
                    action.setting_capabilities.length > 0 &&
                    action.editable_effects.includes(effect),
                )
                const excluded = selectedActions.filter(
                  (entry) => !allowed.includes(entry),
                )
                return (
                  <div key={effect ?? 'role'} className="min-w-0 space-y-2">
                    <button
                      className={control}
                      disabled={!allowed.length}
                      onClick={() =>
                        stage(
                          allowed.flatMap(({ item, action }) =>
                            stageActionSetting(item, action, effect, draft.baseline, draft.patches),
                          ),
                        )
                      }
                    >
                      {t(`access.studio.setting.${effect ?? 'role'}`)}
                    </button>
                    {excluded.length > 0 && (
                      <div className="text-sm">
                        <p>
                          {t('access.studio.excluded', {
                            count: excluded.length,
                          })}
                        </p>
                        <ul>
                          {excluded.map(({ item, action }) => (
                            <li
                              key={destinationId(item.resource, action.action)}
                            >
                              <bdi>{localized(item.label, i18n.language)}</bdi>{' '}
                              · {t(`access.studio.actions.${action.action}`)}{' '}
                              <bdi dir="ltr">
                                {destinationId(item.resource, action.action)}
                              </bdi>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )
              },
            )}
          </div>
        </fieldset>
      )}
      {!items.length && (
        <p role="status">
          {t('access.studio.noMatches')}{' '}
          <button className={control} onClick={() => setFilter('all')}>
            {t('access.studio.filter.all')}
          </button>
        </p>
      )}
      <AccessGroups
        items={items}
        snapshot={draft.baseline}
        proposed={currentPreview?.proposed}
        patches={draft.patches}
        disabled={locked || busy}
        selected={selected}
        onSelect={(id, checked) =>
          setSelected((previous) => {
            const next = new Set(previous)
            if (checked) next.add(id)
            else next.delete(id)
            return next
          })
        }
        onStage={stage}
        focusDestination={focusDestination}
      />
      <CheckAccess
        subjectId={subjectId}
        snapshot={draft.baseline}
        patches={draft.patches}
      />
      <CopyAccess
        target={draft.baseline}
        operatorId={user?.id ?? -1}
        disabled={locked || busy || draft.dirty}
        onStage={stage}
      />
      {draft.dirty && (
        <ChangeReview
          snapshot={draft.baseline}
          patches={draft.patches}
          preview={currentPreview}
          busy={busy}
          onReview={() => {
            setReviewed(draft.version)
            void evaluate()
          }}
          onAcknowledge={() => setAcknowledged((value) => !value)}
          acknowledged={acknowledged}
        />
      )}
      {error && (
        <div role="alert">
          {t(`access.studio.error.${error}`)}
          {error === 'validation' && (
            <ul>
              {draft.patches.map((patch) => {
                const item = snapshot.items.find((item: AccessItem) =>
                  item.actions.some((action: Decision) =>
                    action.setting_capabilities.includes(patch.capability),
                  ),
                )
                const action = item?.actions.find((action: Decision) =>
                  action.setting_capabilities.includes(patch.capability),
                )
                return (
                  <li key={patch.capability}>
                    {item && action ? (
                      <a
                        className="inline-flex min-h-11 items-center underline underline-offset-4"
                        href={`#${destinationId(item.resource, action.action)}`}
                        onClick={() => {
                          setFilter('all')
                          setFocusDestination(
                            destinationId(item.resource, action.action),
                          )
                        }}
                      >
                        <bdi dir="ltr">{patch.capability}</bdi>
                      </a>
                    ) : (
                      <bdi dir="ltr">{patch.capability}</bdi>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
          {error === 'conflict' && conflictBaseline && (
            <div>
              <BaselineComparison
                previous={draft.baseline}
                next={conflictBaseline}
                patches={draft.patches}
              />
              <button
                className={control}
                onClick={() => {
                  draft.rebase(conflictBaseline)
                  setConflictBaseline(undefined)
                  setError(undefined)
                  setReviewed(undefined)
                  setPreview(undefined)
                }}
              >
                {t('access.studio.rebase')}
              </button>
            </div>
          )}
        </div>
      )}
      <footer
        className={`${draft.dirty || receipt ? 'sticky bottom-0 ' : ''}flex flex-wrap items-center gap-3 border-t border-border bg-surface py-3 pb-[max(.75rem,env(safe-area-inset-bottom))]`}
        aria-label={t('access.studio.saveActions')}
      >
        <span role="status" aria-live="polite">
          {receipt
            ? t('access.studio.saved', { id: subjectId })
            : t('access.studio.unsaved', { count: draft.patches.length })}
        </span>
        {draft.dirty && !awaitingRefresh && (
          <>
            <button
              className={control}
              disabled={busy}
              onClick={() => {
                generation.current++
                draft.discard()
                setPreview(undefined)
                setError(undefined)
              }}
            >
              {t('access.studio.discard')}
            </button>
            <button
              className={`${control} bg-primary text-primary-foreground`}
              disabled={
                locked ||
                busy ||
                error === 'conflict' ||
                (needsReview && reviewed === draft.version && !acknowledged)
              }
              onClick={() => void save()}
            >
              {busy
                ? t('access.studio.saving')
                : needsReview && reviewed !== draft.version
                  ? t('access.studio.reviewAction')
                  : t('access.studio.save')}
            </button>
          </>
        )}
      </footer>
    </section>
  )
}

function BaselineComparison({
  previous,
  next,
  patches,
}: {
  previous: Snapshot
  next: Snapshot
  patches: Patch[]
}) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4 py-3 sm:grid-cols-2">
      {[
        { snapshot: previous, label: 'oldBaseline' },
        { snapshot: next, label: 'newBaseline' },
      ].map(({ snapshot, label }) => (
        <section key={label} className="min-w-0 space-y-2">
          <h3 className="font-semibold">{t(`access.studio.${label}`)}</h3>
          <p>
            {t(`access.roleName.${snapshot.subject.role}`)} ·{' '}
            {t(`access.studio.status.${snapshot.subject.status}`)}
          </p>
          <bdi dir="ltr" className="block text-xs">
            {snapshot.revision}
          </bdi>
          <ul className="space-y-3">
            {patches.map((patch) => {
              const setting = savedSetting(snapshot, patch.capability)
              return (
                <li key={patch.capability}>
                  <bdi dir="ltr">{patch.capability}</bdi>
                  <p>
                    {t('access.studio.roleBaseline')}:{' '}
                    {t(
                      `access.studio.baseline.${snapshot.role_defaults.includes(patch.capability) ? 'granted' : 'not_granted'}`,
                    )}
                  </p>
                  <p>
                    {t('access.studio.personalSetting')}:{' '}
                    {t(`access.studio.setting.${setting.effect ?? 'role'}`)}
                  </p>
                  {setting.expires_at && (
                    <time dir="ltr" className="block text-xs">
                      {setting.expires_at}
                    </time>
                  )}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}
