/**
 * RecipientManagerDialog — CRUD for the General Book recipient list.
 *
 * Mirrors SubmitterManagerDialog in structure and design tokens.
 * Uses GET/POST/DELETE /api/v1/general-book/recipients.
 * Requires `books.manage` capability for write operations.
 */

import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

import { api, type RecipientCreate } from '@/lib/api'
import { Skeleton } from '@/components/ui/skeleton'

interface RecipientManagerDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const OUTLINE_PILL =
  'inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface px-4 py-2 text-[0.82em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
const PRIMARY_PILL =
  'inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-[0.85em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50'
const INPUT_BASE =
  'rounded-lg border border-border bg-surface px-3.5 py-2.5 text-[0.86em] text-foreground placeholder:text-muted-foreground transition-colors focus:border-primary focus:outline-none focus:ring-3 focus:ring-primary/15'

export function RecipientManagerDialog({
  open,
  onOpenChange,
}: RecipientManagerDialogProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const isAr = i18n.language.startsWith('ar')
  const qc = useQueryClient()

  const { data: recipients, isLoading } = useQuery({
    queryKey: ['general-book', 'recipients'],
    queryFn: () => api.listRecipients(),
    enabled: open,
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteRecipient(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['general-book', 'recipients'] })
      toast.success(isAr ? 'تم حذف المستلم' : 'Recipient deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [newNameAr, setNewNameAr] = useState('')

  const createMut = useMutation({
    mutationFn: (body: RecipientCreate) => api.createRecipient(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['general-book', 'recipients'] })
      toast.success(isAr ? 'تمت إضافة المستلم' : 'Recipient added')
      setShowAdd(false)
      setNewName('')
      setNewNameAr('')
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
              {t('application.recipientManagementTitle')}
            </Dialog.Title>
            <Dialog.Description className="mt-1 text-[0.86em] text-muted-foreground">
              {isAr ? 'أضف أو احذف المستلمين.' : 'Add or remove recipients.'}
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
            {recipients?.length === 0 && (
              <p className="py-2 text-[0.86em] text-muted-foreground">
                {isAr ? 'لا يوجد مستلمون' : 'No recipients yet'}
              </p>
            )}
            {recipients?.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between rounded-lg border border-hairline bg-surface-raised px-4 py-2.5"
              >
                <div className="min-w-0">
                  <span className="text-[0.9em] font-medium text-foreground">
                    {isAr && r.name_ar ? r.name_ar : r.name}
                  </span>
                  {r.name_ar && !isAr && (
                    <span className="ms-2 text-[0.78em] text-muted-foreground">
                      {r.name_ar}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    if (confirm(isAr ? 'حذف المستلم؟' : 'Delete recipient?')) {
                      deleteMut.mutate(r.id)
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
              <div className="flex flex-col gap-2">
                <input
                  autoFocus
                  className={INPUT_BASE}
                  placeholder={t('application.recipientNamePlaceholder')}
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
                <input
                  className={`${INPUT_BASE} text-end`}
                  dir="rtl"
                  placeholder={t('application.recipientNameArPlaceholder')}
                  value={newNameAr}
                  onChange={(e) => setNewNameAr(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  className={OUTLINE_PILL}
                  onClick={() => {
                    setShowAdd(false)
                    setNewName('')
                    setNewNameAr('')
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
                      name_ar: newNameAr.trim() || null,
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
              {t('application.addRecipient')}
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
