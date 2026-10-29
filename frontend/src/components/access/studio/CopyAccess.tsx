import { useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { api, apiErrorMessage } from '@/lib/api'
import { useAccessSnapshot } from '@/lib/permissionStudioApi'
import { savedSetting, type Patch, type Snapshot } from './studioModel'
import { buildCopyPatch } from './copyAccessModel'

export interface CopyAccessProps {
  target: Snapshot
  operatorId: number
  disabled: boolean
  onStage: (patches: Patch[]) => void
}

export function CopyAccess(props: CopyAccessProps) {
  const { t } = useTranslation()
  if (
    props.disabled ||
    props.target.subject.user_id === props.operatorId ||
    props.target.subject.role === 'admin' ||
    props.target.subject.status !== 'active'
  ) {
    return (
      <p className="border-t border-border py-4 text-sm text-muted-foreground">
        {t('access.studio.copy.unavailable')}
      </p>
    )
  }
  return (
    <CopyAccessPicker
      key={`${props.target.subject.user_id}:${props.operatorId}`}
      {...props}
    />
  )
}

function CopyAccessPicker({
  target,
  operatorId,
  disabled,
  onStage,
}: CopyAccessProps) {
  const { t, i18n } = useTranslation()
  const id = useId()
  const [sourceId, setSourceId] = useState<number>()
  const users = useQuery({
    queryKey: ['auth-users', operatorId],
    queryFn: api.listAuthUsers,
  })
  const candidates =
    users.data?.filter((user) => user.id !== target.subject.user_id) ?? []
  const selected = candidates.find((user) => user.id === sourceId)

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="min-w-0 border-t border-border py-5"
    >
      <h3 id={`${id}-heading`} className="font-semibold">
        {t('access.studio.copy.title')}
      </h3>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        {t('access.studio.copy.help')}
      </p>
      {users.isPending && (
        <p role="status" className="mt-4 text-sm text-muted-foreground">
          {t('access.studio.copy.loadingAccounts')}
        </p>
      )}
      {users.isError && (
        <div role="alert" className="mt-4 space-y-2 text-sm">
          <p className="break-words text-accent">
            {apiErrorMessage(users.error)}
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px]"
            disabled={users.isFetching}
            onClick={() => {
              void users.refetch()
            }}
          >
            {t('access.studio.copy.retry')}
          </Button>
        </div>
      )}
      {users.isSuccess && (
        <>
          <label
            htmlFor={`${id}-source`}
            className="mt-4 block text-sm font-medium"
          >
            {t('access.studio.copy.source')}
          </label>
          <select
            id={`${id}-source`}
            value={selected?.id ?? ''}
            disabled={disabled || users.isFetching}
            dir="auto"
            className="mt-1 min-h-[44px] w-full min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
            onChange={(event) => {
              const user = candidates.find(
                (candidate) => String(candidate.id) === event.target.value,
              )
              setSourceId(user?.id)
            }}
          >
            <option value="">{t('access.studio.copy.chooseSource')}</option>
            {candidates.map((user) => {
              const nameAr =
                'name_ar' in user && typeof user.name_ar === 'string'
                  ? user.name_ar
                  : undefined
              const name =
                (i18n.language.startsWith('ar') ? nameAr : user.name_en) ||
                user.display_name ||
                user.name_en ||
                user.email
              return (
                <option key={user.id} value={user.id}>
                  {name} · {`\u2066${user.email}\u2069`} ·{' '}
                  {`\u2066${user.employee_id || user.id}\u2069`}
                </option>
              )
            })}
          </select>
          {candidates.length === 0 && (
            <p className="mt-2 text-sm text-muted-foreground">
              {t('access.studio.copy.noSources')}
            </p>
          )}
          {selected && (
            <CopySource
              key={`${selected.id}:${target.revision}`}
              sourceId={selected.id}
              target={target}
              disabled={disabled || users.isFetching}
              onStage={onStage}
            />
          )}
        </>
      )}
    </section>
  )
}

function CopySource({
  sourceId,
  target,
  disabled,
  onStage,
}: {
  sourceId: number
  target: Snapshot
  disabled: boolean
  onStage: (patches: Patch[]) => void
}) {
  const { t } = useTranslation()
  const sourceQuery = useAccessSnapshot(sourceId)
  const [reviewed, setReviewed] = useState<string>()
  const [stale, setStale] = useState(false)
  const [staged, setStaged] = useState(false)
  const source =
    sourceQuery.data?.subject.user_id === sourceId
      ? sourceQuery.data
      : undefined
  const diff = source ? buildCopyPatch(source, target) : undefined
  const signature =
    source && diff
      ? JSON.stringify([source.revision, target.revision, diff])
      : undefined
  const canStage =
    source &&
    diff &&
    diff.patches.length > 0 &&
    diff.patches.length <= 200 &&
    reviewed === signature &&
    !sourceQuery.isFetching &&
    !sourceQuery.isError &&
    !disabled &&
    !staged

  function stage() {
    if (!canStage || !source || !diff) return
    const currentDiff = buildCopyPatch(source, target)
    const sourceExpired =
      source.valid_until !== null &&
      Date.parse(source.valid_until) <= Date.now()
    const targetExpired =
      target.valid_until !== null &&
      Date.parse(target.valid_until) <= Date.now()
    if (
      sourceExpired ||
      targetExpired ||
      JSON.stringify([source.revision, target.revision, currentDiff]) !==
        reviewed
    ) {
      setStale(true)
      setReviewed(undefined)
      return
    }
    onStage(currentDiff.patches)
    setStaged(true)
  }

  return (
    <div className="mt-4 min-w-0 space-y-4" aria-busy={sourceQuery.isFetching}>
      {sourceQuery.isPending && (
        <p role="status" className="text-sm text-muted-foreground">
          {t('access.studio.copy.loadingSource')}
        </p>
      )}
      {sourceQuery.isError && (
        <div role="alert" className="space-y-2 text-sm">
          <p className="break-words text-accent">
            {apiErrorMessage(sourceQuery.error)}
          </p>
          <Button
            type="button"
            variant="outline"
            className="min-h-[44px]"
            disabled={sourceQuery.isFetching}
            onClick={() => {
              void sourceQuery.refetch()
            }}
          >
            {t('access.studio.copy.retry')}
          </Button>
        </div>
      )}
      {source && diff && (
        <>
          {source.subject.role !== target.subject.role && (
            <p className="max-w-prose text-sm text-warning">
              {t('access.studio.copy.roleMismatch', {
                sourceRole: t(`access.roleName.${source.subject.role}`),
                targetRole: t(`access.roleName.${target.subject.role}`),
              })}
            </p>
          )}
          <p className="max-w-prose text-sm text-muted-foreground">
            {t('access.studio.copy.replacement')}
          </p>
          {diff.patches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t('access.studio.copy.noChanges')}
            </p>
          ) : (
            <ul
              aria-label={t('access.studio.copy.exactChanges')}
              className="divide-y divide-border"
            >
              {diff.patches.map((patch: Patch) => {
                const before = savedSetting(target, patch.capability)
                return (
                  <li key={patch.capability} className="min-w-0 py-3 text-sm">
                    <p className="break-all font-mono">
                      <bdi dir="ltr">{patch.capability}</bdi>
                    </p>
                    <dl className="mt-2 grid min-w-0 gap-3 sm:grid-cols-2">
                      {[
                        { label: 'before', value: before },
                        { label: 'after', value: patch },
                      ].map(
                        ({ label, value }: { label: string; value: Patch }) => (
                          <div key={label} className="min-w-0">
                            <dt className="text-muted-foreground">
                              {t(`access.studio.review.${label}`)}
                            </dt>
                            <dd className="mt-1">
                              {t(
                                value.effect === 'grant'
                                  ? 'access.studio.review.allow'
                                  : value.effect === 'deny'
                                    ? 'access.studio.review.deny'
                                    : 'access.studio.review.followRole',
                              )}
                            </dd>
                            <dd className="mt-1 break-words text-muted-foreground">
                              {t('access.studio.review.expiry')}:{' '}
                              {value.expires_at ? (
                                <time
                                  dateTime={value.expires_at}
                                  dir="ltr"
                                  className="break-all font-mono tabular-nums"
                                >
                                  {value.expires_at}
                                </time>
                              ) : (
                                t('access.studio.review.noExpiry')
                              )}
                            </dd>
                          </div>
                        ),
                      )}
                    </dl>
                  </li>
                )
              })}
            </ul>
          )}
          {diff.exclusions.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold">
                {t('access.studio.copy.exclusions')}
              </h4>
              <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                {t('access.studio.copy.exclusionsHelp')}
              </p>
              <ul className="mt-2 space-y-2 text-sm">
                {diff.exclusions.map((entry) => (
                  <li key={entry.capability} className="break-words">
                    <bdi dir="ltr" className="break-all font-mono">
                      {entry.capability}
                    </bdi>{' '}
                    — {t(`access.studio.copy.exclusion.${entry.reason}`)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {diff.patches.length > 200 && (
            <p role="alert" className="text-sm text-accent">
              {t('access.studio.copy.tooMany')}
            </p>
          )}
          {stale && (
            <div role="alert" className="space-y-2 text-sm">
              <p className="text-warning">{t('access.studio.copy.stale')}</p>
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px]"
                disabled={sourceQuery.isFetching}
                onClick={() => {
                  void sourceQuery.refetch()
                }}
              >
                {t('access.studio.copy.retry')}
              </Button>
            </div>
          )}
          {diff.patches.length > 0 && diff.patches.length <= 200 && (
            <>
              <label className="flex min-h-[44px] min-w-0 cursor-pointer items-start gap-3 py-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1 size-5 shrink-0 accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={
                    disabled ||
                    sourceQuery.isFetching ||
                    sourceQuery.isError ||
                    staged
                  }
                  checked={reviewed === signature}
                  onChange={(event) => {
                    setReviewed(event.target.checked ? signature : undefined)
                    setStale(false)
                  }}
                />
                <span className="min-w-0 break-words">
                  {t('access.studio.copy.confirm')}
                </span>
              </label>
              <Button
                type="button"
                variant="outline"
                className="min-h-[44px] max-w-full whitespace-normal"
                disabled={!canStage}
                onClick={stage}
              >
                {t('access.studio.copy.stage')}
              </Button>
            </>
          )}
          {staged && (
            <p
              role="status"
              className="max-w-prose text-sm text-muted-foreground"
            >
              {t('access.studio.copy.staged')}
            </p>
          )}
        </>
      )}
    </div>
  )
}
