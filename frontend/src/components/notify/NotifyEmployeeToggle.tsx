/**
 * NotifyEmployeeToggle — the On-by-default "notify the employee" switch shared by
 * the form-generation preview (per-book opt-out) and the leave Approve action
 * (per-approval opt-out). A button styled as a switch (role="switch") so the
 * whole control is keyboard/AT-accessible; RTL-safe via logical `ms-auto` and a
 * mirrored thumb translate. `hint` is optional — the leave surfaces render just
 * the label.
 */

import { cn } from '@/lib/utils'

interface NotifyEmployeeToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label: string
  hint?: string
  /** Extra classes for the outer row (e.g. spacing). */
  className?: string
}

export function NotifyEmployeeToggle({
  checked,
  onChange,
  label,
  hint,
  className,
}: NotifyEmployeeToggleProps): React.JSX.Element {
  return (
    <label
      className={cn(
        'flex items-center gap-3 rounded-md border border-hairline bg-muted/20 px-3 py-2.5',
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block text-[0.85em] font-medium text-foreground">{label}</span>
        {hint !== undefined && (
          <span className="mt-0.5 block text-[0.75em] text-muted-foreground">{hint}</span>
        )}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          'relative ms-auto inline-flex h-6 w-11 shrink-0 items-center rounded-full px-0.5 transition-colors',
          checked ? 'bg-primary' : 'bg-muted',
        )}
      >
        <span
          className={cn(
            'inline-block h-5 w-5 rounded-full bg-white shadow transition-transform',
            checked ? 'translate-x-5 rtl:-translate-x-5' : 'translate-x-0',
          )}
        />
      </button>
    </label>
  )
}
