import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { AccessWarnings, DecisionOutcome, WhyAccess } from './WhyAccess'
import {
  destinationId,
  localized,
  savedSetting,
  type AccessItem,
  type Decision,
  type Patch,
  type PreviewResponse,
  type Snapshot,
} from './studioModel'

export interface ChangeReviewProps {
  snapshot: Snapshot
  patches: Patch[]
  preview: PreviewResponse | undefined
  busy: boolean
  onReview: () => void
  onAcknowledge: () => void
  acknowledged: boolean
}

export function ChangeReview({
  snapshot,
  patches,
  preview,
  busy,
  onReview,
  onAcknowledge,
  acknowledged,
}: ChangeReviewProps) {
  const { t, i18n } = useTranslation()
  const id = useId()
  const validPreview =
    preview?.current.subject.user_id === snapshot.subject.user_id &&
    preview.proposed.subject.user_id === snapshot.subject.user_id &&
    preview.current.revision === snapshot.revision
      ? preview
      : undefined
  const hasErrors =
    validPreview?.validation.some(
      (issue: PreviewResponse['validation'][number]) =>
        issue.severity === 'error',
    ) ?? false
  const changedCapabilities = new Set<string>(
    patches.map((patch: Patch) => patch.capability),
  )
  const affectedItems: AccessItem[] =
    validPreview?.proposed.items.filter(
      (item: AccessItem) =>
        item.actions.some((decision: Decision) =>
          decision.setting_capabilities.some((capability: string) =>
            changedCapabilities.has(capability),
          ),
        ) ||
        validPreview?.impacts.some(
          (impact: PreviewResponse['impacts'][number]) =>
            impact.resource.kind === item.resource.kind &&
            impact.resource.id === item.resource.id,
        ),
    ) ?? []

  return (
    <section
      data-change-review
      tabIndex={-1}
      aria-labelledby={`${id}-heading`}
      aria-busy={busy}
      className="min-w-0 border-t border-border py-5 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <h3 id={`${id}-heading`} className="font-semibold">
        {t('access.studio.review.title')}
      </h3>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        {t('access.studio.review.help')}
      </p>
      {patches.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          {t('access.studio.review.empty')}
        </p>
      ) : (
        <>
          <ul
            aria-label={t('access.studio.review.exactChanges')}
            className="mt-4 divide-y divide-border"
          >
            {patches.map((patch) => {
              const before = savedSetting(snapshot, patch.capability)
              const previous = snapshot.overrides.find(
                (override: Snapshot['overrides'][number]) =>
                  override.capability === patch.capability,
              )
              return (
                <li key={patch.capability} className="min-w-0 py-3">
                  <p className="break-all font-mono text-sm">
                    <bdi dir="ltr">{patch.capability}</bdi>
                  </p>
                  <dl className="mt-2 grid min-w-0 gap-3 text-sm sm:grid-cols-2">
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">
                        {t('access.studio.review.before')}
                      </dt>
                      <dd className="mt-1">
                        {t(
                          before.effect === 'grant'
                            ? 'access.studio.review.allow'
                            : before.effect === 'deny'
                              ? 'access.studio.review.deny'
                              : 'access.studio.review.followRole',
                        )}
                      </dd>
                      <dd className="mt-1 break-words text-muted-foreground">
                        {t('access.studio.review.expiry')}:{' '}
                        {before.expires_at ? (
                          <time
                            dateTime={before.expires_at}
                            dir="ltr"
                            className="break-all font-mono tabular-nums"
                          >
                            {before.expires_at}
                          </time>
                        ) : (
                          t('access.studio.review.noExpiry')
                        )}
                      </dd>
                      {previous?.state === 'expired' && (
                        <dd className="mt-1 text-warning">
                          {t('access.studio.review.expired')}
                        </dd>
                      )}
                    </div>
                    <div className="min-w-0">
                      <dt className="text-muted-foreground">
                        {t('access.studio.review.after')}
                      </dt>
                      <dd className="mt-1">
                        {t(
                          patch.effect === 'grant'
                            ? 'access.studio.review.allow'
                            : patch.effect === 'deny'
                              ? 'access.studio.review.deny'
                              : 'access.studio.review.followRole',
                        )}
                      </dd>
                      <dd className="mt-1 break-words text-muted-foreground">
                        {t('access.studio.review.expiry')}:{' '}
                        {patch.expires_at ? (
                          <time
                            dateTime={patch.expires_at}
                            dir="ltr"
                            className="break-all font-mono tabular-nums"
                          >
                            {patch.expires_at}
                          </time>
                        ) : (
                          t('access.studio.review.noExpiry')
                        )}
                      </dd>
                    </div>
                  </dl>
                </li>
              )
            })}
          </ul>
          <Button
            type="button"
            variant="outline"
            onClick={onReview}
            disabled={busy}
            className="mt-3 min-h-[44px] max-w-full whitespace-normal"
          >
            {t(
              busy
                ? 'access.studio.review.reviewing'
                : 'access.studio.review.refresh',
            )}
          </Button>
          {!validPreview && (
            <p role="status" className="mt-3 text-sm text-muted-foreground">
              {t('access.studio.review.required')}
            </p>
          )}
          {validPreview && (
            <div className="mt-5 min-w-0 space-y-5">
              <div>
                <h4 className="mb-2 text-sm font-semibold">
                  {t('access.studio.review.validation')}
                </h4>
                {validPreview.validation.length ? (
                  <AccessWarnings warnings={validPreview.validation} />
                ) : (
                  <p className="text-sm text-muted-foreground">
                    {t('access.studio.review.noValidation')}
                  </p>
                )}
              </div>
              <div>
                <h4 className="text-sm font-semibold">
                  {t('access.studio.review.impacts')}
                </h4>
                <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                  {t('access.studio.review.impactHelp')}
                </p>
                {validPreview.impacts.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">
                    {t('access.studio.review.noImpacts')}
                  </p>
                ) : (
                  <ul className="mt-2 divide-y divide-border">
                    {validPreview.impacts.map(
                      (impact: PreviewResponse['impacts'][number]) => {
                        const item = validPreview.proposed.items.find(
                          (entry: AccessItem) =>
                            entry.resource.kind === impact.resource.kind &&
                            entry.resource.id === impact.resource.id,
                        )
                        return (
                          <li
                            key={destinationId(impact.resource, impact.action)}
                            className="min-w-0 py-4"
                          >
                            <h5 className="break-words text-sm font-medium">
                              {item ? (
                                localized(item.label, i18n.language)
                              ) : (
                                <bdi>{impact.resource.id}</bdi>
                              )}{' '}
                              · {t(`access.studio.actions.${impact.action}`)}
                            </h5>
                            <p className="mt-1 break-all font-mono text-xs">
                              <bdi dir="ltr">
                                {destinationId(impact.resource, impact.action)}
                              </bdi>
                            </p>
                            {impact.before.executable_now === true &&
                              impact.after.executable_now === false && (
                                <p className="mt-2 text-sm text-warning">
                                  {t('access.studio.review.newlyBlocked')}
                                </p>
                              )}
                            <div className="mt-3 grid min-w-0 gap-4 md:grid-cols-2">
                              <div className="min-w-0 space-y-2">
                                <p className="text-sm text-muted-foreground">
                                  {t('access.studio.review.before')}
                                </p>
                                <DecisionOutcome decision={impact.before} resource={impact.resource} />
                                <WhyAccess
                                  decision={impact.before}
                                  snapshot={validPreview.current}
                                  resource={impact.resource}
                                />
                              </div>
                              <div className="min-w-0 space-y-2">
                                <p className="text-sm text-muted-foreground">
                                  {t('access.studio.review.after')}
                                </p>
                                <DecisionOutcome decision={impact.after} resource={impact.resource} />
                                <AccessWarnings
                                  warnings={impact.after.warnings}
                                />
                                <WhyAccess
                                  decision={impact.after}
                                  snapshot={validPreview.proposed}
                                  resource={impact.resource}
                                />
                              </div>
                            </div>
                          </li>
                        )
                      },
                    )}
                  </ul>
                )}
              </div>
              {affectedItems.some((item: AccessItem) =>
                item.actions.some(
                  (decision: Decision) => decision.authorization === 'allowed',
                ),
              ) && (
                <div>
                  <h4 className="text-sm font-semibold">
                    {t('access.studio.review.residual')}
                  </h4>
                  <p className="mt-1 max-w-prose text-sm text-muted-foreground">
                    {t('access.studio.review.residualHelp')}
                  </p>
                  <ul className="mt-2 space-y-2 text-sm">
                    {affectedItems.flatMap((item: AccessItem) =>
                      item.actions
                        .filter(
                          (decision: Decision) =>
                            decision.authorization === 'allowed',
                        )
                        .map((decision: Decision) => (
                          <li
                            key={destinationId(item.resource, decision.action)}
                            className="min-w-0 break-words"
                          >
                            <p>
                              {localized(item.label, i18n.language)} ·{' '}
                              {t(`access.studio.actions.${decision.action}`)}
                            </p>
                            <DecisionOutcome decision={decision} resource={item.resource} />
                            <WhyAccess
                              decision={decision}
                              snapshot={validPreview.proposed}
                              resource={item.resource}
                            />
                          </li>
                        )),
                    )}
                  </ul>
                </div>
              )}
              {hasErrors ? (
                <p role="alert" className="text-sm text-accent">
                  {t('access.studio.review.blocked')}
                </p>
              ) : (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-[44px] max-w-full whitespace-normal"
                    disabled={busy || acknowledged}
                    onClick={onAcknowledge}
                  >
                    {t(
                      acknowledged
                        ? 'access.studio.review.acknowledged'
                        : 'access.studio.review.acknowledge',
                    )}
                  </Button>
                  {acknowledged && (
                    <p role="status" className="text-sm text-muted-foreground">
                      {t('access.studio.review.ready')}
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </section>
  )
}
