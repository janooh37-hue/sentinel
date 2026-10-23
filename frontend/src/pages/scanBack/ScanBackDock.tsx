/**
 * The all-day ambient reminder: a pill anchored bottom-end that expands into
 * the six oldest stranded records, each a drop target.
 *
 * The collapsed pill is a twin of a toast pill (ScanBackDock.css): it shares
 * the toasts' corner, so the corner reads as one family. Positioned with
 * `inset-inline-end` so it flips in Arabic, and lifted clear of BottomTabBar
 * (mobile) and of the live toast stack — see the `--dock-band` comment below.
 */
import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Printer, Upload, X } from 'lucide-react'

import type { BookRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { cn } from '@/lib/utils'
import { useIsMobile } from '@/lib/useIsMobile'
import { ScanBackThumb } from './ScanBackThumb'
import { ScanBackUploadZone } from './ScanBackRow'
import { ageDays, dockDismissKeyFor, today, useFileSignedCopy, useScanBack, useScanBackUpload } from './useScanBack'

import './ScanBackDock.css'

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
      <ScanBackThumb book={book} className="w-28" />
      <div className="min-w-0 flex-1">
      <div className="mb-1.5 flex items-center gap-2">
        <span className="shrink-0 rounded bg-surface-tinted px-1.5 py-0.5 font-mono text-[0.68em] font-semibold">
          {ref}
        </span>
        <span dir="auto" className="min-w-0 flex-1 truncate text-[0.74em]">{book.subject}</span>
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
  const { user } = useAuth()
  const { books, count } = useScanBack()
  const { file, busy } = useFileSignedCopy()
  const isMobile = useIsMobile()
  const { upload, busy: autoBusy } = useScanBackUpload()
  const [open, setOpen] = useState(() => localStorage.getItem(OPEN_KEY) === '1')
  const dismissKey = dockDismissKeyFor(user?.id ?? 'anon')
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(dismissKey) === today())

  // Nothing to nag about, the user is already on the page that IS the dock, or
  // they put it away for today — an ambient reminder that can't be silenced is
  // just an obstacle, and it floats over the record pane's own buttons.
  // On a phone the record page owns the bottom edge (its action dock) — this
  // pill would sit on top of it, so it steps aside there.
  if (
    count === 0 ||
    pathname === '/scan-back' ||
    dismissed ||
    (isMobile && /^\/books\/\d+\/?$/.test(pathname))
  ) {
    return null
  }

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
        // Never `right-4`. Precedent: IdentityDocCard.tsx:97.
        'fixed z-30 flex flex-col items-end gap-2 end-4',
        // The toast viewport (AppToaster) shares this corner in both languages and
        // paints over anything under it, so the dock clears it spatially. AppToaster
        // publishes how far up the live stack reaches as `--toast-stack` (0px when
        // empty); the dock rests where a toast pill sits (1.5rem, above the
        // BottomTabBar on mobile) and rides 0.5rem above any stack, following it
        // as bodies open and toasts close. It is clamped to half the viewport so a
        // tall stack cannot push the header off screen, and the open panel below
        // is capped to the room left above it (the rows scroll).
        '[--dock-rest:calc(5.5rem+var(--safe-bottom))] md:[--dock-rest:1.5rem]',
        '[--dock-band:min(50dvh,max(var(--dock-rest),var(--toast-stack,0px)_+_0.5rem))]',
        'bottom-[var(--dock-band)] motion-safe:transition-[bottom] motion-safe:duration-200 motion-safe:ease-out',
        'rtl:items-start',
      )}
    >
      {open && (
        /* 26rem, not 20rem: each row now carries a page-1 thumbnail, and the
           dock has to be wide enough for the thumb to still be a preview
           (~7rem here) and leave the drop target room beside it. */
        <div className="flex w-[min(26rem,calc(100vw-2rem))] max-h-[max(6rem,calc(100dvh-var(--dock-band)-4.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-surface shadow-lg">
          <div className="flex shrink-0 items-center gap-2 border-b border-hairline py-2 ps-2 pe-3">
            {/* The pill's badge, in the page's own warning tone. */}
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-warning-soft text-warning" aria-hidden>
              <Printer className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            <span className="flex-1 text-[0.76em] font-semibold">{t('scanBack.dock.header')}</span>
            <button
              type="button"
              onClick={() => navigate('/scan-back')}
              className="rounded px-1.5 py-0.5 text-[0.72em] font-semibold text-info hover:bg-info-soft"
            >
              {t('scanBack.viewAll', { count })}
            </button>
          </div>
          {/* Everything under the header scrolls when the capped panel is short. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <ScanBackUploadZone onFile={upload} busy={autoBusy} compact />
            {/* The barcode target adds ~7rem above the rows; 15rem keeps the
                expanded dock inside its previous ~22rem mobile height budget. */}
            <div className="max-h-[15rem] overflow-auto">
              {books.slice(0, MAX_ROWS).map((b) => (
                <DockRow key={b.id} book={b} onFile={file} busy={busy} />
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Two buttons in one pill, not a button inside a button: the toggle and
          the dismiss are separate actions and nested buttons are invalid. */}
      <div className="scanback-pill flex h-10 items-center rounded-full pe-1 shadow-lg">
        <button
          type="button"
          onClick={toggle}
          aria-expanded={open}
          className="flex h-full items-center gap-2 rounded-full ps-2 pe-2.5 text-[0.825rem] font-medium leading-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="scanback-badge flex h-6 w-6 shrink-0 items-center justify-center rounded-full" aria-hidden>
            <Printer className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          {t('scanBack.dock.pill', { count })}
          {/* The visible pill text is already a meaningful accessible name (and
              is what callers query by); expand/collapse is state, not identity,
              so it rides along as extra text for screen readers rather than
              overriding the name via aria-label. */}
          <span className="sr-only">{open ? t('scanBack.dock.collapse') : t('scanBack.dock.expand')}</span>
          {open ? <ChevronDown className="scanback-muted h-3.5 w-3.5" aria-hidden />
                : <ChevronUp className="scanback-muted h-3.5 w-3.5" aria-hidden />}
        </button>
        <button
          type="button"
          onClick={() => { localStorage.setItem(dismissKey, today()); setDismissed(true) }}
          aria-label={t('scanBack.gate.close')}
          className="scanback-muted rounded-full p-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" strokeWidth={2.2} aria-hidden />
        </button>
      </div>
    </div>
  )
}
