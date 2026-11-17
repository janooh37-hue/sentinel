/**
 * RequestShell — a Vehicle Services request, filled in on its own page.
 *
 * A request (accident report, maintenance job, fine, licence renewal, a new
 * vehicle, the site list) covers the whole window: a flat navy band names it,
 * the form takes the start of the page and what the request is written against
 * takes the end — the official letter it will produce, or the records the
 * vehicle already has, so the same fine is not entered twice. On a narrow
 * screen the side panel follows the form.
 *
 * It is still a modal dialog underneath (Radix): focus is trapped, Escape and
 * Cancel close it, and the caller keeps it URL-backed with `useUrlOverlay`, so
 * Back closes it too. Like `DialogShell`, Radix unmounts the content on close,
 * and a close request is refused while a save is in flight.
 */

import * as Dialog from '@radix-ui/react-dialog'
import { useRef } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { isArabic } from '@/lib/language'
import { cn } from '@/lib/utils'

import { SERVICE_WRAP } from './serviceStyles'

interface ShellProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  /** Everything below the band — normally a `<form>` holding `RequestBody`
   *  and `RequestFooter`. */
  children: React.ReactNode
  /** Blocks Escape and Cancel while saving. */
  busy?: boolean
  returnFocusRef?: React.RefObject<HTMLElement | null>
}

export function RequestShell({
  open,
  onOpenChange,
  title,
  description,
  children,
  busy = false,
  returnFocusRef,
}: ShellProps): React.JSX.Element {
  const { t, i18n } = useTranslation()
  const Back = isArabic(i18n.language) ? ChevronRight : ChevronLeft
  const openerRef = useRef<HTMLElement | null>(null)

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return
        onOpenChange(next)
      }}
    >
      <Dialog.Portal>
        <Dialog.Content
          className={cn(
            'fixed inset-0 z-50 flex flex-col bg-background focus-visible:outline-none',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-bottom-2 data-[state=open]:duration-200',
            'motion-reduce:animate-none',
          )}
          onOpenAutoFocus={() => {
            openerRef.current =
              document.activeElement instanceof HTMLElement ? document.activeElement : null
          }}
          onCloseAutoFocus={(event) => {
            // Radix only restores its own Trigger, which a controlled request
            // page does not have.
            const target = returnFocusRef?.current ?? openerRef.current
            if (target?.isConnected && target !== document.body) {
              event.preventDefault()
              target.focus()
            }
          }}
        >
          <header className="shrink-0 bg-primary pb-5 pt-4 text-primary-foreground">
            <div className={SERVICE_WRAP}>
              <Dialog.Close
                disabled={busy}
                className="mb-1 inline-flex items-center gap-1 rounded-sm text-[0.76rem] font-semibold text-primary-foreground/80 transition-colors hover:text-primary-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-foreground disabled:opacity-50 motion-reduce:transition-none"
              >
                <Back className="h-3.5 w-3.5" strokeWidth={1.9} aria-hidden />
                {t('common.cancel')}
              </Dialog.Close>
              <Dialog.Title className="text-[1.3rem] font-extrabold leading-tight tracking-tight md:text-[1.6rem] rtl:tracking-normal">
                {title}
              </Dialog.Title>
              <Dialog.Description className="mt-1 max-w-[65ch] text-[0.82rem] text-primary-foreground/80">
                {description}
              </Dialog.Description>
            </div>
          </header>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/**
 * The scrolling middle: the form at the start, `aside` at the end. Without an
 * aside the form keeps a readable measure instead of stretching.
 */
export function RequestBody({
  aside,
  asideLabel,
  children,
}: {
  aside?: React.ReactNode
  /** Names the side panel for assistive technology. */
  asideLabel?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div
        className={cn(
          SERVICE_WRAP,
          'grid items-start gap-8 pb-12 pt-6',
          aside
            ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]'
            : 'grid-cols-[minmax(0,46rem)]',
        )}
      >
        <div className="flex min-w-0 flex-col gap-8">{children}</div>
        {aside && (
          <aside aria-label={asideLabel} className="min-w-0 lg:sticky lg:top-6">
            {aside}
          </aside>
        )}
      </div>
    </div>
  )
}

/** One numbered part of a request form. `index` is shown only when the form
 *  has more than one titled part. */
export function RequestSection({
  index,
  title,
  note,
  children,
}: {
  index?: number
  title?: string
  note?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="flex min-w-0 flex-col gap-3.5">
      {title && (
        <h3 className="mb-1 flex flex-wrap items-baseline gap-2 border-b border-border pb-2 text-[1.1rem] font-bold text-primary-text">
          {index != null && (
            <span className="font-mono text-[0.8rem] font-medium text-faint">
              {String(index).padStart(2, '0')}
            </span>
          )}
          {title}
          {note && (
            <small className="basis-full text-[0.74rem] font-medium text-muted-foreground">
              {note}
            </small>
          )}
        </h3>
      )}
      {children}
    </section>
  )
}

/** The side panel's box: a navy-ruled note beside the form. */
export function RequestNote({
  title,
  children,
}: {
  title?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="border border-t-2 border-border border-t-primary bg-surface p-4 text-[0.82rem]">
      {title && (
        <h4 className="mb-2 flex flex-wrap items-center gap-2 text-[0.9rem] font-bold text-primary-text">
          {title}
        </h4>
      )}
      {children}
    </div>
  )
}

/** The label above the paper the request will produce. */
export function RequestPaperLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <p className="mb-2 text-[0.72rem] font-semibold text-muted-foreground">{children}</p>
}

/**
 * The pinned action row: Cancel, then the request's one submit button. The
 * caller renders the submit inside its own `<form>`.
 */
export function RequestFooter({
  busy = false,
  children,
}: {
  busy?: boolean
  /** The submit button. */
  children: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <footer className="shrink-0 border-t border-border bg-surface py-3">
      <div className={cn(SERVICE_WRAP, 'flex justify-end gap-2 [&>*]:flex-1 sm:[&>*]:flex-none')}>
        <Dialog.Close asChild>
          <Button type="button" variant="ghost" size="lg" disabled={busy}>
            {t('common.cancel')}
          </Button>
        </Dialog.Close>
        {children}
      </div>
    </footer>
  )
}
