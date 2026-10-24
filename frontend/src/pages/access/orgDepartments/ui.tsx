/**
 * Small shared surfaces for Organization & departments: the bottom-sheet
 * dialog shell, query-failure line, back link, page heading and the
 * "access limits are on" notice.
 */

import { ChevronLeft, Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { DialogContent, DialogDescription, DialogHeader, DialogRoot, DialogTitle } from '@/components/ui/dialog'
import { departmentErrorMessage } from '@/lib/departments'
import { cn } from '@/lib/utils'

/** Bottom sheet on phones, centred dialog from md up (same as DistributeDialog). */
const SHEET = 'bottom-sheet !inset-x-0 !bottom-0 !top-auto !max-h-[92dvh] !translate-x-0 !translate-y-0 rounded-b-none md:!inset-x-auto md:!start-1/2 md:!bottom-auto md:!top-1/2 md:!max-h-[85dvh] md:!-translate-x-1/2 md:!-translate-y-1/2 md:rounded-b-2xl rtl:md:!translate-x-1/2'

export const INPUT = 'mt-1.5 w-full min-h-11 rounded-lg border border-border bg-surface px-3.5 py-2.5 text-[0.9em] text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20'
export const LINK_BUTTON = 'inline-flex min-h-11 items-center gap-1.5 rounded-md px-2 text-[0.84em] font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50'
export const PANEL = 'rounded-2xl border border-hairline bg-surface'
export const LABEL = 'text-[0.74em] font-semibold uppercase tracking-[0.08em] text-muted-foreground rtl:tracking-normal'

export function Sheet({ title, description, onClose, wide = false, children }: {
  title: string
  description?: React.ReactNode
  onClose: () => void
  wide?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <DialogRoot open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent className={cn(SHEET, wide && 'md:max-w-[min(1100px,94vw)]')}>
        <DialogHeader className="pe-12">
          <DialogTitle dir="auto">{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
      </DialogContent>
    </DialogRoot>
  )
}

export function SheetFooter({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <footer className="flex flex-wrap justify-end gap-2 border-t border-hairline px-4 py-3">{children}</footer>
}

export function QueryFailure({ error, retry, className }: { error: unknown; retry: () => void; className?: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <p role="alert" className={cn('text-[0.86em] text-accent', className)}>
      {departmentErrorMessage(error, t)}{' '}
      <button type="button" className="underline" onClick={retry}>{t('departments.retry')}</button>
    </p>
  )
}

export function BackLink({ onClick, label }: { onClick: () => void; label?: string }): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <button type="button" onClick={onClick} className={cn(LINK_BUTTON, '-ms-2 text-muted-foreground hover:text-foreground')}>
      <ChevronLeft className="h-4 w-4 rtl:rotate-180" aria-hidden />
      {label ?? t('orgDepartments.nav.departments')}
    </button>
  )
}

export function ViewHeading({ title, children, actions }: {
  title: React.ReactNode
  children?: React.ReactNode
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-[72ch]">
        <h2 className="break-words text-[1.35em] font-semibold tracking-tight text-foreground">{title}</h2>
        {children ? <div className="mt-1.5 text-[0.88em] leading-relaxed text-muted-foreground">{children}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}

/** While limits are on, edits are live: say so where they are made. */
export function LiveEditsNotice({ show }: { show: boolean }): React.JSX.Element | null {
  const { t } = useTranslation()
  if (!show) return null
  return (
    <p className="flex items-start gap-2 rounded-xl bg-info-soft px-3.5 py-2.5 text-[0.84em] text-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden />
      {t('orgDepartments.limits.editsApply')}
    </p>
  )
}
