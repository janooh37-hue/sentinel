/**
 * ChangeGradeDialog — relabel a record's grade. Callers show the
 * trigger only when `book.can_change_grade`; the backend re-checks.
 */
import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { toast } from '@/lib/toast'

import { api, apiErrorMessage, type BookRead, type Grade } from '@/lib/api'
import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { GradeSelect } from './GradeSelect'

interface Props {
  book: BookRead
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ChangeGradeDialog({ book, open, onOpenChange }: Props): React.JSX.Element {
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      {open && <Body book={book} close={() => onOpenChange(false)} />}
    </DialogRoot>
  )
}

function Body({ book, close }: { book: BookRead; close: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [level, setLevel] = useState<Grade>(book.grade)
  const unchanged = level === book.grade

  const mutation = useMutation({
    mutationFn: () => api.setBookGrade(book.id, level),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      toast.success(t('books.grade.changed', { level: t(`books.grade.levels.${level}`) }), {
        reference: book.ref_number,
      })
      close()
    },
    onError: (err) => toast.error(apiErrorMessage(err)),
  })

  return (
    <DialogContent>
      <DialogHeader className="pe-12">
        <DialogTitle>{t('books.grade.changeTitle')}</DialogTitle>
        <DialogDescription>
          <bdi dir="ltr" className="font-mono">{book.ref_number}</bdi>
        </DialogDescription>
      </DialogHeader>
      <div className="px-4 py-4">
        <GradeSelect value={level} onChange={setLevel} disabled={mutation.isPending} />
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
          {t('books.grade.save')}
        </button>
      </footer>
    </DialogContent>
  )
}
