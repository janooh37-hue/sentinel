/**
 * The all-day ambient reminder: a pill anchored bottom-end that expands into
 * the six oldest stranded records, each a drop target.
 *
 * Positioned with `inset-inline-end` so it flips in Arabic, and lifted clear
 * of both BottomTabBar (mobile, `fixed inset-x-0 bottom-0 z-40`) and sonner's
 * app-wide bottom-right Toaster (same corner in LTR, z-index far above ours)
 * — see the `bottom-[...]` comment below for the clearance arithmetic.
 */
import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Printer, Upload } from 'lucide-react'

import type { BookRead } from '@/lib/api'
import { cn } from '@/lib/utils'
import { ScanBackThumb } from './ScanBackThumb'
import { ageDays, useFileSignedCopy, useScanBack } from './useScanBack'

const OPEN_KEY = 'scanback-dock-open'
const MAX_ROWS = 6

function DockRow({
  book, onFile, busy,
}: {
  book: BookRead
  onFile: (bookId: number, ref: string, f: File) => Promise<void>
  busy: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const ref = book.ref_number ?? `#${book.id}`
  return (
    <div className="flex gap-2 border-b border-hairline px-3 py-2 last:border-0">
      <ScanBackThumb book={book} className="w-16" />
      <div className="min-w-0 flex-1">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="shrink-0 rounded bg-surface-tinted px-1.5 py-0.5 font-mono text-[0.68em] font-semibold">
          {ref}
        </span>
        <span className="min-w-0 flex-1 truncate text-[0.74em]">{book.subject}</span>
        <span className="shrink-0 font-mono text-[0.66em] font-bold text-muted-foreground">
          {t('scanBack.age', { count: ageDays(book.created_at) })}
        </span>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const f = e.dataTransfer.files[0]
          if (f && !busy) void onFile(book.id, ref, f)
        }}
        className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border-strong bg-surface-raised px-2.5 py-1.5 text-[0.71em] text-muted-foreground transition-colors hover:border-info hover:bg-info-soft hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
      >
        <Upload className="h-3 w-3" strokeWidth={2} aria-hidden />
        {t('scanBack.drop')}
      </button>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.png,.jpg,.jpeg,.tif,.tiff,.webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f && !busy) void onFile(book.id, ref, f)
          e.target.value = ''
        }}
      />
      </div>
    </div>
  )
}

export function ScanBackDock(): React.JSX.Element | null {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { books, count } = useScanBack()
  const { file, busy } = useFileSignedCopy()
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1')

  // Nothing to nag about, or the user is already on the page that IS the dock.
  if (count === 0 || pathname === '/scan-back') return null

  // Compute-write-set, not a side effect inside the updater: React 19 dev
  // StrictMode double-invokes state updaters to surface impurity, and a
  // localStorage write inside `setOpen(v => ...)` would fire twice.
  const toggle = (): void => {
    const next = !open
    localStorage.setItem(OPEN_KEY, next ? '1' : '0')
    setOpen(next)
  }

  return (
    <div
      data-print-hide
      className={cn(
        // `end-4` is the logical utility (inset-inline-end) — it flips in RTL.
        // Never `right-4`. Precedent: BookDetailDrawer.tsx:340, IdentityDocCard.tsx:97.
        'fixed z-30 flex flex-col items-end gap-2 end-4',
        // sonner's Toaster (App.tsx, position="bottom-right") sits at the same
        // corner in LTR and paints over anything under it (z-index 999999999 —
        // we clear it spatially, not by fighting z-index). Its default 24px
        // bottom offset + a single toast's ~64px height is a ~88px (5.5rem)
        // band; 5.5rem also exceeds the 3.5rem BottomTabBar clearance
        // App.tsx's <main> already reserves on mobile, so one value covers
        // both viewports. A stack of several toasts can still reach higher —
        // accepted residual, not solved here.
        'bottom-[calc(5.5rem+env(safe-area-inset-bottom))] md:bottom-[5.5rem]',
        'rtl:items-start',
      )}
    >
      {open && (
        /* 26rem, not 20rem: each row now carries a page-1 thumbnail, and a
           thumb narrower than ~4rem shows "a paper exists" rather than which
           paper — which is the whole point of the preview. */
        <div className="w-[min(26rem,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-surface shadow-lg">
          <div className="flex items-center gap-2 border-b border-hairline px-3 py-2">
            <Printer className="h-3.5 w-3.5 text-warning" strokeWidth={2} aria-hidden />
            <span className="flex-1 text-[0.76em] font-semibold">{t('scanBack.dock.header')}</span>
            <button
              type="button"
              onClick={() => navigate('/scan-back')}
              className="rounded px-1.5 py-0.5 text-[0.72em] font-semibold text-info hover:bg-info-soft"
            >
              {t('scanBack.viewAll', { count })}
            </button>
          </div>
          <div className="max-h-[22rem] overflow-auto">
            {books.slice(0, MAX_ROWS).map((b) => (
              <DockRow key={b.id} book={b} onFile={file} busy={busy} />
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="flex items-center gap-2 rounded-full bg-primary px-4 py-2.5 text-[0.78em] font-semibold text-primary-foreground shadow-lg transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-foreground" aria-hidden />
        {t('scanBack.dock.pill', { count })}
        {/* The visible pill text is already a meaningful accessible name (and
            is what callers query by); expand/collapse is state, not identity,
            so it rides along as extra text for screen readers rather than
            overriding the name via aria-label. */}
        <span className="sr-only">{open ? t('scanBack.dock.collapse') : t('scanBack.dock.expand')}</span>
        {open ? <ChevronDown className="h-3.5 w-3.5" aria-hidden />
              : <ChevronUp className="h-3.5 w-3.5" aria-hidden />}
      </button>
    </div>
  )
}
