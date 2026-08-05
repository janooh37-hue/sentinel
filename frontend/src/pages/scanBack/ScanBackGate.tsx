/**
 * The once-a-day interrupt. Shows the THREE oldest stranded records, never all
 * of them — a wall of rows reads as unfixable, three reads as a task.
 *
 * The localStorage key is per-user per-day: per-user so a shared browser
 * doesn't silence the next person, per-day so it comes back tomorrow. No table,
 * no migration.
 *
 * The key is stamped the moment the gate is actually SHOWN, not when the user
 * closes it — "shown today" alone must suppress it for the rest of the day,
 * however the count moves afterward and whichever button closes it (X, Not
 * now, View all are all just visual closes; none of them writes the key).
 * Otherwise a record crossing the 24h line at 2pm would drop a second
 * full-screen modal on someone mid-task who already saw one this morning.
 */
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Printer, X } from 'lucide-react'

import type { BookRead } from '@/lib/api'
import { useAuth } from '@/lib/authContext'
import { cn } from '@/lib/utils'
import { ScanBackThumb } from './ScanBackThumb'
import { ageDays, ageGroup, dismissKeyFor, useFileSignedCopy, useScanBack } from './useScanBack'

// Spec tiers (design doc §2): red >=30d, amber >=14d, grey below — same
// buckets `ageGroup` already defines for the page's tabs, and the same
// tokens ExpiringSoonWidget.tsx uses for its expired/critical/soon tiers.
const AGE_COLOR = { overMonth: 'text-destructive', weeks: 'text-warning', recent: 'text-muted-foreground' } as const

const SHOWN = 3

// Local calendar date, NOT `toISOString().slice(0, 10)` (that's the UTC date).
// This app runs at UTC+4: between 00:00 and 04:00 local, the UTC date is still
// yesterday, so a UTC-keyed dismissal would re-open a few hours into the same
// working day (the same local-vs-UTC trap as Book.created_at, bug f111177).
// `toLocaleDateString('en-CA')` gives YYYY-MM-DD in the browser's local time.
const today = (): string => new Date().toLocaleDateString('en-CA')

function GateRow({
  book, onFile, busy,
}: {
  book: BookRead
  onFile: (bookId: number, ref: string, f: File) => Promise<void>
  busy: boolean
}): React.JSX.Element {
  const { t } = useTranslation()
  const inputRef = useRef<HTMLInputElement>(null)
  const ref = book.ref_number ?? `#${book.id}`
  const days = ageDays(book.created_at)
  return (
    <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-surface-raised">
      {/* w-32 is a measured floor, not a taste call: at 80px this page renders
          as a grey smudge, at ~128px the doc title, date, G-number and name are
          all readable — which is the whole point of showing the paper. */}
      <ScanBackThumb book={book} className="w-32" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="shrink-0 rounded bg-surface-tinted px-1.5 py-1 font-mono text-[0.7em] font-semibold">
            {ref}
          </span>
          <span className={cn('shrink-0 font-mono text-[0.68em] font-bold', AGE_COLOR[ageGroup(days)])}>
            {t('scanBack.age', { count: days })}
          </span>
        </div>
        {/* dir="auto": subjects are often Latin ("Warning Form — <name>") inside
            an RTL page, and without it the ellipsis eats the START of the string
            — the part that says which form this is. */}
        <p dir="auto" className="mt-1 truncate text-[0.78em]">{book.subject}</p>
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-[0.72em] font-semibold text-primary-foreground hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
      >
        {t('scanBack.gate.upload')}
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
  )
}

export function ScanBackGate(): React.JSX.Element | null {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { user } = useAuth()
  const { books, count } = useScanBack()
  const { file, busy } = useFileSignedCopy()
  const key = dismissKeyFor(user?.id ?? 'anon')
  const [shownBefore] = useState(() => localStorage.getItem(key) === today())
  const [closed, setClosed] = useState(false)
  // Tracks "has this mount shown the gate at all", independent of `closed` —
  // `closed` alone only catches the three buttons. `<ScanBackGate />` sits
  // outside App.tsx's route-keyed <main>, so it never remounts on navigation;
  // within one mount, count can drop to 0 and rise again (an upload, then a
  // fresh record crossing the 24h line), or the pathname can swing off
  // /scan-back and back (browser Back/Forward past the modal). Either would
  // silently reopen the gate with the key already stamped if `wasShown`
  // didn't also convert that show->hide into a permanent close.
  const wasShown = useRef(false)

  // Nothing to nag about, already shown today (this mount or a previous
  // one, however it stopped showing), or the user is already on the page
  // that IS the fix — same suppression ScanBackDock.tsx applies.
  const show = !shownBefore && !closed && count > 0 && pathname !== '/scan-back'

  // Stamp "shown today" the instant it's actually shown — not on close — so
  // a remount later today (route change, tab reload) reads the key and
  // renders nothing, even if the user never explicitly dismissed it. And:
  // once shown in this mount, any show -> hide transition counts as closed,
  // same as clicking a button — see `wasShown` comment above.
  useEffect(() => {
    if (show) {
      wasShown.current = true
      localStorage.setItem(key, today())
    } else if (wasShown.current) {
      setClosed(true)
    }
  }, [show, key])

  if (!show) return null

  const dismiss = (): void => setClosed(true)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="scanback-gate-title"
      data-print-hide
      className="fixed inset-0 z-50 grid place-items-center bg-primary/40 p-6 backdrop-blur-sm"
    >
      {/* max-w-lg, not -md: the rows carry a page-1 thumbnail now — the paper
          is what the operator recognises, so it needs room to be legible. */}
      <div className="flex max-h-full w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
        <div className="relative shrink-0 border-b border-hairline px-5 py-5">
          <button
            type="button"
            onClick={dismiss}
            aria-label={t('scanBack.gate.close')}
            className="absolute top-3 end-3 rounded-lg bg-surface-tinted p-1.5 text-muted-foreground hover:bg-accent-soft hover:text-accent"
          >
            <X className="h-4 w-4" strokeWidth={2} aria-hidden />
          </button>
          <div className="mb-3 grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent">
            <Printer className="h-4 w-4" strokeWidth={1.9} aria-hidden />
          </div>
          <h2 id="scanback-gate-title" className="text-[1em] font-bold tracking-tight">
            {t('scanBack.gate.title', { count })}
          </h2>
          <p className="mt-1 text-[0.79em] text-muted-foreground">{t('scanBack.gate.blurb')}</p>
        </div>

        {/* Scrolls rather than growing past the viewport on a short screen —
            three thumbnailed rows are ~3x taller than the old text rows. */}
        <div className="min-h-0 overflow-auto px-3 py-2">
          {books.slice(0, SHOWN).map((b) => (
            <GateRow key={b.id} book={b} onFile={file} busy={busy} />
          ))}
        </div>

        <div className="flex shrink-0 items-center gap-3 border-t border-hairline bg-surface-raised px-4 py-3">
          <button
            type="button"
            onClick={() => { navigate('/scan-back'); setClosed(true) }}
            className="rounded-lg bg-accent px-4 py-2 text-[0.78em] font-semibold text-white hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('scanBack.viewAll', { count })}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-lg px-3 py-2 text-[0.78em] text-muted-foreground hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {t('scanBack.gate.later')}
          </button>
        </div>
      </div>
    </div>
  )
}
