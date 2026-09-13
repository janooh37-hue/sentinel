import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Trash2 } from 'lucide-react'

import type {
  InmateManualRowIn,
  InmateManualRowPatch,
  InmateRegisterEntry,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { EmployeePicker } from '../EmployeePicker'
import { NationalityPicker } from './RegisterPickers'
import { WINGS } from './registerModel'
import { useInmateNationalities } from './useInmateRegister'

const EMPTY_WING = '__none__'

interface ManualEntryFormProps {
  entry: InmateRegisterEntry | null
  year: number
  month: number
  isWriting: boolean
  onCreate: (body: InmateManualRowIn) => void
  onUpdate: (args: { rowId: number; body: InmateManualRowPatch }) => void
  onCancel?: () => void
  onDelete?: () => void
}

export function ManualEntryForm({
  entry,
  year,
  month,
  isWriting,
  onCreate,
  onUpdate,
  onCancel,
  onDelete,
}: ManualEntryFormProps): React.JSX.Element {
  const { t } = useTranslation()
  const formId = useId()
  const reporterLabelId = useId()
  const nationalities = useInmateNationalities()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [name, setName] = useState(entry?.name ?? '')
  const [violationDate, setViolationDate] = useState(entry?.violation_date ?? '')
  const [reason, setReason] = useState(entry?.manual?.reason ?? '')
  const [uid, setUid] = useState(entry?.uid ?? '')
  const [nationalityCode, setNationalityCode] = useState(
    entry?.nationality_code && entry.nationality_code !== 'XX' ? entry.nationality_code : '',
  )
  const [nationalityTouched, setNationalityTouched] = useState(false)
  const [wing, setWing] = useState(entry?.wing ?? '')
  const [holdingNo, setHoldingNo] = useState(entry?.holding_no ?? '')
  const [reporterId, setReporterId] = useState(entry?.reporter_id ?? '')
  const [detailsText, setDetailsText] = useState(entry?.details_text ?? '')
  const [error, setError] = useState<string | null>(null)
  const options = (nationalities.data?.items ?? []).filter((item) => item.selectable)
  const editing = entry?.origin === 'manual' && entry.manual?.row_id != null

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    const normalizedName = name.trim()
    const normalizedReason = reason.trim()
    if (!normalizedName || !violationDate || !normalizedReason) {
      setError(t('inmateStats.manualForm.required'))
      return
    }
    const [dateYear, dateMonth] = violationDate.split('-').map(Number)
    if (dateYear !== year || dateMonth !== month) {
      setError(t('inmateStats.manualForm.dateOutsideMonth'))
      return
    }

    const nationality = options.find((item) => item.code === nationalityCode)
    const body: InmateManualRowIn = {
      name: normalizedName,
      violation_date: violationDate,
      reason: normalizedReason,
      uid: uid.trim() || null,
      nationality_label: nationalityTouched
        ? (nationality?.label_ar ?? null)
        : (nationality?.label_ar ?? entry?.nationality_label ?? null),
      wing: wing || null,
      holding_no: holdingNo.trim() || null,
      reporter_id: reporterId || null,
      details_text: detailsText.trim() || null,
    }
    setError(null)
    if (editing && entry.manual?.row_id != null) {
      onUpdate({ rowId: entry.manual.row_id, body })
    } else {
      onCreate(body)
    }
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <div>
        <h3 className="text-base font-semibold">
          {t(editing ? 'inmateStats.manualForm.editTitle' : 'inmateStats.manualForm.createTitle')}
        </h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t('inmateStats.manualForm.detailsHint')}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${formId}-name`}>
            {t('inmateStats.manualForm.name')}
            <span className="ms-0.5 text-destructive">*</span>
          </Label>
          <Input
            id={`${formId}-name`}
            value={name}
            onChange={(event) => setName(event.target.value)}
            required
            dir="auto"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-date`}>
            {t('inmateStats.manualForm.violationDate')}
            <span className="ms-0.5 text-destructive">*</span>
          </Label>
          <Input
            id={`${formId}-date`}
            type="date"
            value={violationDate}
            onChange={(event) => setViolationDate(event.target.value)}
            required
            dir="ltr"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-uid`}>{t('inmateStats.manualForm.uid')}</Label>
          <Input
            id={`${formId}-uid`}
            value={uid}
            onChange={(event) => setUid(event.target.value)}
            dir="ltr"
          />
        </div>
        <NationalityPicker
          label={t('inmateStats.manualForm.nationality')}
          value={nationalityCode}
          options={options}
          loading={nationalities.isLoading}
          loadError={nationalities.isError}
          onChange={(code) => {
            setNationalityCode(code)
            setNationalityTouched(true)
          }}
          disabled={nationalities.isLoading || nationalities.isError}
          unresolved={entry?.nationality_code === 'XX'}
        />
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-wing`}>{t('inmateStats.manualForm.wing')}</Label>
          <Select
            value={WINGS.includes(wing) ? wing : EMPTY_WING}
            onValueChange={(value) => setWing(value === EMPTY_WING ? '' : value)}
          >
            <SelectTrigger id={`${formId}-wing`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={EMPTY_WING}>—</SelectItem>
              {WINGS.map((value) => (
                <SelectItem key={value} value={value}>
                  <bdi dir="ltr">{value}</bdi>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {wing && !WINGS.includes(wing) ? (
            <p className="text-sm text-warning">
              {t('inmateStats.workflow.invalidWing')} <bdi dir="ltr">{wing}</bdi>
            </p>
          ) : null}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-holding`}>{t('inmateStats.manualForm.holdingNo')}</Label>
          <Input
            id={`${formId}-holding`}
            value={holdingNo}
            onChange={(event) => setHoldingNo(event.target.value)}
            dir="ltr"
          />
        </div>
        <div className="space-y-1.5">
          <Label id={reporterLabelId}>{t('inmateStats.manualForm.reporter')}</Label>
          <div role="group" aria-labelledby={reporterLabelId}>
            <EmployeePicker
              selectedId={reporterId || null}
              onSelect={(id) => setReporterId(id ?? '')}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {t('inmateStats.manualForm.reporterHint')}
          </p>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${formId}-details`}>{t('inmateStats.manualForm.details')}</Label>
          <Textarea
            id={`${formId}-details`}
            value={detailsText}
            onChange={(event) => setDetailsText(event.target.value)}
            rows={5}
            dir="auto"
          />
          <p className="text-xs text-muted-foreground">{t('inmateStats.manualForm.detailsHint')}</p>
        </div>
        <div className="space-y-1.5 sm:col-span-2">
          <Label htmlFor={`${formId}-reason`}>
            {t('inmateStats.manualForm.reason')}
            <span className="ms-0.5 text-destructive">*</span>
          </Label>
          <Textarea
            id={`${formId}-reason`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            required
            dir="auto"
          />
          <p className="text-xs text-muted-foreground">{t('inmateStats.manualForm.reasonHint')}</p>
        </div>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2 border-t border-hairline pt-4">
        <Button type="submit" variant="commit" disabled={isWriting}>
          {t('inmateStats.actions.save')}
        </Button>
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel} disabled={isWriting}>
            {t('inmateStats.actions.cancel')}
          </Button>
        ) : null}
        {onDelete ? (
          <Button
            type="button"
            variant="destructive"
            disabled={isWriting}
            onClick={() => setDeleteOpen(true)}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            {t('inmateStats.actions.delete')}
          </Button>
        ) : null}
      </div>
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('inmateStats.manualForm.deleteTitle')}
        description={t('inmateStats.manualForm.deleteConfirm')}
        confirmLabel={t('inmateStats.actions.delete')}
        destructive
        onConfirm={() => onDelete?.()}
      />
    </form>
  )
}
