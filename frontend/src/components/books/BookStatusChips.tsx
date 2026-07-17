/**
 * BookStatusChips — inline classification / draft / editing / voided chips.
 * Used in both the record surfaces (RecordPane, BookRecordPage) and BooksPage rows.
 */
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import type { BookRead } from '@/lib/api'
import { api } from '@/lib/api'
import { bidi } from '@/lib/bidi'

interface Props {
  book: BookRead
  /** Skip the classification chip (e.g. list rows where space is tight) */
  noClassification?: boolean
}

export function BookStatusChips({ book, noClassification }: Props): React.JSX.Element | null {
  const { t } = useTranslation()

  const { data: classificationData } = useQuery({
    queryKey: ['books', 'classifications'],
    queryFn: () => api.listBookClassifications(),
    staleTime: Infinity,
    enabled: !noClassification && !!book.classification_code,
  })

  const chips: React.ReactNode[] = []

  // Classification chip — navy
  if (!noClassification && book.classification_code) {
    const item = classificationData?.items.find((c) => c.code === book.classification_code)
    const label = item
      ? `${book.classification_code} ${item.name_ar}`
      : book.classification_code
    chips.push(
      <span
        key="cls"
        className="inline-flex items-center rounded-full bg-primary px-2.5 py-0.5 text-[0.72em] font-semibold uppercase tracking-[0.06em] text-primary-foreground"
      >
        {label}
      </span>,
    )
  }

  // Draft chip — amber (draft, not voided)
  if (book.is_draft && !book.voided_at) {
    chips.push(
      <span
        key="draft"
        className="inline-flex items-center rounded-full bg-warning-soft px-2.5 py-0.5 text-[0.72em] font-semibold uppercase tracking-[0.06em] text-warning"
      >
        {t('books.word.draft')}
      </span>,
    )
  }

  // Editing chip — info (active session, shown alongside draft chip)
  if (book.edit_session?.state === 'active') {
    const holderName = book.edit_session.user_name
    chips.push(
      <span
        key="editing"
        className="inline-flex items-center rounded-full bg-info-soft px-2.5 py-0.5 text-[0.72em] font-semibold uppercase tracking-[0.06em] text-info"
      >
        {holderName
          ? t('books.word.editingBy', { name: bidi(holderName) })
          : t('books.word.editing')}
      </span>,
    )
  }

  // Voided chip — red
  if (book.voided_at) {
    chips.push(
      <span
        key="voided"
        className="inline-flex items-center rounded-full bg-destructive/10 px-2.5 py-0.5 text-[0.72em] font-semibold uppercase tracking-[0.06em] text-destructive"
      >
        {t('books.word.voided')}
      </span>,
    )
  }

  if (chips.length === 0) return null
  return <>{chips}</>
}
