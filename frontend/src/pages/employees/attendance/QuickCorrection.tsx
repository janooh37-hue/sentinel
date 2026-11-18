import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { X } from 'lucide-react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { useBlocker } from 'react-router-dom'

import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { api, ApiError, apiErrorMessage } from '@/lib/api'
import type { AttendanceAdjustmentWrite, AttendanceCase } from '@/lib/api'
import { pickEmployeeName } from '@/lib/employeeName'
import { toast } from '@/lib/toast'
import { useCapabilities } from '@/lib/useCapabilities'
import { cn } from '@/lib/utils'
import { ATTENDANCE_CORRECT_CAP } from '@/lib/workforceAttendance'

import type { CorrectionDismissalGuard, CorrectionTarget } from './attendanceCorrectionContext'
import { invalidateAttendanceQueries, toLocalInput, utcDate } from './attendanceCorrectionForm'
import { shiftIsoDate } from './attendanceModel'
import {
  QUICK_CORRECTION_LEAVE_KINDS,
  QUICK_CORRECTION_REASONS,
  buildQuickCorrectionPayload,
  buildQuickCorrectionReason,
  quickCorrectionDraftFromCase,
  validateQuickCorrection,
  type QuickCorrectionAction,
  type QuickCorrectionDraft,
} from './quickCorrectionForm'

interface Props {
  target: CorrectionTarget | null
  anchor: HTMLElement | null
  onClose(): void
  onViewEvidence(caseId: number): void
  onDismissalGuardChange?(guard: CorrectionDismissalGuard | null): void
}

interface DraftState {
  draft: QuickCorrectionDraft
  initial: QuickCorrectionDraft
  etag: string
}

type Submission = { etag: string; payload: AttendanceAdjustmentWrite }
  | { etag: string; adjustmentId: number; reason: string }

const CONTROL = 'min-h-11 min-w-0 rounded-md border border-input bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
const BUTTON = 'min-h-11 rounded-md px-3 py-2 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'
const MOBILE_QUERY = '(max-width: 640px)'

/** The live region outlives the panel so saving is announced even as the panel closes. */
export function QuickCorrection(props: Props): React.JSX.Element | null {
  const { has } = useCapabilities()
  const [announcement, setAnnouncement] = useState('')
  if (!has(ATTENDANCE_CORRECT_CAP)) return null
  return (
    <>
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>
      {props.target !== null && (
        <QuickCorrectionPanel
          key={props.target.caseId}
          {...props}
          target={props.target}
          onSaved={setAnnouncement}
        />
      )}
    </>
  )
}

function QuickCorrectionPanel({ target, anchor, onClose, onViewEvidence, onDismissalGuardChange, onSaved }: Omit<Props, 'target'> & {
  target: CorrectionTarget
  onSaved(message: string): void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const direction = i18n.dir(i18n.language)
  const queryClient = useQueryClient()
  const [panel, setPanel] = useState<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const keepEditingRef = useRef<HTMLButtonElement>(null)
  const dismissOrigin = useRef<HTMLElement | null>(null)
  const movingToAnotherPanel = useRef(false)
  const [isMobile, setIsMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  const [position, setPosition] = useState<CSSProperties>({ insetInlineEnd: 24, insetBlockStart: 16, inlineSize: 412 })
  const [draftOverride, setDraftOverride] = useState<DraftState | null>(null)
  const [datesExpanded, setDatesExpanded] = useState(false)
  const [dismissal, setDismissal] = useState<{ proceed: () => void; cancel?: () => void } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [conflictWarning, setConflictWarning] = useState(false)
  const caseQuery = useQuery({
    queryKey: ['attendance-case', target.caseId],
    queryFn: () => api.getAttendanceCase(target.caseId),
    refetchOnWindowFocus: false,
  })
  const attendanceCase = caseQuery.data?.data
  const etag = caseQuery.data?.etag ?? ''
  const initial = attendanceCase ? quickCorrectionDraftFromCase(attendanceCase) : null
  const draftState = draftOverride ?? (initial === null ? null : { draft: initial, initial, etag })
  const draft = draftState?.draft ?? null
  const activeAdjustmentId = typeof attendanceCase?.effective?.adjustment_id === 'number'
    ? attendanceCase.effective.adjustment_id : null
  const validation = attendanceCase && draft ? validateQuickCorrection(attendanceCase, draft, new Date()) : null
  const dirty = draftState !== null && (
    draftState.draft.action !== draftState.initial.action
    || draftState.draft.inTime !== draftState.initial.inTime
    || draftState.draft.outTime !== draftState.initial.outTime
    || draftState.draft.inDate !== draftState.initial.inDate
    || draftState.draft.outDate !== draftState.initial.outDate
    || draftState.draft.inDateConfirmed !== draftState.initial.inDateConfirmed
    || draftState.draft.outDateConfirmed !== draftState.initial.outDateConfirmed
    || draftState.draft.leaveKind !== draftState.initial.leaveKind
    || draftState.draft.reason !== draftState.initial.reason
    || draftState.draft.details !== draftState.initial.details
    || draftState.draft.auditNote !== draftState.initial.auditNote
  )
  const blocker = useBlocker(dirty)

  useEffect(() => {
    const media = window.matchMedia(MOBILE_QUERY)
    const update = (): void => setIsMobile(media.matches)
    media.addEventListener('change', update)
    return () => media.removeEventListener('change', update)
  }, [])

  useLayoutEffect(() => {
    if (isMobile || panel === null) return
    const place = (): void => {
      const width = Math.min(412, window.innerWidth - 32)
      const height = Math.min(panel.scrollHeight, window.innerHeight - 32)
      const rect = anchor?.getBoundingClientRect()
      const preferredX = rect
        ? direction === 'rtl' ? rect.x : rect.right - width
        : direction === 'rtl' ? 24 : window.innerWidth - width - 24
      const x = Math.max(16, Math.min(window.innerWidth - width - 16, preferredX))
      const below = rect ? rect.bottom + 8 : 90
      const preferredY = rect && below + height > window.innerHeight - 16 ? rect.top - height - 8 : below
      const y = Math.max(16, Math.min(window.innerHeight - height - 16, preferredY))
      setPosition({
        insetInlineStart: direction === 'rtl' ? window.innerWidth - x - width : x,
        insetBlockStart: y,
        inlineSize: width,
        maxBlockSize: window.innerHeight - 32,
      })
    }
    place()
    const observer = new ResizeObserver(place)
    observer.observe(panel)
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [anchor, direction, isMobile, panel])

  const mutation = useMutation({
    mutationFn: async (submission: Submission): Promise<void> => {
      if ('adjustmentId' in submission) {
        await api.revokeAttendanceAdjustment(target.caseId, submission.adjustmentId, submission.etag, { reason: submission.reason })
      } else {
        await api.createAttendanceAdjustment(target.caseId, submission.etag, submission.payload)
      }
    },
    retry: false,
    onSuccess: async (_result, submission) => {
      await invalidateAttendanceQueries(queryClient, target.caseId)
      const message = t('attendance.quickCorrection.' + ('adjustmentId' in submission ? 'cleared' : 'saved'))
      onSaved(message)
      toast.success(message)
      onClose()
    },
    onError: async (error) => {
      if (error instanceof ApiError && error.code === 'ATTENDANCE_CASE_VERSION_CONFLICT') {
        setConflictWarning(true)
        const refreshed = await caseQuery.refetch()
        const refreshedEtag = refreshed.data?.etag
        if (refreshed.isSuccess && refreshedEtag) {
          setDraftOverride((current) => current === null ? current : { ...current, etag: refreshedEtag })
        }
      } else {
        setActionError(apiErrorMessage(error))
      }
    },
  })

  const setDraft = (next: QuickCorrectionDraft): void => {
    if (draftState !== null) setDraftOverride({ ...draftState, draft: next })
    setActionError(null)
  }
  const requestDismissal = useCallback((proceed: () => void, cancel?: () => void) => {
    if (mutation.isPending) return
    if (dirty) {
      dismissOrigin.current = document.activeElement instanceof HTMLElement ? document.activeElement : closeRef.current
      setDismissal({ proceed, cancel })
    } else proceed()
  }, [dirty, mutation.isPending])
  useLayoutEffect(() => {
    onDismissalGuardChange?.((proceed) => requestDismissal(() => {
      movingToAnotherPanel.current = true
      proceed()
    }))
    return () => onDismissalGuardChange?.(null)
  }, [onDismissalGuardChange, requestDismissal])
  useEffect(() => {
    if (blocker.state !== 'blocked') return
    requestDismissal(() => {
      movingToAnotherPanel.current = true
      onClose()
      blocker.proceed()
    }, blocker.reset)
  }, [blocker, onClose, requestDismissal])
  useEffect(() => {
    if (!dirty) return
    const warnBeforeUnload = (event: BeforeUnloadEvent): void => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [dirty])
  const viewEvidence = (): void => requestDismissal(() => {
    movingToAnotherPanel.current = true
    onViewEvidence(target.caseId)
  })
  const employeeName = attendanceCase
    ? pickEmployeeName({ name_en: attendanceCase.name_en, name_ar: attendanceCase.name_ar ?? null }, i18n.language)
    : target.employeeName
  const shiftCode = attendanceCase?.shift_code_snapshot ?? target.shiftCode
  const currentPresence = typeof attendanceCase?.effective?.presence_state === 'string'
    ? attendanceCase.effective.presence_state : 'unknown'
  const lastAudit = attendanceCase?.adjustment_audit?.reduce<NonNullable<AttendanceCase['adjustment_audit']>[number] | null>(
    (latest, audit) => latest === null || utcDate(audit.occurred_at) > utcDate(latest.occurred_at) ? audit : latest,
    null,
  )
  const lastAdjustment = attendanceCase?.adjustments?.reduce<NonNullable<AttendanceCase['adjustments']>[number] | null>(
    (latest, adjustment) => latest === null
      || utcDate(adjustment.revoked_at ?? adjustment.created_at) > utcDate(latest.revoked_at ?? latest.created_at)
      ? adjustment : latest,
    null,
  )
  const lastAt = lastAudit?.occurred_at ?? lastAdjustment?.revoked_at ?? lastAdjustment?.created_at
  const startDate = attendanceCase ? toLocalInput(attendanceCase.scheduled_start_at).slice(0, 10) : ''
  const endDate = attendanceCase ? toLocalInput(attendanceCase.scheduled_end_at).slice(0, 10) : ''
  const overnight = startDate !== endDate
  const showDates = overnight || datesExpanded
  const dateChoices = attendanceCase
    ? [...new Set([startDate, endDate, shiftIsoDate(startDate, 1), draft?.inDate ?? '', draft?.outDate ?? ''])]
      .filter((date) => date !== '')
    : []

  return (
    <Dialog.Root open modal={isMobile} onOpenChange={(open) => { if (!open) requestDismissal(onClose) }}>
      <Dialog.Portal>
        {isMobile && <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40" />}
        <Dialog.Content
          ref={setPanel}
          aria-modal={isMobile ? true : undefined}
          dir={direction}
          onOpenAutoFocus={(event) => { event.preventDefault(); closeRef.current?.focus() }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (!movingToAnotherPanel.current) anchor?.focus({ preventScroll: true })
          }}
          onEscapeKeyDown={(event) => { event.preventDefault(); requestDismissal(onClose) }}
          onInteractOutside={(event) => {
            event.preventDefault()
            if (event.target instanceof Element && event.target.closest('[data-attendance-correction-trigger], [data-attendance-correction-navigation], a[href]')) return
            requestDismissal(onClose)
          }}
          style={isMobile ? {
            insetInline: 0, insetBlockEnd: 0, inlineSize: '100%', maxBlockSize: 'calc(100dvh - 2rem)',
          } : position}
          className={cn(
            'fixed z-50 flex flex-col overflow-hidden bg-surface text-foreground shadow-2xl focus-visible:outline-none',
            isMobile ? 'rounded-ss-2xl rounded-se-2xl pb-[env(safe-area-inset-bottom)]' : 'rounded-2xl border border-border',
          )}
        >
          {isMobile && <span aria-hidden="true" className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-border-strong" />}
          <header className="flex shrink-0 items-start gap-3 border-b border-hairline px-5 py-4">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold">{t('attendance.quickCorrection.title')}</Dialog.Title>
              <p className="mt-1 break-words text-sm font-semibold">{employeeName}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                <bdi dir="ltr">{target.employeeId}</bdi>{' · '}<bdi dir="ltr">{target.operationalDate}</bdi>
                {shiftCode && <> · {t(`attendance.shift.${shiftCode}`, { defaultValue: shiftCode })}</>}
              </p>
            </div>
            <button
              ref={closeRef}
              type="button"
              disabled={mutation.isPending}
              aria-label={t('attendance.quickCorrection.close')}
              onClick={() => requestDismissal(onClose)}
              className={cn(BUTTON, 'flex min-w-11 shrink-0 items-center justify-center px-2 text-muted-foreground hover:bg-surface-tinted hover:text-foreground')}
            ><X className="h-4 w-4" aria-hidden="true" /></button>
          </header>
          <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-5">
            <Dialog.Description className="mt-4 text-sm text-muted-foreground">{t('attendance.quickCorrection.subtitle')}</Dialog.Description>
            {caseQuery.isPending ? <p role="status" className="py-5 text-sm">{t('common.loading')}</p>
              : caseQuery.isError && !attendanceCase ? (
                <div className="py-4">
                  <p role="alert" className="text-sm text-destructive-text">{t('attendance.quickCorrection.loadFailed')}</p>
                  <button type="button" onClick={() => { void caseQuery.refetch() }} className={cn(BUTTON, 'mt-2 hover:bg-surface-tinted')}>{t('common.retry')}</button>
                </div>
              ) : attendanceCase && draft ? (
                <>
                  {conflictWarning && <p role="alert" className="mt-3 rounded-md bg-warning-soft p-3 text-sm text-foreground">{t('attendance.quickCorrection.conflictWarning')}</p>}
                  {caseQuery.isError && <div className="mt-3">
                    <p role="alert" className="text-sm text-destructive-text">{t('attendance.quickCorrection.refreshFailed')}</p>
                    <button type="button" onClick={() => { void caseQuery.refetch() }} className={cn(BUTTON, 'mt-1 hover:bg-surface-tinted')}>{t('common.retry')}</button>
                  </div>}
                  <section aria-label={t('attendance.quickCorrection.currentEvidence')} className="mt-3 rounded-md bg-surface-tinted p-3 text-sm">
                    <p className="font-medium">{t('attendance.quickCorrection.currentResult')}{': '}
                      {t(`attendance.review.presence.${currentPresence}`, { defaultValue: t('attendance.review.presence.unknown') })}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">{t(activeAdjustmentId === null ? 'attendance.quickCorrection.automatic' : 'attendance.quickCorrection.corrected')}</p>
                    <dl className="mt-2 grid grid-cols-2 gap-3">
                      {(['first_in_at', 'final_out_at'] as const).map((field) => {
                        const value = attendanceCase.effective?.[field]
                        return <div key={field}>
                          <dt className="text-xs text-muted-foreground">{t(field === 'first_in_at' ? 'attendance.quickCorrection.in' : 'attendance.quickCorrection.out')}</dt>
                          <dd className="mt-0.5 tabular-nums"><bdi dir="ltr">{typeof value === 'string' ? toLocalInput(value).replace('T', ' ') : '—'}</bdi></dd>
                        </div>
                      })}
                    </dl>
                  </section>
                  <p className="mt-2 text-xs text-muted-foreground">{t('attendance.quickCorrection.schedule')}{': '}
                    <bdi dir="ltr">{toLocalInput(attendanceCase.scheduled_start_at).replace('T', ' ')} – {toLocalInput(attendanceCase.scheduled_end_at).replace('T', ' ')}</bdi>
                  </p>
                  <form className="mt-4" onSubmit={(event) => {
                    event.preventDefault()
                    if (!draftState || caseQuery.isFetching || mutation.isPending || etag === '') return
                    setActionError(null)
                    if (draftState.etag !== etag) {
                      setConflictWarning(true)
                      setDraftOverride({ ...draftState, etag })
                      return
                    }
                    const labels = {
                      reason: draft.reason === '' ? '' : t(`attendance.quickCorrection.reasons.${draft.reason}`),
                      leaveSubtype: t(`attendance.quickCorrection.leaves.${draft.leaveKind}`),
                      leaveSubtypeLabel: t('attendance.quickCorrection.subtype'),
                      auditNoteLabel: t('attendance.quickCorrection.audit'),
                    }
                    const error = validateQuickCorrection(attendanceCase, draft, new Date())
                    if (error !== null) { setActionError(t(`attendance.quickCorrection.errors.${error}`)); return }
                    try {
                      mutation.mutate(draft.action === 'clear' && activeAdjustmentId !== null
                        ? { etag: draftState.etag, adjustmentId: activeAdjustmentId, reason: buildQuickCorrectionReason(draft, labels) }
                        : { etag: draftState.etag, payload: buildQuickCorrectionPayload(attendanceCase, draft, labels, new Date()) })
                    } catch (error) {
                      setActionError(error instanceof Error ? t(`attendance.quickCorrection.errors.${error.message}`) : apiErrorMessage(error))
                    }
                  }}>
                    <fieldset disabled={mutation.isPending} className="min-w-0 space-y-3">
                      <div role="group" aria-label={t('attendance.quickCorrection.result')} className="grid grid-cols-3 gap-1 rounded-md bg-surface-tinted p-1">
                        {(['present', 'absent', 'leave'] as const).map((action: QuickCorrectionAction) => (
                          <button key={action} type="button" aria-pressed={draft.action === action}
                            onClick={() => setDraft({ ...draft, action })}
                            className={cn(BUTTON, 'px-1', draft.action === action ? 'bg-surface text-primary-text shadow-sm' : 'text-muted-foreground hover:bg-surface-raised hover:text-foreground')}>
                            {t(`attendance.quickCorrection.${action}`)}
                          </button>
                        ))}
                      </div>
                      {activeAdjustmentId !== null && <button type="button" aria-pressed={draft.action === 'clear'}
                        onClick={() => setDraft({ ...draft, action: 'clear' })}
                        className={cn(BUTTON, 'text-primary-text underline underline-offset-4 hover:bg-surface-tinted', draft.action === 'clear' && 'bg-primary-soft')}>
                        {t('attendance.quickCorrection.clear')}
                      </button>}
                      {draft.action === 'present' && <>
                        {!overnight && <button type="button" aria-expanded={datesExpanded} aria-controls="quick-correction-times"
                          onClick={() => setDatesExpanded((expanded) => !expanded)}
                          className={cn(BUTTON, 'text-primary-text underline underline-offset-4 hover:bg-surface-tinted')}>
                          {t('attendance.quickCorrection.changeDates')}
                        </button>}
                        <div id="quick-correction-times" className={cn('grid gap-3', !isMobile && 'grid-cols-2')}>
                          <div className="grid content-start gap-2">
                            <label htmlFor="quick-correction-in" className="grid gap-1.5 text-sm font-medium">
                              {t('attendance.quickCorrection.inTime')}
                              <input id="quick-correction-in" type="text" inputMode="numeric" dir="ltr" autoComplete="off" required
                                placeholder="07:00" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" value={draft.inTime}
                                aria-describedby="quick-correction-time-hint" className={cn(CONTROL, 'isolate-bidi tabular-nums')}
                                onChange={(event) => setDraft({ ...draft, inTime: event.target.value })} />
                            </label>
                            {showDates && <label htmlFor="quick-correction-in-date" className="grid gap-1.5 text-sm font-medium">
                              {t('attendance.quickCorrection.inDate')}
                              <select id="quick-correction-in-date" required
                                value={draft.inDateConfirmed ? draft.inDate : ''}
                                aria-describedby="quick-correction-date-hint" className={cn(CONTROL, 'tabular-nums')}
                                onChange={(event) => setDraft({ ...draft, inDate: event.target.value, inDateConfirmed: event.target.value !== '' })}>
                                <option value="">{t('attendance.quickCorrection.chooseDate')}</option>
                                {dateChoices.map((date) => <option key={date} value={date}>{date}</option>)}
                              </select>
                            </label>}
                          </div>
                          <div className="grid content-start gap-2">
                            <label htmlFor="quick-correction-out" className="grid gap-1.5 text-sm font-medium">
                              <span>{t('attendance.quickCorrection.outTime')} <span className="font-normal text-muted-foreground">({t('attendance.quickCorrection.optional')})</span></span>
                              <input id="quick-correction-out" type="text" inputMode="numeric" dir="ltr" autoComplete="off"
                                placeholder="15:00" pattern="([01][0-9]|2[0-3]):[0-5][0-9]" value={draft.outTime}
                                aria-describedby="quick-correction-time-hint" className={cn(CONTROL, 'isolate-bidi tabular-nums')}
                                onChange={(event) => setDraft({ ...draft, outTime: event.target.value })} />
                            </label>
                            {showDates && <label htmlFor="quick-correction-out-date" className="grid gap-1.5 text-sm font-medium">
                              {t('attendance.quickCorrection.outDate')}
                              <select id="quick-correction-out-date" required={draft.outTime !== ''}
                                value={draft.outDateConfirmed ? draft.outDate : ''}
                                aria-describedby="quick-correction-date-hint" className={cn(CONTROL, 'tabular-nums')}
                                onChange={(event) => setDraft({ ...draft, outDate: event.target.value, outDateConfirmed: event.target.value !== '' })}>
                                <option value="">{t('attendance.quickCorrection.chooseDate')}</option>
                                {dateChoices.map((date) => <option key={date} value={date}>{date}</option>)}
                              </select>
                            </label>}
                          </div>
                        </div>
                        <p id="quick-correction-time-hint" className="text-xs text-muted-foreground">{t('attendance.quickCorrection.timeHint')}</p>
                        {showDates && <p id="quick-correction-date-hint" className="text-xs text-muted-foreground">{t(overnight ? 'attendance.quickCorrection.overnightHint' : 'attendance.quickCorrection.datesHint')}</p>}
                        {validation !== null && validation !== 'reasonRequired' && <p role="alert" className="text-sm text-destructive-text">{t(`attendance.quickCorrection.errors.${validation}`)}</p>}
                      </>}
                      {draft.action === 'leave' && <div className="grid gap-1.5">
                        <label htmlFor="quick-correction-leave" className="text-sm font-medium">{t('attendance.quickCorrection.subtype')}</label>
                        <select id="quick-correction-leave" value={draft.leaveKind} className={CONTROL} aria-describedby="quick-correction-leave-hint"
                          onChange={(event) => {
                            const leaveKind = QUICK_CORRECTION_LEAVE_KINDS.find((kind) => kind === event.target.value)
                            if (leaveKind) setDraft({ ...draft, leaveKind })
                          }}>
                          {QUICK_CORRECTION_LEAVE_KINDS.map((kind) => <option key={kind} value={kind}>{t(`attendance.quickCorrection.leaves.${kind}`)}</option>)}
                        </select>
                        <p id="quick-correction-leave-hint" className="text-xs text-muted-foreground">{t('attendance.quickCorrection.leaveHint')}</p>
                      </div>}
                      {draft.action === 'clear' && <p className="text-sm text-muted-foreground">{t('attendance.quickCorrection.clearHint')}</p>}
                      <label htmlFor="quick-correction-reason" className="grid gap-1.5 text-sm font-medium">
                        {t('attendance.quickCorrection.reason')}
                        <select id="quick-correction-reason" value={draft.reason} required className={CONTROL} aria-describedby="quick-correction-reason-hint"
                          onChange={(event) => {
                            const reason = QUICK_CORRECTION_REASONS.find((key) => key === event.target.value) ?? ''
                            setDraft({ ...draft, reason })
                          }}>
                          <option value="">{t('attendance.quickCorrection.chooseReason')}</option>
                          {QUICK_CORRECTION_REASONS.map((reason) => <option key={reason} value={reason}>{t(`attendance.quickCorrection.reasons.${reason}`)}</option>)}
                        </select>
                      </label>
                      <label htmlFor="quick-correction-details" className="grid gap-1.5 text-sm font-medium">
                        {t('attendance.quickCorrection.reasonText')}
                        <textarea id="quick-correction-details" rows={2} required value={draft.details} className={CONTROL}
                          placeholder={t('attendance.quickCorrection.reasonPlaceholder')} aria-describedby="quick-correction-reason-hint"
                          onChange={(event) => setDraft({ ...draft, details: event.target.value })} />
                      </label>
                      <p id="quick-correction-reason-hint" className="text-xs text-muted-foreground">{t(draft.reason !== '' && draft.details.trim() !== '' ? 'attendance.quickCorrection.reasonReady' : 'attendance.quickCorrection.reasonHint')}</p>
                      <label htmlFor="quick-correction-audit" className="grid gap-1.5 text-sm font-medium">
                        <span>{t('attendance.quickCorrection.audit')} <span className="font-normal text-muted-foreground">({t('attendance.quickCorrection.optional')})</span></span>
                        <textarea id="quick-correction-audit" rows={2} value={draft.auditNote} className={CONTROL}
                          placeholder={t('attendance.quickCorrection.auditPlaceholder')}
                          onChange={(event) => setDraft({ ...draft, auditNote: event.target.value })} />
                      </label>
                      {actionError && <p role="alert" className="text-sm text-destructive-text">{actionError}</p>}
                      <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                        <button type="button" onClick={() => requestDismissal(onClose)} className={cn(BUTTON, 'border border-border hover:bg-surface-tinted')}>{t('attendance.quickCorrection.cancel')}</button>
                        <button type="submit" disabled={validation !== null || caseQuery.isFetching || etag === '' || !caseQuery.isSuccess}
                          aria-describedby="quick-correction-reason-hint" className={cn(BUTTON, 'bg-primary text-primary-foreground hover:bg-primary-hover')}>
                          {mutation.isPending ? t('common.loading') : t(draft.action === 'clear' ? 'attendance.quickCorrection.clearSave' : 'attendance.quickCorrection.save')}
                        </button>
                      </div>
                    </fieldset>
                  </form>
                  <footer className="mt-4 space-y-2 border-t border-hairline pt-3 text-xs text-muted-foreground">
                    <p>{t('attendance.quickCorrection.overlayFooter')}</p>
                    <p>{lastAt ? <Trans i18nKey="attendance.quickCorrection.lastCorrection"
                      values={{ name: lastAudit?.actor ?? t('attendance.quickCorrection.unknownActor'), at: toLocalInput(lastAt).replace('T', ' ') }}
                      components={{ at: <bdi dir="ltr" /> }} /> : t('attendance.quickCorrection.noPrevious')}</p>
                  </footer>
                </>
              ) : <p role="alert" className="py-4 text-sm text-destructive-text">{t('attendance.quickCorrection.loadFailed')}</p>}
            <button type="button" disabled={mutation.isPending} onClick={viewEvidence}
              className={cn(BUTTON, 'mt-3 text-primary-text underline underline-offset-4 hover:bg-surface-tinted')}>{t('attendance.quickCorrection.viewEvidence')}</button>
          </div>
          <AlertDialog open={dismissal !== null} onOpenChange={(open) => { if (!open) { dismissal?.cancel?.(); setDismissal(null) } }}>
            <AlertDialogContent dir={direction} role="alertdialog" className="max-w-[calc(100%-2rem)] sm:max-w-sm"
              onOpenAutoFocus={(event) => { event.preventDefault(); keepEditingRef.current?.focus() }}
              onCloseAutoFocus={(event) => { event.preventDefault(); dismissOrigin.current?.focus() }}>
              <AlertDialogTitle>{t('attendance.quickCorrection.discardTitle')}</AlertDialogTitle>
              <AlertDialogDescription className="mt-2">{t('attendance.quickCorrection.discardDescription')}</AlertDialogDescription>
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button ref={keepEditingRef} type="button" onClick={() => { dismissal?.cancel?.(); setDismissal(null) }} className={cn(BUTTON, 'border border-border hover:bg-surface-tinted')}>{t('attendance.quickCorrection.keepEditing')}</button>
                <button type="button" onClick={() => { dismissal?.proceed(); setDismissal(null) }}
                  className={cn(BUTTON, 'bg-primary text-primary-foreground hover:bg-primary-hover')}>{t('attendance.quickCorrection.discard')}</button>
              </div>
            </AlertDialogContent>
          </AlertDialog>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
