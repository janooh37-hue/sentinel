/**
 * The insurance side of an accident report.
 *
 * A report carries no damage cost: insurance covers the damage and the
 * technician estimates it (`DamageCover`). The claim itself (number, status,
 * insurance company, repair garage, who bears the cost) is optional and can be
 * recorded at filing or any time later (`InsuranceDialog`); a report closes
 * without it. Only what has been recorded is shown (`InsuranceFacts`): an empty
 * optional field is not a gap to point at.
 */

import { useId, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Field, FieldGrid, FormAlert } from '@/components/forms/DialogShell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { api } from '@/lib/api'
import type { VehicleAccidentRead } from '@/lib/api'
import { localized } from '@/lib/language'
import { toast } from '@/lib/toast'

import {
  CLAIM_STATUSES,
  COST_PAYERS,
  formatDateTime,
  hasInsurance,
  insuranceDraftOf,
  insurancePayload,
  invalidateVehicleQueries,
  vehicleErrorMessage,
  type InsuranceDraft,
} from '../vehicleUtils'
import { PlateChip } from './PlateChip'
import { RequestBody, RequestFooter, RequestShell } from './RequestShell'
import { VehicleStatusBadge } from './VehicleStatusBadge'

const SELECT_CLASS =
  'h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50'

/** The five optional claim fields. */
export function InsuranceFields({
  draft,
  onChange,
  disabled = false,
}: {
  draft: InsuranceDraft
  onChange: (next: InsuranceDraft) => void
  disabled?: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const id = useId()
  const set = <K extends keyof InsuranceDraft>(key: K, value: InsuranceDraft[K]): void =>
    onChange({ ...draft, [key]: value })

  return (
    <FieldGrid>
      <Field id={`${id}-claim`} label={t('vehicles.insurance.claimNo')}>
        <Input
          id={`${id}-claim`}
          dir="ltr"
          className="font-mono"
          maxLength={64}
          disabled={disabled}
          value={draft.claim_no}
          onChange={(event) => set('claim_no', event.target.value)}
        />
      </Field>
      <Field id={`${id}-status`} label={t('vehicles.insurance.claimStatus')}>
        <select
          id={`${id}-status`}
          className={SELECT_CLASS}
          disabled={disabled}
          value={draft.claim_status}
          onChange={(event) => set('claim_status', event.target.value as InsuranceDraft['claim_status'])}
        >
          <option value="">{t('vehicles.insurance.notSet')}</option>
          {CLAIM_STATUSES.map((status) => (
            <option key={status} value={status}>
              {t(`vehicles.insurance.claimStatuses.${status}`)}
            </option>
          ))}
        </select>
      </Field>
      <Field id={`${id}-insurer`} label={t('vehicles.insurance.insurer')}>
        <Input
          id={`${id}-insurer`}
          dir="auto"
          maxLength={128}
          disabled={disabled}
          value={draft.insurer}
          onChange={(event) => set('insurer', event.target.value)}
        />
      </Field>
      <Field id={`${id}-garage`} label={t('vehicles.insurance.repairGarage')}>
        <Input
          id={`${id}-garage`}
          dir="auto"
          maxLength={128}
          disabled={disabled}
          value={draft.repair_garage}
          onChange={(event) => set('repair_garage', event.target.value)}
        />
      </Field>
      <Field id={`${id}-payer`} label={t('vehicles.insurance.payer')} full>
        <select
          id={`${id}-payer`}
          className={SELECT_CLASS}
          disabled={disabled}
          value={draft.cost_payer}
          onChange={(event) => set('cost_payer', event.target.value as InsuranceDraft['cost_payer'])}
        >
          <option value="">{t('vehicles.insurance.notSet')}</option>
          {COST_PAYERS.map((payer) => (
            <option key={payer} value={payer}>
              {t(`vehicles.insurance.payers.${payer}`)}
            </option>
          ))}
        </select>
      </Field>
    </FieldGrid>
  )
}

/** «Damage cost: covered by insurance, the technician estimates the cost.» */
export function DamageCover({ className }: { className?: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <p className={`flex items-start gap-2.5 text-[0.8rem] ${className ?? ''}`}>
      <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary-text" aria-hidden />
      <span className="flex flex-col">
        <b className="font-semibold text-foreground">{t('vehicles.damageCost')}</b>
        <span className="text-muted-foreground">{t('vehicles.damageCoverLine')}</span>
      </span>
    </p>
  )
}

/** What has been recorded about the claim, and nothing else. */
export function InsuranceFacts({
  accident,
}: {
  accident: VehicleAccidentRead
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const rows: { label: string; value: React.ReactNode }[] = []
  if (accident.claim_status) {
    rows.push({
      label: t('vehicles.insurance.claimStatus'),
      value: <VehicleStatusBadge family="claim" status={accident.claim_status} />,
    })
  }
  if (accident.claim_no) {
    rows.push({
      label: t('vehicles.insurance.claimNo'),
      value: (
        <bdi dir="ltr" className="font-mono">
          {accident.claim_no}
        </bdi>
      ),
    })
  }
  if (accident.insurer) {
    rows.push({
      label: t('vehicles.insurance.insurer'),
      value: <span dir="auto">{accident.insurer}</span>,
    })
  }
  if (accident.repair_garage) {
    rows.push({
      label: t('vehicles.insurance.repairGarage'),
      value: <span dir="auto">{accident.repair_garage}</span>,
    })
  }
  if (accident.cost_payer) {
    rows.push({
      label: t('vehicles.insurance.payer'),
      value: t(`vehicles.insurance.payers.${accident.cost_payer}`),
    })
  }
  if (rows.length === 0) return null
  return (
    <dl className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-x-5 gap-y-2.5">
      {rows.map((row) => (
        <div key={row.label} className="min-w-0">
          <dt className="text-[0.68rem] text-muted-foreground">{row.label}</dt>
          <dd className="mt-0.5 text-[0.8rem] font-semibold text-foreground">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** Add or edit the claim on a filed report, on its own page. */
export function InsuranceDialog({
  open,
  onOpenChange,
  accident,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  accident: VehicleAccidentRead
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const queryClient = useQueryClient()
  const alertId = useId()
  const [draft, setDraft] = useState<InsuranceDraft>(() => insuranceDraftOf(accident))
  const [error, setError] = useState<string | null>(null)

  const save = useMutation({
    mutationFn: () =>
      api.setAccidentInsurance(accident.vehicle_id, accident.id, insurancePayload(draft)),
    onMutate: () => setError(null),
    onSuccess: () => {
      invalidateVehicleQueries(queryClient, {
        vehicleId: accident.vehicle_id,
        registers: ['accidents'],
      })
      toast.success(t('vehicles.insurance.saved'))
      onOpenChange(false)
    },
    onError: (err) => {
      const message = vehicleErrorMessage(err)
      setError(message)
      toast.error(message)
    },
  })

  return (
    <RequestShell
      open={open}
      onOpenChange={onOpenChange}
      title={t(hasInsurance(accident) ? 'vehicles.insurance.edit' : 'vehicles.insurance.add')}
      description={t('vehicles.insurance.optional')}
      busy={save.isPending}
    >
      <form
        className="flex min-h-0 flex-1 flex-col"
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
      >
        <RequestBody>
          <FormAlert id={alertId} message={error} />
          <div className="flex flex-wrap items-center gap-2">
            <PlateChip plate={accident.vehicle_plate_label} />
            <span className="text-[0.76rem] text-muted-foreground">
              <span dir="auto">
                {localized(accident.vehicle_type_ar, accident.vehicle_type_en, i18n.language)}
              </span>
              {' · '}
              <bdi dir="ltr" className="font-mono">
                {formatDateTime(accident.date, accident.time)}
              </bdi>
            </span>
          </div>
          <DamageCover />
          <InsuranceFields draft={draft} onChange={setDraft} disabled={save.isPending} />
        </RequestBody>
        <RequestFooter busy={save.isPending}>
          <Button type="submit" size="lg" className="sm:min-w-[11rem]" disabled={save.isPending}>
            {save.isPending ? t('common.saving') : t('vehicles.save')}
          </Button>
        </RequestFooter>
      </form>
    </RequestShell>
  )
}
