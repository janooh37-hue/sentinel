/**
 * RecordRail — the progress timeline: the desktop right-hand aside and the
 * phone `<details>` disclosure, both rendering the same RecordTimelineContent
 * so the two surfaces can never drift apart.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, AlertTriangle, Clock, PanelRightClose, PanelRightOpen, X } from 'lucide-react'
import { TONE, type StationTone } from './recordTones'
import { reviewerSteps } from '@/components/books/reviewers'
import { ReviewerList } from '@/components/books/ReviewerList'
import type { BookApprovalStepRead, NotifyMessageRead } from '@/lib/api'
import { bidi } from '@/lib/bidi'
import { smsDeliveryTone } from '@/lib/smsDelivery'
import { cn } from '@/lib/utils'
import type { BookRead } from '@/lib/api'
import { Hint } from '@/components/ui/hint'
import type { RecordView } from './recordActions'
import { RAIL_BREAKPOINT, useRecordChrome } from './RecordChrome'

export type StationState = 'done' | 'live' | 'future'
export interface Station {
  key: string
  icon: React.ReactNode
  label: string
  meta: string
  note?: string | null
  state: StationState
  tone: StationTone
}

/** The station that best summarizes "where this record is right now" — for
 *  `pending`/`awaiting_scan` the array's last entry is a `future` placeholder
 *  (e.g. "Signed" ahead of the still-live "Awaiting signature"), so summarizing
 *  from the raw last entry would show the wrong step. Prefer the live station;
 *  fall back to the latest completed one for a terminal state with no live
 *  station (`returned`/`rejected`) — never blindly the last array entry. */
function currentSummaryStation(stations: Station[]): Station | undefined {
  return (
    stations.find((s) => s.state === 'live') ??
    [...stations].reverse().find((s) => s.state === 'done')
  )
}

/** Shared render of the progress timeline + reviewer list + SMS notifications —
 *  used by both the desktop sidebar and the mobile expandable status section so
 *  the two surfaces can never drift apart. */
function RecordTimelineContent({
  stations,
  currentSteps,
  currentVersionNo,
  liveVersionNo,
  sms,
}: {
  stations: Station[]
  currentSteps: BookApprovalStepRead[]
  currentVersionNo?: number
  liveVersionNo?: number
  sms?: NotifyMessageRead[] | null
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <>
      <h2 className="mb-5 text-[0.66em] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {t('books.record.progress')}
      </h2>
      <ol>
        {stations.map((s, i) => {
          const last = i === stations.length - 1
          const tone = TONE[s.tone]
          return (
            <li
              key={s.key}
              aria-current={s.state === 'live' ? 'step' : undefined}
              className="flex gap-3"
              style={{ opacity: s.state === 'done' ? 0.5 : s.state === 'future' ? 0.42 : 1 }}
            >
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    'flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full border-[3px] border-surface',
                    s.state === 'live' && 'rec-live-node',
                  )}
                  style={
                    s.state === 'future'
                      ? { background: 'var(--surface)', color: 'var(--text-faint)', borderStyle: 'dashed', borderColor: 'var(--hairline)' }
                      : { background: tone.bg, color: tone.fg }
                  }
                  aria-hidden
                >
                  {s.icon}
                </span>
                {!last && (
                  <span
                    className={cn('my-1 w-0.5 flex-1', s.state === 'live' ? 'rec-live-rail' : '')}
                    style={s.state === 'live' ? undefined : { background: 'var(--hairline)', minHeight: 22 }}
                  />
                )}
              </div>
              <div className="pb-5">
                <div className="text-[0.82em] font-bold" style={{ color: s.state === 'live' ? tone.fg : undefined }}>
                  {s.label}
                </div>
                <div className="mt-0.5 text-[0.7em] text-muted-foreground">{s.meta}</div>
                {s.note && (
                  <div
                    className="mt-1.5 rounded-md px-2 py-1 text-[0.7em]"
                    style={{ background: tone.bg, color: tone.fg }}
                  >
                    “{s.note}”
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {/* Reviewer rows — advisory chain, below the approver timeline */}
      <ReviewerList
        reviewers={reviewerSteps(currentSteps)}
        versionNo={currentVersionNo}
        currentVersionNo={liveVersionNo}
      />

      {/* Notification block — SMS sent for this record */}
      {sms && sms.length > 0 && <NotificationBlock messages={sms} />}
    </>
  )
}

function NotificationBlock({ messages }: { messages: NotifyMessageRead[] }): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const fmt = useMemo(
    () => new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }),
    [i18n.language],
  )
  return (
    <div className="mt-6">
      <h2 className="mb-3 text-[0.66em] font-bold uppercase tracking-[0.12em] text-muted-foreground">
        {t('books.record.notification')}
      </h2>
      <div className="flex flex-col gap-2">
        {messages.map((m) => {
          const tone = smsDeliveryTone(m)
          const badge = {
            delivered: {
              cls: 'bg-success-soft text-success',
              icon: <Check className="h-3 w-3" />,
              label: t('employee.messages.delivered'),
            },
            failed: {
              cls: 'bg-destructive/10 text-destructive',
              icon: <AlertTriangle className="h-3 w-3" />,
              label: t('employee.messages.failed'),
            },
            pending: {
              cls: 'bg-warning/10 text-warning',
              icon: <Clock className="h-3 w-3" />,
              label: t('employee.messages.pending'),
            },
          }[tone]
          return (
            <div key={m.id} className="rounded-lg border border-hairline bg-surface p-2.5 text-[0.78em]">
              <div className="mb-1 flex flex-wrap items-center gap-1.5">
                <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-semibold ${badge.cls}`}>
                  {badge.icon}
                  {badge.label}
                </span>
                <span className="ms-auto font-mono text-muted-foreground">
                  {fmt.format(new Date(m.created_at))}
                </span>
              </div>
              {m.body && (
                <div className="whitespace-pre-wrap text-foreground" dir="auto">
                  {m.body}
                </div>
              )}
              {tone === 'failed' && m.error && (
                <div className="mt-1 text-destructive" dir="ltr">{m.error}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export interface RecordRailProps {
  book: BookRead | undefined
  view: RecordView
}

/** Mobile status disclosure — the desktop progress rail is `hidden md:block`
 *  (physically inert below `md`, never focusable there); this is its
 *  complement, `md:hidden`, so exactly one of the two surfaces is ever in the
 *  accessibility tree. Native `<details>` gives free expand/collapse semantics
 *  (no extra state) with a one-line summary — the live station, or the latest
 *  completed one when there is no live station (see `currentSummaryStation`) —
 *  and the full timeline plus reviewer/notification content on expand,
 *  reusing the exact same `RecordTimelineContent` the desktop rail renders. */
export function RecordPhoneProgress({ book, view }: RecordRailProps): React.JSX.Element {
  const { stations, currentSteps, current, liveVersion } = view
  const { focus } = useRecordChrome()
  return (
    <>
    {book && !focus && (
      <div className="border-b border-hairline bg-surface px-4 py-3 md:hidden" data-print-hide>
        <details className="group max-h-[40dvh] overflow-auto">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
            {(() => {
              const summary = currentSummaryStation(stations)
              const tone = summary ? TONE[summary.tone] : undefined
              return (
                <span className="flex min-w-0 items-center gap-2 text-[0.82em] font-semibold text-foreground">
                  {tone && (
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: tone.fg }}
                      aria-hidden
                    />
                  )}
                  <span className="min-w-0 truncate">
                    {summary?.label}
                    {summary?.meta ? ` — ${bidi(summary.meta)}` : ''}
                  </span>
                </span>
              )
            })()}
            <ChevronDown
              className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180 motion-reduce:transition-none"
              aria-hidden
            />
          </summary>
          <div className="mt-3">
            <RecordTimelineContent
              stations={stations}
              currentSteps={currentSteps}
              currentVersionNo={current?.version_no}
              liveVersionNo={liveVersion?.version_no}
              sms={book.sms}
            />
          </div>
        </details>
      </div>
    )}
    </>
  )
}

/** True from `minWidth` px up; follows window resizes (the chrome's rail switch). */
function useMinWidth(minWidth: number): boolean {
  const [wide, setWide] = useState(() => window.innerWidth >= minWidth)
  useEffect(() => {
    const onResize = (): void => setWide(window.innerWidth >= minWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [minWidth])
  return wide
}

/** Vertical progress timeline — physically pinned to the right in both
 *  languages (the page body is `direction:ltr`). From `xl` (1280) it is a
 *  15rem docked column with Hide; below that, or once hidden, a 52px dot strip
 *  whose toggle opens a 280px overlay from the physical right. Focus mode hides
 *  it entirely. Below `md` it is inert and unfocusable: RecordPhoneProgress is
 *  its sole complement there. */
export function RecordRail({ book, view }: RecordRailProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const { isAr, stations, currentSteps, current, liveVersion } = view
  const { rail, toggleRail, railDrawerOpen, closeRailDrawer, focus } = useRecordChrome()
  const docked = useMinWidth(RAIL_BREAKPOINT)
  const overlayRef = useRef<HTMLElement | null>(null)

  // Click outside the overlay (but not on its toggle) dismisses it; Esc is the page's resolver.
  const overlayOpen = railDrawerOpen && !docked
  useEffect(() => {
    if (!overlayOpen) return
    overlayRef.current?.querySelector<HTMLElement>('[data-rail-close]')?.focus()
    const onPointerDown = (e: PointerEvent): void => {
      const target = e.target as Node
      if (overlayRef.current?.contains(target)) return
      if ((target as Element).closest?.('[data-rail-toggle]')) return
      closeRailDrawer()
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [overlayOpen, closeRailDrawer])

  if (focus) return null
  const dir = isAr ? 'rtl' : 'ltr'
  const summary = currentSummaryStation(stations)
  const timeline = (
    <RecordTimelineContent
      stations={stations}
      currentSteps={currentSteps}
      currentVersionNo={current?.version_no}
      liveVersionNo={liveVersion?.version_no}
      sms={book?.sms}
    />
  )
  const heading = (
    <b className="text-[0.6875rem] font-bold uppercase tracking-[0.07em] text-faint">{t('books.record.progress')}</b>
  )

  if (docked && rail === 'open') {
    return (
      <aside
        dir={dir}
        data-record-rail="open"
        className="hidden w-[15rem] shrink-0 overflow-auto bg-surface px-[18px] py-4 transition-[width] motion-reduce:transition-none md:block"
      >
        <div className="mb-2.5 flex items-center justify-between gap-2">
          {heading}
          <Hint label={t('books.record.hideProgress')} side="bottom">
            <button
              type="button"
              data-rail-toggle
              aria-label={t('books.record.hideProgress')}
              aria-expanded="true"
              onClick={toggleRail}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              <PanelRightClose className="h-4 w-4" aria-hidden />
            </button>
          </Hint>
        </div>
        {timeline}
      </aside>
    )
  }

  return (
    <aside
      dir={dir}
      data-record-rail="strip"
      className="relative hidden w-[52px] shrink-0 bg-surface transition-[width] motion-reduce:transition-none md:block"
    >
      <Hint label={t('books.record.showProgress')} side="left">
        <button
          type="button"
          data-rail-toggle
          aria-label={t('books.record.showProgress')}
          aria-expanded={overlayOpen}
          onClick={toggleRail}
          className="flex h-full w-full flex-col items-center gap-2.5 py-2.5 transition-colors hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring motion-reduce:transition-none"
        >
          <PanelRightOpen className="h-4 w-4 text-muted-foreground" aria-hidden />
          <span className="text-[0.6875rem] font-bold uppercase tracking-[0.08em] text-faint [writing-mode:vertical-rl]">
            {t('books.record.progress')}
          </span>
          <span className="flex flex-col items-center gap-2" aria-hidden>
            {stations.map((s) => (
              <i
                key={s.key}
                className={cn(
                  'block h-2.5 w-2.5 rounded-full',
                  s.state === 'live' && 'ring-4 ring-primary-soft',
                  s.state === 'future' && 'opacity-40',
                )}
                style={{ background: TONE[s.tone].fg }}
              />
            ))}
          </span>
          {/* The dots carry state by colour: the words are here. */}
          <span className="sr-only">
            {summary?.label}
            {summary?.meta ? ` — ${bidi(summary.meta)}` : ''}
          </span>
        </button>
      </Hint>

      {overlayOpen && (
        <section
          ref={overlayRef}
          dir={dir}
          data-record-rail="overlay"
          aria-label={t('books.record.progress')}
          className="absolute inset-y-0 right-0 z-20 w-[280px] overflow-auto bg-surface px-[18px] py-4 shadow-[-12px_0_32px_rgba(20,20,10,0.16)] animate-in fade-in-0 slide-in-from-right-8 duration-200 motion-reduce:animate-none"
        >
          <div className="mb-2.5 flex items-center justify-between gap-2">
            {heading}
            <button
              type="button"
              data-rail-close
              aria-label={t('common.close')}
              onClick={closeRailDrawer}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-surface-tinted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
          {timeline}
        </section>
      )}
    </aside>
  )
}
