/**
 * Vehicle file — `/vehicles/:id`.
 *
 * The whole record of one vehicle on one page: a photo + facts overview, then
 * five registers behind a chip bar — Fines, Renewals, Accidents, Maintenance,
 * Photos. The active register lives in the URL (`?tab=accidents`), so the
 * accidents register can link straight at it and a reload keeps its place.
 *
 * Everything comes from `GET /vehicles/{id}` (`['vehicle', id]`): the fines,
 * the archived license periods, the incident reports, the maintenance log and
 * the gallery are all fields of that one response, so no register can disagree
 * with the overview. The operating-site name is the one fact the response does
 * not carry (it holds `site_id`), and comes from the cached sites list.
 *
 * Ownership of writes: every dialog (Renew, Fine, Accident, Maintenance) and
 * `AccidentCard` own their own mutation, toast and invalidation — this page
 * only decides which one is open. Its own mutations are the three the dialogs
 * do not cover: delete a fine, delete a maintenance row, and add/remove a
 * gallery photo. All of them go through `invalidateVehicleQueries`, so the hub
 * summary, the ledger and the fleet-wide registers refresh with this file.
 *
 * Capability gating: `vehicles.view` is enforced by the route. Renew, Add fine,
 * Generate letter, New report, Add maintenance and the photo upload need
 * `vehicles.edit`; every delete needs `vehicles.delete` and a confirmation. A
 * viewer is never shown a control the API would refuse.
 */

import { useCallback, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Car,
  ChevronLeft,
  ChevronRight,
  FileText,
  History,
  Image as ImageIcon,
  Pencil,
  Trash2,
  Wrench,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import { FileTypeIcon } from '@/components/ledger/FileTypeIcon'
import { RefreshButton } from '@/components/refresh/RefreshButton'
import { Button } from '@/components/ui/button'
import { buttonVariants } from '@/components/ui/button-variants'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { DocumentViewerDialog } from '@/components/ui/document-viewer-dialog'
import type { DocViewerItem } from '@/components/ui/document-viewer-dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { FileUploadZone } from '@/components/ui/file-upload-zone'
import { Skeleton } from '@/components/ui/skeleton'
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ApiError, api } from '@/lib/api'
import type {
  VehicleFileRead,
  VehicleFineRead,
  VehicleMaintenanceRead,
  VehicleRead,
} from '@/lib/api'
import { toBase64Url } from '@/lib/pdf'
import { useCapabilities } from '@/lib/useCapabilities'
import { useIsMobile } from '@/lib/useIsMobile'
import { cn } from '@/lib/utils'

import {
  EMPTY_VALUE,
  IMAGE_ACCEPT,
  VEHICLE_QUERY_KEYS,
  employeeLabel,
  formatAed,
  formatDateTime,
  formatIsoDate,
  formatNumber,
  invalidateVehicleQueries,
  isArabic,
  localized,
  plateLabel,
  vehicleErrorMessage,
} from './vehicleUtils'
import { AccidentCard } from './components/AccidentCard'
import { AccidentDialog } from './components/AccidentDialog'
import { FineDialog } from './components/FineDialog'
import { MaintenanceDialog } from './components/MaintenanceDialog'
import { PlateChip } from './components/PlateChip'
import { RenewLicenseDialog } from './components/RenewLicenseDialog'
import { VehicleFileThumb } from './components/VehicleFileViewer'
import { VehicleStatusBadge } from './components/VehicleStatusBadge'

/** The registers, in the order they are worked. `fines` is the default and is
 *  therefore the one state the URL does not spell out. */
const TABS = ['fines', 'renewals', 'accidents', 'maintenance', 'photos'] as const
type VehicleTab = (typeof TABS)[number]

const TAB_LABELS: Record<VehicleTab, string> = {
  fines: 'vehicles.tabFines',
  renewals: 'vehicles.tabRenewals',
  accidents: 'vehicles.tabAccidents',
  maintenance: 'vehicles.tabMaintenance',
  photos: 'vehicles.tabPhotos',
}

/** One archived license period (`VehicleRead.renewals[]`). */
type Renewal = NonNullable<VehicleRead['renewals']>[number]

/** Which fine the dialog is about: a new one, or an existing row to edit. */
type FineTarget = { mode: 'add' } | { mode: 'edit'; fine: VehicleFineRead }

function tabFromSearch(params: URLSearchParams): VehicleTab {
  const value = params.get('tab') ?? ''
  return TABS.includes(value as VehicleTab) ? (value as VehicleTab) : 'fines'
}

export function VehicleDetailPage(): React.JSX.Element {
  const { id } = useParams<{ id: string }>()
  // A non-numeric path segment can never be a vehicle: no request is made and
  // the page answers "no matching vehicles" straight away.
  const vehicleId = id && /^\d+$/.test(id) ? Number(id) : null
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = tabFromSearch(searchParams)

  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const isAr = isArabic(lang)
  const queryClient = useQueryClient()
  const { has } = useCapabilities()
  const canEdit = has('vehicles.edit')
  const canDelete = has('vehicles.delete')
  const isMobile = useIsMobile()

  const [renewOpen, setRenewOpen] = useState(false)
  const [fineTarget, setFineTarget] = useState<FineTarget | null>(null)
  const [accidentOpen, setAccidentOpen] = useState(false)
  const [maintenanceOpen, setMaintenanceOpen] = useState(false)
  const [fineToDelete, setFineToDelete] = useState<VehicleFineRead | null>(null)
  const [recordToDelete, setRecordToDelete] = useState<VehicleMaintenanceRead | null>(null)
  const [photoToDelete, setPhotoToDelete] = useState<VehicleFileRead | null>(null)

  const vehicleQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.detail(vehicleId ?? 0),
    queryFn: () => api.getVehicle(vehicleId as number),
    enabled: vehicleId != null,
  })
  // Only the site name is missing from the vehicle response; the list is small,
  // shared with the hub and the dialogs, and rarely changes.
  const sitesQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.sites,
    queryFn: () => api.listVehicleSites(),
    enabled: vehicleId != null,
    staleTime: 60_000,
  })

  const selectTab = useCallback(
    (next: VehicleTab) => {
      setSearchParams(
        (previous) => {
          const params = new URLSearchParams(previous)
          if (next === 'fines') params.delete('tab')
          else params.set('tab', next)
          return params
        },
        // Switching register is not a navigation step: Back returns to whatever
        // brought the operator here, not to the previous chip.
        { replace: true },
      )
    },
    [setSearchParams],
  )

  const deleteFine = useMutation({
    mutationFn: (target: { vehicleId: number; fineId: number }) =>
      api.deleteVehicleFine(target.vehicleId, target.fineId),
    onSuccess: (_updated, target) => {
      invalidateVehicleQueries(queryClient, {
        vehicleId: target.vehicleId,
        registers: ['fines'],
      })
      toast.success(t('vehicles.fineDeleted'))
    },
    onError: (err) => toast.error(vehicleErrorMessage(err, t)),
  })

  const deleteMaintenance = useMutation({
    mutationFn: (target: { vehicleId: number; maintenanceId: number }) =>
      api.deleteVehicleMaintenance(target.vehicleId, target.maintenanceId),
    onSuccess: (_result, target) => {
      invalidateVehicleQueries(queryClient, {
        vehicleId: target.vehicleId,
        registers: ['maintenance'],
      })
      toast.success(t('common.deletedToast'))
    },
    onError: (err) => toast.error(vehicleErrorMessage(err, t)),
  })

  const uploadPhoto = useMutation({
    mutationFn: (target: { vehicleId: number; file: File }) =>
      // Both halves of the label are written now, so the tile reads correctly
      // in the other language too without a second request.
      api.uploadVehicleFile(target.vehicleId, 'gallery', target.file, {
        label_ar: t('vehicles.newPhoto', { lng: 'ar' }),
        label_en: t('vehicles.newPhoto', { lng: 'en' }),
      }),
    onSuccess: (_file, target) => {
      invalidateVehicleQueries(queryClient, { vehicleId: target.vehicleId })
      toast.success(t('common.savedToast'))
    },
    onError: (err) => toast.error(vehicleErrorMessage(err, t)),
  })

  const deletePhoto = useMutation({
    mutationFn: (target: { vehicleId: number; fileId: number }) =>
      api.deleteVehicleFile(target.vehicleId, target.fileId),
    onSuccess: (_result, target) => {
      invalidateVehicleQueries(queryClient, { vehicleId: target.vehicleId })
      toast.success(t('common.deletedToast'))
    },
    onError: (err) => toast.error(vehicleErrorMessage(err, t)),
  })

  const vehicle = vehicleQuery.data
  const notFound =
    vehicleId == null ||
    (vehicleQuery.error instanceof ApiError && vehicleQuery.error.status === 404)
  const plate = vehicle ? vehicle.plate_label || plateLabel(vehicle) : null
  const fines = vehicle?.fines ?? []
  const renewals = vehicle?.renewals ?? []
  const accidents = vehicle?.accidents ?? []
  const maintenance = vehicle?.maintenance ?? []
  const photos = vehicle?.photos ?? []
  const galleryCount =
    photos.length + (vehicle?.photo_url ? 1 : 0) + (vehicle?.license_url ? 1 : 0)
  const counts: Record<VehicleTab, number> = {
    fines: fines.length,
    renewals: renewals.length,
    accidents: accidents.length,
    maintenance: maintenance.length,
    photos: galleryCount,
  }

  const site = sitesQuery.data?.find((candidate) => candidate.id === vehicle?.site_id)
  const siteLabel = site
    ? localized(site.name_ar, site.name_en, lang)
    : sitesQuery.data && vehicle
      ? `#${vehicle.site_id}`
      : EMPTY_VALUE

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <header className="shrink-0 px-4 pb-2 pt-3 md:px-6 md:pb-3 md:pt-5">
        <Link
          to="/vehicles"
          className="inline-flex items-center gap-1.5 text-[0.8em] font-medium text-primary transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background motion-reduce:transition-none"
        >
          {isAr ? (
            <ChevronRight className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          ) : (
            <ChevronLeft className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
          )}
          {t('vehicles.backHub')}
        </Link>

        <div className="mt-1.5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-xl font-bold tracking-tight text-foreground md:text-[1.55em]">
              {t('vehicles.vehicleDetail')}
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
              {t('vehicles.detailDesc')}
            </p>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            {vehicle && canEdit && (
              <>
                <Button
                  type="button"
                  size="sm"
                  // Primary only while the license actually needs attention —
                  // on a valid license Renew is a background action.
                  variant={vehicle.expiry_status === 'valid' ? 'secondary' : 'default'}
                  onClick={() => setRenewOpen(true)}
                >
                  {t('vehicles.renew')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => setFineTarget({ mode: 'add' })}
                >
                  {t('vehicles.addFine')}
                </Button>
                {fines.length > 0 ? (
                  <Link
                    to={`/vehicles/${vehicle.id}/fines-letter`}
                    className={buttonVariants({ size: 'sm' })}
                  >
                    <FileText className="h-3.5 w-3.5" aria-hidden />
                    {t('vehicles.generateDocument')}
                  </Link>
                ) : (
                  // A letter with no fines is not a document the API accepts;
                  // the action stays visible so its absence is explained.
                  <Button type="button" size="sm" disabled title={t('vehicles.noFines')}>
                    <FileText className="h-3.5 w-3.5" aria-hidden />
                    {t('vehicles.generateDocument')}
                  </Button>
                )}
              </>
            )}
            <RefreshButton />
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-24 md:px-6">
        {notFound ? (
          <div className="rounded-xl border border-border bg-surface">
            <EmptyState icon={Car} message={t('vehicles.noVehicles')} />
          </div>
        ) : vehicleQuery.isError ? (
          <div className="rounded-xl border border-border bg-surface">
            <EmptyState
              icon={Car}
              message={t('common.loadError')}
              actionLabel={t('common.retry')}
              onAction={() => void vehicleQuery.refetch()}
            />
          </div>
        ) : !vehicle ? (
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 rounded-xl border border-border bg-surface p-3.5 md:grid-cols-[240px_1fr]">
              <Skeleton className="h-[180px] w-full" />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Skeleton key={index} className="h-10 w-full" />
                ))}
              </div>
            </div>
            <Skeleton className="h-9 w-72" />
            <Skeleton className="h-56 w-full" />
          </div>
        ) : (
          <>
            <OverviewPanel vehicle={vehicle} plate={plate ?? ''} siteLabel={siteLabel} />

            <div
              className="mt-4 flex flex-wrap gap-1.5"
              role="group"
              aria-label={t('vehicles.vehicleDetail')}
            >
              {TABS.map((candidate) => (
                <TabChip
                  key={candidate}
                  active={tab === candidate}
                  count={counts[candidate]}
                  label={t(TAB_LABELS[candidate])}
                  onClick={() => selectTab(candidate)}
                />
              ))}
            </div>

            <div className="mt-3">
              {tab === 'fines' && (
                <FinesPanel
                  vehicle={vehicle}
                  fines={fines}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  isMobile={isMobile}
                  busy={deleteFine.isPending}
                  onEdit={(fine) => setFineTarget({ mode: 'edit', fine })}
                  onDelete={setFineToDelete}
                />
              )}
              {tab === 'renewals' && (
                <RenewalsPanel
                  vehicle={vehicle}
                  renewals={renewals}
                  canEdit={canEdit}
                  onRenew={() => setRenewOpen(true)}
                />
              )}
              {tab === 'accidents' && (
                <AccidentsPanel
                  accidents={accidents}
                  canEdit={canEdit}
                  onAdd={() => setAccidentOpen(true)}
                />
              )}
              {tab === 'maintenance' && (
                <MaintenancePanel
                  records={maintenance}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  isMobile={isMobile}
                  busy={deleteMaintenance.isPending}
                  onAdd={() => setMaintenanceOpen(true)}
                  onDelete={setRecordToDelete}
                />
              )}
              {tab === 'photos' && (
                <PhotosPanel
                  vehicle={vehicle}
                  photos={photos}
                  count={galleryCount}
                  canEdit={canEdit}
                  canDelete={canDelete}
                  uploading={uploadPhoto.isPending}
                  deleting={deletePhoto.isPending}
                  onUpload={(file) => uploadPhoto.mutate({ vehicleId: vehicle.id, file })}
                  onDelete={setPhotoToDelete}
                />
              )}
            </div>
          </>
        )}
      </div>

      {/* Dialogs. Each owns its mutation, toast and invalidation; this page owns
          only whether it is open, and remounts it per target so the form never
          opens with the previous row's values. */}
      {vehicle && canEdit && (
        <>
          {renewOpen && (
            <RenewLicenseDialog
              open
              vehicle={vehicle}
              onOpenChange={(open) => {
                if (!open) setRenewOpen(false)
              }}
            />
          )}
          {fineTarget && (
            <FineDialog
              open
              key={fineTarget.mode === 'edit' ? `fine-${fineTarget.fine.id}` : 'fine-new'}
              vehicle={vehicle}
              fine={fineTarget.mode === 'edit' ? fineTarget.fine : null}
              onOpenChange={(open) => {
                if (!open) setFineTarget(null)
              }}
            />
          )}
          {accidentOpen && (
            <AccidentDialog
              open
              vehicle={vehicle}
              onOpenChange={(open) => {
                if (!open) setAccidentOpen(false)
              }}
            />
          )}
          {maintenanceOpen && (
            <MaintenanceDialog
              open
              vehicle={vehicle}
              onOpenChange={(open) => {
                if (!open) setMaintenanceOpen(false)
              }}
            />
          )}
        </>
      )}

      {vehicle && canDelete && (
        <>
          <ConfirmDialog
            open={fineToDelete != null}
            onOpenChange={(open) => {
              if (!open) setFineToDelete(null)
            }}
            title={t('vehicles.delete')}
            description={t('vehicles.deleteConfirm')}
            confirmLabel={t('vehicles.delete')}
            destructive
            onConfirm={() => {
              if (fineToDelete) {
                deleteFine.mutate({ vehicleId: vehicle.id, fineId: fineToDelete.id })
              }
              setFineToDelete(null)
            }}
          />
          <ConfirmDialog
            open={recordToDelete != null}
            onOpenChange={(open) => {
              if (!open) setRecordToDelete(null)
            }}
            title={t('vehicles.delete')}
            description={t('vehicles.deleteConfirm')}
            confirmLabel={t('vehicles.delete')}
            destructive
            onConfirm={() => {
              if (recordToDelete) {
                deleteMaintenance.mutate({
                  vehicleId: vehicle.id,
                  maintenanceId: recordToDelete.id,
                })
              }
              setRecordToDelete(null)
            }}
          />
          <ConfirmDialog
            open={photoToDelete != null}
            onOpenChange={(open) => {
              if (!open) setPhotoToDelete(null)
            }}
            title={t('vehicles.delete')}
            description={t('vehicles.deleteConfirm')}
            confirmLabel={t('vehicles.delete')}
            destructive
            onConfirm={() => {
              if (photoToDelete) {
                deletePhoto.mutate({ vehicleId: vehicle.id, fileId: photoToDelete.id })
              }
              setPhotoToDelete(null)
            }}
          />
        </>
      )}
    </div>
  )
}

// ── Shared page furniture ───────────────────────────────────────────────────

function Panel({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <section className={cn('overflow-hidden rounded-xl border border-border bg-surface', className)}>
      {children}
    </section>
  )
}

function PanelHeader({
  title,
  subtitle,
  actions,
}: {
  title: string
  subtitle?: React.ReactNode
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-hairline px-3 py-2.5">
      <div className="min-w-0">
        <h2 className="text-[0.88rem] font-semibold tracking-tight text-foreground">{title}</h2>
        {subtitle != null && (
          <p className="mt-0.5 text-[0.7rem] text-muted-foreground">{subtitle}</p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

/** A digit run (plate, code, date, VIN) kept left-to-right inside Arabic. */
function Mono({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <bdi dir="ltr" className="font-mono tabular-nums">
      {children}
    </bdi>
  )
}

function InfoItem({
  label,
  children,
  className,
}: {
  label: string
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('min-w-0', className)}>
      <dt className="text-[0.63rem] uppercase tracking-[0.06em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-[0.78rem] font-medium text-foreground">{children}</dd>
    </div>
  )
}

function TabChip({
  active,
  label,
  count,
  onClick,
}: {
  active: boolean
  label: string
  count: number
  onClick: () => void
}): React.JSX.Element {
  const { i18n } = useTranslation()
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-[0.78rem] font-semibold transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'motion-reduce:transition-none',
        active
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border bg-surface text-muted-foreground hover:border-border-strong hover:text-foreground',
      )}
    >
      {label}
      <span
        className={cn(
          'font-mono text-[0.7rem] tabular-nums',
          active ? 'opacity-75' : 'text-faint',
        )}
      >
        {formatNumber(count, i18n.language)}
      </span>
    </button>
  )
}

/**
 * An attachment the API exposes as a bare URL: the main photo, the current
 * license scan, an archived renewal scan, a maintenance receipt. `VehicleRead`
 * carries no media type for those (only `photos[]` are full `VehicleFileRead`
 * rows), so the tile renders the file as an image and, when the browser cannot
 * decode it, switches to the PDF viewer — `.pdf` is the only non-image type
 * `vehicle_service` accepts for a license or a receipt. PDFs are read through
 * `?encoding=base64`, which the WebView2/IDM handler cannot hijack.
 */
function UrlFileTile({
  url,
  label,
  className,
  showLabel = false,
}: {
  url: string
  label: string
  className?: string
  showLabel?: boolean
}): React.JSX.Element {
  const [isPdf, setIsPdf] = useState(false)
  const [open, setOpen] = useState(false)
  const item: DocViewerItem = isPdf
    ? { name: label, kind: 'pdf', pdfBase64Url: toBase64Url(url), openUrl: url, downloadUrl: url }
    : { name: label, kind: 'image', imageUrl: url, openUrl: url, downloadUrl: url }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={label}
        title={label}
        className={cn(
          'flex flex-col items-stretch overflow-hidden rounded-lg border border-border bg-surface-raised',
          'transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
          'motion-reduce:transition-none',
          className ?? 'h-[38px] w-[54px]',
        )}
      >
        {isPdf ? (
          <span className="flex min-h-0 w-full flex-1 items-center justify-center p-1.5">
            <FileTypeIcon kind="pdf" size={22} />
          </span>
        ) : (
          <img
            src={url}
            alt=""
            loading="lazy"
            onError={() => setIsPdf(true)}
            className="min-h-0 w-full flex-1 object-cover"
          />
        )}
        {showLabel && (
          <span
            className="truncate border-t border-hairline px-2 py-1 text-[0.66rem] text-muted-foreground"
            dir="auto"
          >
            {label}
          </span>
        )}
      </button>
      {open && <DocumentViewerDialog items={[item]} onClose={() => setOpen(false)} />}
    </>
  )
}

/** The same box as `UrlFileTile`, for a record that carries no file yet. */
function MissingFileTile({
  icon: Icon,
  label,
  className,
}: {
  icon: LucideIcon
  label: string
  className?: string
}): React.JSX.Element {
  return (
    <span
      className={cn(
        'grid place-items-center rounded-lg border border-dashed border-border bg-surface-raised',
        className ?? 'h-[38px] w-[54px]',
      )}
    >
      <span className="flex flex-col items-center gap-1 p-2 text-center text-[0.64rem] text-muted-foreground">
        <Icon className="h-4 w-4 text-faint" strokeWidth={1.6} aria-hidden />
        {label}
      </span>
    </span>
  )
}

// ── Overview ────────────────────────────────────────────────────────────────

function OverviewPanel({
  vehicle,
  plate,
  siteLabel,
}: {
  vehicle: VehicleRead
  plate: string
  siteLabel: string
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language

  return (
    <Panel className="md:grid md:grid-cols-[240px_1fr]">
      <div className="relative min-h-[170px] md:min-h-[228px]">
        {vehicle.photo_url ? (
          <UrlFileTile
            url={vehicle.photo_url}
            label={t('vehicles.mainPhoto')}
            className="h-full min-h-[170px] w-full rounded-none border-0 md:min-h-[228px]"
          />
        ) : (
          <MissingFileTile
            icon={Car}
            label={t('vehicles.mainPhoto')}
            className="h-full min-h-[170px] w-full rounded-none border-0 md:min-h-[228px]"
          />
        )}
        {vehicle.photo_url && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-3 bottom-2.5 truncate rounded-lg bg-primary/85 px-2 py-1 text-[0.62rem] font-medium text-primary-foreground"
          >
            {t('vehicles.mainPhoto')}
          </span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-hairline p-3.5 sm:grid-cols-3 md:border-s md:border-t-0">
        <InfoItem label={t('vehicles.plate')}>
          <Mono>{plate}</Mono>
        </InfoItem>
        <InfoItem label={t('vehicles.type')}>
          <span dir="auto">{localized(vehicle.type_ar, vehicle.type_en, lang)}</span>
        </InfoItem>
        <InfoItem label={t('vehicles.class')}>
          <span dir="auto">{localized(vehicle.class_ar, vehicle.class_en, lang)}</span>
        </InfoItem>
        <InfoItem label={t('vehicles.trafficCode')}>
          <Mono>{vehicle.traffic_code}</Mono>
        </InfoItem>
        <InfoItem label={t('vehicles.licenseStart')}>
          <Mono>{formatIsoDate(vehicle.license_start)}</Mono>
        </InfoItem>
        <InfoItem label={t('vehicles.licenseExpiry')}>
          <span className="flex flex-wrap items-center gap-1.5">
            <Mono>{formatIsoDate(vehicle.license_expiry)}</Mono>
            <VehicleStatusBadge family="expiry" status={vehicle.expiry_status} />
          </span>
        </InfoItem>
        <InfoItem label={t('vehicles.vin')}>
          <Mono>{vehicle.vin || EMPTY_VALUE}</Mono>
        </InfoItem>
        <InfoItem label={t('vehicles.site')}>
          <span dir="auto">{siteLabel}</span>
        </InfoItem>
        <InfoItem label={t('vehicles.contractNote')} className="col-span-2 sm:col-span-1">
          <span dir="auto">
            {localized(vehicle.contract_note_ar, vehicle.contract_note_en, lang) || EMPTY_VALUE}
          </span>
        </InfoItem>
      </dl>
    </Panel>
  )
}

// ── Fines ───────────────────────────────────────────────────────────────────

function FinesPanel({
  vehicle,
  fines,
  canEdit,
  canDelete,
  isMobile,
  busy,
  onEdit,
  onDelete,
}: {
  vehicle: VehicleRead
  fines: readonly VehicleFineRead[]
  canEdit: boolean
  canDelete: boolean
  isMobile: boolean
  busy: boolean
  onEdit: (fine: VehicleFineRead) => void
  onDelete: (fine: VehicleFineRead) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  const showActions = canEdit || canDelete

  return (
    <Panel>
      <PanelHeader
        title={t('vehicles.tabFines')}
        subtitle={
          <bdi>
            {`${formatNumber(fines.length, lang)} ${t('vehicles.fineCount')} · ${formatAed(
              vehicle.fines_amount,
              lang,
            )} · ${formatNumber(vehicle.black_points, lang)} ${t('vehicles.points')}`}
          </bdi>
        }
      />
      {fines.length === 0 ? (
        <EmptyState icon={FileText} message={t('vehicles.noFines')} />
      ) : isMobile ? (
        <div className="flex flex-col gap-2.5 p-2.5">
          {fines.map((fine, index) => (
            <FineCard
              key={fine.id}
              fine={fine}
              index={index}
              canEdit={canEdit}
              canDelete={canDelete}
              busy={busy}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className="w-[54px]">{t('vehicles.sequence')}</TableHead>
                <TableHead>{t('vehicles.employee')}</TableHead>
                <TableHead>{t('vehicles.gNumber')}</TableHead>
                <TableHead>{t('vehicles.date')}</TableHead>
                <TableHead>{t('vehicles.amount')}</TableHead>
                <TableHead>{t('vehicles.blackPoints')}</TableHead>
                {showActions && <TableHead className="text-end">{t('vehicles.action')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {fines.map((fine, index) => (
                <TableRow key={fine.id}>
                  <TableCell className="w-[54px] font-mono text-[0.72rem] tabular-nums text-muted-foreground">
                    {formatNumber(index + 1, lang)}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-col">
                      <strong className="text-[0.78rem] font-semibold text-foreground" dir="auto">
                        {employeeLabel(fine, lang, t('vehicles.unassigned'))}
                      </strong>
                      {fine.evg_ticket_no && (
                        <small
                          className="font-mono text-[0.64rem] text-muted-foreground"
                          title={t('vehicles.evg.sourceRow')}
                        >
                          <bdi dir="ltr">{fine.evg_ticket_no}</bdi>
                        </small>
                      )}
                    </span>
                  </TableCell>
                  <TableCell className="text-[0.72rem]">
                    <Mono>{fine.employee_id || EMPTY_VALUE}</Mono>
                  </TableCell>
                  <TableCell className="text-[0.74rem]">
                    <Mono>{formatDateTime(fine.date, fine.time)}</Mono>
                  </TableCell>
                  <TableCell className="text-[0.76rem] font-medium">
                    <bdi>{formatAed(fine.amount, lang)}</bdi>
                  </TableCell>
                  <TableCell className="font-mono text-[0.74rem] tabular-nums">
                    {formatNumber(fine.black_points, lang)}
                  </TableCell>
                  {showActions && (
                    <TableCell className="text-end">
                      <FineActions
                        fine={fine}
                        canEdit={canEdit}
                        canDelete={canDelete}
                        busy={busy}
                        onEdit={onEdit}
                        onDelete={onDelete}
                      />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      )}
    </Panel>
  )
}

/** Edit (assign a driver, fix an amount) and delete, shared by row and card. */
function FineActions({
  fine,
  canEdit,
  canDelete,
  busy,
  onEdit,
  onDelete,
}: {
  fine: VehicleFineRead
  canEdit: boolean
  canDelete: boolean
  busy: boolean
  onEdit: (fine: VehicleFineRead) => void
  onDelete: (fine: VehicleFineRead) => void
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-end gap-1">
      {canEdit && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t('vehicles.editFine')}
          title={t('vehicles.editFine')}
          onClick={() => onEdit(fine)}
        >
          <Pencil className="h-4 w-4" aria-hidden />
        </Button>
      )}
      {canDelete && (
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground hover:text-destructive"
          disabled={busy}
          aria-label={t('vehicles.delete')}
          title={t('vehicles.delete')}
          onClick={() => onDelete(fine)}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
        </Button>
      )}
    </div>
  )
}

function FineCard({
  fine,
  index,
  canEdit,
  canDelete,
  busy,
  onEdit,
  onDelete,
}: {
  fine: VehicleFineRead
  index: number
  canEdit: boolean
  canDelete: boolean
  busy: boolean
  onEdit: (fine: VehicleFineRead) => void
  onDelete: (fine: VehicleFineRead) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  return (
    <article className="rounded-xl border border-border bg-surface-raised p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[0.82rem] font-semibold text-foreground" dir="auto">
            {`${formatNumber(index + 1, lang)}. ${employeeLabel(fine, lang, t('vehicles.unassigned'))}`}
          </h3>
          <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
            <Mono>{fine.employee_id || EMPTY_VALUE}</Mono>
            {fine.evg_ticket_no && (
              <>
                {' · '}
                <Mono>{fine.evg_ticket_no}</Mono>
              </>
            )}
          </p>
        </div>
        {(canEdit || canDelete) && (
          <FineActions
            fine={fine}
            canEdit={canEdit}
            canDelete={canDelete}
            busy={busy}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        )}
      </div>
      <dl className="mt-2.5 grid grid-cols-3 gap-2 border-t border-hairline pt-2.5">
        <InfoItem label={t('vehicles.date')}>
          <Mono>{formatDateTime(fine.date, fine.time)}</Mono>
        </InfoItem>
        <InfoItem label={t('vehicles.amount')}>
          <bdi>{formatAed(fine.amount, lang)}</bdi>
        </InfoItem>
        <InfoItem label={t('vehicles.blackPoints')}>
          <Mono>{formatNumber(fine.black_points, lang)}</Mono>
        </InfoItem>
      </dl>
      {fine.location && (
        <p className="mt-2 text-[0.7rem] text-muted-foreground" dir="auto">
          {fine.location}
        </p>
      )}
    </article>
  )
}

// ── Renewals ────────────────────────────────────────────────────────────────

function RenewalsPanel({
  vehicle,
  renewals,
  canEdit,
  onRenew,
}: {
  vehicle: VehicleRead
  renewals: readonly Renewal[]
  canEdit: boolean
  /** The page's single renew dialog — the panel holds no state of its own. */
  onRenew: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language

  return (
    <>
      <Panel>
        <PanelHeader
          title={t('vehicles.currentLicense')}
          subtitle={
            <Mono>{`${formatIsoDate(vehicle.license_start)} — ${formatIsoDate(vehicle.license_expiry)}`}</Mono>
          }
          actions={
            <>
              <VehicleStatusBadge family="expiry" status={vehicle.expiry_status} />
              {canEdit && (
                <Button
                  type="button"
                  size="sm"
                  variant={vehicle.expiry_status === 'valid' ? 'secondary' : 'default'}
                  onClick={onRenew}
                >
                  {t('vehicles.renew')}
                </Button>
              )}
            </>
          }
        />
        <div className="grid gap-3.5 p-3.5 sm:grid-cols-[210px_1fr]">
          {vehicle.license_url ? (
            <UrlFileTile
              url={vehicle.license_url}
              label={t('vehicles.licenseScan')}
              className="h-[152px] w-full"
              showLabel
            />
          ) : (
            <MissingFileTile
              icon={FileText}
              label={t('vehicles.licenseScan')}
              className="h-[152px] w-full"
            />
          )}
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 self-start">
            <InfoItem label={t('vehicles.licenseStart')}>
              <Mono>{formatIsoDate(vehicle.license_start)}</Mono>
            </InfoItem>
            <InfoItem label={t('vehicles.licenseExpiry')}>
              <Mono>{formatIsoDate(vehicle.license_expiry)}</Mono>
            </InfoItem>
            <InfoItem label={t('vehicles.status')}>
              <VehicleStatusBadge family="expiry" status={vehicle.expiry_status} />
            </InfoItem>
          </dl>
        </div>
      </Panel>

      <Panel className="mt-3">
        <PanelHeader
          title={t('vehicles.renewalHistory')}
          subtitle={
            <bdi>{`${formatNumber(renewals.length, lang)} ${t('vehicles.records')}`}</bdi>
          }
        />
        {renewals.length === 0 ? (
          <EmptyState icon={History} message={t('vehicles.noRenewals')} />
        ) : (
          <ol className="flex flex-col gap-2.5 p-2.5">
            {renewals.map((renewal) => (
              <li
                key={renewal.id}
                className="flex items-center gap-3 rounded-xl border border-hairline bg-surface-raised p-3"
              >
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary ring-4 ring-primary-soft"
                />
                <div className="min-w-0 flex-1">
                  <h3 className="text-[0.78rem] font-semibold text-foreground">
                    <Mono>{`${formatIsoDate(renewal.start)} — ${formatIsoDate(renewal.expiry)}`}</Mono>
                  </h3>
                  <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
                    {`${t('vehicles.renewedOn')}: `}
                    <Mono>{formatIsoDate(renewal.renewed_on)}</Mono>
                    {renewal.cost != null && (
                      <>
                        {` · ${t('vehicles.cost')}: `}
                        <bdi>{formatAed(renewal.cost, lang)}</bdi>
                      </>
                    )}
                  </p>
                </div>
                {renewal.scan_url && (
                  <UrlFileTile url={renewal.scan_url} label={t('vehicles.licenseScan')} />
                )}
              </li>
            ))}
          </ol>
        )}
      </Panel>
    </>
  )
}

// ── Accidents ───────────────────────────────────────────────────────────────

function AccidentsPanel({
  accidents,
  canEdit,
  onAdd,
}: {
  accidents: NonNullable<VehicleRead['accidents']>
  canEdit: boolean
  onAdd: () => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  return (
    <Panel>
      <PanelHeader
        title={t('vehicles.tabAccidents')}
        subtitle={
          <bdi>{`${formatNumber(accidents.length, i18n.language)} ${t('vehicles.records')}`}</bdi>
        }
        actions={
          canEdit && (
            <Button type="button" size="sm" onClick={onAdd}>
              {t('vehicles.newReport')}
            </Button>
          )
        }
      />
      {accidents.length === 0 ? (
        <EmptyState icon={FileText} message={t('vehicles.noAccidents')} />
      ) : (
        <div className="flex flex-col gap-2.5 p-2.5">
          {accidents.map((accident) => (
            // Inside the vehicle's own file the plate chip and the «Open» link
            // would only point back at this page.
            <AccidentCard key={accident.id} accident={accident} />
          ))}
        </div>
      )}
    </Panel>
  )
}

// ── Maintenance ─────────────────────────────────────────────────────────────

function MaintenancePanel({
  records,
  canEdit,
  canDelete,
  isMobile,
  busy,
  onAdd,
  onDelete,
}: {
  records: readonly VehicleMaintenanceRead[]
  canEdit: boolean
  canDelete: boolean
  isMobile: boolean
  busy: boolean
  onAdd: () => void
  onDelete: (record: VehicleMaintenanceRead) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language

  return (
    <Panel>
      <PanelHeader
        title={t('vehicles.tabMaintenance')}
        subtitle={<bdi>{`${formatNumber(records.length, lang)} ${t('vehicles.records')}`}</bdi>}
        actions={
          canEdit && (
            <Button type="button" size="sm" onClick={onAdd}>
              {t('vehicles.addMaintenance')}
            </Button>
          )
        }
      />
      {records.length === 0 ? (
        <EmptyState icon={Wrench} message={t('vehicles.noMaintenance')} />
      ) : isMobile ? (
        <div className="flex flex-col gap-2.5 p-2.5">
          {records.map((record) => (
            <MaintenanceCard
              key={record.id}
              record={record}
              canDelete={canDelete}
              busy={busy}
              onDelete={onDelete}
            />
          ))}
        </div>
      ) : (
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[840px] text-sm">
            <TableHeader>
              <TableRow>
                <TableHead>{t('vehicles.date')}</TableHead>
                <TableHead>{t('vehicles.maintenanceType')}</TableHead>
                <TableHead>{t('vehicles.odometer')}</TableHead>
                <TableHead>{t('vehicles.cost')}</TableHead>
                <TableHead>{t('vehicles.garage')}</TableHead>
                <TableHead>{t('vehicles.nextDue')}</TableHead>
                <TableHead>{t('vehicles.receipt')}</TableHead>
                {canDelete && <TableHead className="text-end">{t('vehicles.action')}</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {records.map((record) => (
                <TableRow key={record.id}>
                  <TableCell className="text-[0.74rem]">
                    <Mono>{formatIsoDate(record.date)}</Mono>
                  </TableCell>
                  <TableCell className="text-[0.76rem]" dir="auto">
                    {t(`vehicles.${record.type}`)}
                  </TableCell>
                  <TableCell className="text-[0.74rem]">
                    {record.odometer_km == null ? (
                      EMPTY_VALUE
                    ) : (
                      <bdi>{`${formatNumber(record.odometer_km, lang)} ${t('vehicles.km')}`}</bdi>
                    )}
                  </TableCell>
                  <TableCell className="text-[0.76rem] font-medium">
                    <bdi>{formatAed(record.cost, lang)}</bdi>
                  </TableCell>
                  <TableCell className="text-[0.76rem]" dir="auto">
                    {localized(record.vendor_ar, record.vendor_en, lang) || EMPTY_VALUE}
                  </TableCell>
                  <TableCell>
                    <span className="flex flex-col items-start gap-1">
                      <Mono>{formatIsoDate(record.next_due)}</Mono>
                      {record.due_state && (
                        <VehicleStatusBadge family="due" status={record.due_state} />
                      )}
                    </span>
                  </TableCell>
                  <TableCell>
                    {record.receipt_url ? (
                      <UrlFileTile url={record.receipt_url} label={t('vehicles.receipt')} />
                    ) : (
                      <span className="text-[0.74rem] text-muted-foreground">{EMPTY_VALUE}</span>
                    )}
                  </TableCell>
                  {canDelete && (
                    <TableCell className="text-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        disabled={busy}
                        aria-label={t('vehicles.delete')}
                        title={t('vehicles.delete')}
                        onClick={() => onDelete(record)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      )}
    </Panel>
  )
}

function MaintenanceCard({
  record,
  canDelete,
  busy,
  onDelete,
}: {
  record: VehicleMaintenanceRead
  canDelete: boolean
  busy: boolean
  onDelete: (record: VehicleMaintenanceRead) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const lang = i18n.language
  return (
    <article className="rounded-xl border border-border bg-surface-raised p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[0.82rem] font-semibold text-foreground" dir="auto">
            {t(`vehicles.${record.type}`)}
          </h3>
          <p className="mt-0.5 text-[0.68rem] text-muted-foreground">
            <Mono>{formatIsoDate(record.date)}</Mono>
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {record.due_state && <VehicleStatusBadge family="due" status={record.due_state} />}
          {canDelete && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-muted-foreground hover:text-destructive"
              disabled={busy}
              aria-label={t('vehicles.delete')}
              title={t('vehicles.delete')}
              onClick={() => onDelete(record)}
            >
              <Trash2 className="h-4 w-4" aria-hidden />
            </Button>
          )}
        </div>
      </div>

      <dl className="mt-2.5 grid grid-cols-2 gap-2 border-y border-hairline py-2.5">
        <InfoItem label={t('vehicles.odometer')}>
          {record.odometer_km == null ? (
            EMPTY_VALUE
          ) : (
            <bdi>{`${formatNumber(record.odometer_km, lang)} ${t('vehicles.km')}`}</bdi>
          )}
        </InfoItem>
        <InfoItem label={t('vehicles.cost')}>
          <bdi>{formatAed(record.cost, lang)}</bdi>
        </InfoItem>
        <InfoItem label={t('vehicles.garage')}>
          <span dir="auto">{localized(record.vendor_ar, record.vendor_en, lang) || EMPTY_VALUE}</span>
        </InfoItem>
        <InfoItem label={t('vehicles.nextDue')}>
          <Mono>{formatIsoDate(record.next_due)}</Mono>
        </InfoItem>
      </dl>

      {record.receipt_url && (
        <div className="mt-2.5">
          <UrlFileTile url={record.receipt_url} label={t('vehicles.receipt')} />
        </div>
      )}
    </article>
  )
}

// ── Photos ──────────────────────────────────────────────────────────────────

function PhotosPanel({
  vehicle,
  photos,
  count,
  canEdit,
  canDelete,
  uploading,
  deleting,
  onUpload,
  onDelete,
}: {
  vehicle: VehicleRead
  photos: readonly VehicleFileRead[]
  count: number
  canEdit: boolean
  canDelete: boolean
  uploading: boolean
  /** A removal is in flight: every tile's delete stays out of reach until the
   *  refreshed gallery comes back, so a second tap cannot fire on stale rows. */
  deleting: boolean
  onUpload: (file: File) => void
  onDelete: (photo: VehicleFileRead) => void
}): React.JSX.Element {
  const { t, i18n } = useTranslation()

  return (
    <Panel>
      <PanelHeader
        title={t('vehicles.gallery')}
        subtitle={<bdi>{formatNumber(count, i18n.language)}</bdi>}
      />
      <div className="grid grid-cols-2 gap-2.5 p-2.5 sm:grid-cols-3 lg:grid-cols-4">
        {vehicle.photo_url && (
          <UrlFileTile
            url={vehicle.photo_url}
            label={t('vehicles.mainPhoto')}
            className="h-[132px] w-full"
            showLabel
          />
        )}
        {vehicle.license_url && (
          <UrlFileTile
            url={vehicle.license_url}
            label={t('vehicles.licenseScan')}
            className="h-[132px] w-full"
            showLabel
          />
        )}
        {photos.map((photo) => (
          // The delete control is a sibling of the tile, never nested inside
          // its button: one tap opens the photo, the other removes it.
          <div key={photo.id} className="relative">
            <VehicleFileThumb
              vehicleId={vehicle.id}
              file={photo}
              siblings={photos}
              showLabel
              className="h-[132px] w-full"
            />
            {canDelete && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute end-1 top-1 bg-surface/85 text-muted-foreground hover:text-destructive"
                disabled={deleting}
                aria-label={t('vehicles.delete')}
                title={t('vehicles.delete')}
                onClick={() => onDelete(photo)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
              </Button>
            )}
          </div>
        ))}
        {canEdit && (
          <FileUploadZone
            accept={IMAGE_ACCEPT}
            label={t('vehicles.addPhoto')}
            busy={uploading}
            onFile={onUpload}
          />
        )}
        {count === 0 && !canEdit && (
          <div className="col-span-2 sm:col-span-3 lg:col-span-4">
            <EmptyState icon={ImageIcon} message={t('vehicles.gallery')} />
          </div>
        )}
      </div>
    </Panel>
  )
}
