import { useEffect, useId, useRef, useState, type FormEvent } from 'react'

import { Button } from '@/components/ui/button'
import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import type { ArmoryGuardRead, ArmoryPersonCandidateRead, Versioned } from '@/lib/api'
import { normalizeDigits } from '@/lib/utils'

import { Ltr } from '../ArmoryLtr'
import { displayDate, orgDateIso, useArmoryLocale } from '../armoryFormat'
import { armoryErrorMessage, armoryErrorRecovery, isArmoryAccessError, useArmoryAccess, useArmoryGuard, useSaveArmoryQualification } from '../armoryQueries'
import { ArmoryPersonPicker } from '../dialogs/ArmoryPersonPicker'

interface Props {
  employeeId: string | null
  open: boolean
  onClose(saved: boolean): void
  restoreFocus?: () => void
}

type QualificationDraft = {
  courseRound: string
  licenceNumber: string
  expiry: string
  invalidExpiry: boolean
  etag: string
}

function draftFrom({ data: { qualification }, etag }: Versioned<ArmoryGuardRead>): QualificationDraft {
  return {
    courseRound: qualification.course_round?.toString() ?? '',
    licenceNumber: qualification.licence_number ?? '',
    expiry: qualification.licence_expires_on ?? '',
    invalidExpiry: false,
    etag,
  }
}

/** The same editor handles a page action and a draft suspended by the shell. */
export function GuardQualificationDialog({ open, ...props }: Props): React.JSX.Element | null {
  const { canEdit, principal } = useArmoryAccess()
  if (!open || !canEdit || principal === null) return null
  return <QualificationSession key={`${principal}:${props.employeeId ?? ''}`} {...props} />
}

function QualificationSession({ employeeId, onClose, restoreFocus }: Omit<Props, 'open'>): React.JSX.Element {
  const { t, name } = useArmoryLocale()
  const id = useId()
  const [person, setPerson] = useState<ArmoryPersonCandidateRead | null>(null)
  const selectedId = employeeId ?? person?.person.employee_id ?? null
  const [edited, setEdited] = useState<QualificationDraft | null>(null)
  // After a 412 the draft stays as typed; `saved` holds the refreshed server
  // values until the operator keeps the draft or takes the saved values.
  const [conflict, setConflict] = useState<'loading' | 'failed' | { saved: QualificationDraft } | null>(null)
  const review = typeof conflict === 'object' && conflict !== null ? conflict.saved : null
  const closed = useRef(false)
  const cancel = useRef<HTMLButtonElement>(null)
  const courseInput = useRef<HTMLInputElement>(null)
  const expiryInput = useRef<HTMLInputElement>(null)
  const keepChanges = useRef<HTMLButtonElement>(null)
  const guardQuery = useArmoryGuard(selectedId)
  const mutation = useSaveArmoryQualification()
  const loadError = guardQuery.isError ? guardQuery.error : null
  const accessDenied = isArmoryAccessError(loadError)
  const versioned = accessDenied || guardQuery.isPlaceholderData ? undefined : guardQuery.data
  const guard = versioned?.data
  const saveDenied = isArmoryAccessError(mutation.error)
  const showFields = guard !== undefined && !guard.person.is_former && !saveDenied
  // Pin the ETag at the first edit. A background query refresh must not attach
  // a newer ETag to a draft based on older evidence.
  const draft = edited ?? (versioned ? draftFrom(versioned) : null)
  const roundText = draft?.courseRound.trim() ?? ''
  const courseRound = roundText ? Number(roundText) : null
  const invalidRound = courseRound !== null && (!/^\d+$/.test(roundText) || !Number.isSafeInteger(courseRound) || courseRound < 1)
  const licenceNumber = draft?.licenceNumber.trim() || null
  const expiry = draft?.expiry || null
  const missingPair = (licenceNumber === null) !== (expiry === null)
  const pastExpiry = expiry !== null && expiry < orgDateIso(new Date().toISOString())
  const saving = mutation.isPending
  const fieldsDisabled = saving || conflict !== null || loadError !== null

  useEffect(() => {
    if (showFields && document.activeElement === cancel.current) courseInput.current?.focus()
  }, [showFields])

  useEffect(() => {
    if (review) keepChanges.current?.focus()
  }, [review])

  function close(saved: boolean) {
    if (closed.current) return
    closed.current = true
    onClose(saved)
  }

  function edit(changes: Partial<QualificationDraft>) {
    if (draft) setEdited({ ...draft, ...changes })
  }

  async function reloadAfterConflict(pinned: QualificationDraft) {
    setEdited(pinned)
    setConflict('loading')
    // The mutation already invalidates Armory on a version conflict. Join
    // that refetch rather than aborting it and issuing a duplicate request.
    const latest = await guardQuery.refetch({ cancelRefetch: false })
    setConflict(latest.isSuccess ? { saved: draftFrom(latest.data) } : 'failed')
  }

  /** Keep the draft against the new version, or replace it with the saved values. */
  function resolveConflict(keep: boolean) {
    if (!review || !draft) return
    setEdited(keep ? { ...draft, etag: review.etag } : review)
    setConflict(null)
    mutation.reset()
    requestAnimationFrame(() => courseInput.current?.focus())
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft || !showFields || !selectedId || fieldsDisabled || invalidRound || missingPair || draft.invalidExpiry) return
    if (expiryInput.current && !expiryInput.current.validity.valid) {
      edit({ invalidExpiry: true })
      return
    }
    setConflict(null)
    mutation.mutate({
      employeeId: selectedId,
      body: { course_round: courseRound, licence_number: licenceNumber, licence_expires_on: expiry },
      etag: draft.etag,
    }, {
      onSuccess: () => close(true),
      onError: (error) => {
        if (armoryErrorRecovery(error) === 'reload') void reloadAfterConflict(draft)
      },
    })
  }

  const title = selectedId === null
    ? t('assets.armory.guardsPane.addGuard')
    : showFields
      ? t(guard.qualification.licence_number === null ? 'assets.armory.addLicence' : 'assets.armory.updateLicence')
      : t('assets.armory.guardsPane.qualification')
  const pairErrorId = missingPair ? `${id}-pair-error` : undefined
  const dateNoticeId = draft?.invalidExpiry || pastExpiry ? `${id}-date-notice` : undefined

  return (
    <DialogRoot open onOpenChange={(next) => { if (!next && !saving) close(false) }}>
      <DialogContent
        hideClose={saving}
        onCloseAutoFocus={restoreFocus ? (event) => { event.preventDefault(); restoreFocus() } : undefined}
      >
        <DialogHeader className="pe-14">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription>
            {employeeId !== null && guard ? (
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <bdi className="[overflow-wrap:anywhere]">{name(guard.person)}</bdi>
                <Ltr className="tabular-nums">{guard.person.employee_id}</Ltr>
              </span>
            ) : t(employeeId === null ? 'assets.armory.guardsPane.chooseEmployee' : 'assets.armory.guardsHint')}
          </DialogDescription>
        </DialogHeader>
        <form noValidate className="flex min-h-0 flex-1 flex-col" onSubmit={submit}>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
            {employeeId === null && !saveDenied && (
              <ArmoryPersonPicker
                purpose="qualification"
                safeId={null}
                label={t('assets.armory.searchGuard')}
                value={person}
                disabled={saving || conflict === 'loading'}
                onChange={(candidate) => {
                  setPerson(candidate)
                  setEdited(null)
                  setConflict(null)
                  mutation.reset()
                  if (candidate !== null) cancel.current?.focus()
                }}
              />
            )}
            {selectedId !== null && versioned === undefined && !loadError && (
              <div role="status" className="space-y-2">
                <span className="sr-only">{t('assets.armory.loadingText')}</span>
                <Skeleton className="h-11 w-full" />
                <Skeleton className="h-11 w-full" />
              </div>
            )}
            {loadError && (
              <div className="flex flex-wrap items-center gap-2">
                <p role="alert" className="text-sm text-destructive-text">{armoryErrorMessage(loadError)}</p>
                {!accessDenied && <Button type="button" variant="ghost" className="min-h-11" onClick={() => void (conflict === 'failed' && draft ? reloadAfterConflict(draft) : guardQuery.refetch())}>{t('assets.armory.retry')}</Button>}
              </div>
            )}
            {guard?.person.is_former && <p role="status" className="text-sm text-muted-foreground">{t('assets.armory.guardsPane.formerReadOnly')}</p>}
            {showFields && draft && (
              <>
                <div className="space-y-1">
                  <label htmlFor={`${id}-round`} className="block text-sm font-medium">{t('assets.armory.courseRound')}</label>
                  <Input
                    id={`${id}-round`}
                    ref={courseInput}
                    type="text"
                    dir="ltr"
                    inputMode="numeric"
                    autoComplete="off"
                    value={draft.courseRound}
                    disabled={fieldsDisabled}
                    className="min-h-11 tabular-nums"
                    aria-invalid={invalidRound || undefined}
                    aria-describedby={invalidRound ? `${id}-round-error` : `${id}-round-help`}
                    onChange={(event) => edit({ courseRound: normalizeDigits(event.target.value) })}
                  />
                  {invalidRound ? (
                    <p id={`${id}-round-error`} role="alert" className="text-xs text-destructive-text">{t('assets.armory.guardsPane.invalidRound')}</p>
                  ) : (
                    <p id={`${id}-round-help`} className="text-xs text-muted-foreground">{t('assets.armory.guardsPane.courseHelp')}</p>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="min-w-0 space-y-1">
                    <label htmlFor={`${id}-licence`} className="block text-sm font-medium">{t('assets.armory.securityNumber')}</label>
                    <Input
                      id={`${id}-licence`}
                      dir="ltr"
                      autoComplete="off"
                      maxLength={80}
                      value={draft.licenceNumber}
                      disabled={fieldsDisabled}
                      className="min-h-11 tabular-nums"
                      aria-invalid={(missingPair && licenceNumber === null) || undefined}
                      aria-describedby={pairErrorId}
                      onChange={(event) => edit({ licenceNumber: normalizeDigits(event.target.value) })}
                    />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <label htmlFor={`${id}-expiry`} className="block text-sm font-medium">{t('assets.armory.securityExpiry')}</label>
                    <Input
                      id={`${id}-expiry`}
                      ref={expiryInput}
                      type="date"
                      dir="ltr"
                      min="0001-01-01"
                      max="9999-12-31"
                      value={draft.expiry}
                      disabled={fieldsDisabled}
                      className="min-h-11 tabular-nums"
                      aria-invalid={draft.invalidExpiry || (missingPair && expiry === null) || undefined}
                      aria-describedby={[pairErrorId, dateNoticeId].filter(Boolean).join(' ') || undefined}
                      onChange={(event) => edit({ expiry: event.target.value, invalidExpiry: !event.target.validity.valid })}
                    />
                  </div>
                </div>
                {missingPair && <p id={pairErrorId} role="alert" className="text-sm text-destructive-text">{t('assets.armory.numberNeeded')}</p>}
                {draft.invalidExpiry ? (
                  <p id={dateNoticeId} role="alert" className="text-sm text-destructive-text">{t('assets.armory.guardsPane.invalidExpiry')}</p>
                ) : pastExpiry && (
                  <p id={dateNoticeId} role="status" className="rounded-md bg-warning-soft px-3 py-2 text-sm">{t('assets.armory.pastLicenceDate')}</p>
                )}
              </>
            )}
            {mutation.isError && (
              <p role="alert" className="rounded-md bg-accent-soft px-3 py-2 text-sm text-destructive-text">
                {armoryErrorMessage(mutation.error)}
              </p>
            )}
            {conflict === 'loading' && <p role="status" className="text-sm text-muted-foreground">{t('assets.armory.loadingText')}</p>}
            {review && (
              <section aria-labelledby={`${id}-saved`} className="space-y-3 rounded-md bg-surface-raised p-3">
                <h3 id={`${id}-saved`} className="text-sm font-semibold">{t('assets.armory.guardsPane.savedValues')}</h3>
                <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">{t('assets.armory.courseRound')}</dt>
                  <dd>{review.courseRound ? <Ltr className="tabular-nums">{review.courseRound}</Ltr> : t('assets.armory.none')}</dd>
                  <dt className="text-muted-foreground">{t('assets.armory.securityNumber')}</dt>
                  <dd className="[overflow-wrap:anywhere]">{review.licenceNumber ? <Ltr className="tabular-nums">{review.licenceNumber}</Ltr> : t('assets.armory.none')}</dd>
                  <dt className="text-muted-foreground">{t('assets.armory.securityExpiry')}</dt>
                  <dd>{review.expiry ? <Ltr className="tabular-nums">{displayDate(review.expiry)}</Ltr> : t('assets.armory.none')}</dd>
                </dl>
                <p className="text-sm text-muted-foreground">{t('assets.armory.guardsPane.recoverQualification')}</p>
                <div className="flex flex-wrap gap-2">
                  <Button ref={keepChanges} type="button" variant="outline" className="min-h-11" onClick={() => resolveConflict(true)}>{t('assets.armory.guardsPane.keepChanges')}</Button>
                  <Button type="button" variant="outline" className="min-h-11" onClick={() => resolveConflict(false)}>{t('assets.armory.guardsPane.useSaved')}</Button>
                </div>
              </section>
            )}
          </div>
          <div className="flex flex-none flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
            <Button ref={cancel} type="button" variant="outline" className="min-h-11" disabled={saving} onClick={() => close(false)}>{t('assets.armory.cancel')}</Button>
            {showFields && draft && (
              <Button type="submit" className="min-h-11" disabled={fieldsDisabled || invalidRound || missingPair || draft.invalidExpiry}>
                {saving ? <span role="status">{t('common.saving')}</span> : t('assets.armory.save')}
              </Button>
            )}
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  )
}
