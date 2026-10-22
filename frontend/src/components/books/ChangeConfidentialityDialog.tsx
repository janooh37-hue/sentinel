/**
 * ChangeConfidentialityDialog — relabel a record's level. Callers show the
 * trigger only when `book.can_change_confidentiality`; the backend re-checks.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import { api, apiErrorMessage, type BookRead, type Confidentiality } from '@/lib/api'
import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { ConfidentialitySelect } from './ConfidentialitySelect'

interface Props {
  book: BookRead
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChangeConfidentialityDialog({ book, open, onOpenChange }: Props): React.JSX.Element {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      {open && <Body book={book} close={() => onOpenChange(false)} />}
    </DialogRoot>
  )
}

function Body({ book, close }: { book: BookRead; close: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [level, setLevel] = useState<Confidentiality>(book.confidentiality)
  const unchanged = level === book.confidentiality

  const mutation = useMutation({
    mutationFn: () => api.setBookConfidentiality(book.id, level),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      toast.success(t('books.confidentiality.changed', { level: t(`books.confidentiality.levels.${level}`) }))
      close()
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  return (
    <DialogContent>
      <DialogHeader className="pe-12">
        <DialogTitle>{t('books.confidentiality.changeTitle')}</DialogTitle>
        <DialogDescription>
          <bdi dir="ltr" className="font-mono">{book.ref_number}</bdi>
        </DialogDescription>
      </DialogHeader>
      <div className="px-4 py-4">
        <ConfidentialitySelect value={level} onChange={setLevel} disabled={mutation.isPending} />
      </div>
      <footer className="flex flex-wrap items-center justify-end gap-2.5 border-t border-hairline px-4 py-3">
        <button
          type="button"
          onClick={close}
          className="min-h-10 rounded-lg border border-hairline px-4 py-2 text-[0.84em] font-medium text-muted-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('common.cancel')}
        </button>
        <button
          type="button"
          aria-disabled={unchanged || mutation.isPending ? true : undefined}
          aria-busy={mutation.isPending ? true : undefined}
          onClick={() => {
            if (unchanged || mutation.isPending) return
            mutation.mutate()
          }}
          className="min-h-10 rounded-lg bg-primary px-4 py-2 text-[0.84em] font-semibold text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-disabled:opacity-40"
        >
          {t('books.confidentiality.save')}
        </button>
      </footer>
    </DialogContent>
  )
}
