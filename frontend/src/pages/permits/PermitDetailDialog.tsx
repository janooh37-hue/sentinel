/**
 * PermitDetailDialog — the read + manage surface for one permit.
 *
 * Fetches the permit fresh (so the people list is always current), shows the
 * header facts, and — for users with `permits.manage` — hosts the amendment
 * actions: add / remove person, renew, revoke, delete. Renew and revoke use
 * inline panels (not nested modals) to keep the Radix dialog stack shallow;
 * delete uses the AlertDialog-based ConfirmDialog.
 */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, UserPlus, FileText, Upload, Car, ScanLine, Printer } from 'lucide-react'
import { toast } from 'sonner'

import { api, apiErrorMessage, type PermitRead } from '@/lib/api'
import { RowDocButton } from './RowDocButton'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { useCapabilities } from '@/lib/useCapabilities'
import { ZoneBadge } from './ZoneBadge'
import { fmtDate, statusTone } from './permitUtils'

const inputCls =
  'h-9 rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

interface Props {
  permitId: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit: (permit: PermitRead) => void
}

export function PermitDetailDialog({ permitId, open, onOpenChange, onEdit }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { has } = useCapabilities()
  const canManage = has('permits.manage')

  const query = useQuery({
    queryKey: ['permit', permitId],
    queryFn: () => api.getPermit(permitId),
    enabled: open,
  })
  const permit = query.data

  const [renewOpen, setRenewOpen] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [newEnd, setNewEnd] = useState('')
  const [renewReason, setRenewReason] = useState('')
  const [revokeReason, setRevokeReason] = useState('')
  const [personName, setPersonName] = useState('')
  const [personUae, setPersonUae] = useState('')
  const [personNationality, setPersonNationality] = useState('')
  const [vehiclePlate, setVehiclePlate] = useState('')
  const [vehicleMakeModel, setVehicleMakeModel] = useState('')
  const [vehicleColour, setVehicleColour] = useState('')
  const [vehicleType, setVehicleType] = useState('')
  const [vehiclePlateCategory, setVehiclePlateCategory] = useState('')
  const [vehicleTrafficNo, setVehicleTrafficNo] = useState('')
  const [vehicleRegExpiry, setVehicleRegExpiry] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const invalidate = (): void => {
    void qc.invalidateQueries({ queryKey: ['permit', permitId] })
    void qc.invalidateQueries({ queryKey: ['permits-list'] })
    void qc.invalidateQueries({ queryKey: ['permits-summary'] })
  }

  const onErr = (err: unknown): void => {
    toast.error(apiErrorMessage(err))
  }

  const addPerson = useMutation({
    mutationFn: () =>
      api.addPermitPerson(permitId, {
        name: personName.trim(),
        uae_id: personUae.trim(),
        nationality: personNationality.trim() || null,
      }),
    onSuccess: () => {
      invalidate()
      setPersonName('')
      setPersonUae('')
      setPersonNationality('')
    },
    onError: onErr,
  })

  const removePerson = useMutation({
    mutationFn: (personId: number) => api.removePermitPerson(permitId, personId),
    onSuccess: invalidate,
    onError: onErr,
  })

  const renew = useMutation({
    mutationFn: () => api.renewPermit(permitId, { new_end_date: newEnd, reason: renewReason.trim() || undefined }),
    onSuccess: () => {
      invalidate()
      setRenewOpen(false)
      setRenewReason('')
      toast.success(t('common.savedToast'))
    },
    onError: onErr,
  })

  const revoke = useMutation({
    mutationFn: () => api.revokePermit(permitId, { reason: revokeReason.trim() || undefined }),
    onSuccess: () => {
      invalidate()
      setRevokeOpen(false)
      setRevokeReason('')
      toast.success(t('common.savedToast'))
    },
    onError: onErr,
  })

  const del = useMutation({
    mutationFn: () => api.deletePermit(permitId),
    onSuccess: () => {
      invalidate()
      onOpenChange(false)
      toast.success(t('common.savedToast'))
    },
    onError: onErr,
  })

  const uploadDoc = useMutation({
    mutationFn: (file: File) => api.uploadPermitDocument(permitId, file),
    onSuccess: () => {
      invalidate()
      toast.success(t('common.savedToast'))
    },
    onError: onErr,
  })

  const removeDoc = useMutation({
    mutationFn: () => api.removePermitDocument(permitId),
    onSuccess: invalidate,
    onError: onErr,
  })

  const pickFile = (e: React.ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0]
    if (file) uploadDoc.mutate(file)
    e.target.value = '' // allow re-picking the same filename
  }

  const personDoc = useMutation({
    mutationFn: ({ personId, file }: { personId: number; file: File }) =>
      api.uploadPersonDocument(permitId, personId, file),
    onSuccess: () => {
      invalidate()
      toast.success(t('permits.doc.scanAttached'))
    },
    onError: onErr,
  })

  const addVehicle = useMutation({
    mutationFn: () =>
      api.addPermitVehicle(permitId, {
        plate_no: vehiclePlate.trim() || null,
        make_model: vehicleMakeModel.trim() || null,
        colour: vehicleColour.trim() || null,
        vehicle_type: vehicleType.trim() || null,
        plate_category: vehiclePlateCategory.trim() || null,
        traffic_no: vehicleTrafficNo.trim() || null,
        reg_expiry: vehicleRegExpiry.trim() || null,
      }),
    onSuccess: () => {
      invalidate()
      setVehiclePlate('')
      setVehicleMakeModel('')
      setVehicleColour('')
      setVehicleType('')
      setVehiclePlateCategory('')
      setVehicleTrafficNo('')
      setVehicleRegExpiry('')
    },
    onError: onErr,
  })

  const removeVehicle = useMutation({
    mutationFn: (vehicleId: number) => api.removePermitVehicle(permitId, vehicleId),
    onSuccess: invalidate,
    onError: onErr,
  })

  const vehicleDoc = useMutation({
    mutationFn: ({ vehicleId, file }: { vehicleId: number; file: File }) =>
      api.uploadVehicleDocument(permitId, vehicleId, file),
    onSuccess: () => {
      invalidate()
      toast.success(t('permits.doc.scanAttached'))
    },
    onError: onErr,
  })

  const openBlob = async (fetcher: () => Promise<Blob>): Promise<void> => {
    try {
      const blob = await fetcher()
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener')
      // Reclaim the blob once the new tab has had time to load it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (err) {
      onErr(err)
    }
  }
  const previewDoc = (): Promise<void> => openBlob(() => api.fetchPermitDocumentBlob(permitId))
  const previewPersonDoc = (personId: number): Promise<void> =>
    openBlob(() => api.fetchPersonDocumentBlob(permitId, personId))
  const previewVehicleDoc = (vehicleId: number): Promise<void> =>
    openBlob(() => api.fetchVehicleDocumentBlob(permitId, vehicleId))

  const handleScanId = async (file: File): Promise<void> => {
    try {
      const result = await api.scanEmiratesId(file)
      if (result.name) setPersonName(result.name)
      if (result.uae_id) setPersonUae(result.uae_id)
      if (result.nationality) setPersonNationality(result.nationality)
    } catch {
      // scan failure is non-fatal; user can fill in manually
    }
  }

  const handleScanLicence = async (file: File): Promise<void> => {
    try {
      const result = await api.scanVehicleLicence(file)
      if (result.plate_no) setVehiclePlate(result.plate_no)
      if (result.make_model) setVehicleMakeModel(result.make_model)
      if (result.colour) setVehicleColour(result.colour)
      if (result.vehicle_type) setVehicleType(result.vehicle_type)
      if (result.plate_category) setVehiclePlateCategory(result.plate_category)
      if (result.traffic_no) setVehicleTrafficNo(result.traffic_no)
      if (result.reg_expiry) setVehicleRegExpiry(result.reg_expiry)
    } catch {
      // scan failure is non-fatal
    }
  }

  const openBookPdf = async (): Promise<void> => {
    if (!permit?.book_id) return
    try {
      const book = await api.getBook(permit.book_id)
      const versions = book.versions ?? []
      const latest = [...versions].sort((a, b) => b.version_no - a.version_no)[0] ?? null
      const pdfUrl = latest?.pdf_url ?? null
      if (pdfUrl) {
        window.open(pdfUrl, '_blank', 'noopener')
      } else {
        toast.error(t('permits.printNoPdf'))
      }
    } catch (err) {
      onErr(err)
    }
  }

  const activePeople = permit?.people.filter((p) => p.removed_at === null) ?? []
  const activeVehicles = permit?.vehicles.filter((v) => v.removed_at === null) ?? []
  const isRevoked = permit?.status === 'revoked'

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {permit ? t('permits.detail.title', { no: permit.permit_no ?? permit.id }) : t('common.loading')}
          </DialogTitle>
          {permit && (
            <DialogDescription>
              {t('permits.detail.createdAt', { date: fmtDate(permit.created_at) })}
            </DialogDescription>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-4 overflow-y-auto px-4 py-4 text-sm">
          {query.isError && <p className="text-destructive">{t('permits.loadError')}</p>}
          {permit && (
            <>
              {/* Badges */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={statusTone(permit.derived_status)}>
                  {t(`permits.status.${permit.derived_status}`)}
                </Badge>
                <ZoneBadge zones={permit.zones} full />
              </div>

              {/* Facts grid */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Fact label={t('permits.detail.company')} value={permit.company} />
                <Fact
                  label={t('permits.detail.window')}
                  value={`${fmtDate(permit.start_date)} → ${fmtDate(permit.end_date)}`}
                  mono
                  ltr
                />
                <Fact
                  label={t('permits.detail.duration')}
                  value={t('permits.duration', { count: permit.duration_days })}
                />
                <Fact
                  label={t('permits.columns.people')}
                  value={t('permits.detail.peopleCount', { count: permit.people_count })}
                />
                <Fact
                  label={t('permits.columns.vehicles')}
                  value={t('permits.detail.vehicleCount', { count: permit.vehicle_count })}
                />
                {permit.purpose && (
                  <Fact label={t('permits.detail.purpose')} value={permit.purpose} span />
                )}
                {permit.notes && (
                  <Fact label={t('permits.detail.notes')} value={permit.notes} span />
                )}
                {permit.book_ref && (
                  <Fact
                    label={t('permits.detail.bookRef')}
                    value={permit.book_ref}
                    mono
                    ltr
                  />
                )}
                {isRevoked && permit.revoke_reason && (
                  <div className="col-span-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {t('permits.detail.revokedReason', { reason: permit.revoke_reason })}
                  </div>
                )}
              </dl>

              {/* Permit paper */}
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('permits.paper.title')}
                </h3>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf,image/*"
                  className="hidden"
                  onChange={pickFile}
                />
                {permit.document_name ? (
                  <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised px-3 py-2.5">
                    <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-accent-soft text-accent">
                      <FileText className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">{permit.document_name}</div>
                      <div className="text-xs text-muted-foreground">{t('permits.paper.attached')}</div>
                    </div>
                    <div className="flex flex-none items-center gap-1.5">
                      <Button type="button" variant="outline" size="sm" onClick={() => void previewDoc()}>
                        {t('permits.paper.preview')}
                      </Button>
                      {canManage && !isRevoked && (
                        <>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={uploadDoc.isPending}
                            onClick={() => fileRef.current?.click()}
                          >
                            {t('permits.paper.replace')}
                          </Button>
                          <button
                            type="button"
                            aria-label={t('permits.paper.remove')}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-tinted hover:text-destructive"
                            onClick={() => removeDoc.mutate()}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ) : canManage && !isRevoked ? (
                  <button
                    type="button"
                    disabled={uploadDoc.isPending}
                    onClick={() => fileRef.current?.click()}
                    className="flex items-center gap-3 rounded-xl border border-dashed border-border-strong bg-surface px-3 py-3 text-start hover:border-ring hover:bg-surface-tinted disabled:opacity-60"
                  >
                    <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-primary-soft text-primary">
                      <Upload className="h-[18px] w-[18px]" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-foreground">
                        {uploadDoc.isPending ? t('common.loading') : t('permits.paper.upload')}
                      </span>
                      <span className="block text-xs text-muted-foreground">{t('permits.paper.uploadHelp')}</span>
                    </span>
                  </button>
                ) : (
                  <p className="text-xs text-muted-foreground">{t('permits.paper.none')}</p>
                )}
              </section>

              {/* People */}
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('permits.detail.people')}
                </h3>
                {activePeople.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('permits.detail.noPeople')}</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                    {activePeople.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground" dir="auto">
                            {p.name}
                          </div>
                          {(p.uae_id || p.nationality || p.role) && (
                            <div className="truncate text-xs text-muted-foreground">
                              {[p.uae_id, p.nationality, p.role].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-none items-center gap-1.5">
                          <RowDocButton
                            docName={p.id_doc_name}
                            label={t('permits.person.idDoc')}
                            canManage={canManage && !isRevoked}
                            busy={personDoc.isPending}
                            onUpload={(file) => personDoc.mutate({ personId: p.id, file })}
                            onPreview={() => void previewPersonDoc(p.id)}
                          />
                          {canManage && !isRevoked && (
                            <button
                              type="button"
                              aria-label={t('permits.actions.removePerson')}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-tinted hover:text-destructive"
                              onClick={() => removePerson.mutate(p.id)}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Add person (manage + not revoked) */}
                {canManage && !isRevoked && (
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.3fr_1fr_1fr_auto]">
                      <input
                        className={inputCls}
                        placeholder={t('permits.person.name')}
                        dir="auto"
                        value={personName}
                        onChange={(e) => setPersonName(e.target.value)}
                      />
                      <input
                        className={inputCls}
                        placeholder={t('permits.person.uaeId')}
                        value={personUae}
                        onChange={(e) => setPersonUae(e.target.value)}
                      />
                      <input
                        className={inputCls}
                        placeholder={t('permits.person.nationality')}
                        dir="auto"
                        value={personNationality}
                        onChange={(e) => setPersonNationality(e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          personName.trim().length === 0 ||
                          personUae.trim().length === 0 ||
                          addPerson.isPending
                        }
                        onClick={() => addPerson.mutate()}
                      >
                        <UserPlus className="me-1.5 h-4 w-4" aria-hidden />
                        {t('permits.person.add')}
                      </Button>
                    </div>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
                      <ScanLine className="h-3.5 w-3.5" aria-hidden />
                      {t('permits.person.scanId')}
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        aria-label={t('permits.person.scanId')}
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) void handleScanId(file)
                          e.target.value = ''
                        }}
                      />
                    </label>
                  </div>
                )}
              </section>

              {/* Vehicles */}
              <section className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t('permits.detail.vehicles')}
                </h3>
                {activeVehicles.length === 0 ? (
                  <p className="text-xs text-muted-foreground">{t('permits.detail.noVehicles')}</p>
                ) : (
                  <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
                    {activeVehicles.map((v) => (
                      <li key={v.id} className="flex items-center justify-between gap-2 px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate font-medium text-foreground" dir="auto">
                            <span className="font-mono">{v.plate_no ?? t('permits.vehicle.noPlate')}</span>
                            {v.plate_emirate && (
                              <span className="ms-1.5 text-xs font-normal text-muted-foreground">
                                {v.plate_emirate}
                              </span>
                            )}
                          </div>
                          {(v.make_model || v.driver_name || v.colour || v.vehicle_type) && (
                            <div className="truncate text-xs text-muted-foreground">
                              {[v.make_model, v.colour, v.vehicle_type, v.driver_name].filter(Boolean).join(' · ')}
                            </div>
                          )}
                          {(v.plate_category || v.traffic_no || v.reg_expiry) && (
                            <div className="truncate text-xs text-muted-foreground font-mono">
                              {[v.plate_category, v.traffic_no, v.reg_expiry ? t('permits.vehicle.expiry', { date: fmtDate(v.reg_expiry) }) : null].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>
                        <div className="flex flex-none items-center gap-1.5">
                          <RowDocButton
                            docName={v.license_doc_name}
                            label={t('permits.vehicle.licence')}
                            canManage={canManage && !isRevoked}
                            busy={vehicleDoc.isPending}
                            onUpload={(file) => vehicleDoc.mutate({ vehicleId: v.id, file })}
                            onPreview={() => void previewVehicleDoc(v.id)}
                          />
                          {canManage && !isRevoked && (
                            <button
                              type="button"
                              aria-label={t('permits.vehicle.remove')}
                              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-tinted hover:text-destructive"
                              onClick={() => removeVehicle.mutate(v.id)}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </button>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {/* Add vehicle (manage + not revoked) */}
                {canManage && !isRevoked && (
                  <div className="flex flex-col gap-2">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <input
                        className={inputCls}
                        placeholder={t('permits.vehicle.plate')}
                        value={vehiclePlate}
                        onChange={(e) => setVehiclePlate(e.target.value)}
                      />
                      <input
                        className={inputCls}
                        placeholder={t('permits.vehicle.makeModel')}
                        dir="auto"
                        value={vehicleMakeModel}
                        onChange={(e) => setVehicleMakeModel(e.target.value)}
                      />
                      <Button
                        type="button"
                        variant="outline"
                        disabled={
                          (vehiclePlate.trim().length === 0 && vehicleMakeModel.trim().length === 0) ||
                          addVehicle.isPending
                        }
                        onClick={() => addVehicle.mutate()}
                      >
                        <Car className="me-1.5 h-4 w-4" aria-hidden />
                        {t('permits.vehicle.add')}
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <input
                        className={inputCls}
                        placeholder={t('permits.vehicle.colour')}
                        dir="auto"
                        value={vehicleColour}
                        onChange={(e) => setVehicleColour(e.target.value)}
                      />
                      <input
                        className={inputCls}
                        placeholder={t('permits.vehicle.vehicleType')}
                        dir="auto"
                        value={vehicleType}
                        onChange={(e) => setVehicleType(e.target.value)}
                      />
                      <input
                        className={inputCls}
                        placeholder={t('permits.vehicle.plateCategory')}
                        value={vehiclePlateCategory}
                        onChange={(e) => setVehiclePlateCategory(e.target.value)}
                      />
                      <input
                        className={`${inputCls} font-mono`}
                        placeholder={t('permits.vehicle.trafficNo')}
                        value={vehicleTrafficNo}
                        onChange={(e) => setVehicleTrafficNo(e.target.value)}
                      />
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">{t('permits.vehicle.regExpiry')}</span>
                        <input
                          type="date"
                          aria-label={t('permits.vehicle.regExpiry')}
                          className={`${inputCls} font-mono`}
                          value={vehicleRegExpiry}
                          onChange={(e) => setVehicleRegExpiry(e.target.value)}
                        />
                      </label>
                    </div>
                    <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground hover:text-primary">
                      <ScanLine className="h-3.5 w-3.5" aria-hidden />
                      {t('permits.vehicle.scanLicence')}
                      <input
                        type="file"
                        accept="image/*,application/pdf"
                        aria-label={t('permits.vehicle.scanLicence')}
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0]
                          if (file) void handleScanLicence(file)
                          e.target.value = ''
                        }}
                      />
                    </label>
                  </div>
                )}
              </section>

              {/* Renew panel */}
              {renewOpen && (
                <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
                  <p className="text-xs text-muted-foreground">
                    {t('permits.renew.help', { end: fmtDate(permit.end_date) })}
                  </p>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">{t('permits.renew.newEnd')}</span>
                      <input
                        type="date"
                        className={`${inputCls} font-mono`}
                        min={permit.end_date.slice(0, 10)}
                        value={newEnd}
                        autoFocus
                        onChange={(e) => setNewEnd(e.target.value)}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <span className="text-xs text-muted-foreground">{t('permits.renew.reason')}</span>
                      <input
                        className={inputCls}
                        dir="auto"
                        value={renewReason}
                        onChange={(e) => setRenewReason(e.target.value)}
                      />
                    </label>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setRenewOpen(false)}>
                      {t('common.cancel')}
                    </Button>
                    <Button
                      type="button"
                      disabled={!newEnd || newEnd <= permit.end_date.slice(0, 10) || renew.isPending}
                      onClick={() => renew.mutate()}
                    >
                      {t('permits.renew.save')}
                    </Button>
                  </div>
                </div>
              )}

              {/* Revoke panel */}
              {revokeOpen && (
                <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 p-3">
                  <p className="text-xs text-muted-foreground">{t('permits.revoke.help')}</p>
                  <input
                    className={inputCls}
                    placeholder={t('permits.revoke.reason')}
                    dir="auto"
                    value={revokeReason}
                    autoFocus
                    onChange={(e) => setRevokeReason(e.target.value)}
                  />
                  <div className="flex justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={() => setRevokeOpen(false)}>
                      {t('common.cancel')}
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate()}
                    >
                      {t('permits.revoke.confirm')}
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer actions */}
        {permit && canManage && (
          <div className="flex flex-wrap justify-end gap-2 border-t border-border px-4 py-3">
            <Button
              type="button"
              variant="ghost"
              className="text-destructive hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              {t('permits.actions.delete')}
            </Button>
            <div className="flex-1" />
            {permit.book_id && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void openBookPdf()}
              >
                <Printer className="me-1.5 h-4 w-4" aria-hidden />
                {t('permits.actions.printPermit')}
              </Button>
            )}
            {!isRevoked && (
              <>
                <Button type="button" variant="outline" onClick={() => onEdit(permit)}>
                  {t('permits.actions.edit')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setNewEnd('')
                    setRenewOpen((v) => !v)
                    setRevokeOpen(false)
                  }}
                >
                  {t('permits.actions.renew')}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => {
                    setRevokeOpen((v) => !v)
                    setRenewOpen(false)
                  }}
                >
                  {t('permits.actions.revoke')}
                </Button>
              </>
            )}
          </div>
        )}

        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          title={t('permits.delete.title')}
          description={t('permits.delete.help')}
          confirmLabel={t('permits.delete.confirm')}
          destructive
          onConfirm={() => del.mutate()}
        />
      </DialogContent>
    </DialogRoot>
  )
}

function Fact({
  label,
  value,
  mono = false,
  span = false,
  ltr = false,
}: {
  label: string
  value: string
  mono?: boolean
  span?: boolean
  /** Force LTR — for values like the date window whose `→` reverses under RTL. */
  ltr?: boolean
}): React.JSX.Element {
  return (
    <div className={`flex flex-col gap-0.5 ${span ? 'col-span-2' : ''}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-foreground ${mono ? 'font-mono' : ''}`} dir={ltr ? 'ltr' : 'auto'}>
        {value}
      </dd>
    </div>
  )
}
