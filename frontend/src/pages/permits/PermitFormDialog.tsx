/**
 * PermitFormDialog — issue a new permit or edit an existing one's header.
 *
 * On create it also accepts an initial list of people (rows can be added /
 * removed inline); on edit the people list is managed from the detail dialog,
 * so this form only edits the header fields.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Trash2, Plus, Upload } from 'lucide-react'
import { toast } from 'sonner'

import {
  api,
  apiErrorMessage,
  type PermitCreate,
  type PermitPersonCreate,
  type PermitRead,
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
import { todayISO } from './permitUtils'

const ZONES: PermitZone[] = ['green', 'red', 'both']

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

let rowSeq = 0
const newRow = (): PersonRow => ({ key: `r${rowSeq++}`, name: '' })

export function PermitFormDialog({ open, permit, onOpenChange, onSaved }: Props): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const isEdit = Boolean(permit)

  const [company, setCompany] = useState('')
  const [zone, setZone] = useState<PermitZone>('green')
  const [startDate, setStartDate] = useState(todayISO())
  const [endDate, setEndDate] = useState(todayISO())
  const [purpose, setPurpose] = useState('')
  const [notes, setNotes] = useState('')
  const [people, setPeople] = useState<PersonRow[]>([])
  const [docFile, setDocFile] = useState<File | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Re-seed local state each time the dialog opens so a reopen starts clean
  // (create) or from the record's current values (edit).
  useEffect(() => {
    if (!open) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCompany(permit?.company ?? '')
    setZone(permit?.zone ?? 'green')
    setStartDate(permit ? permit.start_date.slice(0, 10) : todayISO())
    setEndDate(permit ? permit.end_date.slice(0, 10) : todayISO())
    setPurpose(permit?.purpose ?? '')
    setNotes(permit?.notes ?? '')
    setPeople([])
    setDocFile(null)
  }, [open, permit])

  const windowValid = endDate >= startDate
  const canSave = company.trim().length > 0 && windowValid

  const mutation = useMutation({
    mutationFn: async (): Promise<PermitRead> => {
      if (isEdit && permit) {
        return api.updatePermit(permit.id, {
          company: company.trim(),
          zone,
          start_date: startDate,
          end_date: endDate,
          purpose: purpose.trim() || null,
          notes: notes.trim() || null,
        })
      }
      const body: PermitCreate = {
        company: company.trim(),
        zone,
        start_date: startDate,
        end_date: endDate,
        purpose: purpose.trim() || null,
        notes: notes.trim() || null,
        people: people
          .filter((p) => p.name.trim().length > 0)
          .map((p) => ({
            name: p.name.trim(),
            uae_id: p.uae_id?.trim() || null,
            nationality: p.nationality?.trim() || null,
            role: p.role?.trim() || null,
          })),
      }
      const created = await api.createPermit(body)
      // The scan can only attach once the permit has an id — upload it now.
      if (docFile) return api.uploadPermitDocument(created.id, docFile)
      return created
    },
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['permits-list'] })
      void qc.invalidateQueries({ queryKey: ['permits-summary'] })
      toast.success(t('common.savedToast', { defaultValue: 'Saved' }))
      onSaved(data)
      onOpenChange(false)
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  const patchRow = (key: string, patch: Partial<PersonRow>): void =>
    setPeople((rows) => rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))

  const title = useMemo(
    () => (isEdit ? t('permits.form.editTitle') : t('permits.form.newTitle')),
    [isEdit, t],
  )

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
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

          {/* Zone + dates */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs text-muted-foreground">{t('permits.form.zone')}</span>
              <select
                className={inputCls}
                value={zone}
                onChange={(e) => setZone(e.target.value as PermitZone)}
              >
                {ZONES.map((z) => (
                  <option key={z} value={z}>
                    {t(`permits.zone.${z}`)}
                  </option>
                ))}
              </select>
            </label>
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

          {/* Permit paper — create only (edit manages it from the detail view) */}
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

          {/* People — create only */}
          {!isEdit && (
            <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">
                  {t('permits.form.people')}
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
              {people.length === 0 ? (
                <p className="text-xs text-muted-foreground">{t('permits.form.peopleHelp')}</p>
              ) : (
                people.map((row) => (
                  <div key={row.key} className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
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
                    <button
                      type="button"
                      aria-label={t('common.remove')}
                      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-tinted hover:text-destructive"
                      onClick={() => setPeople((r) => r.filter((x) => x.key !== row.key))}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </button>
                  </div>
                ))
              )}
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
