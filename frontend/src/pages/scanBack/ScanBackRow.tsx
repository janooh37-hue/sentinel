/** One stranded record: ref, subject, age, and a drop target that files it. */
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Upload } from 'lucide-react'

import type { BookRead } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ScanBackThumb } from './ScanBackThumb'
import { ageDays } from './useScanBack'

export function ScanBackRow({
  book, onFile, busy,
}: {
  book: BookRead
  onFile: (bookId: number, ref: string, f: File) => Promise<void>
  busy: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const days = ageDays(book.created_at)
  const ref = book.ref_number ?? `#${book.id}`

  const take = (f: File | undefined): void => {
    if (f && !busy) void onFile(book.id, ref, f)
  }

  return (
    <article
      className={cn(
        'mb-2 flex gap-4 rounded-xl border border-hairline bg-surface p-4',
        days >= 30 && 'border-s-[3px] border-s-accent',
      )}
    >
      <ScanBackThumb book={book} className="w-32" />
      {/* The text column stretches to the paper's height and the drop target
          sits at its foot, so the row reads as one card instead of a label
          and a target at opposite ends of a wide screen. */}
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded-md bg-surface-tinted px-1.5 py-1 font-mono text-[0.72em] font-semibold">
            {ref}
          </span>
          <span className="text-[0.74em] text-muted-foreground">
            {t('scanBack.age', { count: days })}
          </span>
        </div>
        <p dir="auto" className="truncate text-[0.86em] font-semibold text-foreground">
          {book.subject}
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files[0]) }}
          className={cn(
            'mt-auto flex w-full max-w-sm items-center justify-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface-raised px-3 py-2.5 text-[0.74em] text-muted-foreground transition-colors',
            'hover:border-info hover:bg-info-soft hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40',
            over && 'border-info bg-info-soft text-info',
          )}
        >
          <Upload className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          {t('scanBack.drop')}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp"
        className="hidden"
        onChange={(e) => { take(e.target.files?.[0]); e.target.value = '' }}
      />
    </article>
  )
}
