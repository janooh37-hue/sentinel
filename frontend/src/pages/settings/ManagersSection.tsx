/**
 * ManagersSection — admin (settings.edit) management of the signatory directory.
 * List (active only) with per-row account link, Edit, and Deactivate; plus an
 * Add form. Signatures use the shared SignatureDrawPanel (draw or upload).
 */
import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Loader2 } from 'lucide-react'

import { api, apiErrorMessage, type ManagerRead } from '@/lib/api'
import { SignatureDrawPanel } from '@/components/signature/SignatureDrawPanel'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { SectionCard, OutlineButton, PrimaryButton } from './SettingsPage'

interface FormState {
  name_en: string
  name_ar: string
  title: string
}

const EMPTY: FormState = { name_en: '', name_ar: '', title: '' }

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  return (await fetch(dataUrl)).blob()
}

export function ManagersSection(): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data: managers } = useQuery({ queryKey: ['managers'], queryFn: () => api.listManagers() })
  const { data: users } = useQuery({ queryKey: ['auth', 'users'], queryFn: () => api.listAuthUsers() })
  const active = (users ?? []).filter((u) => u.status === 'active')

  const [addOpen, setAddOpen] = useState(false)
  const [editId, setEditId] = useState<number | null>(null)
  const [form, setForm] = useState<FormState>(EMPTY)
  const [pendingSig, setPendingSig] = useState<string | null>(null) // data URL for a new manager
  const [deactivateId, setDeactivateId] = useState<number | null>(null)

  const invalidate = () => void qc.invalidateQueries({ queryKey: ['managers'] })

  const linkMut = useMutation({
    mutationFn: ({ id, userId }: { id: number; userId: number | null }) =>
      api.linkManagerAccount(id, userId),
    onSuccess: () => { invalidate(); toast.success(t('settings.managers.linkedToast')) },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  })

  const createMut = useMutation({
    mutationFn: async () => {
      const mgr = await api.createManager({
        name_en: form.name_en.trim() || null,
        name_ar: form.name_ar.trim() || null,
        title: form.title.trim() || null,
        active: true,
      })
      if (pendingSig) await api.uploadManagerSignature(mgr.id, await dataUrlToBlob(pendingSig))
      return mgr
    },
    onSuccess: () => {
      invalidate(); toast.success(t('settings.managers.addedToast'))
      setAddOpen(false); setForm(EMPTY); setPendingSig(null)
    },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  })

  const updateMut = useMutation({
    mutationFn: (id: number) =>
      api.updateManager(id, {
        name_en: form.name_en.trim() || null,
        name_ar: form.name_ar.trim() || null,
        title: form.title.trim() || null,
      }),
    onSuccess: () => { invalidate(); toast.success(t('settings.managers.updatedToast')); setEditId(null) },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  })

  const deactivateMut = useMutation({
    mutationFn: (id: number) => api.updateManager(id, { active: false }),
    onSuccess: () => { invalidate(); toast.success(t('settings.managers.deactivatedToast')) },
    onError: (e: unknown) => toast.error(apiErrorMessage(e)),
  })

  const openEdit = (m: ManagerRead) => {
    setEditId(m.id)
    setForm({ name_en: m.name_en ?? '', name_ar: m.name_ar ?? '', title: m.title ?? '' })
    setAddOpen(false)
    setPendingSig(null)
  }

  const nameValid = form.name_en.trim() !== '' || form.name_ar.trim() !== ''
  const inputCls =
    'w-full rounded-lg border border-border bg-surface px-3.5 py-2.5 text-[0.86em] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15'

  const formFields = (
    <div className="space-y-2">
      <input className={inputCls} dir="auto" placeholder={t('settings.managers.nameEn')}
        value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} />
      <input className={inputCls} dir="auto" placeholder={t('settings.managers.nameAr')}
        value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.target.value })} />
      <input className={inputCls} dir="auto" placeholder={t('settings.managers.jobTitle')}
        value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
    </div>
  )

  return (
    <SectionCard title={t('settings.managers.title')} description={t('settings.managers.description')}>
      <div className="space-y-2.5">
        {managers && managers.length === 0 && (
          <p className="py-2 text-[0.86em] text-muted-foreground">{t('settings.managers.empty')}</p>
        )}

        {managers?.map((m) =>
          editId === m.id ? (
            <div key={m.id} className="space-y-2.5 rounded-lg border border-hairline bg-surface-tinted p-3">
              {formFields}
              <ManagerSignatureEditor managerId={m.id} />
              <div className="flex justify-end gap-2">
                <OutlineButton onClick={() => setEditId(null)}>{t('settings.managers.cancel')}</OutlineButton>
                <PrimaryButton disabled={!nameValid || updateMut.isPending} onClick={() => updateMut.mutate(m.id)}>
                  {updateMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {t('settings.managers.save')}
                </PrimaryButton>
              </div>
            </div>
          ) : (
            <div key={m.id} className="flex items-center justify-between gap-3 rounded-lg border border-hairline bg-surface-raised px-4 py-2.5">
              <div className="min-w-0">
                <span className="block truncate text-[0.9em] font-medium text-foreground" dir="auto">
                  {m.name_en ?? m.name_ar}
                </span>
                <span className="text-[0.76em] text-muted-foreground" dir="auto">
                  {m.title ? m.title + ' · ' : ''}
                  {m.has_signature ? t('settings.managers.hasSignature') : t('settings.managers.noSignature')}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <select aria-label={t('settings.managers.noAccount')}
                  className="rounded-lg border border-border bg-surface px-3 py-1.5 text-[0.84em]"
                  value={m.user_id != null ? String(m.user_id) : ''}
                  onChange={(e) => linkMut.mutate({ id: m.id, userId: e.target.value ? Number(e.target.value) : null })}>
                  <option value="">{t('settings.managers.noAccount')}</option>
                  {active.map((u) => (
                    <option key={u.id} value={u.id}>{u.name_en ?? u.display_name ?? u.email}</option>
                  ))}
                </select>
                <button type="button" onClick={() => openEdit(m)}
                  className="rounded-full px-3 py-1 text-[0.78em] font-medium text-primary hover:bg-primary/10">
                  {t('settings.managers.edit')}
                </button>
                <button type="button" onClick={() => setDeactivateId(m.id)}
                  className="rounded-full px-3 py-1 text-[0.78em] font-medium text-accent hover:bg-accent-soft">
                  {t('settings.managers.deactivate')}
                </button>
              </div>
            </div>
          ),
        )}

        {addOpen ? (
          <div className="space-y-2.5 rounded-lg border border-hairline bg-surface-tinted p-3">
            {formFields}
            <div>
              <p className="mb-1 text-[0.78em] font-medium text-muted-foreground">{t('settings.managers.signature')}</p>
              {pendingSig ? (
                <div className="flex items-center gap-3">
                  <img src={pendingSig} alt={t('settings.managers.signature')} className="max-h-16 rounded border border-border bg-white p-1" />
                  <OutlineButton onClick={() => setPendingSig(null)}>{t('settings.managers.cancel')}</OutlineButton>
                </div>
              ) : (
                <SignatureDrawPanel showSaveToProfile={false} onUse={(d) => setPendingSig(d)} />
              )}
            </div>
            <div className="flex justify-end gap-2">
              <OutlineButton onClick={() => { setAddOpen(false); setForm(EMPTY); setPendingSig(null) }}>
                {t('settings.managers.cancel')}
              </OutlineButton>
              <PrimaryButton disabled={!nameValid || createMut.isPending} onClick={() => createMut.mutate()}>
                {createMut.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t('settings.managers.addAction')}
              </PrimaryButton>
            </div>
          </div>
        ) : (
          <OutlineButton onClick={() => { setForm(EMPTY); setPendingSig(null); setEditId(null); setAddOpen(true) }}>
            {t('settings.managers.add')}
          </OutlineButton>
        )}
      </div>

      <ConfirmDialog
        open={deactivateId !== null}
        onOpenChange={(o) => { if (!o) setDeactivateId(null) }}
        title={t('settings.managers.confirmDeactivate')}
        confirmLabel={t('settings.managers.deactivate')}
        onConfirm={() => { if (deactivateId !== null) deactivateMut.mutate(deactivateId) }}
        destructive
      />
    </SectionCard>
  )
}

/** Edit-mode signature manager: show current, Replace via draw/upload, Remove. */
function ManagerSignatureEditor({ managerId }: { managerId: number }): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [replacing, setReplacing] = useState(false)
  const { data } = useQuery({
    queryKey: ['manager-signature', managerId],
    queryFn: () => api.getManagerSignature(managerId),
    retry: false,
  })
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['manager-signature', managerId] })

  const save = async (dataUrl: string): Promise<void> => {
    try {
      await api.uploadManagerSignature(managerId, await dataUrlToBlob(dataUrl))
      setReplacing(false); invalidate()
      void qc.invalidateQueries({ queryKey: ['managers'] })
    } catch (e) { toast.error(apiErrorMessage(e)) }
  }
  const remove = async (): Promise<void> => {
    try {
      await api.deleteManagerSignature(managerId)
      invalidate(); void qc.invalidateQueries({ queryKey: ['managers'] })
    } catch (e) { toast.error(apiErrorMessage(e)) }
  }

  return (
    <div>
      <p className="mb-1 text-[0.78em] font-medium text-muted-foreground">{t('settings.managers.signature')}</p>
      {data?.dataUrl && !replacing ? (
        <div className="flex items-center gap-3">
          <img src={data.dataUrl} alt={t('settings.managers.signature')} className="max-h-16 rounded border border-border bg-white p-1" />
          <OutlineButton onClick={() => setReplacing(true)}>{t('settings.managers.edit')}</OutlineButton>
          <button type="button" onClick={() => void remove()} className="text-[0.78em] font-medium text-accent">
            {t('settings.managers.removeSignature')}
          </button>
        </div>
      ) : (
        <SignatureDrawPanel showSaveToProfile={false} onUse={(d) => void save(d)}
          onCancel={data?.dataUrl ? () => setReplacing(false) : undefined} />
      )}
    </div>
  )
}
