import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, X } from 'lucide-react'

import type { InmateCompletionIn, InmateRegisterEntry } from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
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
import { useInmateNationalities } from './useInmateRegister'

const EMPTY_WING = '__none__'

interface CompletionLine {
  key: string
  name: string
  uid: string
  nationalityCode: string
  nationalityLabel: string
  wing: string
  holdingNo: string
  unresolvedNationality: boolean
}

interface CompletionFormProps {
  wings: readonly string[]
  sourceEntry: InmateRegisterEntry
  reportEntries: readonly InmateRegisterEntry[]
  isWriting: boolean
  onComplete: (args: { bookId: number; body: InmateCompletionIn }) => void
}

function lineFromEntry(entry: InmateRegisterEntry): CompletionLine {
  return {
    key: entry.id,
    name: entry.name,
    uid: entry.uid,
    nationalityCode:
      entry.nationality_code && entry.nationality_code !== 'XX' ? entry.nationality_code : '',
    nationalityLabel: entry.nationality_label,
    wing: entry.wing,
    holdingNo: entry.holding_no,
    unresolvedNationality: entry.nationality_code === 'XX',
  }
}

export function CompletionForm({
  wings,
  sourceEntry,
  reportEntries,
  isWriting,
  onComplete,
}: CompletionFormProps): React.JSX.Element {
  const { t } = useTranslation()
  const formId = useId()
  const reporterLabelId = useId()
  const nationalities = useInmateNationalities()
  const [reportTime, setReportTime] = useState('')
  const [reporterId, setReporterId] = useState(sourceEntry.reporter_id ?? '')
  const [violationDetails, setViolationDetails] = useState(sourceEntry.details_text)
  const [nextLine, setNextLine] = useState(1)
  const [lines, setLines] = useState<CompletionLine[]>(() => reportEntries.map(lineFromEntry))
  const [error, setError] = useState<string | null>(null)
  const options = (nationalities.data?.items ?? []).filter((item) => item.selectable)
  const bookId = sourceEntry.completion_book_id

  const updateLine = (key: string, patch: Partial<CompletionLine>): void => {
    setLines((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    )
  }

  const submit = (event: React.FormEvent<HTMLFormElement>): void => {
    event.preventDefault()
    if (
      bookId == null ||
      !reportTime ||
      !reporterId ||
      !violationDetails.trim() ||
      lines.length === 0 ||
      lines.some((line) => !line.name.trim())
    ) {
      setError(t('inmateStats.completion.required'))
      return
    }
    const body: InmateCompletionIn = {
      report_time: reportTime,
      reporter_id: reporterId,
      violation_details: violationDetails.trim(),
      inmates: lines.map((line) => {
        const nationality = options.find((item) => item.code === line.nationalityCode)
        return {
          name: line.name.trim(),
          uid: line.uid.trim() || null,
          nationality: line.nationalityCode
            ? (nationality?.label_ar ?? line.nationalityLabel)
            : null,
          wing: line.wing || null,
          holding_no: line.holdingNo.trim() || null,
        }
      }),
    }
    setError(null)
    onComplete({ bookId, body })
  }

  return (
    <form className="space-y-5" onSubmit={submit}>
      <div className="rounded-lg border border-warning/30 bg-warning-soft p-3">
        <Badge tone="warning">{t('inmateStats.inspector.pendingCompletion')}</Badge>
        <h3 className="mt-2 text-base font-semibold">{t('inmateStats.completion.title')}</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
          {t('inmateStats.completion.hint')}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor={`${formId}-time`}>
            {t('inmateStats.completion.reportTime')}
            <span className="ms-0.5 text-destructive">*</span>
          </Label>
          <Input
            id={`${formId}-time`}
            type="time"
            value={reportTime}
            onChange={(event) => setReportTime(event.target.value)}
            required
            dir="ltr"
          />
        </div>
        <div className="space-y-1.5">
          <Label id={reporterLabelId}>
            {t('inmateStats.completion.reporter')}
            <span className="ms-0.5 text-destructive">*</span>
          </Label>
          <div role="group" aria-labelledby={reporterLabelId}>
            <EmployeePicker
              selectedId={reporterId || null}
              onSelect={(id) => setReporterId(id ?? '')}
            />
          </div>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor={`${formId}-details`}>
          {t('inmateStats.completion.details')}
          <span className="ms-0.5 text-destructive">*</span>
        </Label>
        <Textarea
          id={`${formId}-details`}
          value={violationDetails}
          onChange={(event) => setViolationDetails(event.target.value)}
          required
          rows={6}
          dir="auto"
        />
      </div>

      <fieldset className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <legend className="text-sm font-semibold">{t('inmateStats.completion.inmates')}</legend>
          <Button
            type="button"
            size="xs"
            variant="secondary"
            onClick={() => {
              const key = `new-${nextLine}`
              setNextLine((value) => value + 1)
              setLines((current) => [
                ...current,
                {
                  key,
                  name: '',
                  uid: '',
                  nationalityCode: '',
                  nationalityLabel: '',
                  wing: '',
                  holdingNo: '',
                  unresolvedNationality: false,
                },
              ])
            }}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('inmateStats.completion.addLine')}
          </Button>
        </div>

        {lines.map((line, index) => (
          <div key={line.key} className="rounded-lg border border-hairline bg-surface p-3">
            <div className="mb-3 flex items-center justify-between gap-2">
              <span className="font-mono text-xs font-semibold text-muted-foreground" dir="ltr">
                #{index + 1}
              </span>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                aria-label={t('inmateStats.completion.removeLine')}
                onClick={() => setLines((current) => current.filter((item) => item.key !== line.key))}
              >
                <X className="h-3.5 w-3.5" aria-hidden />
              </Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor={`${formId}-${line.key}-name`}>{t('inmateStats.columns.name')}</Label>
                <Input
                  id={`${formId}-${line.key}-name`}
                  value={line.name}
                  onChange={(event) => updateLine(line.key, { name: event.target.value })}
                  required
                  dir="auto"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-${line.key}-uid`}>{t('inmateStats.columns.uid')}</Label>
                <Input
                  id={`${formId}-${line.key}-uid`}
                  value={line.uid}
                  onChange={(event) => updateLine(line.key, { uid: event.target.value })}
                  dir="ltr"
                />
              </div>
              <NationalityPicker
                label={t('inmateStats.columns.nationality')}
                value={line.nationalityCode}
                options={options}
                loading={nationalities.isLoading}
                loadError={nationalities.isError}
                onChange={(nationalityCode) => updateLine(line.key, { nationalityCode })}
                disabled={nationalities.isLoading || nationalities.isError}
                unresolved={line.unresolvedNationality}
              />
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-${line.key}-wing`}>{t('inmateStats.inspector.wing')}</Label>
                <Select
                  value={wings.includes(line.wing) ? line.wing : EMPTY_WING}
                  onValueChange={(value) =>
                    updateLine(line.key, { wing: value === EMPTY_WING ? '' : value })
                  }
                >
                  <SelectTrigger id={`${formId}-${line.key}-wing`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={EMPTY_WING}>—</SelectItem>
                    {wings.map((value) => (
                      <SelectItem key={value} value={value}>
                        <bdi dir="ltr">{value}</bdi>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {line.wing && !wings.includes(line.wing) ? <p className="text-sm text-warning">{t('inmateStats.workflow.invalidWing')} <bdi dir="ltr">{line.wing}</bdi></p> : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor={`${formId}-${line.key}-holding`}>{t('inmateStats.inspector.holdingNo')}</Label>
                <Input
                  id={`${formId}-${line.key}-holding`}
                  value={line.holdingNo}
                  onChange={(event) => updateLine(line.key, { holdingNo: event.target.value })}
                  dir="ltr"
                />
              </div>
            </div>
          </div>
        ))}
      </fieldset>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {t('inmateStats.completion.nationalityGate')}
      </p>
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : null}
      <div className="border-t border-hairline pt-4">
        <Button type="submit" variant="commit" disabled={isWriting || bookId == null}>
          {t('inmateStats.actions.complete')}
        </Button>
      </div>
    </form>
  )
}
