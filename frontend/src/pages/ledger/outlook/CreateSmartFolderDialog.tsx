/**
 * CreateSmartFolderDialog — confirm a suggested cluster into a smart folder
 * (Phase 3, E4).
 *
 * Mirrors the prototype's "Create a smart folder" modal: editable EN + AR name
 * (prefilled from the cluster's `name_suggestion`), an explainer, and a preview
 * of the emails that will match (the cluster's sample subjects). On create it
 * POSTs `{name_en, name_ar, rule_kind:'subject', rule_value:cluster_key}`,
 * invalidates the folders + suggestions queries, and selects the new folder.
 *
 * Names default to the same suggestion for both languages so the operator only
 * edits what they want (a guessed name is rarely already bilingual).
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import {
  api,
  ApiError,
  type SmartFolder,
  type SmartFolderSuggestion,
} from '@/lib/api'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

interface CreateSmartFolderDialogProps {
  /** The cluster being confirmed, or null when the dialog is closed. */
  suggestion: SmartFolderSuggestion | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Called with the created folder so the shell can select it. */
  onCreated: (folder: SmartFolder) => void
}

export function CreateSmartFolderDialog({
  suggestion,
  open,
  onOpenChange,
  onCreated,
}: CreateSmartFolderDialogProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [nameEn, setNameEn] = useState('')
  const [nameAr, setNameAr] = useState('')

  // Prefill both names from the cluster's guess each time the dialog opens.
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot form hydration on open */
  useEffect(() => {
    if (open && suggestion) {
      setNameEn(suggestion.name_suggestion)
      setNameAr(suggestion.name_suggestion)
    }
  }, [open, suggestion])
  /* eslint-enable react-hooks/set-state-in-effect */

  const createMut = useMutation({
    mutationFn: () => {
      if (!suggestion) throw new Error('no suggestion')
      return api.createSmartFolder({
        name_en: nameEn.trim(),
        name_ar: nameAr.trim(),
        rule_kind: 'subject',
        rule_value: suggestion.cluster_key,
      })
    },
    onSuccess: (folder) => {
      void qc.invalidateQueries({ queryKey: ['ledger-smart-folders'] })
      void qc.invalidateQueries({ queryKey: ['ledger-smart-suggestions'] })
      onOpenChange(false)
      onCreated(folder)
      toast(t('ledger.smart.created'))
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  if (!suggestion) return null

  const canCreate = nameEn.trim().length > 0 && nameAr.trim().length > 0
  const samples = suggestion.sample_subjects

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('ledger.smart.createTitle')}</DialogTitle>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (canCreate) createMut.mutate()
          }}
        >
          <p className="text-xs text-muted-foreground" dir="auto">
            {t('ledger.smart.createBody', {
              count: suggestion.count,
              cluster: suggestion.name_suggestion,
            })}
          </p>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="smart-create-en">{t('ledger.smart.nameEn')}</Label>
            <Input
              id="smart-create-en"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              dir="auto"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="smart-create-ar">{t('ledger.smart.nameAr')}</Label>
            <Input
              id="smart-create-ar"
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              dir="rtl"
              className="text-end"
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-[0.7em] font-semibold uppercase tracking-[0.04em] rtl:tracking-normal text-muted-foreground">
              {t('ledger.smart.willMatch', { count: suggestion.count })}
            </span>
            <ul className="max-h-44 overflow-y-auto rounded-lg border border-hairline bg-surface-tinted/40 p-1 text-xs">
              {samples.map((subject, i) => (
                <li
                  key={i}
                  className="truncate rounded px-2 py-1.5 text-foreground"
                  dir="auto"
                  title={subject}
                >
                  {subject || t('ledger.smart.noSubject')}
                </li>
              ))}
            </ul>
          </div>

          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!canCreate || createMut.isPending}>
              {t('ledger.smart.createConfirm')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  )
}
