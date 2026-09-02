/**
 * Fines letter wizard — `/vehicles/:id/fines-letter`.
 *
 * Two steps, because the letter is a filed document and not a screen:
 *   1. which of the vehicle's fines the letter lists — every one of them to
 *      begin with, since "all outstanding fines" is the normal letter — plus
 *      the «Hide employee names» switch that turns it into the internal
 *      investigation copy;
 *   2. the same checklist beside a facsimile of the paper, then Save.
 *
 * The preview is not decoration: it is built from the exact same rules as
 * `backend/app/core/vehicle_letters.fines_letter_fields`, so what the operator
 * approves is what the DOCX prints — rows ordered by date then id and numbered
 * from 1 in that order, the plate written with a slash, the Arabic name first,
 * «—» in the name and G-number cells whenever the names are withheld or the
 * fine has no driver (imported EVG fines carry none), amounts as «349 درهم»
 * and dates as `dd/mm/yyyy`. The six columns stay put when names are hidden —
 * the template's table has six columns and prints the dash — so the operator
 * sees the redaction instead of a narrower table.
 *
 * Text the paper itself prints is read with an explicit `lng: 'ar'`: the sheet
 * is an Arabic letterhead document in both UI languages (the same reason
 * `PaperSheet` pins its own labels and its ink). Everything around the paper —
 * checklist, summary, actions — follows the UI language.
 *
 * Selection is stored as the *excluded* ids, so "all fines" needs no effect to
 * synchronise and a fine that arrives while the wizard is open is included
 * rather than silently dropped from the letter.
 *
 * Saving is a real generation: `POST /vehicles/{id}/fines/letter` mints the VF
 * book through the Records pipeline, so the wizard hands the operator over to
 * `/books/{book_id}`, where the PDF, the print action and the record live. The
 * route only requires `vehicles.view`; generating requires `vehicles.edit`, so
 * the whole wizard sits behind that capability instead of ending at a Save
 * button the API would refuse.
 */

import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Car, ChevronLeft, ChevronRight, FileText, Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { RefreshButton } from '@/components/refresh/RefreshButton'
import { RequireCapability } from '@/components/shell/RequireCapability'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { EmptyState } from '@/components/ui/empty-state'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, api } from '@/lib/api'
import type { VehicleFineRead } from '@/lib/api'
import { cn } from '@/lib/utils'

import {
  EMPTY_VALUE,
  VEHICLE_QUERY_KEYS,
  employeeLabel,
  formatAed,
  formatIsoDate,
  formatLetterAed,
  formatLetterDate,
  formatNumber,
  isArabic,
  plateLabel,
  vehicleErrorMessage,
} from './vehicleUtils'
import { PaperNote, PaperPlateBox, PaperSheet, PaperTable } from './components/PaperSheet'
import { PlateChip } from './components/PlateChip'
import { VehicleFormAlert } from './components/VehicleDialogShell'

/** What the reference line shows before the book exists. The real ref
 *  (`VF-0231`) is minted server-side and announced in the save toast. */
const REF_PLACEHOLDER = 'VF-____'

/** The id of the page's one error region, referenced by the Save button. */
const ERROR_ID = 'fines-letter-error'

/** The letter's own row order: date, then id — the order
 *  `vehicle_letter_service` sorts by before it numbers the rows, while the
 *  vehicle response hands its fines over newest-first. */
function letterOrder(a: VehicleFineRead, b: VehicleFineRead): number {
  return a.date === b.date ? a.id - b.id : a.date < b.date ? -1 : 1
}

export function VehicleFinesLetterPage(): React.JSX.Element {
  return (
    <RequireCapability cap="vehicles.edit">
      <FinesLetterWizard />
    </RequireCapability>
  )
}

function FinesLetterWizard(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  // A non-numeric path segment can never be a vehicle: no request is made and
  // the page says so straight away.
  const vehicleId = id && /^\d+$/.test(id) ? Number(id) : null

  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const isAr = isArabic(lang)
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const [step, setStep] = useState<1 | 2>(1)
  const [hideNames, setHideNames] = useState(false)
  /** Ids the operator has unticked; every other fine is in the letter. */
  const [excluded, setExcluded] = useState<ReadonlySet<number>>(() => new Set())
  const [error, setError] = useState<string | null>(null)

  const vehicleQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.detail(vehicleId ?? 0),
    queryFn: () => api.getVehicle(vehicleId as number),
    enabled: vehicleId != null,
  })

  const vehicle = vehicleQuery.data
  const fines = useMemo(() => vehicle?.fines ?? [], [vehicle?.fines])
  const plate = vehicle ? vehicle.plate_label || plateLabel(vehicle) : null

  /** Every fine in the letter's order — the checklist reads the same way the
   *  document will. */
  const orderedFines = useMemo(() => [...fines].sort(letterOrder), [fines])
  /** The rows the letter will carry: the single source for the preview, the
   *  running total and the payload. */
  const letterRows = useMemo(
    () => orderedFines.filter((fine) => !excluded.has(fine.id)),
    [orderedFines, excluded],
  )
  const selectedTotal = letterRows.reduce((sum, fine) => sum + fine.amount, 0)
  const hasSelection = letterRows.length > 0

  const generate = useMutation({
    mutationFn: () =>
      api.generateFinesLetter(vehicleId as number, {
        fine_ids: letterRows.map((fine) => fine.id),
        hide_names: hideNames,
      }),
    onMutate: () => setError(null),
    onSuccess: (result) => {
      // A new book lands in Records and on the dashboard counters; the fines
      // themselves are untouched, so no vehicle query needs refreshing.
      void queryClient.invalidateQueries({ queryKey: ['books'] })
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success(t('vehicles.letterSaved', { ref: result.ref_number }))
      navigate(`/books/${result.book_id}`)
    },
    onError: (err) => {
      const message = vehicleErrorMessage(err, t)
      setError(message)
      toast.error(message)
    },
  })

  const toggleFine = (fineId: number, next: boolean): void =>
    setExcluded((current) => {
      const draft = new Set(current)
      if (next) draft.delete(fineId)
      else draft.add(fineId)
      return draft
    })

  const notFound =
    vehicleId == null ||
    (vehicleQuery.error instanceof ApiError && vehicleQuery.error.status === 404)
  const backTo = vehicleId == null ? '/vehicles' : `/vehicles/${vehicleId}`

  const checklist = vehicle ? (
    <FineChecklist
      fines={orderedFines}
      excluded={excluded}
      onToggle={toggleFine}
      hideNames={hideNames}
      onHideNamesChange={setHideNames}
      busy={generate.isPending}
      selectedCount={letterRows.length}
      selectedTotal={selectedTotal}
    />
  ) : null

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <header className="shrink-0 px-4 pb-2 pt-3 md:px-6 md:pb-3 md:pt-5">
        <Link
          to={backTo}
          className="inline-flex items-center gap-1.5 text-[0.8em] font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          {isAr ? (
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          )}
          {t('vehicles.vehicleDetail')}
        </Link>

        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight text-foreground md:text-[1.55em]">
              {t('vehicles.generateTitle')}
              {plate && (
                <>
                  <span aria-hidden className="text-faint">
                    ·
                  </span>
                  <PlateChip plate={plate} size="lg" />
                </>
              )}
            </h1>
            <p className="mt-1 hidden text-[0.84em] text-muted-foreground md:block">
              {t('vehicles.generateDesc')}
            </p>
          </div>
          <RefreshButton />
        </div>

        {vehicle && fines.length > 0 && <WizardSteps step={step} />}
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-24 md:px-6">
        {notFound ? (
          <Panel>
            <EmptyState
              icon={Car}
              message={t('vehicles.noVehicles')}
              actionLabel={t('vehicles.backHub')}
              onAction={() => navigate('/vehicles')}
            />
          </Panel>
        ) : vehicleQuery.isError ? (
          <Panel>
            <EmptyState
              icon={Car}
              message={t('common.loadError')}
              actionLabel={t('common.retry')}
              onAction={() => void vehicleQuery.refetch()}
            />
          </Panel>
        ) : !vehicle ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-9 w-64" />
            <Skeleton className="h-72 w-full" />
          </div>
        ) : fines.length === 0 ? (
          <Panel>
            {/* Nothing to select and nothing to print: the letter cannot exist,
                so the only offer is the way back to the vehicle file, where a
                fine is added. */}
            <EmptyState
              icon={FileText}
              message={t('vehicles.noFines')}
              description={t('vehicles.addFineDesc')}
              actionLabel={t('vehicles.vehicleDetail')}
              onAction={() => navigate(backTo)}
            />
          </Panel>
        ) : (
          <>
            {step === 1 ? (
              checklist
            ) : (
              // Checklist first in the DOM: on a phone the operator scrolls
              // ticks → paper, which is the order the decision is made in.
              <div className="grid items-start gap-3 xl:grid-cols-2">
                {checklist}
                <LetterPreview plate={plate ?? ''} rows={letterRows} hideNames={hideNames} />
              </div>
            )}

            <div className="mt-3">
              <VehicleFormAlert id={ERROR_ID} message={error} />
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
              {step === 2 ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={generate.isPending}
                  onClick={() => setStep(1)}
                >
                  {t('vehicles.previous')}
                </Button>
              ) : (
                <Link to={backTo} className={buttonVariants({ variant: 'secondary' })}>
                  {t('vehicles.cancel')}
                </Link>
              )}

              <div className="flex flex-wrap items-center gap-2">
                {/* Why the primary action is unavailable, stated rather than
                    left to the operator to infer from a dim button. */}
                {!hasSelection && (
                  <span role="status" className="text-[0.76em] text-muted-foreground">
                    {t('vehicles.noSelected')}
                  </span>
                )}
                {step === 1 ? (
                  <Button type="button" disabled={!hasSelection} onClick={() => setStep(2)}>
                    <FileText className="h-3.5 w-3.5" aria-hidden />
                    {t('vehicles.previewDocument')}
                  </Button>
                ) : (
                  <Button
                    type="button"
                    disabled={!hasSelection || generate.isPending}
                    aria-describedby={error ? ERROR_ID : undefined}
                    onClick={() => generate.mutate()}
                  >
                    {generate.isPending ? (
                      <Loader2
                        aria-hidden
                        strokeWidth={1.8}
                        className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
                      />
                    ) : (
                      <FileText className="h-3.5 w-3.5" aria-hidden />
                    )}
                    {generate.isPending ? t('common.saving') : t('vehicles.saveDocument')}
                  </Button>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Panel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <section
      className={cn('overflow-hidden rounded-xl border border-border bg-surface', className)}
    >
      {children}
    </section>
  )
}

/** Where the operator is in the two-step flow. An ordered list, so the steps
 *  are announced as a sequence and not as two loose words. */
function WizardSteps({ step }: { step: 1 | 2 }): React.JSX.Element {
  const { t } = useTranslation()
  const steps = [
    { index: 1 as const, label: t('vehicles.stepSelect') },
    { index: 2 as const, label: t('vehicles.stepPreview') },
  ]

  return (
    <ol className="mt-3 flex flex-wrap items-center gap-2">
      {steps.map((entry, position) => {
        const active = entry.index === step
        const done = entry.index < step
        return (
          <li key={entry.index} className="flex items-center gap-2">
            {position > 0 && <span aria-hidden className="h-px w-6 bg-border sm:w-10" />}
            <span
              aria-current={active ? 'step' : undefined}
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[0.78em] font-semibold transition-colors motion-reduce:transition-none',
                active
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-border bg-surface text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'inline-flex h-5 w-5 items-center justify-center rounded-full font-mono text-[0.72em] tabular-nums',
                  active || done
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {entry.index}
              </span>
              {entry.label}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

// ── Step 1, and the left column of step 2 ───────────────────────────────────

function FineChecklist({
  fines,
  excluded,
  onToggle,
  hideNames,
  onHideNamesChange,
  busy,
  selectedCount,
  selectedTotal,
}: {
  fines: readonly VehicleFineRead[]
  excluded: ReadonlySet<number>
  onToggle: (fineId: number, next: boolean) => void
  hideNames: boolean
  onHideNamesChange: (next: boolean) => void
  busy: boolean
  selectedCount: number
  selectedTotal: number
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const unassigned = t('vehicles.unassigned')

  return (
    <Panel>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline px-3.5 py-2.5">
        <h2 className="text-[0.95em] font-semibold text-foreground">
          {t('vehicles.selectedFines')}
        </h2>
        <span className="text-[0.76em] text-muted-foreground">
          <bdi>{`${formatNumber(fines.length, lang)} ${t('vehicles.fineCount')}`}</bdi>
        </span>
      </header>

      <div className="px-3.5 py-3">
        <HideNamesSwitch checked={hideNames} onChange={onHideNamesChange} disabled={busy} />
      </div>

      <ul className="flex flex-col border-t border-hairline">
        {fines.map((fine) => (
          <li key={fine.id} className="border-b border-hairline last:border-b-0">
            <label
              className={cn(
                'flex cursor-pointer items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-surface-raised motion-reduce:transition-none',
                busy && 'cursor-not-allowed opacity-60',
              )}
            >
              <input
                type="checkbox"
                checked={!excluded.has(fine.id)}
                disabled={busy}
                onChange={(event) => onToggle(fine.id, event.target.checked)}
                className="h-4 w-4 shrink-0 rounded border-input accent-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface disabled:cursor-not-allowed"
              />
              <span className="min-w-0 flex-1">
                <span
                  dir="auto"
                  className="block truncate text-[0.86em] font-medium text-foreground"
                >
                  {employeeLabel(fine, lang, unassigned)}
                </span>
                <span className="mt-0.5 block text-[0.74em] text-muted-foreground">
                  <bdi className="font-mono tabular-nums">{formatIsoDate(fine.date)}</bdi>
                  <span aria-hidden> · </span>
                  <bdi className="font-mono tabular-nums">{fine.employee_id ?? EMPTY_VALUE}</bdi>
                  <span aria-hidden> · </span>
                  <bdi>{`${formatNumber(fine.black_points, lang)} ${t('vehicles.points')}`}</bdi>
                </span>
              </span>
              <strong className="shrink-0 text-[0.82em] font-semibold text-foreground">
                <bdi>{formatAed(fine.amount, lang)}</bdi>
              </strong>
            </label>
          </li>
        ))}
      </ul>

      <footer
        // The running answer to "what will this letter say": how many rows and
        // for how much, spoken as the ticks change.
        aria-live="polite"
        className="border-t border-hairline bg-surface-raised px-3.5 py-2.5 text-[0.8em] font-semibold text-foreground"
      >
        <bdi>
          {t('vehicles.selectedSummary', {
            count: selectedCount,
            total: formatNumber(selectedTotal, lang),
          })}
        </bdi>
      </footer>
    </Panel>
  )
}

/**
 * «Hide employee names» — the switch that turns the letter into the internal
 * investigation copy. The app's switch grammar (a `role="switch"` button with a
 * mirrored thumb, so RTL slides the right way), and the hint says what the copy
 * is for: the consequence — every name and G-number replaced by «—» in a filed
 * document — does not follow from the label alone.
 */
function HideNamesSwitch({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const label = t('vehicles.hideNames')
  return (
    <label className="flex items-center gap-3 rounded-md border border-hairline bg-muted/20 px-3 py-2.5">
      <span className="min-w-0">
        <span className="block text-[0.85em] font-medium text-foreground">{label}</span>
        <span className="mt-0.5 block text-[0.75em] text-muted-foreground">
          {t('vehicles.hideNamesHint')}
        </span>
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative ms-auto inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-surface',
          'disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform motion-reduce:transition-none',
            checked ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
    </label>
  )
}

// ── Step 2: the paper ───────────────────────────────────────────────────────

/** The template's six columns, in its own order — inside the RTL sheet the
 *  first cell sits on the right, exactly as the DOCX lays them out:
 *  «ت | اسم الموظف | الرقم الوظيفي | تاريخ المخالفة | مبلغ المخالفة | نقاط السوداء». */
const PAPER_COLUMNS = [
  'vehicles.sequence',
  'vehicles.employee',
  'vehicles.gNumber',
  'vehicles.paperFineDate',
  'vehicles.paperFineAmount',
  'vehicles.paperBlackPoints',
] as const

function LetterPreview({
  plate,
  rows,
  hideNames,
}: {
  plate: string
  rows: readonly VehicleFineRead[]
  hideNames: boolean
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <Panel>
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-hairline px-3.5 py-2.5">
        <h2 className="text-[0.95em] font-semibold text-foreground">
          {t('vehicles.paperPreview')}
        </h2>
        <span className="font-mono text-[0.76em] text-muted-foreground">
          <bdi dir="ltr">{REF_PLACEHOLDER}</bdi>
        </span>
      </header>

      {/* The sheet keeps its document proportions; a narrow viewport scrolls it
          rather than reflowing a letter that has one true layout. */}
      <div className="overflow-x-auto p-3">
        <PaperSheet
          reference={REF_PLACEHOLDER}
          title={t('vehicles.documentTitle', { lng: 'ar' })}
        >
          {/* The template writes the plate with a slash («10 / 90363»), not
              with the ledger's backslash. */}
          <PaperPlateBox
            label={t('vehicles.plate', { lng: 'ar' })}
            plate={plate.replace('\\', '/')}
          />

          {hideNames && <PaperNote>{t('vehicles.anonymousNote', { lng: 'ar' })}</PaperNote>}

          <PaperTable>
            <thead>
              <tr>
                {PAPER_COLUMNS.map((key) => (
                  <th key={key} scope="col">
                    {t(key, { lng: 'ar' })}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  {/* Never printed — the API refuses an empty letter — but the
                      paper must not look like a valid blank document either. */}
                  <td colSpan={PAPER_COLUMNS.length}>{t('vehicles.noSelected')}</td>
                </tr>
              ) : (
                rows.map((fine, index) => {
                  // The template's own rule: withheld names and driverless
                  // fines both print the dash, in both cells.
                  const anonymous = hideNames || fine.employee_id == null
                  const name = anonymous
                    ? EMPTY_VALUE
                    : fine.employee_name_ar || fine.employee_name_en || EMPTY_VALUE
                  return (
                    <tr key={fine.id}>
                      <td className="font-mono">{index + 1}</td>
                      <td>{name}</td>
                      <td className="font-mono">
                        {anonymous ? EMPTY_VALUE : <bdi dir="ltr">{fine.employee_id}</bdi>}
                      </td>
                      <td className="font-mono">
                        <bdi dir="ltr">{formatLetterDate(fine.date)}</bdi>
                      </td>
                      <td>{formatLetterAed(fine.amount)}</td>
                      <td className="font-mono">{fine.black_points}</td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </PaperTable>
        </PaperSheet>
      </div>
    </Panel>
  )
}
