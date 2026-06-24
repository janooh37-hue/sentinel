import { useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2, X } from 'lucide-react'

import { api, ApiError } from '@/lib/api'
import type { RecipientListMember, RecipientListRead } from '@/lib/api'
import {
  DialogRoot,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type DraftMember = { id: string; field: 'to' | 'cc'; address: string; display_name: string }

export interface RecipientListDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Pre-fill a new (unsaved) list — used by "Save current To/Cc". */
  initialDraft?: { name: string; members: RecipientListMember[] } | null
  /** Saved contact addresses feeding the per-row datalist autocomplete. */
  contactAddresses: string[]
}

export function RecipientListDialog({
  open,
  onOpenChange,
  initialDraft,
  contactAddresses,
}: RecipientListDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const datalistId = useId()

  const listsQuery = useQuery({
    queryKey: ['ledger-recipient-lists'],
    queryFn: () => api.listRecipientLists(),
    enabled: open,
  })
  const lists = listsQuery.data ?? []

  const [editingId, setEditingId] = useState<number | null>(null)
  const [pendingDelete, setPendingDelete] = useState<RecipientListRead | null>(null)
  const [name, setName] = useState(initialDraft?.name ?? '')
  const [members, setMembers] = useState<DraftMember[]>(
    (initialDraft?.members ?? []).map((m) => ({ ...m, id: crypto.randomUUID() })),
  )
  const [nameError, setNameError] = useState<string | null>(null)

  function startNew(): void {
    setEditingId(null)
    setName('')
    setMembers([])
    setNameError(null)
  }

  // Reset the editor each time the dialog opens (it's controlled, not remounted).
  useEffect(() => {
    if (!open) return
    /* eslint-disable react-hooks/set-state-in-effect -- intentional: sync form state to dialog open event */
    setEditingId(null)
    setName(initialDraft?.name ?? '')
    setMembers((initialDraft?.members ?? []).map((m) => ({ ...m, id: crypto.randomUUID() })))
    setNameError(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    // initialDraft is captured at open-time on purpose; re-run only on `open`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function startEdit(l: RecipientListRead): void {
    setEditingId(l.id)
    setName(l.name)
    setMembers(l.members.map((m) => ({ ...m, id: crypto.randomUUID() })))
    setNameError(null)
  }

  const saveMutation = useMutation({
    mutationFn: async (): Promise<void> => {
      const cleaned = members
        .map((m) => ({ field: m.field, address: m.address.trim(), display_name: m.display_name }))
        .filter((m) => m.address.length > 0)
      if (editingId == null) {
        await api.createRecipientList({ name: name.trim(), members: cleaned })
      } else {
        await api.updateRecipientList(editingId, { name: name.trim(), members: cleaned })
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ledger-recipient-lists'] })
      toast.success(t('ledger.lists.saved', { defaultValue: 'List saved' }))
      startNew()
    },
    onError: (err) => {
      if (err instanceof ApiError && err.code === 'RECIPIENT_LIST_NAME_TAKEN') {
        setNameError(t('ledger.lists.nameTaken', { defaultValue: 'A list with this name already exists' }))
        return
      }
      toast.error(err instanceof ApiError ? err.message : (err as Error).message)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.deleteRecipientList(id),
    onSuccess: (_d, id) => {
      void qc.invalidateQueries({ queryKey: ['ledger-recipient-lists'] })
      if (editingId === id) startNew()
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : (err as Error).message),
  })

  const canSave = name.trim().length > 0 && !saveMutation.isPending

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('ledger.lists.title', { defaultValue: 'Recipient lists' })}</DialogTitle>
          <DialogDescription>
            {t('ledger.lists.desc', {
              defaultValue: 'Save groups of To/Cc recipients and apply them in one click.',
            })}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 overflow-y-auto p-4 sm:grid-cols-[200px_1fr]">
          <div className="flex flex-col gap-1 border-e border-hairline pe-3">
            <button
              type="button"
              onClick={startNew}
              className={cn(
                'flex items-center gap-1.5 rounded-md px-2 py-1.5 text-start text-xs font-semibold transition-colors',
                editingId == null ? 'bg-primary-soft text-primary-on-soft' : 'hover:bg-surface-tinted',
              )}
            >
              <Plus className="h-3.5 w-3.5" /> {t('ledger.lists.new', { defaultValue: 'New list' })}
            </button>
            {lists.map((l) => (
              <div key={l.id} className="group flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => startEdit(l)}
                  className={cn(
                    'min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-start text-xs transition-colors',
                    editingId === l.id ? 'bg-surface-tinted font-medium' : 'hover:bg-surface-tinted',
                  )}
                  dir="auto"
                >
                  {l.name}
                </button>
                <button
                  type="button"
                  aria-label={t('common.delete', { defaultValue: 'Delete' })}
                  onClick={() => setPendingDelete(l)}
                  className="flex-none rounded-md p-1 text-faint opacity-0 transition-opacity hover:text-accent group-hover:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <Label htmlFor="rl-name">{t('ledger.lists.name', { defaultValue: 'List name' })}</Label>
              <Input
                id="rl-name"
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                  setNameError(null)
                }}
                placeholder={t('ledger.lists.namePlaceholder', { defaultValue: 'e.g. Payroll' })}
                dir="auto"
              />
              {nameError && <span className="text-xs text-accent">{nameError}</span>}
            </div>

            <datalist id={datalistId}>
              {contactAddresses.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>

            <div className="flex flex-col gap-2">
              {members.map((m, i) => (
                <div key={m.id} className="flex items-center gap-2">
                  <div className="flex flex-none overflow-hidden rounded-md border border-input text-[11px] font-semibold">
                    {(['to', 'cc'] as const).map((f) => (
                      <button
                        key={f}
                        type="button"
                        aria-pressed={m.field === f}
                        onClick={() =>
                          setMembers((prev) => prev.map((x, j) => (j === i ? { ...x, field: f } : x)))
                        }
                        className={cn(
                          'px-2 py-1 uppercase transition-colors',
                          m.field === f ? 'bg-primary text-primary-foreground' : 'bg-surface text-muted-foreground hover:bg-surface-tinted',
                        )}
                      >
                        {f}
                      </button>
                    ))}
                  </div>
                  <Input
                    list={datalistId}
                    value={m.address}
                    onChange={(e) =>
                      setMembers((prev) => prev.map((x, j) => (j === i ? { ...x, address: e.target.value } : x)))
                    }
                    placeholder="name@example.com"
                    className="min-w-0 flex-1"
                    dir="auto"
                  />
                  <button
                    type="button"
                    aria-label={t('common.remove', { defaultValue: 'Remove' })}
                    onClick={() => setMembers((prev) => prev.filter((_, j) => j !== i))}
                    className="flex-none rounded-md p-1 text-faint hover:text-accent"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() => setMembers((prev) => [...prev, { id: crypto.randomUUID(), field: 'to', address: '', display_name: '' }])}
                className="inline-flex w-fit items-center gap-1 rounded-md border border-dashed border-primary/40 px-2.5 py-1 text-xs font-semibold text-primary transition-colors hover:bg-primary-soft/70"
              >
                <Plus className="h-3.5 w-3.5" /> {t('ledger.lists.addMember', { defaultValue: 'Add recipient' })}
              </button>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                {t('common.close', { defaultValue: 'Close' })}
              </Button>
              <Button type="button" disabled={!canSave} onClick={() => saveMutation.mutate()}>
                {editingId == null
                  ? t('ledger.lists.create', { defaultValue: 'Create list' })
                  : t('ledger.lists.save', { defaultValue: 'Save changes' })}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
      <ConfirmDialog
        open={pendingDelete != null}
        onOpenChange={(o) => { if (!o) setPendingDelete(null) }}
        title={t('ledger.lists.deleteTitle', { defaultValue: 'Delete this list?' })}
        description={pendingDelete ? t('ledger.lists.deleteDesc', { defaultValue: 'Delete "{{name}}"? This cannot be undone.', name: pendingDelete.name }) : undefined}
        confirmLabel={t('common.delete', { defaultValue: 'Delete' })}
        destructive
        onConfirm={() => { if (pendingDelete) deleteMutation.mutate(pendingDelete.id); setPendingDelete(null) }}
      />
    </DialogRoot>
  )
}
