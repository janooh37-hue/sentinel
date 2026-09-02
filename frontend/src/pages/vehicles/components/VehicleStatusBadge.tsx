/**
 * VehicleStatusBadge — the module's three state families on one badge:
 * license expiry (valid / due soon / expired), maintenance due-date
 * (overdue / due soon / scheduled) and accident status (open / closed).
 *
 * Every badge carries a glyph AND its translated word, so the state survives
 * greyscale printing, colour blindness and a screen reader (PRODUCT.md: never
 * signal state by colour alone). Pass `onClick` for the accidents register,
 * where the badge itself is the open/closed toggle; it then renders as a real
 * button with a focus ring.
 *
 * A toggle has to say what pressing it does, not only what the record is:
 * `actionLabel` is appended to the visible word for the button's accessible
 * name («Open · Mark as closed»), which names the action while keeping the
 * visible label inside the name (WCAG 2.5.3), and `pressed` publishes the
 * toggle state as `aria-pressed`. Both are optional and only reach the button
 * form: a badge without `onClick` stays a plain `<span>` we do not relabel,
 * and a call site that passes neither behaves exactly as before.
 */

import { AlertTriangle, CalendarClock, CheckCircle2, CircleDot, Clock } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Badge } from '@/components/ui/badge'
import { badgeVariants } from '@/components/ui/badge-variants'
import { cn } from '@/lib/utils'

import {
  accidentTone,
  dueTone,
  expiryTone,
  type AccidentStatus,
  type DueState,
  type ExpiryStatus,
  type VehicleTone,
} from '../vehicleUtils'

type Family =
  | { family: 'expiry'; status: ExpiryStatus }
  | { family: 'due'; status: DueState }
  | { family: 'accident'; status: AccidentStatus }

type Props = Family & {
  className?: string
  /** Turns the badge into a toggle button. */
  onClick?: () => void
  /** Only meaningful together with `onClick`. */
  disabled?: boolean
  /** Extra context for the toggle (e.g. "Mark as closed"). */
  title?: string
  /**
   * What pressing the toggle does («Mark as closed»). Appended to the visible
   * state word for the button's accessible name, so the name both matches the
   * visible label and states the action. Ignored without `onClick`.
   */
  actionLabel?: string
  /** Publishes `aria-pressed` on the toggle. Omit for a plain action. */
  pressed?: boolean
}

const ICONS = {
  valid: CheckCircle2,
  due: Clock,
  expired: AlertTriangle,
  overdue: AlertTriangle,
  scheduled: CalendarClock,
  open: CircleDot,
  closed: CheckCircle2,
} as const

export function VehicleStatusBadge(props: Props): React.JSX.Element {
  const { t } = useTranslation()
  const { className, onClick, disabled = false, title, actionLabel, pressed } = props

  const tone: VehicleTone =
    props.family === 'expiry'
      ? expiryTone(props.status)
      : props.family === 'due'
        ? dueTone(props.status)
        : accidentTone(props.status)

  // `valid | expired | overdue | scheduled` are their own locale keys; the
  // accident pair is named differently, and a maintenance date that is merely
  // approaching says «Due soon» — `vehicles.due` is the license wording
  // («ينتهي قريباً», an expiry), which a service date must not borrow.
  const label =
    props.family === 'accident'
      ? t(props.status === 'open' ? 'vehicles.openStatus' : 'vehicles.closedStatus')
      : props.family === 'due' && props.status === 'due'
        ? t('vehicles.dueSoon')
        : t(`vehicles.${props.status}`)

  const Icon = ICONS[props.status]
  const content = (
    <>
      <Icon aria-hidden strokeWidth={2} className="h-3 w-3 shrink-0" />
      {label}
    </>
  )

  if (!onClick) {
    return (
      <Badge tone={tone} className={className} title={title}>
        {content}
      </Badge>
    )
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      // «Open · Mark as closed»: the visible word stays inside the accessible
      // name, and the action is what a screen-reader user hears they can do.
      aria-label={actionLabel ? `${label} · ${actionLabel}` : undefined}
      aria-pressed={pressed}
      className={cn(
        badgeVariants({ tone }),
        'transition-[filter,opacity] hover:brightness-[0.97] disabled:cursor-not-allowed disabled:opacity-60',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background',
        'motion-reduce:transition-none',
        className,
      )}
    >
      {content}
    </button>
  )
}
