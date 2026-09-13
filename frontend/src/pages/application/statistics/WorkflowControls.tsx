import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import type { InmateRegisterMonth, InmateWorkflowActor } from '@/lib/api'
import { formatRegisterDateTime, formatRegisterMonth } from './registerModel'
import type { UseInmateRegister } from './useInmateRegister'

interface Props {
  month: InmateRegisterMonth
  register: UseInmateRegister
  onCorrectEntry: (id: string) => void
}

/** Eligible next actors come from the server; assignment grants nothing. */
function PersonPicker({
  id,
  stage,
  value,
  people,
  loading,
  disabled,
  onChange,
}: {
  id: string
  stage: 'reviewer' | 'manager'
  value: string
  people: readonly { user_id: number; name_ar: string; employee_id: string }[]
  loading: boolean
  disabled: boolean
  onChange: (value: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="min-w-0 space-y-1.5">
      <Label htmlFor={id}>{t(`inmateStats.workflow.select.${stage}`)}</Label>
      <Select value={value} onValueChange={onChange} disabled={disabled || loading}>
        <SelectTrigger id={id} className="h-auto min-h-10 text-start">
          <SelectValue placeholder={t('inmateStats.workflow.choosePerson')} />
        </SelectTrigger>
        <SelectContent>
          {people.map((person) => (
            <SelectItem key={person.user_id} value={String(person.user_id)}>
              <bdi>{person.name_ar}</bdi>
              {' · '}
              <bdi dir="ltr">{person.employee_id}</bdi>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {!loading && people.length === 0 ? (
        <p className="text-sm text-warning">{t('inmateStats.workflow.noCandidates')}</p>
      ) : null}
    </div>
  )
}

export function WorkflowControls({ month, register, onCorrectEntry }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const [reviewer, setReviewer] = useState('')
  const [manager, setManager] = useState('')
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState<'approve' | 'reopen' | null>(null)
  const workflow = month.workflow
  const allowed = workflow.allowed_actions
  const busy = register.isWriting
  const canPrepare = allowed.includes('prepare')
  const canReview = allowed.includes('review')
  const monthLabel = formatRegisterMonth(month.year, month.month, i18n.language)

  const actor = (facts: InmateWorkflowActor | null): React.JSX.Element =>
    facts ? (
      <div className="mt-1 space-y-1 text-sm">
        <p className="break-words">
          <bdi>{facts.name_ar}</bdi>
        </p>
        <p>
          <bdi dir="ltr" className="font-mono">
            {facts.employee_id}
          </bdi>
        </p>
        <p className="text-xs text-muted-foreground">
          <bdi dir="ltr">{formatRegisterDateTime(facts.acted_at, i18n.language)}</bdi>
        </p>
      </div>
    ) : (
      <p className="mt-1 text-sm text-muted-foreground">
        {t('inmateStats.workflow.notPerformed')}
      </p>
    )

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="space-y-4 rounded-xl border border-hairline bg-surface p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-title`} className="font-semibold">
          {t('inmateStats.workflow.title')}
        </h3>
        <p role="status" className="text-sm font-medium">
          {t(`inmateStats.workflow.states.${workflow.state}`)}
        </p>
      </div>

      <ol className="grid gap-4 sm:grid-cols-3">
        {(['prepared', 'reviewed', 'approved'] as const).map((stage, index) => (
          <li key={stage} className="min-w-0">
            <h4 className="text-sm font-semibold">
              {index + 1}. {t(`inmateStats.workflow.stages.${stage}`)}
            </h4>
            {actor(workflow[stage])}
          </li>
        ))}
      </ol>

      {workflow.last_event ? (
        <p className="rounded-lg bg-warning-soft p-3 text-sm text-warning">
          {t(`inmateStats.workflow.events.${workflow.last_event.action}`)}
          {workflow.last_event.name_ar ? (
            <>
              {' · '}
              <bdi>{workflow.last_event.name_ar}</bdi>
            </>
          ) : null}
          {' · '}
          <bdi dir="ltr">
            {formatRegisterDateTime(workflow.last_event.acted_at, i18n.language)}
          </bdi>
          {workflow.last_event.reason ? (
            <span dir="auto" className="mt-1 block whitespace-pre-wrap">
              {workflow.last_event.reason}
            </span>
          ) : null}
        </p>
      ) : null}

      {workflow.reviewer || workflow.manager ? (
        <dl className="grid gap-3 border-t border-hairline pt-3 text-sm sm:grid-cols-2">
          {(['reviewer', 'manager'] as const).map((stage) => {
            const assignment = workflow[stage]
            return assignment ? (
              <div key={stage} className="min-w-0">
                <dt className="text-muted-foreground">
                  {t(`inmateStats.workflow.selected.${stage}`)}
                </dt>
                <dd className="break-words">
                  <bdi>{assignment.name_ar ?? t('inmateStats.workflow.unavailablePerson')}</bdi>
                  {' · '}
                  <bdi dir="ltr">{assignment.employee_id}</bdi>
                </dd>
                {!assignment.eligible ? (
                  <dd className="text-warning">{t('inmateStats.workflow.assigneeUnavailable')}</dd>
                ) : null}
              </div>
            ) : null
          })}
        </dl>
      ) : null}

      {workflow.blockers.length > 0 ? (
        <ul className="space-y-2 rounded-lg bg-warning-soft p-3 text-sm">
          {workflow.blockers.map((blocker, index) => (
            <li key={`${blocker.code}-${index}`}>
              {t(`inmateStats.workflow.errors.${blocker.code}`)}
            </li>
          ))}
        </ul>
      ) : null}

      {!month.closed && month.blocking.length > 0 ? (
        <ul className="space-y-2">
          {month.blocking.map((entry) => (
            <li key={entry.id}>
              <button
                type="button"
                className="text-start text-sm text-primary underline-offset-4 hover:underline"
                onClick={() => onCorrectEntry(entry.id)}
              >
                <bdi>{entry.name}</bdi>
                {' — '}
                {entry.missing.map((field) => t(`inmateStats.missing.${field}`)).join(' · ')}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {register.mutationError ? (
        <p role="alert" className="text-sm text-accent">{register.mutationError}</p>
      ) : null}
      {register.candidatesError ? (
        <div role="alert" className="text-sm text-accent">
          {t('inmateStats.workflow.candidatesError')}{' '}
          <Button type="button" variant="link" onClick={register.retryCandidates}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      {canPrepare || canReview ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {canPrepare ? (
            <PersonPicker
              id={`${id}-reviewer`}
              stage="reviewer"
              value={reviewer}
              people={register.reviewers}
              loading={register.candidatesLoading || Boolean(register.candidatesError)}
              disabled={busy}
              onChange={setReviewer}
            />
          ) : null}
          {canReview ? (
            <PersonPicker
              id={`${id}-manager`}
              stage="manager"
              value={manager}
              people={register.managers}
              loading={register.candidatesLoading || Boolean(register.candidatesError)}
              disabled={busy}
              onChange={setManager}
            />
          ) : null}
        </div>
      ) : null}

      {allowed.includes('return') || allowed.includes('reopen') ? (
        <div className="space-y-1.5">
          <Label htmlFor={`${id}-reason`}>{t('inmateStats.workflow.reason')}</Label>
          <Textarea
            id={`${id}-reason`}
            rows={3}
            maxLength={2000}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            dir="auto"
          />
          <p className="text-xs text-muted-foreground">{t('inmateStats.workflow.reasonHint')}</p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canPrepare ? (
          <Button
            type="button"
            className="h-auto min-h-10 whitespace-normal"
            disabled={
              busy || !register.reviewers.some((person) => String(person.user_id) === reviewer)
            }
            onClick={() =>
              register.prepareMonth({
                expected_version: workflow.version,
                expected_projection_fingerprint: month.projection_fingerprint,
                reviewer_user_id: Number(reviewer),
              })
            }
          >
            {t('inmateStats.workflow.prepare')}
          </Button>
        ) : null}
        {canReview ? (
          <Button
            type="button"
            className="h-auto min-h-10 whitespace-normal"
            disabled={
              busy || !register.managers.some((person) => String(person.user_id) === manager)
            }
            onClick={() =>
              register.reviewMonth({
                expected_version: workflow.version,
                manager_user_id: Number(manager),
              })
            }
          >
            {t('inmateStats.workflow.review')}
          </Button>
        ) : null}
        {allowed.includes('approve') ? (
          <Button
            type="button"
            className="h-auto min-h-10 whitespace-normal"
            disabled={busy}
            onClick={() => setConfirmation('approve')}
          >
            {t('inmateStats.workflow.approve')}
          </Button>
        ) : null}
        {allowed.includes('return') ? (
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-10 whitespace-normal"
            disabled={busy || !reason.trim()}
            onClick={() =>
              register.returnMonth({
                expected_version: workflow.version,
                reason: reason.trim(),
              })
            }
          >
            {t('inmateStats.workflow.return')}
          </Button>
        ) : null}
        {allowed.includes('reopen') ? (
          <Button
            type="button"
            variant="outline"
            className="h-auto min-h-10 whitespace-normal"
            disabled={busy || !reason.trim()}
            onClick={() => setConfirmation('reopen')}
          >
            {t('inmateStats.actions.reopen')}
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmation(null)
        }}
        title={t(`inmateStats.workflow.${confirmation ?? 'approve'}Title`, { month: monthLabel })}
        description={t(`inmateStats.workflow.${confirmation ?? 'approve'}Hint`, { month: monthLabel })}
        confirmLabel={t(
          confirmation === 'reopen'
            ? 'inmateStats.actions.reopen'
            : 'inmateStats.workflow.approve',
        )}
        onConfirm={() => {
          if (busy) return
          if (confirmation === 'approve' && allowed.includes('approve')) {
            register.approveMonth({ expected_version: workflow.version })
          }
          if (confirmation === 'reopen' && allowed.includes('reopen') && reason.trim()) {
            register.reopenMonth({ expected_version: workflow.version, reason: reason.trim() })
          }
        }}
      />
    </section>
  )
}
