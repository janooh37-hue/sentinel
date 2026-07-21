/**
 * PermitDetailDialog — the read + manage surface for one permit.
 *
 * Fetches the permit fresh (so the people list is always current), shows the
 * header facts, and — for users with `permits.manage` — hosts the amendment
 * actions: add / remove person, renew, revoke, delete. Renew and revoke use
 * inline panels (not nested modals) to keep the Radix dialog stack shallow;
 * delete uses the AlertDialog-based ConfirmDialog.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Trash2, UserPlus } from 'lucide-react'
import { toast } from 'sonner'

import { api, apiErrorMessage, type PermitRead } from '@/lib/api'
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
import { fmtDate, statusTone, zoneTone } from './permitUtils'

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
        uae_id: personUae.trim() || null,
      }),
    onSuccess: () => {
      invalidate()
      setPersonName('')
      setPersonUae('')
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
      toast.success(t('common.savedToast', { defaultValue: 'Saved' }))
    },
    onError: onErr,
  })

  const revoke = useMutation({
    mutationFn: () => api.revokePermit(permitId, { reason: revokeReason.trim() || undefined }),
    onSuccess: () => {
      invalidate()
      setRevokeOpen(false)
      setRevokeReason('')
      toast.success(t('common.savedToast', { defaultValue: 'Saved' }))
    },
    onError: onErr,
  })

  const del = useMutation({
    mutationFn: () => api.deletePermit(permitId),
    onSuccess: () => {
      invalidate()
      onOpenChange(false)
      toast.success(t('common.savedToast', { defaultValue: 'Saved' }))
    },
    onError: onErr,
  })

  const activePeople = permit?.people.filter((p) => p.removed_at === null) ?? []
  const isRevoked = permit?.status === 'revoked'

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
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
                <Badge tone={zoneTone(permit.zone)}>{t(`permits.zone.${permit.zone}`)}</Badge>
              </div>

              {/* Facts grid */}
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
                <Fact label={t('permits.detail.company')} value={permit.company} />
                <Fact
                  label={t('permits.detail.window')}
                  value={`${fmtDate(permit.start_date)} → ${fmtDate(permit.end_date)}`}
                  mono
                />
                <Fact
                  label={t('permits.detail.duration')}
                  value={t('permits.duration', { count: permit.duration_days })}
                />
                <Fact
                  label={t('permits.columns.people')}
                  value={t('permits.detail.peopleCount', { count: permit.people_count })}
                />
                {permit.purpose && (
                  <Fact label={t('permits.detail.purpose')} value={permit.purpose} span />
                )}
                {permit.notes && (
                  <Fact label={t('permits.detail.notes')} value={permit.notes} span />
                )}
                {isRevoked && permit.revoke_reason && (
                  <div className="col-span-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
                    {t('permits.detail.revokedReason', { reason: permit.revoke_reason })}
                  </div>
                )}
              </dl>

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
                          {(p.uae_id || p.role) && (
                            <div className="truncate text-xs text-muted-foreground">
                              {[p.uae_id, p.role].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>
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
                      </li>
                    ))}
                  </ul>
                )}

                {/* Add person (manage + not revoked) */}
                {canManage && !isRevoked && (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto]">
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
                    <Button
                      type="button"
                      variant="outline"
                      disabled={personName.trim().length === 0 || addPerson.isPending}
                      onClick={() => addPerson.mutate()}
                    >
                      <UserPlus className="me-1.5 h-4 w-4" aria-hidden />
                      {t('permits.person.add')}
                    </Button>
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
}: {
  label: string
  value: string
  mono?: boolean
  span?: boolean
}): React.JSX.Element {
  return (
    <div className={`flex flex-col gap-0.5 ${span ? 'col-span-2' : ''}`}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={`text-foreground ${mono ? 'font-mono' : ''}`} dir="auto">
        {value}
      </dd>
    </div>
  )
}
