/**
 * RenameSmartFolderDialog — edit a smart folder's EN + AR name (Phase 3, E3).
 *
 * A small modal opened from the rail row's ⋯ menu. Both names are editable
 * (the AR field is `dir="rtl"`); Save PATCHes and invalidates the folders query.
 */

import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import { api, ApiError, type SmartFolder } from '@/lib/api'
import {
  DialogRoot,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'

interface RenameSmartFolderDialogProps {
  folder: SmartFolder
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function RenameSmartFolderDialog({
  folder,
  open,
  onOpenChange,
}: RenameSmartFolderDialogProps): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [nameEn, setNameEn] = useState(folder.name_en)
  const [nameAr, setNameAr] = useState(folder.name_ar)

  // Re-seed from the folder each time the dialog opens (folder may change).
  /* eslint-disable react-hooks/set-state-in-effect -- one-shot form hydration on open */
  useEffect(() => {
    if (open) {
      setNameEn(folder.name_en)
      setNameAr(folder.name_ar)
    }
  }, [open, folder.name_en, folder.name_ar])
  /* eslint-enable react-hooks/set-state-in-effect */

  const renameMut = useMutation({
    mutationFn: () =>
      api.updateSmartFolder(folder.id, {
        name_en: nameEn.trim(),
        name_ar: nameAr.trim(),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['ledger-smart-folders'] })
      onOpenChange(false)
      toast(t('ledger.smart.renamed'))
    },
    onError: (err) =>
      toast.error(err instanceof ApiError ? err.message : String(err)),
  })

  const canSave = nameEn.trim().length > 0 && nameAr.trim().length > 0

  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t('ledger.smart.renameTitle')}</DialogTitle>
        </DialogHeader>
        <form
          className="flex flex-col gap-3 px-4 py-3.5"
          onSubmit={(e) => {
            e.preventDefault()
            if (canSave) renameMut.mutate()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="smart-rename-en">{t('ledger.smart.nameEn')}</Label>
            <Input
              id="smart-rename-en"
              value={nameEn}
              onChange={(e) => setNameEn(e.target.value)}
              dir="auto"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="smart-rename-ar">{t('ledger.smart.nameAr')}</Label>
            <Input
              id="smart-rename-ar"
              value={nameAr}
              onChange={(e) => setNameAr(e.target.value)}
              dir="rtl"
              className="text-end"
            />
          </div>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!canSave || renameMut.isPending}>
              {t('common.save')}
            </Button>
          </div>
        </form>
      </DialogContent>
    </DialogRoot>
  )
}
