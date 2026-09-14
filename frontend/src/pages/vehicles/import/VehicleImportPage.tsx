import { useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { EmptyState } from '@/components/ui/empty-state'
import { ApiError, api } from '@/lib/api'
import type {
  VehicleImportInspection,
  VehicleImportPreview,
  VehicleImportPreviewDraftRow,
  VehicleImportPreviewRequest,
  VehicleImportResult,
  VehicleProfileScan,
} from '@/lib/api'

import {
  VEHICLE_QUERY_KEYS,
  invalidateVehicleQueries,
  type Translate,
  vehicleErrorMessage,
} from '../vehicleUtils'
import { ImportPageHeader } from './ImportPageHeader'
import { ImportResultSummary } from './ImportResultSummary'
import { ImportReviewTable } from './ImportReviewTable'
import { ImportUploadStep } from './ImportUploadStep'
import { createDraftRows, inferSiteMappings, isConfirmable } from './importUtils'

const IMPORT_ERROR_KEYS: Record<string, string> = {
  VEHICLE_IMPORT_BAD_FILE: 'badFile',
  VEHICLE_IMPORT_TOO_LARGE: 'tooLarge',
  VEHICLE_IMPORT_TOKEN_NOT_FOUND: 'expired',
  VEHICLE_IMPORT_TOKEN_EXPIRED: 'expired',
  VEHICLE_IMPORT_TOKEN_FORBIDDEN: 'forbidden',
  VEHICLE_IMPORT_TOKEN_CLAIMED: 'claimed',
  VEHICLE_IMPORT_UNKNOWN_REVISION: 'stale',
  VEHICLE_IMPORT_STALE: 'stale',
  VEHICLE_IMPORT_BUSY: 'busy',
  VEHICLE_IMPORT_UNASSIGNED_IMAGE: 'unassignedImage',
  VEHICLE_IMPORT_INVALID_FIELD: 'invalidField',
  VEHICLE_IMPORT_IMAGE_ROLE_REQUIRED: 'imageRoleRequired',
}

const STALE_CODES: Record<string, true> = {
  VEHICLE_IMPORT_UNKNOWN_REVISION: true,
  VEHICLE_IMPORT_STALE: true,
}

function importErrorMessage(error: unknown, t: Translate): string {
  if (error instanceof ApiError) {
    const key = IMPORT_ERROR_KEYS[error.code]
    if (key) return t(`vehicles.import.requestErrors.${key}`)
  }
  return vehicleErrorMessage(error, t)
}

export function VehicleImportPage(): React.JSX.Element {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const draftVersion = useRef(0)
  const [inspection, setInspection] = useState<VehicleImportInspection | null>(null)
  const [drafts, setDrafts] = useState<VehicleImportPreviewDraftRow[]>([])
  const [siteMappings, setSiteMappings] = useState<Record<string, number>>({})
  const [unassignedDestinations, setUnassignedDestinations] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<VehicleImportPreview | null>(null)
  const [previewDirty, setPreviewDirty] = useState(true)
  const [scanResults, setScanResults] = useState<Record<string, VehicleProfileScan>>({})
  const [deselectedRowIds, setDeselectedRowIds] = useState<Set<string>>(() => new Set())
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [confirmError, setConfirmError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [result, setResult] = useState<VehicleImportResult | null>(null)

  const sitesQuery = useQuery({
    queryKey: VEHICLE_QUERY_KEYS.sites,
    queryFn: () => api.listVehicleSites(),
    staleTime: 60_000,
  })

  const markDirty = (): void => {
    draftVersion.current += 1
    setPreviewDirty(true)
    setConfirmError(null)
    setStale(false)
  }

  const inspectMutation = useMutation({
    mutationFn: (file: File) => api.inspectVehicleImport(file),
    onSuccess: (nextInspection) => {
      draftVersion.current += 1
      setInspection(nextInspection)
      setDrafts(createDraftRows(nextInspection))
      setSiteMappings(inferSiteMappings(nextInspection, sitesQuery.data ?? []))
      setUnassignedDestinations(
        Object.fromEntries(
          nextInspection.images
            .filter((image) => image.row_id == null)
            .map((image) => [image.image_id, '']),
        ),
      )
      setPreview(null)
      setPreviewDirty(true)
      setScanResults({})
      setDeselectedRowIds(new Set())
      setUploadError(null)
      setPreviewError(null)
      setConfirmError(null)
      setStale(false)
    },
    onError: (error) => {
      const message = importErrorMessage(error, t)
      setUploadError(message)
      toast.error(message)
    },
  })

  const previewMutation = useMutation({
    mutationFn: ({
      token,
      request,
    }: {
      token: string
      request: VehicleImportPreviewRequest
      version: number
    }) => api.previewVehicleImport(token, request),
    onSuccess: (nextPreview, variables) => {
      setPreview(nextPreview)
      setPreviewDirty(variables.version !== draftVersion.current)
      setPreviewError(null)
      setConfirmError(null)
      setStale(false)
    },
    onError: (error) => {
      const message = importErrorMessage(error, t)
      setPreviewError(message)
      setPreviewDirty(true)
      toast.error(message)
    },
  })

  const scanMutation = useMutation({
    mutationFn: ({ token, imageId }: { token: string; imageId: string }) =>
      api.scanVehicleImportImage(token, imageId),
    onSuccess: (scan, variables) => {
      setScanResults((current) => ({ ...current, [variables.imageId]: scan }))
      markDirty()
    },
    onError: (error) => {
      const message = importErrorMessage(error, t)
      setPreviewError(message)
      toast.error(message)
    },
  })

  const confirmMutation = useMutation({
    mutationFn: ({
      token,
      revision,
      rowIds,
    }: {
      token: string
      revision: string
      rowIds: string[]
    }) => api.confirmVehicleImport(token, { revision, row_ids: rowIds }),
    onSuccess: (nextResult) => {
      setResult(nextResult)
      invalidateVehicleQueries(queryClient, { registers: ['sites'] })
    },
    onError: (error) => {
      const isStale = error instanceof ApiError && STALE_CODES[error.code] === true
      const message = isStale
        ? t('vehicles.import.staleDescription')
        : importErrorMessage(error, t)
      setConfirmError(message)
      setStale(isStale)
      if (isStale) setPreviewDirty(true)
      toast.error(message)
    },
  })

  const reset = (): void => {
    draftVersion.current += 1
    setInspection(null)
    setDrafts([])
    setSiteMappings({})
    setUnassignedDestinations({})
    setPreview(null)
    setPreviewDirty(true)
    setScanResults({})
    setDeselectedRowIds(new Set())
    setUploadError(null)
    setPreviewError(null)
    setConfirmError(null)
    setStale(false)
    setResult(null)
  }

  const updateDraft = (
    rowId: string,
    update: (draft: VehicleImportPreviewDraftRow) => VehicleImportPreviewDraftRow,
  ): void => {
    setDrafts((current) =>
      current.map((draft) => (draft.row_id === rowId ? update(draft) : draft)),
    )
    markDirty()
  }

  const updateUnassignedDestination = (imageId: string, destination: string): void => {
    setUnassignedDestinations((current) => ({ ...current, [imageId]: destination }))
    setDrafts((current) =>
      current.map((draft) => {
        const imageRoles = { ...(draft.image_roles ?? {}) }
        delete imageRoles[imageId]
        const detached: VehicleImportPreviewDraftRow = {
          ...draft,
          image_ids: (draft.image_ids ?? []).filter((id) => id !== imageId),
          image_roles: imageRoles,
          primary_image_id: draft.primary_image_id === imageId ? null : draft.primary_image_id,
          license_image_id: draft.license_image_id === imageId ? null : draft.license_image_id,
          ocr_reviewed_image_ids: (draft.ocr_reviewed_image_ids ?? []).filter((id) => id !== imageId),
          ocr_manual_image_ids: (draft.ocr_manual_image_ids ?? []).filter((id) => id !== imageId),
          ocr_identity_confirmed_image_ids: (draft.ocr_identity_confirmed_image_ids ?? []).filter(
            (id) => id !== imageId,
          ),
        }
        return draft.row_id === destination
          ? { ...detached, image_ids: [...(detached.image_ids ?? []), imageId] }
          : detached
      }),
    )
    markDirty()
  }

  const runPreview = (): void => {
    if (!inspection) return
    const excludedImageIds = Object.entries(unassignedDestinations)
      .filter(([, destination]) => destination === 'exclude')
      .map(([imageId]) => imageId)
    previewMutation.mutate({
      token: inspection.token,
      version: draftVersion.current,
      request: {
        site_mappings: siteMappings,
        rows: drafts,
        excluded_image_ids: excludedImageIds,
      },
    })
  }

  const selectedRowIds = new Set<string>()
  for (const row of preview?.rows ?? []) {
    if (isConfirmable(row) && !deselectedRowIds.has(row.row_id)) selectedRowIds.add(row.row_id)
  }
  const allSitesMapped = Boolean(
    inspection?.sections.every((section) => siteMappings[section.id] != null),
  )
  const allUnassignedResolved = Object.values(unassignedDestinations).every(Boolean)
  const canPreview = allSitesMapped && allUnassignedResolved && drafts.length > 0
  const step = result ? 'done' : inspection ? 'review' : 'upload'

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <ImportPageHeader
        step={step}
        showReset={Boolean(inspection && !result)}
        onReset={reset}
      />

      <div className="min-h-0 flex-1 overflow-y-auto pt-5">
        {result ? (
          <ImportResultSummary result={result} onRestart={reset} />
        ) : inspection ? (
          sitesQuery.isError ? (
            <EmptyState
              message={t('vehicles.import.sitesLoadError')}
              actionLabel={t('vehicles.import.retry')}
              onAction={() => void sitesQuery.refetch()}
            />
          ) : (
            <ImportReviewTable
              inspection={inspection}
              drafts={drafts}
              sites={sitesQuery.data ?? []}
              siteMappings={siteMappings}
              unassignedDestinations={unassignedDestinations}
              preview={preview}
              scanResults={scanResults}
              scanningImageId={scanMutation.isPending ? scanMutation.variables?.imageId ?? null : null}
              selectedRowIds={selectedRowIds}
              previewDirty={previewDirty}
              canPreview={canPreview}
              isPreviewing={previewMutation.isPending}
              isConfirming={confirmMutation.isPending}
              previewError={previewError}
              confirmError={confirmError}
              stale={stale}
              onSiteMappingChange={(sectionId, siteId) => {
                setSiteMappings((current) => {
                  const next = { ...current }
                  if (siteId) next[sectionId] = siteId
                  else delete next[sectionId]
                  return next
                })
                markDirty()
              }}
              onUnassignedDestinationChange={updateUnassignedDestination}
              onDraftChange={updateDraft}
              onSelectedChange={(rowId, selected) =>
                setDeselectedRowIds((current) => {
                  const next = new Set(current)
                  if (selected) next.delete(rowId)
                  else next.add(rowId)
                  return next
                })
              }
              onScan={(imageId) => scanMutation.mutate({ token: inspection.token, imageId })}
              onPreview={runPreview}
              onConfirm={() => {
                if (!preview || previewDirty) return
                confirmMutation.mutate({
                  token: inspection.token,
                  revision: preview.revision,
                  rowIds: preview.rows
                    .filter((row) => selectedRowIds.has(row.row_id))
                    .map((row) => row.row_id),
                })
              }}
            />
          )
        ) : (
          <ImportUploadStep
            busy={inspectMutation.isPending}
            error={uploadError}
            onFile={(file) => {
              if (!file.name.toLocaleLowerCase().endsWith('.xlsx')) {
                setUploadError(t('vehicles.import.fileMustBeXlsx'))
                return
              }
              setUploadError(null)
              inspectMutation.mutate(file)
            }}
          />
        )}
      </div>
    </div>
  )
}
