/**
 * FilterSheet — mobile bottom-sheet that houses a screen's filter controls so
 * the list below can own the viewport. Slides up from the bottom edge on
 * mobile (`.bottom-sheet` motion in index.css, reduced-motion guarded); above
 * `md` it never renders (desktop keeps its inline filter bar).
 *
 * Built on Radix Dialog directly (mirrors SubmitForApprovalDialog) rather than
 * the start-edge `Sheet` wrapper, which only slides horizontally.
 */

import * as RadixDialog from '@radix-ui/react-dialog'
import { SlidersHorizontal, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

interface FilterSheetProps {
  /** Title shown in the sheet header. */
  title: string
  /** Trigger button label. */
  triggerLabel: string
  /** Number of active filters — renders a count badge on the trigger when > 0. */
  activeCount: number
  /** Filter controls. */
  children: React.ReactNode
  /** Optional footer (e.g. a Clear-filters button); pinned below the scroll area. */
  footer?: React.ReactNode
}

export function FilterSheet({
  title,
  triggerLabel,
  activeCount,
  children,
  footer,
}: FilterSheetProps): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <RadixDialog.Root>
      <RadixDialog.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-4 text-[0.82em] font-medium transition-colors',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
            activeCount > 0
              ? 'bg-primary-soft font-semibold text-primary'
              : 'bg-surface-tinted text-muted-foreground hover:text-foreground',
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" strokeWidth={2} />
          {triggerLabel}
          {activeCount > 0 && (
            <span className="inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.7em] font-semibold leading-none text-primary-foreground tabular-nums">
              {activeCount}
            </span>
          )}
        </button>
      </RadixDialog.Trigger>

      <RadixDialog.Portal>
        <RadixDialog.Overlay
          className={cn(
            'fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px]',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-300',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-200',
            'motion-reduce:animate-none',
          )}
        />
        <RadixDialog.Content
          className={cn(
            // `.bottom-sheet` carries the motion: slide-up from translateY(100%).
            'bottom-sheet fixed inset-x-0 bottom-0 z-50 flex max-h-[85dvh] flex-col rounded-t-2xl bg-surface shadow-2xl',
            'focus-visible:outline-none',
          )}
          aria-modal
        >
          {/* grabber */}
          <span
            aria-hidden
            className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-hairline"
          />

          {/* header */}
          <header className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
            <RadixDialog.Title className="text-[0.95em] font-semibold text-foreground">
              {title}
            </RadixDialog.Title>
            <RadixDialog.Close asChild>
              <button
                type="button"
                aria-label={t('common.close')}
                className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground"
              >
                <X className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </RadixDialog.Close>
          </header>

          {/* scrollable body */}
          <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

          {footer && (
            <footer className="border-t border-hairline px-5 py-3">{footer}</footer>
          )}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
