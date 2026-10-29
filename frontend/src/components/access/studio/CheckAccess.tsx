import { useId, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { apiErrorMessage } from '@/lib/api'
import { useCheckAccess } from '@/lib/permissionStudioApi'
import { AccessWarnings, DecisionOutcome, WhyAccess } from './WhyAccess'
import {
  destinationId,
  localized,
  type AccessItem,
  type Action,
  type CheckRequest,
  type CheckResponse,
  type Patch,
  type Resource,
  type Snapshot,
} from './studioModel'

export interface CheckAccessProps {
  subjectId: number
  snapshot: Snapshot
  patches: Patch[]
  initialResource?: Resource
  initialAction?: Action
  disabled?: boolean
}

const RESOURCE_KINDS: Resource['kind'][] = [
  'capability',
  'service',
  'book',
  'notification_template',
  'email_template',
  'word_template',
  'editor_template',
]
const ACTIONS: Action[] = [
  'view',
  'create',
  'read',
  'edit',
  'reset',
  'delete',
  'send',
  'manage',
]
const SELECT_CLASS =
  'min-h-[44px] w-full min-w-0 rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

export function CheckAccess(props: CheckAccessProps) {
  return (
    <CheckAccessForm
      key={`${props.subjectId}:${JSON.stringify(props.initialResource)}:${props.initialAction ?? ''}`}
      {...props}
    />
  )
}

function CheckAccessForm({
  subjectId,
  snapshot,
  patches,
  initialResource,
  initialAction,
  disabled = false,
}: CheckAccessProps) {
  const { t, i18n } = useTranslation()
  const id = useId()
  const check = useCheckAccess(subjectId)
  const [kind, setKind] = useState<Resource['kind']>(
    initialResource?.kind ?? 'capability',
  )
  const [resourceId, setResourceId] = useState(initialResource?.id ?? '')
  const [revisionId, setRevisionId] = useState(
    initialResource?.revision_id?.toString() ?? '',
  )
  const [action, setAction] = useState<Action>(initialAction ?? 'view')
  const [categoryId, setCategoryId] = useState('')
  const [classificationId, setClassificationId] = useState('')
  const [grade, setGrade] = useState('')
  const [result, setResult] = useState<{
    signature: string
    response: CheckResponse
  }>()
  const [failure, setFailure] = useState<{
    signature: string
    message: string
  }>()
  const signature = JSON.stringify([
    subjectId,
    snapshot.revision,
    patches,
    kind,
    resourceId,
    revisionId,
    action,
    categoryId,
    classificationId,
    grade,
  ])
  const response =
    result?.signature === signature &&
    result.response.snapshot.subject.user_id === subjectId
      ? result.response
      : undefined
  const error = failure?.signature === signature ? failure.message : undefined
  const wrongSubject = snapshot.subject.user_id !== subjectId

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled || wrongSubject || check.isPending || !resourceId.trim())
      return
    const request: CheckRequest = {
      resource: {
        kind,
        id: resourceId.trim(),
        ...(revisionId ? { revision_id: Number(revisionId) } : {}),
      },
      action,
      context: {
        ...(categoryId ? { category_id: Number(categoryId) } : {}),
        ...(classificationId
          ? { classification_id: Number(classificationId) }
          : {}),
        ...(grade.trim() ? { grade: grade.trim() } : {}),
      },
      proposed: patches,
      expected_revision: snapshot.revision,
    }
    setResult(undefined)
    setFailure(undefined)
    check.mutate(request, {
      onSuccess: (data: CheckResponse) =>
        setResult({ signature, response: data }),
      onError: (cause: Error) =>
        setFailure({ signature, message: apiErrorMessage(cause) }),
    })
  }

  return (
    <section
      aria-labelledby={`${id}-heading`}
      className="min-w-0 border-t border-border py-5"
    >
      <h3 id={`${id}-heading`} className="font-semibold">
        {t('access.studio.check.title')}
      </h3>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        {t('access.studio.check.help')}
      </p>
      <form
        onSubmit={submit}
        className="mt-4 space-y-4"
        aria-busy={check.isPending}
      >
        <fieldset
          disabled={disabled || wrongSubject || check.isPending}
          className="grid min-w-0 gap-4 sm:grid-cols-2"
        >
          <legend className="sr-only">
            {t('access.studio.check.resource')}
          </legend>
          <label htmlFor={`${id}-kind`} className="min-w-0 space-y-1 text-sm">
            <span>{t('access.studio.check.kind')}</span>
            <select
              id={`${id}-kind`}
              value={kind}
              className={SELECT_CLASS}
              onChange={(event) => {
                const value = RESOURCE_KINDS.find(
                  (candidate: Resource['kind']) =>
                    candidate === event.target.value,
                )
                if (value) setKind(value)
              }}
            >
              {RESOURCE_KINDS.map((value: Resource['kind']) => (
                <option key={value} value={value}>
                  {t(`access.studio.resourceKind.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label
            htmlFor={`${id}-resource`}
            className="min-w-0 space-y-1 text-sm"
          >
            <span>{t('access.studio.check.resourceId')}</span>
            <Input
              id={`${id}-resource`}
              className="min-h-[44px]"
              dir="auto"
              required
              value={resourceId}
              onChange={(event) => setResourceId(event.target.value)}
            />
          </label>
          <label htmlFor={`${id}-action`} className="min-w-0 space-y-1 text-sm">
            <span>{t('access.studio.check.action')}</span>
            <select
              id={`${id}-action`}
              value={action}
              className={SELECT_CLASS}
              onChange={(event) => {
                const value = ACTIONS.find(
                  (candidate: Action) => candidate === event.target.value,
                )
                if (value) setAction(value)
              }}
            >
              {ACTIONS.map((value: Action) => (
                <option key={value} value={value}>
                  {t(`access.studio.actions.${value}`)}
                </option>
              ))}
            </select>
          </label>
          <label
            htmlFor={`${id}-revision`}
            className="min-w-0 space-y-1 text-sm"
          >
            <span>{t('access.studio.check.revisionId')}</span>
            <Input
              id={`${id}-revision`}
              className="min-h-[44px]"
              type="number"
              min={1}
              step={1}
              dir="ltr"
              value={revisionId}
              onChange={(event) => setRevisionId(event.target.value)}
            />
          </label>
        </fieldset>
        <fieldset
          disabled={disabled || wrongSubject || check.isPending}
          className="grid min-w-0 gap-4 sm:grid-cols-3"
        >
          <legend className="mb-2 text-sm font-medium">
            {t('access.studio.check.context')}
          </legend>
          <label
            htmlFor={`${id}-category`}
            className="min-w-0 space-y-1 text-sm"
          >
            <span>{t('access.studio.check.categoryId')}</span>
            <Input
              id={`${id}-category`}
              className="min-h-[44px]"
              type="number"
              min={1}
              step={1}
              dir="ltr"
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            />
          </label>
          <label
            htmlFor={`${id}-classification`}
            className="min-w-0 space-y-1 text-sm"
          >
            <span>{t('access.studio.check.classificationId')}</span>
            <Input
              id={`${id}-classification`}
              className="min-h-[44px]"
              type="number"
              min={1}
              step={1}
              dir="ltr"
              value={classificationId}
              onChange={(event) => setClassificationId(event.target.value)}
            />
          </label>
          <label htmlFor={`${id}-grade`} className="min-w-0 space-y-1 text-sm">
            <span>{t('access.studio.check.grade')}</span>
            <Input
              id={`${id}-grade`}
              className="min-h-[44px]"
              dir="auto"
              value={grade}
              onChange={(event) => setGrade(event.target.value)}
            />
          </label>
        </fieldset>
        <Button
          type="submit"
          className="min-h-[44px] max-w-full whitespace-normal"
          disabled={
            disabled || wrongSubject || check.isPending || !resourceId.trim()
          }
        >
          {t(
            check.isPending
              ? 'access.studio.check.checking'
              : 'access.studio.check.submit',
          )}
        </Button>
      </form>
      {error && (
        <p role="alert" className="mt-4 break-words text-sm text-accent">
          {error}
        </p>
      )}
      <div aria-live="polite" className="mt-4 min-w-0 space-y-4">
        {response && (
          <>
            <div className="grid min-w-0 gap-4 md:grid-cols-2">
              <div className="min-w-0">
                <h4 className="mb-2 text-sm font-semibold">
                  {t('access.studio.check.current')}
                </h4>
                <DecisionOutcome decision={response.current} />
                <WhyAccess
                  decision={response.current}
                  snapshot={response.snapshot}
                />
              </div>
              {response.proposed && (
                <div className="min-w-0">
                  <h4 className="mb-2 text-sm font-semibold">
                    {t('access.studio.check.proposed')}
                  </h4>
                  <DecisionOutcome decision={response.proposed} />
                  <WhyAccess
                    decision={response.proposed}
                    snapshot={response.snapshot}
                  />
                </div>
              )}
            </div>
            {response.impacts.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold">
                  {t('access.studio.check.impacts')}
                </h4>
                <ul className="mt-2 divide-y divide-border">
                  {response.impacts.map(
                    (impact: CheckResponse['impacts'][number]) => {
                      const item = response.snapshot.items.find(
                        (entry: AccessItem) =>
                          entry.resource.kind === impact.resource.kind &&
                          entry.resource.id === impact.resource.id,
                      )
                      return (
                        <li
                          key={destinationId(impact.resource, impact.action)}
                          className="min-w-0 space-y-2 py-3"
                        >
                          <p className="break-words text-sm font-medium">
                            {item ? (
                              localized(item.label, i18n.language)
                            ) : (
                              <bdi>{impact.resource.id}</bdi>
                            )}{' '}
                            · {t(`access.studio.actions.${impact.action}`)}
                          </p>
                          <DecisionOutcome decision={impact.after} />
                          <AccessWarnings warnings={impact.after.warnings} />
                          <WhyAccess
                            decision={impact.after}
                            snapshot={response.snapshot}
                          />
                        </li>
                      )
                    },
                  )}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
