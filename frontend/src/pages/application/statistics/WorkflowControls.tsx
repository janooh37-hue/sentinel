import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { InmateRegisterMonth, InmateWorkflowActor } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatRegisterDate, formatRegisterDateTime, formatRegisterMonth } from './registerModel'
import type { UseInmateRegister } from './useInmateRegister'

interface Props {
  month: InmateRegisterMonth
  register: UseInmateRegister
  viewedSubmissionId: number | null
  viewedDraftFingerprint: string | null
  onOpenReport: (id: number | null) => void
  onCorrectEntry: (id: string) => void
}

export function WorkflowControls({ month, register, viewedSubmissionId, viewedDraftFingerprint, onOpenReport, onCorrectEntry }: Props): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const id = useId()
  const [reviewer, setReviewer] = useState('')
  const [manager, setManager] = useState('')
  const [reason, setReason] = useState('')
  const [confirmation, setConfirmation] = useState<'approve' | 'reopen' | null>(null)
  const workflow = month.workflow
  const allowed = workflow.allowed_actions
  const active = workflow.active_submission_id
  const reviewedReport = active !== null && viewedSubmissionId === active &&
    register.selectedReport?.submission_id === active && !register.selectedReport.stale &&
    register.selectedReport.current && !register.reportLoading && !register.reportError
  const replacing = active !== null && workflow.state !== 'draft' && !workflow.needs_review
  const monthLabel = formatRegisterMonth(month.year, month.month, i18n.language)
  const canPrepare = allowed.includes('prepare')
  const currentDraftVisible = viewedDraftFingerprint === month.projection_fingerprint
  const canReview = allowed.includes('review')
  const busy = register.isWriting
  const pickerStages: ('reviewer' | 'manager')[] = []
  if (canPrepare) pickerStages.push('reviewer')
  if (canReview) pickerStages.push('manager')
  const actor = (facts: InmateWorkflowActor | null): React.JSX.Element => facts ? (
    <div className="mt-1 space-y-1 text-sm">
      <p className="break-words" dir="auto">{facts.name_ar}</p>
      <p><bdi dir="ltr" className="font-mono">{facts.employee_id}</bdi></p>
      <p className="text-xs text-muted-foreground"><bdi dir="ltr">{formatRegisterDateTime(facts.acted_at, i18n.language)}</bdi></p>
    </div>
  ) : <p className="mt-1 text-sm text-muted-foreground">{t('inmateStats.workflow.notPerformed')}</p>

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-4 rounded-xl border border-hairline bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={`${id}-title`} className="font-semibold">{t('inmateStats.workflow.title')}</h3>
        <p role="status" className="text-sm font-medium">{t(`inmateStats.workflow.states.${workflow.state}`)}</p>
      </div>
      <ol className="grid gap-4 sm:grid-cols-3">
        {(['prepared', 'reviewed', 'approved'] as const).map((stage, index) => (
          <li key={stage} className="min-w-0">
            <h4 className="text-sm font-semibold">{index + 1}. {t(`inmateStats.workflow.stages.${stage}`)}</h4>
            {actor(workflow[stage])}
          </li>
        ))}
      </ol>
      {workflow.reviewer || workflow.manager ? (
        <dl className="grid gap-3 border-t border-hairline pt-3 text-sm sm:grid-cols-2">
          {(['reviewer', 'manager'] as const).map((stage) => {
            const assignment = workflow[stage]
            return assignment ? <div key={stage} className="min-w-0">
              <dt className="text-muted-foreground">{t(`inmateStats.workflow.selected.${stage}`)}</dt>
              <dd className="break-words"><bdi>{assignment.name_ar ?? t('inmateStats.workflow.unavailablePerson')}</bdi>{' · '}<bdi dir="ltr">{assignment.employee_id}</bdi></dd>
              {!assignment.eligible ? <dd className="text-warning">{t('inmateStats.workflow.assigneeUnavailable')}</dd> : null}
            </div> : null
          })}
        </dl>
      ) : null}
      {workflow.blockers.length ? <ul className="space-y-2 rounded-lg bg-warning-soft p-3 text-sm">
        {workflow.blockers.map((blocker) => <li key={blocker.code}>
          {t(`inmateStats.workflow.errors.${blocker.code}`)}
          {blocker.code === 'INMATE_REGISTER_MONTH_NOT_ENDED' ? <> <bdi dir="ltr">{formatRegisterDate(month.first_closable_date, i18n.language)}</bdi></> : null}
        </li>)}
      </ul> : null}
      {!month.closed && month.counts.total === 0 ? <p className="text-sm text-warning">{t('inmateStats.workflow.errors.INMATE_REGISTER_MONTH_EMPTY')}</p> : null}
      {!month.closed && month.blocking.length ? <ul className="space-y-2">
        {month.blocking.map((entry) => <li key={entry.id}>
          <button type="button" className="text-start text-sm text-primary underline-offset-4 hover:underline" onClick={() => onCorrectEntry(entry.id)}>
            <bdi>{entry.name}</bdi>{' — '}{entry.missing.map((field) => t(`inmateStats.missing.${field}`)).join(' · ')}
          </button>
        </li>)}
      </ul> : null}
      {register.mutationError ? <p role="alert" className="text-sm text-accent">{register.mutationError}</p> : null}
      {register.candidatesError ? <div role="alert" className="text-sm text-accent">
        {t('inmateStats.workflow.candidatesError')}{' '}<Button type="button" variant="link" onClick={register.refetch}>{t('common.retry')}</Button>
      </div> : null}
      {active !== null ? <Button type="button" variant="outline" className="h-auto min-h-10 whitespace-normal text-start" onClick={() => onOpenReport(active)}>
        {t('inmateStats.workflow.openReport')}
      </Button> : null}
      {canPrepare && !currentDraftVisible ? <Button type="button" variant="outline" className="h-auto min-h-10 whitespace-normal" onClick={() => onOpenReport(null)}>{t('inmateStats.workflow.openDraft')}</Button> : null}
      {pickerStages.length ? <div className="grid gap-3 sm:grid-cols-2">
        {pickerStages.map((stage) => {
          const candidates = stage === 'reviewer' ? register.reviewers : register.managers
          return <div key={stage} className="min-w-0 space-y-1.5">
            <Label htmlFor={`${id}-${stage}`}>{t(`inmateStats.workflow.select.${stage}`)}</Label>
            <Select value={stage === 'reviewer' ? reviewer : manager} onValueChange={stage === 'reviewer' ? setReviewer : setManager} disabled={busy || register.candidatesLoading}>
              <SelectTrigger id={`${id}-${stage}`} className="h-auto min-h-10 text-start"><SelectValue placeholder={t('inmateStats.workflow.choosePerson')} /></SelectTrigger>
              <SelectContent>{candidates.map((person) => <SelectItem key={person.user_id} value={String(person.user_id)}><bdi>{person.name_ar}</bdi>{' · '}<bdi dir="ltr">{person.employee_id}</bdi></SelectItem>)}</SelectContent>
            </Select>
            {!register.candidatesLoading && !register.candidatesError && candidates.length === 0 ? <p className="text-sm text-warning">{t('inmateStats.workflow.noCandidates')}</p> : null}
          </div>
        })}
      </div> : null}
      {(canPrepare && replacing) || allowed.includes('return') || allowed.includes('reopen') ? <div className="space-y-1.5">
        <Label htmlFor={`${id}-reason`}>{t('inmateStats.workflow.reason')}</Label>
        <Textarea id={`${id}-reason`} rows={3} maxLength={2000} value={reason} onChange={(event) => setReason(event.target.value)} dir="auto" />
        <p className="text-xs text-muted-foreground">{t('inmateStats.workflow.reasonHint')}</p>
      </div> : null}
      <div className="flex flex-wrap gap-2">
        {canPrepare ? <Button type="button" className="h-auto min-h-10 whitespace-normal" disabled={busy || !currentDraftVisible || !register.reviewers.some((person) => String(person.user_id) === reviewer) || (replacing && !reason.trim())}
          onClick={() => register.prepareMonth({ expected_version: workflow.version, expected_projection_fingerprint: viewedDraftFingerprint!, reviewer_user_id: Number(reviewer), ...(replacing ? { supersede_reason: reason.trim() } : {}) })}>{t('inmateStats.workflow.prepare')}</Button> : null}
        {canReview ? <Button type="button" className="h-auto min-h-10 whitespace-normal" disabled={busy || !reviewedReport || !register.managers.some((person) => String(person.user_id) === manager)}
          onClick={() => register.reviewMonth({ expected_version: workflow.version, submission_id: active!, manager_user_id: Number(manager) })}>{t('inmateStats.workflow.review')}</Button> : null}
        {allowed.includes('approve') ? <Button type="button" className="h-auto min-h-10 whitespace-normal" disabled={busy || !reviewedReport} onClick={() => setConfirmation('approve')}>{t('inmateStats.workflow.approve')}</Button> : null}
        {allowed.includes('return') ? <Button type="button" variant="outline" className="h-auto min-h-10 whitespace-normal" disabled={busy || !reason.trim() || active === null}
          onClick={() => register.returnMonth({ expected_version: workflow.version, submission_id: active!, reason: reason.trim() })}>{t('inmateStats.workflow.return')}</Button> : null}
        {allowed.includes('reopen') ? <Button type="button" variant="outline" className="h-auto min-h-10 whitespace-normal" disabled={busy || !reason.trim()} onClick={() => setConfirmation('reopen')}>{t('inmateStats.actions.reopen')}</Button> : null}
      </div>
      {(canReview || allowed.includes('approve')) && !reviewedReport ? <p className="text-sm text-muted-foreground">{t('inmateStats.workflow.openReportFirst')}</p> : null}
      <ConfirmDialog open={confirmation !== null} onOpenChange={(open) => { if (!open) setConfirmation(null) }}
        title={t(`inmateStats.workflow.${confirmation ?? 'approve'}Title`, { month: monthLabel })}
        description={t(`inmateStats.workflow.${confirmation ?? 'approve'}Hint`, { month: monthLabel })}
        confirmLabel={t(confirmation === 'reopen' ? 'inmateStats.actions.reopen' : 'inmateStats.workflow.approve')}
        onConfirm={() => {
          if (busy) return
          if (confirmation === 'approve' && allowed.includes('approve') && reviewedReport) register.approveMonth({ expected_version: workflow.version, submission_id: active! })
          if (confirmation === 'reopen' && allowed.includes('reopen') && reason.trim()) register.reopenMonth({ expected_version: workflow.version, reason: reason.trim() })
        }} />
    </section>
  )
}
