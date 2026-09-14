/**
 * The shell every Vehicles dialog is built on, plus the form scaffolding they
 * share, so seven dialogs cannot drift into seven layouts.
 *
 * Surface: a bottom sheet on phones and a centred modal above `md` — the same
 * responsive treatment (and the same `.bottom-sheet` motion, reduced-motion
 * guarded in `index.css`) as the book preview. Radix unmounts the content when
 * the dialog closes, so any state a child form holds is discarded on close and
 * a reopened dialog starts from its defaults — no re-seeding effects.
 *
 * While a mutation is in flight the shell refuses close requests: the
 * add-vehicle flow is three requests, and dismissing it half-way would leave
 * the operator unsure what landed.
 */

import { useId } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, X } from 'lucide-react'

import {
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogRoot,
  DialogTitle,
} from '@/components/ui/dialog'
import { FileUploadZone } from '@/components/ui/file-upload-zone'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'
import { EmployeePicker } from '@/pages/application/EmployeePicker'

const SIZES = {
  md: 'md:max-w-lg',
  lg: 'md:max-w-2xl',
  xl: 'md:max-w-4xl',
} as const

interface ShellProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  /** Everything below the header — normally a `<form>`. */
  children: React.ReactNode
  size?: keyof typeof SIZES
  /** Blocks Escape / overlay / close-button dismissal while saving. */
  busy?: boolean
}

export function VehicleDialogShell({
  open,
  onOpenChange,
  title,
  description,
  children,
  size = 'lg',
  busy = false,
}: ShellProps): React.JSX.Element {
  return (
    <DialogRoot
      open={open}
      onOpenChange={(next) => {
        if (!next && busy) return
        onOpenChange(next)
      }}
    >
      <DialogContent
        className={cn(
          'bottom-sheet inset-x-0 bottom-0 top-auto max-h-[92dvh] max-w-none translate-x-0 translate-y-0 rounded-b-none rounded-t-2xl',
          'md:inset-auto md:left-1/2 md:top-1/2 md:max-h-[88dvh] md:-translate-x-1/2 md:-translate-y-1/2 md:rounded-2xl',
          SIZES[size],
        )}
      >
        {/* Grabber — the sheet affordance on touch; the modal has none. */}
        <span
          aria-hidden
          className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-hairline md:hidden"
        />
        <DialogHeader className="pe-10">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </DialogRoot>
  )
}

/** The scrolling middle of a dialog. */
export function VehicleDialogBody({
  children,
  className,
}: {
  children: React.ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cn('flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-4 py-4', className)}>
      {children}
    </div>
  )
}

/** The pinned action row. Actions read end-aligned in both directions. */
export function VehicleDialogFooter({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex flex-none flex-wrap items-center justify-end gap-2 border-t border-border px-4 py-3">
      {children}
    </div>
  )
}

/** Two columns above `sm`, one below. `full` on a field spans both. */
export function VehicleFieldGrid({
  children,
}: {
  children: React.ReactNode
}): React.JSX.Element {
  return <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">{children}</div>
}

export function VehicleField({
  id,
  label,
  hint,
  error,
  required = false,
  full = false,
  children,
}: {
  /** Must match the control's `id` so the label is associated. */
  id: string
  label: string
  hint?: string
  error?: string
  required?: boolean
  full?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', full && 'sm:col-span-2')}>
      <Label htmlFor={id}>
        {label}
        {required && (
          <span aria-hidden className="ms-0.5 text-accent">
            *
          </span>
        )}
      </Label>
      {children}
      {hint && <span className="text-[0.72em] leading-snug text-muted-foreground">{hint}</span>}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  )
}

/**
 * The one error region per dialog: client validation first, then whatever the
 * server rejected. `id` is what the offending controls point at with
 * `aria-describedby`, so a screen reader reaches the reason from the field.
 */
export function VehicleFormAlert({
  id,
  message,
}: {
  id: string
  message: string | null
}): React.JSX.Element | null {
  if (!message) return null
  return (
    <p
      id={id}
      role="alert"
      className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
    >
      <AlertTriangle aria-hidden strokeWidth={1.75} className="mt-px h-3.5 w-3.5 shrink-0" />
      <span dir="auto">{message}</span>
    </p>
  )
}

/**
 * The optional driver on a fine or an accident report. `EmployeePicker` is a
 * combobox without an id to label, so the group carries the label instead —
 * a screen reader announces «Employee» on entry — and the hint states what an
 * empty selection means, because an imported fine legitimately has no driver.
 */
export function VehicleEmployeeField({
  employeeId,
  onChange,
  hint,
}: {
  employeeId: string | null
  onChange: (employeeId: string | null) => void
  hint: string
}): React.JSX.Element {
  const { t } = useTranslation()
  const labelId = useId()
  return (
    <div className="flex min-w-0 flex-col gap-1.5 sm:col-span-2">
      <Label id={labelId}>{t('vehicles.employeePicker')}</Label>
      <div role="group" aria-labelledby={labelId}>
        <EmployeePicker selectedId={employeeId} onSelect={onChange} />
      </div>
      <span className="text-[0.72em] leading-snug text-muted-foreground">{hint}</span>
    </div>
  )
}

/** A drop zone that, once a file is chosen, shows its name with a clear
 *  button — the operator has to be able to see and undo the choice before the
 *  upload happens on submit. */
export function UploadSlot({
  label,
  accept,
  file,
  onFile,
  onClear,
  clearLabel,
  disabled = false,
  hint,
}: {
  label: string
  accept: string
  file: File | null
  onFile: (file: File) => void
  onClear: () => void
  clearLabel: string
  disabled?: boolean
  hint?: string
}): React.JSX.Element {
  if (file) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2">
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium uppercase tracking-[0.08em] text-muted-foreground">
            {label}
          </span>
          <span className="block truncate text-sm text-foreground" dir="auto">
            {file.name}
          </span>
        </span>
        <button
          type="button"
          onClick={onClear}
          disabled={disabled}
          aria-label={clearLabel}
          title={clearLabel}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-surface-tinted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
        >
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
    )
  }
  return (
    <FileUploadZone
      accept={accept}
      label={label}
      hint={hint}
      disabled={disabled}
      onFile={onFile}
    />
  )
}
