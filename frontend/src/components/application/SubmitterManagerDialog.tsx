/**
 * SubmitterManagerDialog — real CRUD for submitter list.
 * Phase 08: replaces the "coming soon" stub with list/add/delete.
 * TAMM redesign: rounded-2xl card with TAMM form-field vocabulary.
 */

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import { api, type SubmitterCreate } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'

interface SubmitterManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const OUTLINE_PILL =
  'inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-2 text-[0.82em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY_PILL =
  'inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-[0.85em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
const INPUT_BASE =
  'rounded-lg border border-border bg-surface px-3.5 py-2.5 text-[0.86em] text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15'

export function SubmitterManagerDialog({
  open,
  onOpenChange,
}: SubmitterManagerDialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const qc = useQueryClient()

  const { data: submitters, isLoading } = useQuery({
    queryKey: ['submitters'],
    queryFn: () => api.listSubmitters(),
    enabled: open,
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteSubmitter(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['submitters'] })
      toast.success(isAr ? 'تم حذف مقدم الطلب' : 'Submitter deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newEmpId, setNewEmpId] = useState('')

  const createMut = useMutation({
    mutationFn: (body: SubmitterCreate) => api.createSubmitter(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['submitters'] })
      toast.success(isAr ? 'تمت إضافة مقدم الطلب' : 'Submitter added')
      setShowAdd(false)
      setNewName('')
      setNewEmpId('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-black/40 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-200 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-150 motion-reduce:animate-none" />
        <Dialog.Content className="modal-centered fixed left-1/2 top-1/2 z-50 w-full max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl bg-surface p-6 shadow-xl focus:outline-none">
          <div className="mb-4 border-b border-hairline pb-4">
            <Dialog.Title className="text-[1.05em] font-semibold tracking-tight text-foreground">
              {t('application.submitterManagementTitle')}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-[0.86em] text-muted-foreground">
              {isAr ? 'أضف أو احذف مقدمي الطلبات.' : 'Add or remove submitters.'}
            </Dialog.Description>
          </div>

          <div className="max-h-64 space-y-2.5 overflow-y-auto">
            {isLoading && (
              <div className="space-y-2">
                {[1, 2].map((i) => (
                  <Skeleton key={i} className="h-11 w-full rounded-lg" />
                ))}
              </div>
            )}
            {submitters?.length === 0 && (
              <p className="py-2 text-[0.86em] text-muted-foreground">
                {isAr ? 'لا يوجد مقدمو طلبات' : 'No submitters yet'}
              </p>
            )}
            {submitters?.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between rounded-lg border border-hairline bg-surface-raised px-4 py-2.5"
              >
                <div className="min-w-0">
                  <span className="text-[0.9em] font-medium text-foreground">
                    {s.name}
                  </span>
                  {s.employee_id && (
                    <span className="ms-2 font-mono text-[0.78em] text-muted-foreground">
                      {s.employee_id}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(isAr ? 'حذف مقدم الطلب؟' : 'Delete submitter?')) {
                      deleteMut.mutate(s.id)
                    }
                  }}
                  className="rounded-full px-3 py-1 text-[0.78em] font-medium text-accent hover:bg-accent-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  {t('common.delete')}
                </button>
              </div>
            ))}
          </div>

          {showAdd ? (
            <div className="mt-3 space-y-2.5 rounded-lg border border-hairline bg-surface-tinted p-3">
              <div className="flex gap-2">
                <input
                  autoFocus
                  className={`${INPUT_BASE} flex-1`}
                  placeholder={isAr ? 'الاسم' : 'Name'}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <input
                  className={`${INPUT_BASE} w-32 font-mono`}
                  placeholder={isAr ? 'رقم الموظف' : 'Emp ID'}
                  value={newEmpId}
                  onChange={(e) => setNewEmpId(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className={OUTLINE_PILL}
                  onClick={() => {
                    setShowAdd(false)
                    setNewName('')
                    setNewEmpId('')
                  }}
                >
                  {t('common.cancel')}
                </button>
                <button
                  type="button"
                  className={PRIMARY_PILL}
                  disabled={!newName.trim() || createMut.isPending}
                  onClick={() =>
                    createMut.mutate({
                      name: newName.trim(),
                      employee_id: newEmpId || null,
                    })
                  }
                >
                  {createMut.isPending && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {t('common.add')}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className={`${OUTLINE_PILL} mt-3`}
              onClick={() => setShowAdd(true)}
            >
              {isAr ? 'إضافة مقدم طلب' : 'Add submitter'}
            </button>
          )}

          <div className="mt-5 flex justify-end border-t border-hairline pt-4">
            <Dialog.Close asChild>
              <button type="button" className={OUTLINE_PILL}>
                {t('common.close')}
              </button>
            </Dialog.Close>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
