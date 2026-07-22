/**
 * PermitFormDialog — issue a new permit or edit an existing one's header.
 *
 * On create it also accepts an initial list of people (rows can be added /
 * removed inline); on edit the people list is managed from the detail dialog,
 * so this form only edits the header fields.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, Plus, Upload, Car, ScanLine } from 'lucide-react'
import { toast } from 'sonner'

import {
  api,
  apiErrorMessage,
  type PermitCreate,
  type PermitPersonCreate,
  type PermitRead,
  type PermitVehicleCreate,
  type PermitZone,
} from '@/lib/api'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { plusDaysISO, todayISO } from './permitUtils'

/** Default validity window for a new permit (days). Long enough that a fresh
 * permit isn't immediately flagged "expiring". */
const DEFAULT_WINDOW_DAYS = 30

const ZONES: PermitZone[] = ['green', 'red', 'work_residence']

const inputCls =
  'h-9 rounded-md border border-input bg-surface px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

interface Props {
  open: boolean
  /** When set, the dialog edits this permit's header instead of creating one. */
  permit?: PermitRead | null
  onOpenChange: (open: boolean) => void
  onSaved: (permit: PermitRead) => void
}

interface PersonRow extends PermitPersonCreate {
  key: string
}
interface VehicleRow extends PermitVehicleCreate {
  key: string
}

let rowSeq = 0
const newRow = (): PersonRow => ({ key: `r${rowSeq++}`, name: '', uae_id: '' })
const newVehicleRow = (): VehicleRow => ({ key: `v${rowSeq++}`, plate_no: '' })

export function PermitFormDialog({ open, permit, onOpenChange, onSaved }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const isEdit = Boolean(permit)

  const [company, setCompany] = useState('')
  const [zones, setZones] = useState<PermitZone[]>(['green'])
  const [startDate, setStartDate] = useState(todayISO())
  const [endDate, setEndDate] = useState(plusDaysISO(DEFAULT_WINDOW_DAYS))
  const [purpose, setPurpose] = useState('')
  const [notes, setNotes] = useState('')
  const [managerId, setManagerId] = useState<number | null>(null)
  const [people, setPeople] = useState<PersonRow[]>([])
  const [vehicles, setVehicles] = useState<VehicleRow[]>([])
  const [docFile, setDocFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Per-row scan files: key → File (held in refs to avoid re-renders on scan)
  const personScanFiles = useRef<Map<string, File>>(new Map())
  const vehicleScanFiles = useRef<Map<string, File>>(new Map())

  // Managers list (only needed in create mode; skip in edit)
  const { data: managers } = useQuery({
    queryKey: ['managers-list'],
    queryFn: () => api.listManagers(),
    enabled: !isEdit,
    staleTime: 60_000,
  })

  // Re-seed local state each time the dialog opens so a reopen starts clean
  // (create) or from the record's current values (edit).
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCompany(permit?.company ?? '')
    setZones(permit?.zones ?? ['green'])
    setStartDate(permit ? permit.start_date.slice(0, 10) : todayISO())
    setEndDate(permit ? permit.end_date.slice(0, 10) : plusDaysISO(DEFAULT_WINDOW_DAYS))
    setPurpose(permit?.purpose ?? '')
    setNotes(permit?.notes ?? '')
    setManagerId(permit?.manager_id ?? null)
    // A permit must authorize at least one person, so start create with one row.
    setPeople(isEdit ? [] : [newRow()])
    setVehicles([])
    setDocFile(null)
    personScanFiles.current.clear()
    vehicleScanFiles.current.clear()
  }, [open, permit, isEdit])

  const windowValid = endDate >= startDate
  // Every named person must also carry a UAE ID (mandatory); create needs ≥1.
  const namedPeople = people.filter((p) => p.name.trim().length > 0)
  const peopleComplete = namedPeople.every((p) => (p.uae_id ?? '').trim().length > 0)
  const hasPerson = namedPeople.some((p) => (p.uae_id ?? '').trim().length > 0)
  const toggleZone = (z: PermitZone): void =>
    setZones((cur) => (cur.includes(z) ? cur.filter((x) => x !== z) : [...cur, z]))
  const canSave =
    company.trim().length > 0 &&
    windowValid &&
    zones.length > 0 &&
    (isEdit || (hasPerson && peopleComplete))

  const mutation = useMutation({
    mutationFn: async (): Promise<PermitRead> => {
      if (isEdit && permit) {
        return api.updatePermit(permit.id, {
          company: company.trim(),
          zones,
          start_date: startDate,
          end_date: endDate,
          purpose: purpose.trim() || null,
          notes: notes.trim() || null,
        })
      }
      // Capture row order at submit time for index-based matching
      const submittedPeople = people.filter((p) => p.name.trim().length > 0)
      const submittedVehicles = vehicles.filter(
        (v) => (v.plate_no ?? '').trim().length > 0 || (v.make_model ?? '').trim().length > 0,
      )

      const body: PermitCreate = {
        company: company.trim(),
        zones,
        start_date: startDate,
        end_date: endDate,
        purpose: purpose.trim() || null,
        notes: notes.trim() || null,
        manager_id: managerId,
        people: submittedPeople.map((p) => ({
          name: p.name.trim(),
          uae_id: (p.uae_id ?? '').trim(),
          nationality: p.nationality?.trim() || null,
          role: p.role?.trim() || null,
        })),
        vehicles: submittedVehicles.map((v) => ({
          plate_no: (v.plate_no ?? '').trim() || null,
          plate_emirate: v.plate_emirate?.trim() || null,
          make_model: v.make_model?.trim() || null,
          driver_name: v.driver_name?.trim() || null,
          colour: v.colour?.trim() || null,
          vehicle_type: v.vehicle_type?.trim() || null,
          plate_category: v.plate_category?.trim() || null,
          traffic_no: v.traffic_no?.trim() || null,
          reg_expiry: v.reg_expiry?.trim() || null,
        })),
      }
      let created = await api.createPermit(body)

      // Attach the permit-paper scan once we have an id (mirrors existing pattern)
      if (docFile) {
        try { created = await api.uploadPermitDocument(created.id, docFile) } catch { /* scan attach is best-effort */ }
      }

      // Attach per-person UAE ID scans by index order
      // created.people[] is in insertion order, matching submittedPeople order
      for (let i = 0; i < submittedPeople.length; i++) {
        const file = personScanFiles.current.get(submittedPeople[i].key)
        if (file && created.people[i]) {
          try { created = await api.uploadPersonDocument(created.id, created.people[i].id, file) } catch { /* best-effort */ }
        }
      }

      // Attach per-vehicle licence scans by index order
      for (let i = 0; i < submittedVehicles.length; i++) {
        const file = vehicleScanFiles.current.get(submittedVehicles[i].key)
        if (file && created.vehicles[i]) {
          try { created = await api.uploadVehicleDocument(created.id, created.vehicles[i].id, file) } catch { /* best-effort */ }
        }
      }

      return created
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['permits-list'] })
      void qc.invalidateQueries({ queryKey: ['permits-summary'] })
      toast.success(t('common.savedToast'))
      onSaved(data)
      onOpenChange(false)
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const patchRow = (key: string, patch: Partial<PersonRow>): void =>
    setPeople((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const patchVehicle = (key: string, patch: Partial<VehicleRow>): void =>
    setVehicles((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const handleScanId = async (key: string, file: File): Promise<void> => {
    try {
      const result = await api.scanEmiratesId(file)
      personScanFiles.current.set(key, file)
      patchRow(key, {
        name: result.name ?? undefined,
        uae_id: result.uae_id ?? undefined,
        nationality: result.nationality ?? undefined,
      })
    } catch {
      // scan failure is non-fatal; user can fill in manually
      personScanFiles.current.set(key, file)
    }
  }

  const handleScanLicence = async (key: string, file: File): Promise<void> => {
    try {
      const result = await api.scanVehicleLicence(file)
      vehicleScanFiles.current.set(key, file)
      patchVehicle(key, {
        plate_no: result.plate_no ?? undefined,
        plate_emirate: result.plate_emirate ?? undefined,
        plate_category: result.plate_category ?? undefined,
        traffic_no: result.traffic_no ?? undefined,
        make_model: result.make_model ?? undefined,
        vehicle_type: result.vehicle_type ?? undefined,
        colour: result.colour ?? undefined,
        reg_expiry: result.reg_expiry ?? undefined,
        driver_name: result.driver_name ?? undefined,
      })
    } catch {
      vehicleScanFiles.current.set(key, file)
    }
  }

  const title = useMemo(
    () => (isEdit ? t('permits.form.editTitle') : t('permits.form.newTitle')),
    [isEdit, t],
  )

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t('permits.form.help')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 overflow-y-auto px-4 py-4 text-sm">
          {/* Company */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">{t('permits.form.company')}</span>
            <input
              className={inputCls}
              value={company}
              dir="auto"
              onChange={(e) => setCompany(e.target.value)}
              autoFocus
            />
          </label>

          {/* Zones — checklist, at least one */}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">{t('permits.form.zones')}</span>
            <div className="flex flex-wrap gap-2">
              {ZONES.map((z) => {
                const on = zones.includes(z)
                const dot =
                  z === 'green' ? 'bg-success' : z === 'red' ? 'bg-destructive' : 'bg-info'
                return (
                  <button
                    key={z}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleZone(z)}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                      on
                        ? 'border-primary bg-primary-soft text-primary'
                        : 'border-border text-muted-foreground hover:bg-surface-tinted'
                    }`}
                  >
                    <span className={`h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden />
                    {t(`permits.zone.${z}`)}
                  </button>
                )
              })}
            </div>
            {zones.length === 0 && (
              <p className="text-xs text-destructive">{t('permits.form.zonesRequired')}</p>
            )}
          </div>

          {/* Dates */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t('permits.form.startDate')}</span>
              <input
                type="date"
                className={`${inputCls} font-mono`}
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t('permits.form.endDate')}</span>
              <input
                type="date"
                className={`${inputCls} font-mono`}
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
              />
            </label>
          </div>
          {!windowValid && (
            <p className="text-xs text-destructive">{t('permits.form.windowError')}</p>
          )}

          {/* Purpose */}
          <label className="flex flex-col gap-1.5">
            <span className="text-xs text-muted-foreground">{t('permits.form.purpose')}</span>
            <input
              className={inputCls}
              value={purpose}
              dir="auto"
              onChange={(e) => setPurpose(e.target.value)}
            />
          </label>

          {/* Signing manager — create only */}
          {!isEdit && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t('permits.form.signingManager')}</span>
              <select
                className={inputCls}
                value={managerId ?? ''}
                onChange={(e) => setManagerId(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">—</option>
                {managers?.filter((m) => m.active).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name_en ?? m.name_ar ?? m.title ?? String(m.id)}
                  </option>
                ))}
              </select>
            </label>
          )}

          {/* People — create only (at least one required) */}
          {!isEdit && (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-foreground">
                  {t('permits.form.peopleRequired')}
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  onClick={() => setPeople((r) => [...r, newRow()])}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {t('permits.form.addRow')}
                </button>
              </div>
              {(!hasPerson || !peopleComplete) && (
                <p className="text-xs text-muted-foreground">{t('permits.form.peopleRequiredHelp')}</p>
              )}
              {people.length === 0 ? null : (
                people.map((row) => (
                  <div key={row.key} className="flex flex-col gap-1.5">
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1.3fr_1fr_1fr_auto]">
                      <input
                        className={inputCls}
                        placeholder={t('permits.person.name')}
                        dir="auto"
                        value={row.name}
                        onChange={(e) => patchRow(row.key, { name: e.target.value })}
                      />
                      <input
                        className={inputCls}
                        placeholder={t('permits.person.uaeId')}
                        value={row.uae_id ?? ''}
                        onChange={(e) => patchRow(row.key, { uae_id: e.target.value })}
                      />
                      <input
                        className={inputCls}
                        placeholder={t('permits.person.nationality')}
                        dir="auto"
                        value={row.nationality ?? ''}
                        onChange={(e) => patchRow(row.key, { nationality: e.target.value })}
                      />
                      <button
                        type="button"
                        aria-label={t('common.remove')}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-tinted hover:text-destructive"
                        onClick={() => setPeople((r) => r.filter((x) => x.key !== row.key))}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                    {/* Scan ID — label wraps the file input (no JS click needed) */}
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
                          if (file) void handleScanId(row.key, file)
                        }}
                      />
                    </label>
                  </div>
                ))
              )}
              <p className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
                <ScanLine className="h-3.5 w-3.5" aria-hidden />
                {t('permits.form.peopleScanHint')}
              </p>
            </div>
          )}

          {/* Vehicles — create only */}
          {!isEdit && (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('permits.form.vehicles')}
                </span>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                  onClick={() => setVehicles((r) => [...r, newVehicleRow()])}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {t('permits.form.addVehicleRow')}
                </button>
              </div>
              {vehicles.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('permits.form.vehiclesHelp')}</p>
              ) : (
                vehicles.map((row) => (
                  <div key={row.key} className="flex flex-col gap-1.5">
                    {/* Row 1: plate + make/model + remove */}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
                      <input
                        className={`${inputCls} font-mono`}
                        placeholder={t('permits.vehicle.plate')}
                        value={row.plate_no ?? ''}
                        onChange={(e) => patchVehicle(row.key, { plate_no: e.target.value })}
                      />
                      <input
                        className={inputCls}
                        placeholder={t('permits.vehicle.makeModel')}
                        dir="auto"
                        value={row.make_model ?? ''}
                        onChange={(e) => patchVehicle(row.key, { make_model: e.target.value })}
                      />
                      <button
                        type="button"
                        aria-label={t('common.remove')}
                        className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-tinted hover:text-destructive"
                        onClick={() => setVehicles((r) => r.filter((x) => x.key !== row.key))}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </button>
                    </div>
                    {/* Row 2: new fields — colour, type, plate category, traffic no, reg expiry */}
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-[1fr_1fr_1fr_1fr_1.3fr]">
                      <input
                        className={inputCls}
                        placeholder={t('permits.vehicle.colour')}
                        dir="auto"
                        value={row.colour ?? ''}
                        onChange={(e) => patchVehicle(row.key, { colour: e.target.value })}
                      />
                      <input
                        className={inputCls}
                        placeholder={t('permits.vehicle.vehicleType')}
                        dir="auto"
                        value={row.vehicle_type ?? ''}
                        onChange={(e) => patchVehicle(row.key, { vehicle_type: e.target.value })}
                      />
                      <input
                        className={inputCls}
                        placeholder={t('permits.vehicle.plateCategory')}
                        value={row.plate_category ?? ''}
                        onChange={(e) => patchVehicle(row.key, { plate_category: e.target.value })}
                      />
                      <input
                        className={`${inputCls} font-mono`}
                        placeholder={t('permits.vehicle.trafficNo')}
                        value={row.traffic_no ?? ''}
                        onChange={(e) => patchVehicle(row.key, { traffic_no: e.target.value })}
                      />
                      <label className="flex flex-col gap-1">
                        <span className="text-xs text-muted-foreground">{t('permits.vehicle.regExpiry')}</span>
                        <input
                          type="date"
                          aria-label={t('permits.vehicle.regExpiry')}
                          className={`${inputCls} font-mono`}
                          value={row.reg_expiry ?? ''}
                          onChange={(e) => patchVehicle(row.key, { reg_expiry: e.target.value })}
                        />
                      </label>
                    </div>
                    {/* Scan licence — label wraps the file input (no JS click needed) */}
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
                          if (file) void handleScanLicence(row.key, file)
                        }}
                      />
                    </label>
                  </div>
                ))
              )}
              <p className="flex items-center gap-1.5 text-[0.7rem] text-muted-foreground">
                <Car className="h-3.5 w-3.5" aria-hidden />
                {t('permits.form.docsAfterHint')}
              </p>
            </div>
          )}

          {/* Permit paper — optional, last: the issued paper isn't always in
              hand at creation. Managed from the detail view once issued. */}
          {!isEdit && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t('permits.paper.formLabel')}</span>
              <input
                ref={fileRef}
                type="file"
                accept="application/pdf,image/*"
                className="hidden"
                onChange={(e) => setDocFile(e.target.files?.[0] ?? null)}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-3 rounded-xl border border-dashed border-border-strong bg-surface px-3 py-3 text-start hover:border-ring hover:bg-surface-tinted"
              >
                <span className="grid h-9 w-9 flex-none place-items-center rounded-lg bg-primary-soft text-primary">
                  <Upload className="h-[18px] w-[18px]" aria-hidden />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-foreground">
                    {docFile ? docFile.name : t('permits.paper.upload')}
                  </span>
                  <span className="block text-xs text-muted-foreground">{t('permits.paper.uploadHelp')}</span>
                </span>
              </button>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={!canSave || mutation.isPending}
            onClick={() => mutation.mutate()}
          >
            {isEdit ? t('permits.form.save') : t('permits.form.create')}
          </Button>
        </div>
      </DialogContent>
    </DialogRoot>
  )
}
