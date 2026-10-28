import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { toast } from '@/lib/toast'

import { api, ApiError, apiErrorMessage, type BookRead, type Grade } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { useCapabilities } from '@/lib/useCapabilities'
import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { ClassificationField } from '@/components/application/fields/ClassificationField'
import { GradeSelect } from './GradeSelect'
import { deriveGrades } from './derive-grade'

interface Props {
  book: BookRead
  kind: 'reply' | 'based_on'
  open: boolean
  onOpenChange: (open: boolean) => void
}

const ERROR_KEYS: Record<string, string | undefined> = {
  GRADE_BELOW_FLOOR: 'books.thread.errors.levelFloor',
  CLASSIFICATION_REQUIRED: 'books.thread.errors.classificationRequired',
  SECRET_CLEARANCE_REQUIRED: 'books.thread.errors.secretClearance',
  FORBIDDEN: 'books.thread.errors.forbidden',
}

export function DeriveRecordDialog({ book, kind, open, onOpenChange }: Props): React.JSX.Element | null {
  const { user } = useAuth()
  const { has } = useCapabilities()
  if (!user || user.role === 'inmate_reporter' || book.access_scope !== 'full' || !has('books.create') || !has('books.view')) return null
  return (
    <DialogRoot open={open} onOpenChange={onOpenChange}>
      {open && <Body key={`${book.id}-${kind}`} book={book} kind={kind} close={() => onOpenChange(false)} />}
    </DialogRoot>
  )
}

function Body({ book, kind, close }: Pick<Props, 'book' | 'kind'> & { close: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [level, setLevel] = useState<Grade>(book.grade)
  const [attached, setAttached] = useState(true)
  const [classification, setClassification] = useState<string | null>(book.classification_code ?? null)
  const allowedLevels = deriveGrades(book.grade, attached)
  const selectedLevel = allowedLevels.includes(level) ? level : 'secret'
  const title = t(kind === 'reply' ? 'books.thread.reply' : 'books.thread.createFrom')
  const mutation = useMutation({
    mutationFn: () => api.deriveBook(book.id, {
      kind,
      ...(kind === 'based_on' ? { grade: selectedLevel } : {}),
      attach_reference: attached,
      classification_code: classification,
    }),
    onMutate: () => toast.loading(t('books.word.opening')),
    onSuccess: (res, _vars, toastId) => {
      void qc.invalidateQueries({ queryKey: ['books'] })
      toast.dismiss(toastId)
      close()
      navigate(`/books/${res.book_id}/word`)
    },
    onError: (err, _vars, toastId) => {
      const key = err instanceof ApiError ? ERROR_KEYS[err.code] : undefined
      toast.error(key ? t(key) : apiErrorMessage(err), { id: toastId, reference: book.ref_number })
    },
  })
  return (
    <DialogContent data-print-hide className="bottom-sheet !inset-x-0 !bottom-0 !top-auto !max-h-[92dvh] !translate-x-0 !translate-y-0 rounded-b-none md:!inset-x-auto md:!start-1/2 md:!bottom-auto md:!top-1/2 md:!max-h-[80dvh] md:!-translate-x-1/2 md:!-translate-y-1/2 md:rounded-b-2xl rtl:md:!translate-x-1/2">
      <DialogHeader className="pe-12">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription><bdi dir="ltr" className="font-mono">{book.ref_number}</bdi></DialogDescription>
      </DialogHeader>
      <div className="space-y-4 overflow-y-auto px-4 py-4">
        {kind === 'based_on' && <GradeSelect value={selectedLevel} onChange={setLevel} allowedLevels={allowedLevels} disabled={mutation.isPending} />}
        <label className="flex min-h-10 items-center gap-2 text-[0.84em]">
          <input type="checkbox" checked={attached} disabled={mutation.isPending} className="h-4 w-4 accent-primary" onChange={(e) => {
            const checked = e.target.checked
            setAttached(checked)
            if (checked && book.grade !== 'unclassified' && level === 'unclassified') setLevel('secret')
          }} />
          {t('books.thread.attachOriginal')}
        </label>
        {!book.classification_code && (
          <fieldset disabled={mutation.isPending}>
            <ClassificationField name="derive-classification" label_en={t('books.thread.classification')} label_ar={t('books.thread.classification')} required value={classification} onChange={setClassification} />
          </fieldset>
        )}
      </div>
      <footer className="flex flex-wrap justify-end gap-2.5 border-t border-hairline px-4 py-3">
        <button type="button" onClick={close} className="min-h-10 rounded-lg border border-hairline px-4 py-2 text-[0.84em] text-muted-foreground hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">{t('common.cancel')}</button>
        <button type="button" disabled={mutation.isPending || !classification} aria-busy={mutation.isPending || undefined} onClick={() => mutation.mutate()} className="min-h-10 rounded-lg bg-primary px-4 py-2 text-[0.84em] font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40">{title}</button>
      </footer>
    </DialogContent>
  )
}
